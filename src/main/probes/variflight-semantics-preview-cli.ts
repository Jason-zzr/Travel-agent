import { join } from 'node:path'
import { AppError } from '../../shared/errors'
import {
  parseVariflightGateR3PreviewCliArgs,
  VARIFLIGHT_GATE_R3_ARTIFACT_RELATIVE_PATH,
  writeVariflightGateR3Preview
} from './variflight-semantics-gate'

async function main(): Promise<void> {
  try {
    const args = parseVariflightGateR3PreviewCliArgs(process.argv.slice(2))
    const preview = await writeVariflightGateR3Preview(
      join(process.cwd(), VARIFLIGHT_GATE_R3_ARTIFACT_RELATIVE_PATH),
      { allowedRoot: process.cwd(), args }
    )
    console.log(
      JSON.stringify({
        ok: true,
        mode: 'preview',
        externalCalls: 0,
        toolCallAttempts: 0,
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
        toolCallAttempts: 0,
        productionAllowlistMutations: 0,
        errorCode: error instanceof AppError ? error.code : 'PREVIEW_FAILED'
      })
    )
    process.exitCode = 1
  }
}

void main()
