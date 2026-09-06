import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ItineraryRouteCard } from '../../src/renderer/src/ItineraryRouteCard'
import type { EvidenceClaim } from '../../src/shared/schema/evidence'
import {
  ItineraryGoalSchema,
  type ItineraryGoal,
  type MultiCityRouteSnapshot,
  type RoutePlanPreview
} from '../../src/shared/schema/itinerary'
import {
  buildMultiCityRouteCandidates,
  buildMultiCityRouteSourcePlan
} from '../../src/main/skills/s03-route-candidates'

const SESSION_ID = 'route-render'
const NOW = '2026-08-30T12:00:00.000Z'
const GOAL: ItineraryGoal = ItineraryGoalSchema.parse({
  regionGoal: '云南',
  originCity: '广州',
  startDate: '2026-09-08',
  endDate: '2026-09-17',
  totalDays: 10,
  totalNights: 9,
  travelers: [
    {
      count: 2,
      ageBand: 'ADULT',
      relationship: '家人',
      stamina: 'MEDIUM',
      careNeeds: [],
      functionalLimits: []
    }
  ],
  budget: {
    currency: 'CNY',
    basis: 'TOTAL',
    targetMinor: 3000000,
    flexibleRangeMinor: null,
    hardCapMinor: null,
    inclusions: ['TRANSPORT', 'ACCOMMODATION']
  },
  intensity: 'RELAXED',
  mandatoryPlaces: [
    { placeId: 'must-erhai', displayName: '洱海', nodeCity: '大理' },
    { placeId: 'must-yulong', displayName: '玉龙雪山', nodeCity: '丽江' },
    { placeId: 'must-banna', displayName: '西双版纳', nodeCity: '西双版纳' }
  ]
})

function routeClaims(): EvidenceClaim[] {
  return buildMultiCityRouteSourcePlan(GOAL).plannedCalls.map((call, index) => ({
    claimId: `render-route-claim-${index + 1}`,
    sessionId: SESSION_ID,
    subject: `${call.travelDate} ${call.fromCity}→${call.toCity}`,
    predicate: 'routeLeg',
    value: {
      fromCity: call.fromCity,
      toCity: call.toCity,
      travelDate: call.travelDate,
      mode: 'RAIL',
      label: `${call.fromCity}→${call.toCity}`,
      durationMinutes: 120,
      costCents: null,
      transferCount: 0,
      overnightArrival: false
    },
    sourceId: 'SRC_RAIL',
    sourceRef: `route-render:${call.callId}`,
    contentIdentity: 'TRANSACTION',
    verificationStatus: 'VERIFIED',
    observedAt: NOW,
    validUntil: '2026-09-18T00:00:00.000Z',
    confidence: null,
    conflictsWith: [],
    notes: null
  }))
}

test('route UI renders evidence-aware candidates, explicit unknowns and Kunming reasoning without calls', () => {
  const result = buildMultiCityRouteCandidates({
    sessionId: SESSION_ID,
    goal: GOAL,
    claims: routeClaims(),
    now: NOW
  })
  const snapshot: MultiCityRouteSnapshot = {
    sessionId: SESSION_ID,
    stage: 'STAGE_2',
    goal: GOAL,
    candidates: result.candidates,
    selectedRouteId: null,
    sourceOutcomes: [],
    blockingReasons: result.blockingReasons
  }
  let calls = 0
  const noCall = async (): Promise<void> => {
    calls += 1
  }
  const noApply = async (): Promise<boolean> => {
    calls += 1
    return false
  }
  const markup = renderToStaticMarkup(
    createElement(ItineraryRouteCard, {
      snapshot,
      preview: null,
      operationId: null,
      onPreview: noCall,
      onExecute: noCall,
      onCancel: noCall,
      onSelect: noCall,
      onApplyManualEvidence: noApply,
      onManualDirtyChange: () => undefined
    })
  )

  assert.match(markup, /一个总目标 · 不拆会话/)
  assert.match(markup, /洱海、玉龙雪山、西双版纳/)
  assert.match(markup, /综合推荐/)
  assert.match(markup, /费用 UNKNOWN/)
  assert.equal((markup.match(/class="route-candidate(?: |")/g) ?? []).length, 3)
  assert.equal((markup.match(/aria-label="路线优势"/g) ?? []).length, 3)
  assert.equal((markup.match(/aria-label="路线代价与未知项"/g) ?? []).length, 3)
  assert.match(markup, /硬约束 通过/)
  assert.match(markup, /关键证据 完整/)
  assert.match(markup, /未核验腿 0/)
  assert.match(markup, /夜间到达 0/)
  assert.match(markup, /折返分/)
  assert.match(markup, /海拔/)
  assert.match(markup, /费用完整度 不完整/)
  assert.match(markup, /昆明：/)
  assert.match(markup, /route-spine/)
  assert.match(markup, /选择这条路线并进入 STAGE-3/)
  assert.equal(calls, 0)
})

test('route UI exposes exact zero-call authorization and hides selection when every route is blocked', () => {
  const sourcePlan = buildMultiCityRouteSourcePlan(GOAL)
  const blocked = buildMultiCityRouteCandidates({
    sessionId: SESSION_ID,
    goal: GOAL,
    claims: routeClaims().filter((claim) => {
      const value = claim.value as { fromCity?: string; toCity?: string }
      return value.fromCity !== '西双版纳' && value.toCity !== '西双版纳'
    }),
    now: NOW
  })
  const preview: RoutePlanPreview = {
    sessionId: SESSION_ID,
    planId: '123e4567-e89b-42d3-a456-426614174000',
    expiresAt: '2026-08-30T13:00:00.000Z',
    digest: `sha256:${'a'.repeat(64)}`,
    goal: GOAL,
    topologySignatures: sourcePlan.topologySignatures,
    plannedCalls: sourcePlan.plannedCalls,
    totalExternalCalls: sourcePlan.plannedCalls.length,
    retryCount: 0
  }
  const snapshot: MultiCityRouteSnapshot = {
    sessionId: SESSION_ID,
    stage: 'STAGE_2',
    goal: GOAL,
    candidates: blocked.candidates,
    selectedRouteId: null,
    sourceOutcomes: [],
    blockingReasons: blocked.blockingReasons
  }
  const noCall = async (): Promise<void> => undefined
  const noApply = async (): Promise<boolean> => false
  const markup = renderToStaticMarkup(
    createElement(ItineraryRouteCard, {
      snapshot,
      preview,
      operationId: null,
      onPreview: noCall,
      onExecute: noCall,
      onCancel: noCall,
      onSelect: noCall,
      onApplyManualEvidence: noApply,
      onManualDirtyChange: () => undefined
    })
  )

  assert.match(markup, new RegExp(`${sourcePlan.plannedCalls.length} 次只读铁路调用`))
  assert.match(markup, /串行 · retry=0/)
  assert.match(markup, /明确执行此路线核验计划/)
  assert.match(markup, /缺少可用交通证据/)
  assert.equal((markup.match(/aria-label="路线优势"/g) ?? []).length, 3)
  assert.equal((markup.match(/aria-label="路线代价与未知项"/g) ?? []).length, 3)
  assert.match(markup, /关键证据 不完整/)
  assert.match(markup, /交通腿未核验/)
  assert.match(markup, /人工补证范围（只读）/)
  assert.match(markup, /人工航班/)
  assert.match(markup, /人工客运/)
  assert.match(markup, /来源链接（HTTPS）/)
  assert.match(markup, /只写本地事件，不调用交通来源或模型/)
  assert.doesNotMatch(markup, /选择这条路线并进入 STAGE-3/)
})

test('route CSS stacks candidates and leg facts at the existing narrow breakpoint', async () => {
  const css = await readFile(
    new URL('../../src/renderer/src/assets/main.css', import.meta.url),
    'utf8'
  )
  assert.match(css, /@media \(max-width: 980px\)/)
  assert.match(css, /body\s*\{\s*min-width: 0/)
  assert.match(css, /\.route-candidate-grid\s*\{\s*grid-template-columns: 1fr/)
  assert.match(css, /\.route-leg\s*\{\s*grid-template-columns: repeat\(2/)
  assert.match(css, /\.route-comparison-grid\s*\{[\s\S]*grid-template-columns: 1fr/)
})
