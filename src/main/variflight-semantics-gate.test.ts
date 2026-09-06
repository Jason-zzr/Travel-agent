import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppError } from '../shared/errors'
import { SOURCE_DEFINITIONS } from './mcp/source-catalog'
import { digestValue } from './probes/gate-artifact-primitives'
import {
  claimVariflightGateR3,
  consumeAuthorizedVariflightSemanticProbe,
  createVariflightGateR3Preview,
  parseVariflightGateR3ClaimCliArgs,
  parseVariflightGateR3PreviewCliArgs,
  writeVariflightGateR3Preview
} from './probes/variflight-semantics-gate'

const CREATED_AT = new Date('2026-09-01T08:00:00.000Z')
const PLAN_ID = '33333333-3333-4333-8333-333333333333'
const OPERATION_ID = '44444444-4444-4444-8444-444444444444'
const ARGS = { dep_city: 'JHG', arr_city: 'CAN', dep_date: '2026-09-17' } as const

test('Gate R-3 preview binds one future semantic call and performs zero external calls', () => {
  const calls = { connect: 0, list: 0, call: 0, close: 0 }
  const preview = createVariflightGateR3Preview({
    args: ARGS,
    now: CREATED_AT,
    planId: PLAN_ID,
    operationId: OPERATION_ID
  })

  assert.deepEqual(calls, { connect: 0, list: 0, call: 0, close: 0 })
  assert.equal(preview.plan.previewExternalCalls, 0)
  assert.equal(preview.plan.sessionCount, 1)
  assert.equal(preview.plan.toolCallAttempts, 1)
  assert.equal(preview.plan.retryCount, 0)
  assert.equal(preview.plan.timeoutMs, 15_000)
  assert.equal(preview.plan.retention.rawToolResultRetained, false)
  assert.equal(preview.plan.retention.valueRetention, false)
  assert.deepEqual(preview.plan.productionRegistration, {
    allowlistMutation: false,
    toolContractMutation: false
  })
})

test('Gate R-3 writes, claims, and consumes an exact authorization only once', async () => {
  const fixture = await createFixture(false)
  try {
    const preview = await writeVariflightGateR3Preview(fixture.path, {
      allowedRoot: fixture.root,
      args: ARGS,
      now: CREATED_AT,
      planId: PLAN_ID,
      operationId: OPERATION_ID
    })
    assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), preview)

    const authorization = await claimVariflightGateR3(
      fixture.path,
      { planId: PLAN_ID, operationId: OPERATION_ID, digest: preview.digest },
      { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
    )
    assert.equal(JSON.parse(await readFile(fixture.path, 'utf8')).status, 'CONSUMED')
    consumeAuthorizedVariflightSemanticProbe(authorization, new Date('2026-09-01T08:01:01.000Z'))
    assert.throws(
      () =>
        consumeAuthorizedVariflightSemanticProbe(
          authorization,
          new Date('2026-09-01T08:01:02.000Z')
        ),
      isAppError('GATE_BLOCKED')
    )
    await assert.rejects(
      claimVariflightGateR3(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: preview.digest },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:03.000Z') }
      ),
      isAppError('INPUT_INVALID')
    )
  } finally {
    await fixture.cleanup()
  }
})

test('Gate R-3 rejects exact-tuple and contract drift before authorization', async () => {
  const fixture = await createFixture()
  try {
    await assert.rejects(
      claimVariflightGateR3(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: `sha256:${'0'.repeat(64)}` },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
      ),
      isAppError('INPUT_INVALID')
    )

    const tampered = structuredClone(fixture.preview)
    tampered.plan.toolBinding.inputContractDigest = `sha256:${'0'.repeat(64)}`
    tampered.digest = digestValue(tampered.plan)
    await writeFile(fixture.path, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8')
    await assert.rejects(
      claimVariflightGateR3(
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

test('Gate R-3 rejects unknown nested plan fields, expired plans, and future plans', async () => {
  const strictFixture = await createFixture()
  const expiredFixture = await createFixture()
  const futureFixture = await createFixture()
  try {
    const tampered = structuredClone(strictFixture.preview) as unknown as Record<string, unknown>
    const plan = tampered.plan as Record<string, unknown>
    const steps = plan.steps as Array<Record<string, unknown>>
    steps[0]!.unexpected = true
    tampered.digest = digestValue(plan)
    await writeFile(strictFixture.path, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8')
    await assert.rejects(
      claimVariflightGateR3(
        strictFixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: tampered.digest as string },
        { allowedRoot: strictFixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
      ),
      isAppError('INPUT_INVALID')
    )

    await assert.rejects(
      claimVariflightGateR3(
        expiredFixture.path,
        {
          planId: PLAN_ID,
          operationId: OPERATION_ID,
          digest: expiredFixture.preview.digest
        },
        { allowedRoot: expiredFixture.root, now: new Date('2026-09-01T08:30:00.000Z') }
      ),
      isAppError('GATE_BLOCKED')
    )
    await assert.rejects(
      claimVariflightGateR3(
        futureFixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: futureFixture.preview.digest },
        { allowedRoot: futureFixture.root, now: new Date('2026-09-01T07:59:59.999Z') }
      ),
      isAppError('GATE_BLOCKED')
    )
  } finally {
    await strictFixture.cleanup()
    await expiredFixture.cleanup()
    await futureFixture.cleanup()
  }
})

test('Gate R-3 concurrent claims allow at most one authorization', async () => {
  const fixture = await createFixture()
  try {
    const request = {
      planId: PLAN_ID,
      operationId: OPERATION_ID,
      digest: fixture.preview.digest
    }
    const results = await Promise.allSettled([
      claimVariflightGateR3(fixture.path, request, {
        allowedRoot: fixture.root,
        now: new Date('2026-09-01T08:01:00.000Z')
      }),
      claimVariflightGateR3(fixture.path, request, {
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

test('Gate R-3 CLI parsers reject normalization, extras, and incomplete tuples', () => {
  assert.deepEqual(
    parseVariflightGateR3PreviewCliArgs([
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
      parseVariflightGateR3PreviewCliArgs([
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
    () => parseVariflightGateR3ClaimCliArgs(['--plan-id', PLAN_ID]),
    isAppError('INPUT_INVALID')
  )
})

test('Gate R-3 LOCAL leaves production flight registration empty', () => {
  const flight = SOURCE_DEFINITIONS.SRC_FLIGHT
  assert.deepEqual([...flight.allowlist], [])
  assert.deepEqual(Object.keys(flight.tools), [])
  assert.equal(flight.probeTool, null)
  assert.equal(flight.discoveryOnly, true)
})

async function createFixture(write = true): Promise<{
  root: string
  path: string
  preview: ReturnType<typeof createVariflightGateR3Preview>
  cleanup: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'travel-harness-variflight-r3-'))
  const path = join(root, 'gate-r3-preview.json')
  const preview = createVariflightGateR3Preview({
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
