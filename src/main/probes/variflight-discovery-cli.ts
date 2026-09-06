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
  claimVariflightGateR1,
  parseVariflightDiscoveryCliArgs,
  replaceVariflightGateR1Preview,
  VARIFLIGHT_GATE_R1_ARTIFACT_RELATIVE_PATH
} from './variflight-discovery-gate'
import { runVariflightDiscoveryOnce } from './variflight-discovery-once'

async function main(): Promise<void> {
  const artifactPath = join(process.cwd(), VARIFLIGHT_GATE_R1_ARTIFACT_RELATIVE_PATH)
  let context: Context | undefined
  let database: Database.Database | undefined
  let temporaryRoot: string | undefined
  let stage: 'preview' | 'authorize' | 'prepare' | 'connect-list-close' = 'authorize'

  try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === 'preview') {
      stage = 'preview'
      const preview = await replaceVariflightGateR1Preview(artifactPath, {
        allowedRoot: process.cwd()
      })
      console.log(
        JSON.stringify({
          ok: true,
          mode: 'preview',
          externalCalls: 0,
          toolCallAttempts: 0,
          preview
        })
      )
      return
    }
    const request = parseVariflightDiscoveryCliArgs(args)
    const authorization = await claimVariflightGateR1(artifactPath, request, {
      allowedRoot: process.cwd()
    })
    stage = 'prepare'
    temporaryRoot = await mkdtemp(join(tmpdir(), 'travel-harness-variflight-discovery-'))
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

    stage = 'connect-list-close'
    const outcome = await runVariflightDiscoveryOnce(context.tools, authorization)
    console.log(JSON.stringify({ ok: true, ...outcome }))
  } catch (error) {
    const errorCode = error instanceof AppError ? error.code : 'PROBE_FAILED'
    console.error(
      JSON.stringify({
        ok: false,
        source: 'SRC_FLIGHT',
        stage,
        toolCallAttempts: 0,
        retryCount: 0,
        errorCode,
        rawToolResultRetained: false
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
