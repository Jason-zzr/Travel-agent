import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { z } from 'zod'
import {
  normalizeVariflightFlightPriceStructure,
  VariflightFlightPriceNormalizedSchema,
  VariflightFlightPriceRawSchema,
  VariflightFlightPriceToolResultSchema
} from './flight'

const fixtureUrl = new URL(
  '../../../../test/fixtures/variflight/get-flight-price-by-cities.structure-only.synthetic.json',
  import.meta.url
)

const textEnvelope = (text: string, isError?: boolean): unknown => ({
  content: [{ type: 'text', text }],
  ...(isError === undefined ? {} : { isError })
})

async function fixture(): Promise<unknown> {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'))
}

test('VariFlight LOCAL raw contract accepts only observed keys and primitive types', async () => {
  const raw = VariflightFlightPriceRawSchema.parse(await fixture())
  assert.equal(raw.data.length, 2)
  assert.equal(raw.data[0]?.cabins?.length, 1)
  assert.deepEqual(VariflightFlightPriceRawSchema.parse({ ...raw, data: [] }).data, [])
  assert.deepEqual(raw.data[1]?.cabins, [])
  assert.deepEqual(normalizeVariflightFlightPriceStructure({ ...raw, data: [] }).flights, [])
})

test('VariFlight LOCAL raw contract rejects envelope, item, cabin, and type drift', async () => {
  const raw = VariflightFlightPriceRawSchema.parse(await fixture())
  assert.throws(() => VariflightFlightPriceRawSchema.parse({ ...raw, extra: true }), z.ZodError)
  assert.throws(
    () =>
      VariflightFlightPriceRawSchema.parse({
        ...raw,
        data: [{ ...raw.data[0], extra: true }]
      }),
    z.ZodError
  )
  assert.throws(
    () =>
      VariflightFlightPriceRawSchema.parse({
        ...raw,
        data: [{ cabins: [{ ...(raw.data[0]?.cabins?.[0] ?? {}), extra: true }] }]
      }),
    z.ZodError
  )
  assert.throws(
    () => VariflightFlightPriceRawSchema.parse({ ...raw, code: String(raw.code) }),
    z.ZodError
  )
  assert.throws(
    () => VariflightFlightPriceRawSchema.parse({ ...raw, data: [{ cabins: [{}] }] }),
    z.ZodError
  )
  assert.throws(() => VariflightFlightPriceRawSchema.parse({ ...raw, data: [{}] }), z.ZodError)
  const missingMessage: Partial<typeof raw> = structuredClone(raw)
  delete missingMessage.message
  assert.throws(() => VariflightFlightPriceRawSchema.parse(missingMessage), z.ZodError)
})

test('VariFlight LOCAL text envelope validates JSON success and preserves explicit errors', async () => {
  const raw = await fixture()
  assert.equal(
    VariflightFlightPriceToolResultSchema.parse(textEnvelope(JSON.stringify(raw))).isError,
    undefined
  )
  assert.equal(
    VariflightFlightPriceToolResultSchema.parse(textEnvelope('opaque provider error', true))
      .isError,
    true
  )
  assert.throws(
    () => VariflightFlightPriceToolResultSchema.parse(textEnvelope('not-json')),
    z.ZodError
  )
  assert.throws(
    () =>
      VariflightFlightPriceToolResultSchema.parse({
        ...textEnvelope(JSON.stringify(raw)),
        structuredContent: raw
      }),
    z.ZodError
  )
  assert.throws(
    () =>
      VariflightFlightPriceToolResultSchema.parse({
        content: [
          { type: 'text', text: JSON.stringify(raw) },
          { type: 'text', text: 'unvalidated-secondary-payload' }
        ]
      }),
    z.ZodError
  )
  assert.throws(
    () =>
      VariflightFlightPriceToolResultSchema.parse({
        content: [{ type: 'text', text: JSON.stringify(raw), extra: true }]
      }),
    z.ZodError
  )
  assert.throws(
    () => VariflightFlightPriceToolResultSchema.parse({ structuredContent: raw }),
    z.ZodError
  )
})

test('VariFlight LOCAL structure normalizer copies only observed fields and invents no semantics', async () => {
  const normalized = normalizeVariflightFlightPriceStructure(await fixture())
  VariflightFlightPriceNormalizedSchema.parse(normalized)
  assert.equal(normalized.mappingStatus, 'LOCAL_STRUCTURE_ONLY')
  assert.equal(normalized.flights[0]?.flightNumberRaw, 'SYNTHETIC-FLIGHT')
  assert.equal(normalized.flights[1]?.flightNumberRaw, null)
  assert.deepEqual(normalized.flights[1]?.cabins, [])
  const sparse = normalizeVariflightFlightPriceStructure({
    ...VariflightFlightPriceRawSchema.parse(await fixture()),
    data: [{ flightno: 'SPARSE-SYNTHETIC-FLIGHT' }]
  }).flights[0]!
  assert.equal(sparse.flightNumberRaw, 'SPARSE-SYNTHETIC-FLIGHT')
  assert.equal(sparse.flightCompanyRaw, null)
  assert.equal(sparse.departureDateRaw, null)
  assert.equal(sparse.cabins, null)
  for (const flight of normalized.flights) {
    assert.deepEqual(
      {
        startAt: flight.startAt,
        endAt: flight.endAt,
        durationMinutes: flight.durationMinutes,
        costCents: flight.costCents,
        currency: flight.currency,
        transferCount: flight.transferCount,
        overnightArrival: flight.overnightArrival
      },
      {
        startAt: null,
        endAt: null,
        durationMinutes: null,
        costCents: null,
        currency: null,
        transferCount: null,
        overnightArrival: null
      }
    )
  }
})
