import { join } from 'node:path'
import { AppError } from '../../shared/errors'
import { createFlyaiRuntimePaths } from '../paths'
import {
  FLYAI_FLIGHT_GATE_ARTIFACT_RELATIVE_PATH,
  parseFlyaiFlightGatePreviewCliArgs,
  writeFlyaiFlightGatePreview
} from './flyai-flight-gate'
import { inspectFlyaiBundle } from './flyai-cli-runner'

async function main(): Promise<void> {
  try {
    const root = process.cwd()
    const args = parseFlyaiFlightGatePreviewCliArgs(process.argv.slice(2))
    const binding = await inspectFlyaiBundle(
      createFlyaiRuntimePaths({ appPath: root, resourcesPath: root, isPackaged: false })
    )
    const preview = await writeFlyaiFlightGatePreview(
      join(root, FLYAI_FLIGHT_GATE_ARTIFACT_RELATIVE_PATH),
      { allowedRoot: root, args, binding }
    )
    console.log(
      JSON.stringify({
        ok: true,
        mode: 'preview',
        externalCalls: 0,
        cliProcessAttempts: 0,
        productionAllowlistMutations: 0,
        preview
      })
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        ok: false,
        mode: 'preview',
        externalCalls: 0,
        cliProcessAttempts: 0,
        productionAllowlistMutations: 0,
        errorCode: error instanceof AppError ? error.code : 'PREVIEW_FAILED'
      })
    )
    process.exitCode = 1
  }
}

void main()
