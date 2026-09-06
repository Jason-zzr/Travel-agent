import { AppError } from '../../shared/errors'
import {
  ConfirmationCardSchema,
  InterviewTurnResultSchema,
  TravelBasicsSchema,
  type ConfirmationCard,
  type InterviewTurnResult,
  type TravelBasics,
  type TravelBasicsPatch
} from '../../shared/schema/interview'
import type { ProviderRuntime } from '../plugins/provider-runtime'

export const PEAK_CALENDAR_VERSION = 'CN-PEAK-2026-v1'

const PEAK_RANGES_2026 = [
  ['2026-02-15', '2026-02-23'],
  ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'],
  ['2026-06-19', '2026-06-21'],
  ['2026-10-01', '2026-10-07']
] as const

export interface InterviewStep {
  result: InterviewTurnResult
  basics: TravelBasics | null
  confirmationCard: ConfirmationCard | null
}

export class InterviewSkill {
  constructor(private readonly provider: ProviderRuntime) {}

  async run(
    sessionId: string,
    userText: string,
    current: TravelBasicsPatch | null,
    turnNumber: number
  ): Promise<InterviewStep> {
    if (turnNumber > 5) {
      throw new AppError('GATE_BLOCKED', '基础访谈超过五轮仍未形成完整确认卡。', {
        userHint: '基础信息仍不完整，请直接在确认表单中补齐。'
      })
    }
    const resultSchema = InterviewTurnResultSchema.superRefine((value, context) => {
      if (value.readiness !== 'READY') return
      const merged = { ...(current ?? {}), ...value.patch }
      const parsed = TravelBasicsSchema.safeParse(merged)
      if (!parsed.success) {
        context.addIssue({
          code: 'custom',
          message: `READY requires complete basics: ${parsed.error.issues
            .map((issue) => issue.path.join('.'))
            .join(', ')}`
        })
      }
    })
    const result = await this.provider.invokeStructured({
      sessionId,
      role: 'EXTRACTION',
      schema: resultSchema,
      system: [
        'You are SKILL-01 for a domestic travel harness.',
        'Extract only user-provided facts. Never invent a city, budget, traveler detail or date.',
        'Ask exactly one primary missing question and never repeat a known fact.',
        'Return JSON only. Mark READY only when the complete TravelBasics contract can be formed.',
        'A fuzzy destination must remain destinationIntent with destinationCities empty.',
        'When the user gives a region goal plus two or more mandatory places in distinct cities, set itineraryIntent.kind to MULTI_CITY_ROUTE, preserve regionGoal and mandatory place-to-city mappings, and treat destinationCities as an unordered set rather than a route order.',
        'For MULTI_CITY_ROUTE, extract a city-level originGatewayCity only when the user explicitly provides it. Keep a station, airport, address, hotel or pickup point in originPlaceLabel; never guess a gateway city from a precise place label.'
      ].join(' '),
      user: JSON.stringify({ current, turnNumber, userText })
    })
    const normalizedResult = InterviewTurnResultSchema.parse(result)
    const merged = TravelBasicsSchema.safeParse({ ...(current ?? {}), ...normalizedResult.patch })
    const basics = merged.success ? merged.data : null
    if (normalizedResult.readiness === 'READY' && basics === null) {
      throw new AppError('MODEL_OUTPUT_INVALID', '模型声明完成但基础信息仍不完整。')
    }
    return {
      result: normalizedResult,
      basics,
      confirmationCard: basics ? buildConfirmationCard(basics) : null
    }
  }
}

export function buildConfirmationCard(basics: TravelBasics): ConfirmationCard {
  const status = peakStatus(basics)
  return ConfirmationCardSchema.parse({
    basics,
    peakCalendarStatus: status,
    peakCalendarVersion: PEAK_CALENDAR_VERSION,
    requiresPeakConfirmation: status !== 'NORMAL'
  })
}

function peakStatus(basics: TravelBasics): 'NORMAL' | 'PEAK' | 'UNKNOWN' {
  const dates = basics.dates
  if (dates.kind === 'FLEXIBLE') {
    if (!dates.month.startsWith('2026-')) return 'UNKNOWN'
    return PEAK_RANGES_2026.some(([start, end]) =>
      rangesOverlap(`${dates.month}-01`, `${dates.month}-31`, start, end)
    )
      ? 'PEAK'
      : 'NORMAL'
  }
  if (!dates.startDate.startsWith('2026-') || !dates.endDate.startsWith('2026-')) {
    return 'UNKNOWN'
  }
  return PEAK_RANGES_2026.some(([start, end]) =>
    rangesOverlap(dates.startDate, dates.endDate, start, end)
  )
    ? 'PEAK'
    : 'NORMAL'
}

function rangesOverlap(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string
): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd
}
