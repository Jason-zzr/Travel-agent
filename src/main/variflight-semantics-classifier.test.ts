import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../shared/errors'
import type {
  VariflightFlightPriceArgs,
  VariflightFlightPriceRaw
} from '../shared/schema/mcp/flight'
import {
  classifyVariflightSemantics,
  VariflightSemanticSummarySchema
} from './probes/variflight-semantics-classifier'

const ARGS: VariflightFlightPriceArgs = {
  dep_city: 'JHG',
  arr_city: 'CAN',
  dep_date: '2026-09-17'
}

test('VariFlight semantic classifier retains only paths, enums, booleans, and counts', () => {
  const summary = classifyVariflightSemantics(completeFixture(), ARGS)

  assert.equal(summary.contractStatus, 'UNPROVEN')
  assert.equal(summary.classificationStatus, 'FORMAT_AND_CONSISTENCY_ONLY')
  assert.equal(summary.flightCount, 1)
  assert.equal(summary.cabinCount, 1)
  assert.equal(summary.requestBinding.departureCity.status, 'CONSISTENCY_PROVEN')
  assert.equal(summary.requestBinding.arrivalCity.status, 'CONSISTENCY_PROVEN')
  assert.equal(summary.requestBinding.departureDate.status, 'CONSISTENCY_PROVEN')
  assert.equal(summary.dateSemantics.departure.status, 'FORMAT_PROVEN')
  assert.equal(summary.timeSemantics.departure.unit, 'UNKNOWN')
  assert.equal(summary.timeSemantics.departure.timezone, 'UNKNOWN')
  assert.equal(summary.timeSemantics.departure.status, 'UNPROVEN')
  assert.equal(summary.priceSemantics.explicitCurrencyMetadataPresent, false)
  assert.equal(summary.priceSemantics.status, 'UNPROVEN')
  assert.equal(summary.stopShareSemantics.explicitEnumDefinitionPresent, false)
  assert.equal(summary.stopShareSemantics.status, 'UNPROVEN')
  assert.equal(summary.topLevelStatus.mapping, 'UNKNOWN')
  assert.equal(summary.rawResponseRetained, false)
  assert.equal(summary.valueRetention, false)
  assert.deepEqual(VariflightSemanticSummarySchema.parse(summary), summary)

  const serialized = JSON.stringify(summary)
  for (const rawValue of [
    'JHG',
    'CAN',
    '2026-09-17',
    'AQ1042',
    'fixture-request-sensitive',
    'fixture-provider-message',
    '589',
    '700'
  ]) {
    assert.equal(serialized.includes(rawValue), false)
  }
})

test('VariFlight semantic classifier reports conflicts without retaining conflicting values', () => {
  const fixture = completeFixture()
  fixture.data[0] = {
    ...fixture.data[0],
    depcitycode: 'KMG',
    depdate: '17/09/2026'
  }
  const summary = classifyVariflightSemantics(fixture, ARGS)

  assert.equal(summary.requestBinding.departureCity.status, 'UNPROVEN')
  assert.equal(summary.requestBinding.departureCity.mismatchCount, 1)
  assert.equal(summary.requestBinding.departureDate.status, 'UNPROVEN')
  assert.equal(summary.requestBinding.departureDate.mismatchCount, 1)
  assert.equal(summary.dateSemantics.departure.status, 'UNPROVEN')
  assert.equal(summary.conflicts.requestBinding, 2)
  assert.equal(JSON.stringify(summary).includes('KMG'), false)
  assert.equal(JSON.stringify(summary).includes('17/09/2026'), false)
})

test('VariFlight semantic classifier keeps empty and missing-field samples unproven', () => {
  const empty = classifyVariflightSemantics(
    {
      code: 0,
      message: 'fixture-empty',
      request_id: 'fixture-empty-request',
      timestamp: '2026-09-01T08:01:00+08:00',
      data: []
    },
    ARGS
  )
  assert.equal(empty.flightCount, 0)
  assert.equal(empty.requestBinding.departureCity.status, 'UNPROVEN')
  assert.equal(empty.dateSemantics.departure.status, 'UNPROVEN')
  assert.equal(empty.cabinStructure.status, 'UNPROVEN')

  const missing = classifyVariflightSemantics(
    {
      code: 0,
      message: 'fixture-missing',
      request_id: 'fixture-missing-request',
      timestamp: '2026-09-01T08:01:00+08:00',
      data: [{ flightno: 'AQ1042' }]
    },
    ARGS
  )
  assert.equal(missing.requestBinding.departureCity.missingCount, 1)
  assert.equal(missing.requestBinding.arrivalCity.missingCount, 1)
  assert.equal(missing.requestBinding.departureDate.status, 'UNPROVEN')
  assert.equal(JSON.stringify(missing).includes('AQ1042'), false)
})

test('VariFlight semantic classifier rejects unbounded flight and cabin arrays', () => {
  const tooManyFlights = completeFixture()
  tooManyFlights.data = Array.from({ length: 65 }, () => ({ depcitycode: 'JHG' }))
  assert.throws(() => classifyVariflightSemantics(tooManyFlights, ARGS), isAppError('SOURCE_DRIFT'))

  const tooManyCabins = completeFixture()
  tooManyCabins.data[0] = {
    ...tooManyCabins.data[0],
    cabins: Array.from({ length: 65 }, () => ({ price: 589 }))
  }
  assert.throws(() => classifyVariflightSemantics(tooManyCabins, ARGS), isAppError('SOURCE_DRIFT'))
})

test('VariFlight semantic summary schema rejects arbitrary retained fields', () => {
  const summary = classifyVariflightSemantics(completeFixture(), ARGS)
  assert.equal(
    VariflightSemanticSummarySchema.safeParse({ ...summary, rawProviderValue: 'AQ1042' }).success,
    false
  )
})

function completeFixture(): VariflightFlightPriceRaw {
  return {
    code: 0,
    message: 'fixture-provider-message',
    request_id: 'fixture-request-sensitive',
    timestamp: '2026-09-01T08:01:00+08:00',
    data: [
      {
        depcitycode: 'JHG',
        arrcitycode: 'CAN',
        depdate: '2026-09-17',
        arrdate: '2026-09-17',
        flightno: 'AQ1042',
        flightdeptimeplandate: 1_789_609_500_000,
        flightarrtimeplandate: 1_789_618_500_000,
        oilfee: '50',
        tax: '0',
        stopflag: 0,
        shareflag: 0,
        cabins: [
          {
            cabinclass: 'Y',
            price: 589,
            stprice: 700,
            seatnum: 5,
            discount: 0.84
          }
        ]
      }
    ]
  }
}

function isAppError(code: AppError['code']): (error: unknown) => boolean {
  return (error: unknown) => error instanceof AppError && error.code === code
}
