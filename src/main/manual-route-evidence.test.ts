import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../shared/errors'
import {
  ManualRouteLegEvidenceRequestSchema,
  type ManualRouteLegEvidenceRequest
} from '../shared/schema/itinerary'
import { materializeManualRouteLegEvidence } from './manual-route-evidence'

const REQUEST: ManualRouteLegEvidenceRequest = ManualRouteLegEvidenceRequestSchema.parse({
  sessionId: 'manual-route-session',
  routeId: 'route-balanced',
  legId: 'leg-banna-return',
  mode: 'MANUAL_FLIGHT',
  startAt: '2026-09-16T23:10:00+08:00',
  endAt: '2026-09-17T01:40:00+08:00',
  label: 'MU9001',
  costCents: 96800,
  sourceLabel: '航司官网行程页',
  sourceUrl: 'https://example.com/flights/MU9001',
  summary: '用户核对了班次、日期、起降城市和当地时间。',
  confirmed: true
})

test('manual route-leg schema rejects unsafe, unconfirmed, reversed, and extra input', () => {
  assert.equal(ManualRouteLegEvidenceRequestSchema.parse(REQUEST).confirmed, true)
  assert.equal(
    ManualRouteLegEvidenceRequestSchema.safeParse({ ...REQUEST, confirmed: false }).success,
    false
  )
  assert.equal(
    ManualRouteLegEvidenceRequestSchema.safeParse({
      ...REQUEST,
      sourceUrl: 'http://example.com/flights/MU9001'
    }).success,
    false
  )
  assert.equal(
    ManualRouteLegEvidenceRequestSchema.safeParse({
      ...REQUEST,
      sourceUrl: 'https://example.com/flights?token=secret'
    }).success,
    false
  )
  assert.equal(
    ManualRouteLegEvidenceRequestSchema.safeParse({
      ...REQUEST,
      endAt: REQUEST.startAt
    }).success,
    false
  )
  assert.equal(
    ManualRouteLegEvidenceRequestSchema.safeParse({
      ...REQUEST,
      startAt: '2026-09-16T23:10:00'
    }).success,
    false
  )
  assert.equal(
    ManualRouteLegEvidenceRequestSchema.safeParse({ ...REQUEST, costCents: -1 }).success,
    false
  )
  assert.equal(
    ManualRouteLegEvidenceRequestSchema.safeParse({ ...REQUEST, mode: 'RAIL' }).success,
    false
  )
  assert.equal(
    ManualRouteLegEvidenceRequestSchema.safeParse({ ...REQUEST, fromCity: '伪造端点' }).success,
    false
  )
})

test('manual route-leg materialization is deterministic, scoped, redacted, and target-derived', () => {
  const confirmedAt = new Date('2026-08-31T03:00:00.000Z')
  const target = { fromCity: '西双版纳', toCity: '广州', travelDate: '2026-09-16' }
  const first = materializeManualRouteLegEvidence(REQUEST, target, confirmedAt)
  const second = materializeManualRouteLegEvidence(REQUEST, target, confirmedAt)

  assert.deepEqual(second, first)
  assert.deepEqual(first.scope, { kind: 'ROUTE_GOAL_LEG', ...target })
  assert.equal(first.value.fromCity, target.fromCity)
  assert.equal(first.value.toCity, target.toCity)
  assert.equal(first.value.travelDate, target.travelDate)
  assert.equal(first.value.durationMinutes, 150)
  assert.equal(first.value.overnightArrival, true)
  assert.equal(first.claim.sourceId, 'USER_RESEARCH')
  assert.equal(first.claim.verificationStatus, 'VERIFIED_BY_USER')
  assert.equal(first.claim.scope?.kind, 'ROUTE_GOAL_LEG')
  assert.ok(first.claim.sourceRef.startsWith('USER_RESEARCH:'))
  assert.equal(first.claim.sourceRef.includes(REQUEST.sourceUrl), false)
  assert.equal(first.claim.sourceRef.includes(REQUEST.summary), false)
})

test('manual route-leg materialization rejects a start date outside the current leg', () => {
  assert.throws(
    () =>
      materializeManualRouteLegEvidence(REQUEST, {
        fromCity: '西双版纳',
        toCity: '广州',
        travelDate: '2026-09-15'
      }),
    (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
  )
})
