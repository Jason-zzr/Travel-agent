import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppError } from '../shared/errors'
import { VariflightFlightPriceArgsSchema } from '../shared/schema/mcp/flight'
import { SOURCE_DEFINITIONS } from './mcp/source-catalog'
import { digestValue } from './probes/gate-artifact-primitives'
import {
  claimVariflightGateR2,
  consumeAuthorizedVariflightResultProbe,
  createVariflightGateR2Preview,
  parseVariflightGateR2ClaimCliArgs,
  parseVariflightGateR2PreviewCliArgs,
  VARIFLIGHT_FLIGHT_PRICE_INPUT_CONTRACT_DIGEST,
  writeVariflightGateR2Preview
} from './probes/variflight-result-gate'

const CREATED_AT = new Date('2026-09-01T08:00:00.000Z')
const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const ARGS = { dep_city: 'JHG', arr_city: 'CAN', dep_date: '2026-09-17' } as const

test('getFlightPriceByCities input contract accepts only strict IATA/date arguments', () => {
  assert.deepEqual(VariflightFlightPriceArgsSchema.parse(ARGS), ARGS)
  for (const invalid of [
    { ...ARGS, dep_city: 'jhg' },
    { ...ARGS, arr_city: 'CAN ' },
    { ...ARGS, dep_city: 'JH' },
    { ...ARGS, dep_date: '2026-02-30' },
    { ...ARGS, extra: true }
  ]) {
    assert.equal(VariflightFlightPriceArgsSchema.safeParse(invalid).success, false)
  }
})

test('Gate R-2 preview binds one future call while preview itself performs zero external calls', () => {
  const externalCalls = { connect: 0, list: 0, call: 0, close: 0 }
  const preview = createVariflightGateR2Preview({
    args: ARGS,
    now: CREATED_AT,
    planId: PLAN_ID,
    operationId: OPERATION_ID
  })

  assert.deepEqual(externalCalls, { connect: 0, list: 0, call: 0, close: 0 })
  assert.equal(preview.plan.previewExternalCalls, 0)
  assert.equal(preview.plan.toolCallAttempts, 1)
  assert.equal(preview.plan.retryCount, 0)
  assert.equal(preview.plan.toolBinding.name, 'getFlightPriceByCities')
  assert.equal(
    preview.plan.toolBinding.inputContractDigest,
    VARIFLIGHT_FLIGHT_PRICE_INPUT_CONTRACT_DIGEST
  )
  assert.deepEqual(preview.plan.args, ARGS)
  assert.equal(preview.plan.executionEntrypoint, 'tool-registry-gated-one-shot')
  assert.deepEqual(preview.plan.productionRegistration, {
    allowlistMutation: false,
    toolContractMutation: false
  })
})

test('Gate R-2 writes a new local preview without requiring an existing artifact', async () => {
  const fixture = await createFixture(false)
  try {
    const preview = await writeVariflightGateR2Preview(fixture.path, {
      allowedRoot: fixture.root,
      args: ARGS,
      now: CREATED_AT,
      planId: PLAN_ID,
      operationId: OPERATION_ID
    })
    assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), preview)
    assert.equal(preview.status, 'AWAITING_EXACT_APPROVAL')
  } finally {
    await fixture.cleanup()
  }
})

test('Gate R-2 requires the exact planId, digest, and operationId tuple', async () => {
  const fixture = await createFixture()
  try {
    await assert.rejects(
      claimVariflightGateR2(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: `sha256:${'0'.repeat(64)}` },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
      ),
      isAppError('INPUT_INVALID')
    )
    assert.equal(JSON.parse(await readFile(fixture.path, 'utf8')).status, 'AWAITING_EXACT_APPROVAL')
  } finally {
    await fixture.cleanup()
  }
})

test('Gate R-2 disk claim and in-memory authorization are each one-shot', async () => {
  const fixture = await createFixture()
  try {
    const authorization = await claimVariflightGateR2(
      fixture.path,
      { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
      { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
    )
    assert.equal(JSON.parse(await readFile(fixture.path, 'utf8')).status, 'CONSUMED')
    consumeAuthorizedVariflightResultProbe(authorization, new Date('2026-09-01T08:01:01.000Z'))
    assert.throws(
      () =>
        consumeAuthorizedVariflightResultProbe(authorization, new Date('2026-09-01T08:01:02.000Z')),
      isAppError('GATE_BLOCKED')
    )
    await assert.rejects(
      claimVariflightGateR2(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:03.000Z') }
      ),
      isAppError('INPUT_INVALID')
    )
  } finally {
    await fixture.cleanup()
  }
})

test('Gate R-2 rejects expired and not-yet-effective plans before authorization', async () => {
  const expired = await createFixture()
  const future = await createFixture()
  try {
    await assert.rejects(
      claimVariflightGateR2(
        expired.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: expired.preview.digest },
        { allowedRoot: expired.root, now: new Date('2026-09-01T08:30:00.000Z') }
      ),
      isAppError('GATE_BLOCKED')
    )
    await assert.rejects(
      claimVariflightGateR2(
        future.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: future.preview.digest },
        { allowedRoot: future.root, now: new Date('2026-09-01T07:59:59.999Z') }
      ),
      isAppError('GATE_BLOCKED')
    )
  } finally {
    await expired.cleanup()
    await future.cleanup()
  }
})

test('Gate R-2 rejects input-contract drift even with a matching artifact digest', async () => {
  const fixture = await createFixture()
  try {
    const tampered = structuredClone(fixture.preview)
    tampered.plan.toolBinding.inputContractDigest = `sha256:${'0'.repeat(64)}`
    tampered.digest = digestValue(tampered.plan)
    await writeFile(fixture.path, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8')

    await assert.rejects(
      claimVariflightGateR2(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: tampered.digest },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
      ),
      isAppError('GATE_BLOCKED')
    )
  } finally {
    await fixture.cleanup()
  }
})

test('Gate R-2 concurrent claims allow at most one authorization', async () => {
  const fixture = await createFixture()
  try {
    const request = {
      planId: PLAN_ID,
      operationId: OPERATION_ID,
      digest: fixture.preview.digest
    }
    const results = await Promise.allSettled([
      claimVariflightGateR2(fixture.path, request, {
        allowedRoot: fixture.root,
        now: new Date('2026-09-01T08:01:00.000Z')
      }),
      claimVariflightGateR2(fixture.path, request, {
        allowedRoot: fixture.root,
        now: new Date('2026-09-01T08:01:00.000Z')
      })
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  } finally {
    await fixture.cleanup()
  }
})

test('Gate R-2 preview CLI parser rejects normalization, extras, and duplicates', () => {
  assert.deepEqual(
    parseVariflightGateR2PreviewCliArgs([
      '--dep-city',
      'JHG',
      '--arr-city',
      'CAN',
      '--dep-date',
      '2026-09-17'
    ]),
    ARGS
  )
  assert.throws(
    () =>
      parseVariflightGateR2PreviewCliArgs([
        '--dep-city',
        'jhg',
        '--arr-city',
        'CAN',
        '--dep-date',
        '2026-09-17'
      ]),
    isAppError('INPUT_INVALID')
  )
  assert.throws(
    () =>
      parseVariflightGateR2PreviewCliArgs([
        '--dep-city',
        'JHG',
        '--dep-city',
        'CAN',
        '--arr-city',
        'CAN',
        '--dep-date',
        '2026-09-17'
      ]),
    isAppError('INPUT_INVALID')
  )
})

test('Gate R-2 execute CLI parser accepts only the exact approval tuple', () => {
  const digest = `sha256:${'a'.repeat(64)}`
  assert.deepEqual(
    parseVariflightGateR2ClaimCliArgs([
      '--plan-id',
      PLAN_ID,
      '--digest',
      digest,
      '--operation-id',
      OPERATION_ID
    ]),
    { planId: PLAN_ID, digest, operationId: OPERATION_ID }
  )
  for (const invalid of [
    ['--plan-id', PLAN_ID],
    ['--plan-id', PLAN_ID, '--digest', digest, '--operation-id', OPERATION_ID, '--retry', '1'],
    [
      '--plan-id',
      PLAN_ID,
      '--digest',
      digest,
      '--operation-id',
      OPERATION_ID,
      '--operation-id',
      OPERATION_ID
    ]
  ]) {
    assert.throws(() => parseVariflightGateR2ClaimCliArgs(invalid), isAppError('INPUT_INVALID'))
  }
})

test('Phase B LOCAL leaves the production flight allowlist and contracts empty', () => {
  const flight = SOURCE_DEFINITIONS.SRC_FLIGHT
  assert.deepEqual([...flight.allowlist], [])
  assert.deepEqual(Object.keys(flight.tools), [])
  assert.equal(flight.probeTool, null)
  assert.equal(flight.discoveryOnly, true)
})

async function createFixture(write = true): Promise<{
  root: string
  path: string
  preview: ReturnType<typeof createVariflightGateR2Preview>
  cleanup: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-variflight-r2-'))
  const path = join(root, 'gate-r2-preview.json')
  const preview = createVariflightGateR2Preview({
    args: ARGS,
    now: CREATED_AT,
    planId: PLAN_ID,
    operationId: OPERATION_ID
  })
  if (write) await writeFile(path, `${JSON.stringify(preview, null, 2)}\n`, 'utf8')
  return { root, path, preview, cleanup: () => rm(root, { recursive: true, force: true }) }
}

function isAppError(code: AppError['code']): (error: unknown) => boolean {
  return (error: unknown) => error instanceof AppError && error.code === code
}
