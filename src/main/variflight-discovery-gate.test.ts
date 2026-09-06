import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AppError } from '../shared/errors'
import {
  claimVariflightGateR1,
  createVariflightGateR1Preview,
  parseVariflightDiscoveryCliArgs,
  replaceVariflightGateR1Preview
} from './probes/variflight-discovery-gate'
import { runVariflightDiscoveryOnce } from './probes/variflight-discovery-once'

const PLAN_ID = '11111111-1111-4111-8111-111111111111'
const OPERATION_ID = '22222222-2222-4222-8222-222222222222'
const CREATED_AT = new Date('2026-09-01T08:00:00.000Z')

test('Gate R-1 requires the exact tuple, consumes before discovery, and cannot be reused', async () => {
  const fixture = await createArtifact()
  let calls = 0
  try {
    assert.equal(
      fixture.preview.plan.endpointBinding.digest,
      'sha256:56a714907eedcb911f694a6f15c4f52cdf55fe08ef0dc6c95292d84bd36bf94a'
    )
    await assert.rejects(
      claimVariflightGateR1(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: `sha256:${'0'.repeat(64)}` },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
      ),
      (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
    assert.equal(JSON.parse(await readFile(fixture.path, 'utf8')).status, 'AWAITING_EXACT_APPROVAL')

    const authorization = await claimVariflightGateR1(
      fixture.path,
      {
        planId: PLAN_ID,
        operationId: OPERATION_ID,
        digest: fixture.preview.digest
      },
      { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
    )
    assert.equal(JSON.parse(await readFile(fixture.path, 'utf8')).status, 'CONSUMED')

    const outcome = await runVariflightDiscoveryOnce(
      {
        async discoverSourceDescriptorsOnce(sourceId, timeoutMs, operationId) {
          calls += 1
          assert.equal(sourceId, 'SRC_FLIGHT')
          assert.equal(timeoutMs, 15_000)
          assert.equal(operationId, OPERATION_ID)
          return [{ name: 'searchFlightItineraries', description: 'read only', inputSchema: {} }]
        }
      },
      authorization,
      new Date('2026-09-01T08:01:00.000Z')
    )
    assert.equal(calls, 1)
    assert.equal(outcome.toolCallAttempts, 0)
    assert.equal(outcome.tools[0]?.name, 'searchFlightItineraries')

    await assert.rejects(
      runVariflightDiscoveryOnce(
        {
          async discoverSourceDescriptorsOnce() {
            calls += 1
            return []
          }
        },
        authorization,
        new Date('2026-09-01T08:01:30.000Z')
      ),
      (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
    )
    assert.equal(calls, 1)

    await assert.rejects(
      claimVariflightGateR1(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T08:02:00.000Z') }
      ),
      (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
    assert.equal(calls, 1)
  } finally {
    await fixture.cleanup()
  }
})

test('Gate R-1 rejects expired plans before discovery', async () => {
  const fixture = await createArtifact()
  try {
    await assert.rejects(
      claimVariflightGateR1(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T08:30:00.000Z') }
      ),
      (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
    )
    assert.equal(JSON.parse(await readFile(fixture.path, 'utf8')).status, 'AWAITING_EXACT_APPROVAL')
  } finally {
    await fixture.cleanup()
  }
})

test('Gate R-1 rejects plans whose validity window has not started', async () => {
  const fixture = await createArtifact()
  try {
    await assert.rejects(
      claimVariflightGateR1(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T07:59:59.999Z') }
      ),
      (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
    )
    assert.equal(JSON.parse(await readFile(fixture.path, 'utf8')).status, 'AWAITING_EXACT_APPROVAL')
    assert.equal(
      (await readdir(fixture.root)).some((name) => name.endsWith('.tmp')),
      false
    )
  } finally {
    await fixture.cleanup()
  }
})

test('discovery entrypoint rejects a missing consumed authorization', async () => {
  let calls = 0
  await assert.rejects(
    runVariflightDiscoveryOnce(
      {
        async discoverSourceDescriptorsOnce() {
          calls += 1
          return []
        }
      },
      {} as never,
      new Date('2026-09-01T08:01:00.000Z')
    ),
    (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
  )
  assert.equal(calls, 0)
})

test('a claimed authorization remains one-shot when discovery fails', async () => {
  const fixture = await createArtifact()
  let calls = 0
  try {
    const authorization = await claimVariflightGateR1(
      fixture.path,
      { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
      { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
    )
    await assert.rejects(
      runVariflightDiscoveryOnce(
        {
          async discoverSourceDescriptorsOnce() {
            calls += 1
            throw new AppError('SOURCE_UNREACHABLE', 'offline fixture')
          }
        },
        authorization,
        new Date('2026-09-01T08:01:00.000Z')
      )
    )
    await assert.rejects(
      runVariflightDiscoveryOnce(
        {
          async discoverSourceDescriptorsOnce() {
            calls += 1
            return []
          }
        },
        authorization,
        new Date('2026-09-01T08:01:30.000Z')
      ),
      (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
    )
    await assert.rejects(
      claimVariflightGateR1(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
        { allowedRoot: fixture.root, now: new Date('2026-09-01T08:02:00.000Z') }
      )
    )
    assert.equal(calls, 1)
  } finally {
    await fixture.cleanup()
  }
})

test('claimed authorization is frozen and cannot be mutated before discovery', async () => {
  const fixture = await createArtifact()
  try {
    const authorization = await claimVariflightGateR1(
      fixture.path,
      { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
      { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
    )
    assert.equal(Object.isFrozen(authorization), true)
    assert.equal(Object.isFrozen(authorization.plan), true)
    ;(authorization.plan as { timeoutMs: number }).timeoutMs = 120_000
    assert.equal(authorization.plan.timeoutMs, 15_000)
  } finally {
    await fixture.cleanup()
  }
})

test('claim rejects an artifact outside the allowed root', async () => {
  const fixture = await createArtifact()
  const otherRoot = await mkdtemp(join(tmpdir(), 'variflight-gate-r1-other-'))
  try {
    await assert.rejects(
      claimVariflightGateR1(
        fixture.path,
        { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
        { allowedRoot: otherRoot, now: new Date('2026-09-01T08:01:00.000Z') }
      ),
      (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
  } finally {
    await fixture.cleanup()
    await rm(otherRoot, { recursive: true, force: true })
  }
})

test('CLI arguments fail closed and accept only the exact three fields', () => {
  assert.throws(
    () => parseVariflightDiscoveryCliArgs(['--plan-id', PLAN_ID]),
    (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
  )
  assert.throws(
    () =>
      parseVariflightDiscoveryCliArgs([
        '--plan-id',
        PLAN_ID,
        '--operation-id',
        OPERATION_ID,
        '--digest',
        `sha256:${'a'.repeat(64)}`,
        '--retry',
        '1'
      ]),
    (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
  )
  assert.deepEqual(
    parseVariflightDiscoveryCliArgs([
      '--plan-id',
      PLAN_ID,
      '--digest',
      `sha256:${'a'.repeat(64)}`,
      '--operation-id',
      OPERATION_ID
    ]),
    { planId: PLAN_ID, digest: `sha256:${'a'.repeat(64)}`, operationId: OPERATION_ID }
  )
})

test('fresh preview cannot overwrite an active plan', async () => {
  const fixture = await createArtifact()
  try {
    await assert.rejects(
      replaceVariflightGateR1Preview(fixture.path, {
        allowedRoot: fixture.root,
        now: new Date('2026-09-01T08:01:00.000Z')
      }),
      (error: unknown) => error instanceof AppError && error.code === 'GATE_BLOCKED'
    )
    assert.deepEqual(JSON.parse(await readFile(fixture.path, 'utf8')), fixture.preview)
  } finally {
    await fixture.cleanup()
  }
})

test('fresh preview rejects an EXPIRED status whose plan is still active', async () => {
  const fixture = await createArtifact()
  try {
    await writeFile(
      fixture.path,
      `${JSON.stringify({ ...fixture.preview, status: 'EXPIRED' }, null, 2)}\n`,
      'utf8'
    )
    await assert.rejects(
      replaceVariflightGateR1Preview(fixture.path, {
        allowedRoot: fixture.root,
        now: new Date('2026-09-01T08:01:00.000Z')
      }),
      (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
  } finally {
    await fixture.cleanup()
  }
})

test('fresh preview recovers when a consumed marker exists before the main artifact update', async () => {
  const fixture = await createArtifact()
  const nextPlanId = '33333333-3333-4333-8333-333333333333'
  const nextOperationId = '44444444-4444-4444-8444-444444444444'
  try {
    await writeFile(
      `${fixture.path}.${OPERATION_ID}.consumed`,
      `${JSON.stringify(
        {
          status: 'CONSUMED',
          consumedAt: '2026-09-01T08:01:00.000Z',
          digest: fixture.preview.digest,
          plan: fixture.preview.plan
        },
        null,
        2
      )}\n`,
      'utf8'
    )
    const fresh = await replaceVariflightGateR1Preview(fixture.path, {
      allowedRoot: fixture.root,
      now: new Date('2026-09-01T08:02:00.000Z'),
      planId: nextPlanId,
      operationId: nextOperationId
    })
    assert.equal(fresh.plan.planId, nextPlanId)
    assert.equal(fresh.plan.operationId, nextOperationId)
    assert.equal(JSON.parse(await readFile(fixture.path, 'utf8')).status, 'AWAITING_EXACT_APPROVAL')
  } finally {
    await fixture.cleanup()
  }
})

test('fresh preview rejects mismatched or malformed consumed recovery markers', async () => {
  const mismatchedFixture = await createArtifact()
  try {
    await writeFile(
      `${mismatchedFixture.path}.${OPERATION_ID}.consumed`,
      `${JSON.stringify(
        {
          status: 'CONSUMED',
          consumedAt: '2026-09-01T08:01:00.000Z',
          digest: `sha256:${'0'.repeat(64)}`,
          plan: mismatchedFixture.preview.plan
        },
        null,
        2
      )}\n`,
      'utf8'
    )
    await assert.rejects(
      replaceVariflightGateR1Preview(mismatchedFixture.path, {
        allowedRoot: mismatchedFixture.root,
        now: new Date('2026-09-01T08:02:00.000Z')
      }),
      (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
    assert.deepEqual(
      JSON.parse(await readFile(mismatchedFixture.path, 'utf8')),
      mismatchedFixture.preview
    )
  } finally {
    await mismatchedFixture.cleanup()
  }

  const malformedFixture = await createArtifact()
  try {
    await writeFile(`${malformedFixture.path}.${OPERATION_ID}.consumed`, '{', 'utf8')
    await assert.rejects(
      replaceVariflightGateR1Preview(malformedFixture.path, {
        allowedRoot: malformedFixture.root,
        now: new Date('2026-09-01T08:02:00.000Z')
      }),
      (error: unknown) => error instanceof AppError && error.code === 'INPUT_INVALID'
    )
    assert.deepEqual(
      JSON.parse(await readFile(malformedFixture.path, 'utf8')),
      malformedFixture.preview
    )
  } finally {
    await malformedFixture.cleanup()
  }
})

test('a consumed operation does not block a separately approved fresh operation', async () => {
  const fixture = await createArtifact()
  const nextPlanId = '33333333-3333-4333-8333-333333333333'
  const nextOperationId = '44444444-4444-4444-8444-444444444444'
  try {
    await claimVariflightGateR1(
      fixture.path,
      { planId: PLAN_ID, operationId: OPERATION_ID, digest: fixture.preview.digest },
      { allowedRoot: fixture.root, now: new Date('2026-09-01T08:01:00.000Z') }
    )
    const fresh = await replaceVariflightGateR1Preview(fixture.path, {
      allowedRoot: fixture.root,
      now: new Date('2026-09-01T08:02:00.000Z'),
      planId: nextPlanId,
      operationId: nextOperationId
    })
    assert.equal(fresh.plan.operationId, nextOperationId)
    await claimVariflightGateR1(
      fixture.path,
      { planId: nextPlanId, operationId: nextOperationId, digest: fresh.digest },
      { allowedRoot: fixture.root, now: new Date('2026-09-01T08:03:00.000Z') }
    )
    const consumedFiles = (await readdir(fixture.root)).filter((name) => name.endsWith('.consumed'))
    assert.equal(consumedFiles.length, 2)
    assert.equal(
      consumedFiles.some((name) => name.includes(OPERATION_ID)),
      true
    )
    assert.equal(
      consumedFiles.some((name) => name.includes(nextOperationId)),
      true
    )
    assert.equal(
      (await readdir(fixture.root)).some((name) => name.endsWith('.tmp')),
      false
    )
  } finally {
    await fixture.cleanup()
  }
})

async function createArtifact(): Promise<{
  root: string
  path: string
  preview: ReturnType<typeof createVariflightGateR1Preview>
  cleanup: () => Promise<void>
}> {
  const root = await mkdtemp(join(tmpdir(), 'variflight-gate-r1-test-'))
  const path = join(root, 'gate-r1-preview.json')
  const preview = createVariflightGateR1Preview({
    now: CREATED_AT,
    planId: PLAN_ID,
    operationId: OPERATION_ID
  })
  await writeFile(path, `${JSON.stringify(preview, null, 2)}\n`, 'utf8')
  return {
    root,
    path,
    preview,
    cleanup: () => rm(root, { recursive: true, force: true })
  }
}
