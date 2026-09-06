import {
  EnvelopeAssessmentSchema,
  EnvelopeComparisonSchema,
  type EnvelopeAssessment,
  type EnvelopeComparison,
  type EnvelopeViolation
} from '../../shared/schema/envelope'
import type { TravelBasics } from '../../shared/schema/interview'

export const M0_ENVELOPE_VERSION = 'M0-ENVELOPE-v1.1'

export function assessM0Envelope(
  basics: TravelBasics,
  options: { allowFuzzyDestination?: boolean } = {}
): EnvelopeAssessment {
  const violations: EnvelopeViolation[] = []
  const travelerCount = basics.travelers.reduce((sum, group) => sum + group.count, 0)
  const childCount = basics.travelers
    .filter((group) => group.ageBand === 'CHILD')
    .reduce((sum, group) => sum + group.count, 0)
  const olderAdultCount = basics.travelers
    .filter((group) => group.ageBand === 'OLDER_ADULT')
    .reduce((sum, group) => sum + group.count, 0)
  const duration = durationDays(basics)
  const multiCityRoute = basics.itineraryIntent != null

  if (basics.originCities.length !== 1) {
    violations.push({
      dimension: 'ORIGIN_COUNT',
      actual: basics.originCities.length,
      minimum: 1,
      maximum: 1,
      message: `M0 只支持一个出发城市，当前为 ${basics.originCities.length} 个。`
    })
  }
  const fuzzyDestinationAllowed =
    options.allowFuzzyDestination === true &&
    basics.destinationCities.length === 0 &&
    basics.destinationIntent !== null
  const destinationCountAllowed = multiCityRoute
    ? basics.destinationCities.length >= 2 && basics.destinationCities.length <= 6
    : basics.destinationCities.length === 1 || fuzzyDestinationAllowed
  if (!destinationCountAllowed) {
    violations.push({
      dimension: 'DESTINATION_COUNT',
      actual: basics.destinationCities.length,
      minimum: multiCityRoute ? 2 : 1,
      maximum: multiCityRoute ? 6 : 1,
      message:
        basics.destinationCities.length === 0
          ? '目的地仍为筛选意图，需在 D3 用有来源事实收敛为一个城市。'
          : multiCityRoute
            ? `多城市路线支持 2 至 6 个目的地节点，当前为 ${basics.destinationCities.length} 个。`
            : `M0 只支持一个目的地城市，当前为 ${basics.destinationCities.length} 个。`
    })
  }
  pushRangeViolation(violations, 'DURATION', duration, 3, multiCityRoute ? 31 : 6, '日历日')
  pushRangeViolation(violations, 'TRAVELER_COUNT', travelerCount, 2, 6, '位同行者')
  pushRangeViolation(violations, 'CHILD_COUNT', childCount, 0, 2, '位儿童')
  pushRangeViolation(violations, 'OLDER_ADULT_COUNT', olderAdultCount, 0, 2, '位老人')
  const staySegmentsAllowed = multiCityRoute
    ? basics.staySegments >= 2 && basics.staySegments <= 8
    : basics.staySegments === 1
  if (!staySegmentsAllowed) {
    violations.push({
      dimension: 'STAY_SEGMENTS',
      actual: basics.staySegments,
      minimum: multiCityRoute ? 2 : 1,
      maximum: multiCityRoute ? 8 : 1,
      message: multiCityRoute
        ? `多城市路线支持 2 至 8 个住宿段，当前为 ${basics.staySegments} 个。`
        : `M0 整趟只支持一个住宿段，当前为 ${basics.staySegments} 个。`
    })
  }

  return EnvelopeAssessmentSchema.parse({
    withinEnvelope: violations.length === 0,
    violations,
    canSplit:
      !multiCityRoute &&
      (basics.destinationCities.length > 1 ||
        basics.originCities.length > 1 ||
        basics.staySegments > 1)
  })
}

export function buildEnvelopeComparison(assessment: EnvelopeAssessment): EnvelopeComparison {
  return EnvelopeComparisonSchema.parse({
    assessment,
    options: [
      {
        id: 'SPLIT',
        gains: '保留每个城市或住宿段，并让每个子会话获得包络内的完整规划。',
        losses: '没有跨段联合预算、统一时间轴或全局取舍。',
        manualBurden: '城际交通、换酒店、行李和段间衔接需要用户自行确认。',
        qualityDifference: '单段质量保持，但整趟行程的全局优化弱于单一包络内行程。'
      },
      {
        id: 'SHRINK',
        gains: '保留一个包络内行程，后续可获得端到端完整优化。',
        losses: '需要舍弃多余目的地、住宿变更或其他超出范围的部分。',
        manualBurden: '用户需要明确选择保留范围并自行处理被舍弃部分。',
        qualityDifference: '保留部分的规划质量最高，但覆盖面缩小。'
      }
    ]
  })
}

function durationDays(basics: TravelBasics): number {
  if (basics.dates.kind === 'FLEXIBLE') return basics.dates.durationDays
  const start = Date.parse(`${basics.dates.startDate}T00:00:00.000Z`)
  const end = Date.parse(`${basics.dates.endDate}T00:00:00.000Z`)
  return Math.floor((end - start) / 86_400_000) + 1
}

function pushRangeViolation(
  violations: EnvelopeViolation[],
  dimension: EnvelopeViolation['dimension'],
  actual: number,
  minimum: number,
  maximum: number,
  unit: string
): void {
  if (actual >= minimum && actual <= maximum) return
  violations.push({
    dimension,
    actual,
    minimum,
    maximum,
    message: `M0 支持 ${minimum} 至 ${maximum}${unit}，当前为 ${actual}${unit}。`
  })
}
