import { Context } from 'cordis'
import cordisPackage from 'cordis/package.json'
import type Database from 'better-sqlite3'
import { openDatabase } from './db'
import { createAppPaths, type AppPaths, type AppRuntimePathOptions } from './paths'
import { eventLogPlugin } from './plugins/event-log'
import { travelStatePlugin } from './plugins/travel-state'
import { sessionPlugin } from './plugins/session'
import { policyPlugin } from './plugins/policy'
import { toolsPlugin } from './plugins/tool-registry'
import { providerPlugin } from './plugins/provider-runtime'
import { coordinatorPlugin } from './plugins/coordinator'
import { inspectorPlugin } from './plugins/inspector'
import { assertKernelServices } from './kernel-contract'
import { AppLogger } from './logging'
import { ProviderConfigStore } from './provider-config-store'
import { SourceConfigStore } from './source-config-store'

export interface AppKernel {
  context: Context
  database: Database.Database
  paths: AppPaths
  stop(): Promise<void>
}

export async function bootstrapKernel(
  userData: string,
  runtimeRoot = process.cwd(),
  runtimeOptions?: AppRuntimePathOptions
): Promise<AppKernel> {
  const paths = createAppPaths(userData, runtimeRoot, runtimeOptions)
  const logger = new AppLogger(paths)
  const { database } = openDatabase(paths.database)
  const context = new Context()
  context.plugin(eventLogPlugin, {
    paths,
    warn: (message) => logger.warn('EVENT_FINAL_PARTIAL', message)
  })
  context.plugin(travelStatePlugin, {
    database,
    paths,
    warn: (message) => logger.warn('SNAPSHOT_FALLBACK', message)
  })
  context.plugin(sessionPlugin)
  context.plugin(policyPlugin)
  context.plugin(toolsPlugin, {
    database,
    paths,
    sourceConfigStore: new SourceConfigStore(paths.sourceConfig),
    sleep: (milliseconds) => context.sleep(milliseconds),
    log: (code, message, details) => logger.warn(code, message, details)
  })
  context.plugin(providerPlugin, {
    database,
    configStore: new ProviderConfigStore(paths.providerConfig)
  })
  context.plugin(coordinatorPlugin)
  context.plugin(inspectorPlugin, { database })
  await context.start()

  if (cordisPackage.version !== '3.18.1') {
    throw new Error(`Expected Cordis 3.18.1, received ${cordisPackage.version}.`)
  }
  assertKernelServices(context)
  await context.travelState.rebuildAll()
  await context.coordinator.reconcileSplits()

  let stopped = false
  return {
    context,
    database,
    paths,
    async stop() {
      if (stopped) return
      stopped = true
      await context.tools.close()
      await context.eventLog.close()
      await logger.close()
      database.close()
      await context.stop()
    }
  }
}
