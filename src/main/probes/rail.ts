import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { Context } from 'cordis'
import { AppError } from '../../shared/errors'
import { RailFixtureSchema } from '../../shared/schema/mcp/rail'
import { createAppPaths } from '../paths'
import { eventLogPlugin } from '../plugins/event-log'
import { policyPlugin } from '../plugins/policy'
import { toolsPlugin } from '../plugins/tool-registry'
import { travelStatePlugin } from '../plugins/travel-state'
import { SourceConfigStore } from '../source-config-store'

async function main(): Promise<void> {
  const fixturePath = join(process.cwd(), 'test', 'fixtures', 'rail', 'get-current-date.real.json')
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'travel-harness-rail-probe-'))
  const paths = createAppPaths(temporaryRoot)
  const database = new Database(paths.database)
  const context = new Context()

  try {
    database.exec(
      await readFile(new URL('../db/migrations/0001_init.sql', import.meta.url), 'utf8')
    )
    context.plugin(eventLogPlugin, { paths })
    context.plugin(travelStatePlugin, { database, paths })
    context.plugin(policyPlugin)
    context.plugin(toolsPlugin, {
      database,
      paths,
      sourceConfigStore: new SourceConfigStore(paths.sourceConfig),
      sleep: async () => undefined
    })
    await context.start()

    let attempt = 0
    while (true) {
      try {
        const result = await context.tools.invokeRail(
          'd1-public-probe',
          'get-current-date',
          {},
          120_000
        )
        const fixture = RailFixtureSchema.parse({
          capturedAt: new Date().toISOString(),
          package: '12306-mcp@0.3.10',
          tool: 'get-current-date',
          arguments: {},
          result
        })
        await mkdir(dirname(fixturePath), { recursive: true })
        await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
        console.log(
          JSON.stringify({ ok: true, tool: fixture.tool, capturedAt: fixture.capturedAt })
        )
        break
      } catch (error) {
        const retryable =
          error instanceof AppError &&
          (error.code === 'MCP_TIMEOUT' || error.code === 'MCP_PROTOCOL_ERROR')
        if (!retryable || attempt >= 1) throw error
        attempt += 1
        await context.sleep(1000)
      }
    }
  } finally {
    await context.tools?.close()
    await context.eventLog?.close()
    database.close()
    await context.stop()
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

void main()
