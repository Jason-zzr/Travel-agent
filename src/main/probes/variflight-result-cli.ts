import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { AppError } from '../../shared/errors'
import { createAppPaths } from '../paths'
import { eventLogPlugin } from '../plugins/event-log'
import { policyPlugin } from '../plugins/policy'
import { toolsPlugin } from '../plugins/tool-registry'
import { travelStatePlugin } from '../plugins/travel-state'
import { SourceConfigStore } from '../source-config-store'
import {
  claimVariflightGateR2,
  parseVariflightGateR2ClaimCliArgs,
  VARIFLIGHT_GATE_R2_ARTIFACT_RELATIVE_PATH
} from './variflight-result-gate'
import { runVariflightResultProbeOnce } from './variflight-result-once'

async function main(): Promise<void> {
  const artifactPath = join(process.cwd(), VARIFLIGHT_GATE_R2_ARTIFACT_RELATIVE_PATH)
  let context: Context | undefined
  let database: Database.Database | undefined
  let temporaryRoot: string | undefined
  let stage: 'authorize' | 'prepare' | 'connect-list-call-close' = 'authorize'

  try {
    const request = parseVariflightGateR2ClaimCliArgs(process.argv.slice(2))
    const authorization = await claimVariflightGateR2(artifactPath, request, {
      allowedRoot: process.cwd()
    })
    stage = 'prepare'
    temporaryRoot = await mkdtemp(join(tmpdir(), 'travel-harness-variflight-result-'))
    const paths = createAppPaths(temporaryRoot)
    database = new Database(paths.database)
    context = new Context()
    database.exec(
      await readFile(new URL('../db/migrations/0001_init.sql', import.meta.url), 'utf8')
    )
    context.plugin(eventLogPlugin, { paths })
    context.plugin(travelStatePlugin, { database, paths })
    context.plugin(policyPlugin)
    context.plugin(toolsPlugin, {
      database,
      paths,
      sourceConfigStore: new SourceConfigStore(paths.sourceConfig)
    })
    await context.start()

    stage = 'connect-list-call-close'
    const outcome = await runVariflightResultProbeOnce(context.tools, authorization)
    console.log(JSON.stringify(outcome))
    if (!outcome.ok) process.exitCode = 1
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        source: 'SRC_FLIGHT',
        stage,
        toolCallAttempts: 0,
        retryCount: 0,
        productionAllowlistMutations: 0,
        errorCode: error instanceof AppError ? error.code : 'PROBE_FAILED',
        rawResponseRetained: false
      })
    )
    process.exitCode = 1
  } finally {
    await context?.tools?.close()
    await context?.eventLog?.close()
    database?.close()
    await context?.stop()
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  }
}

void main()
