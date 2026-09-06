import { z } from 'zod'

export const ErrorCodeSchema = z.enum([
  'CRED_UNAVAILABLE',
  'CRED_DECRYPT_FAILED',
  'SOURCE_UNCONFIGURED',
  'SOURCE_UNREACHABLE',
  'SOURCE_CANCELLED',
  'SOURCE_DRIFT',
  'SOURCE_ADAPTER_DEGRADED',
  'SOURCE_RATE_LIMITED',
  'SOURCE_QUOTA_EXHAUSTED',
  'IPC_FORBIDDEN',
  'EVENT_INVALID',
  'EVENT_SEQUENCE_GAP',
  'EVENT_LOG_CORRUPT',
  'MCP_TIMEOUT',
  'MCP_PROTOCOL_ERROR',
  'MCP_SCHEMA_INVALID',
  'MCP_TOOL_ERROR',
  'NOT_IN_ALLOWLIST',
  'WRITE_KEYWORD_HIT',
  'INPUT_INVALID',
  'INPUT_OUT_OF_ENVELOPE',
  'GATE_BLOCKED',
  'MODEL_TIMEOUT',
  'MODEL_OUTPUT_INVALID',
  'MODEL_UNAUTHORIZED',
  'PROVIDER_UNCONFIGURED',
  'INTERNAL_SERVICE_NOT_READY',
  'INTERNAL_SCHEMA_MISMATCH',
  'INTERNAL_INVARIANT_VIOLATED',
  'INTERNAL_ERROR'
])

export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const ErrorClassSchema = z.enum(['INPUT', 'GATE', 'MODEL', 'SOURCE', 'INTERNAL'])
export type ErrorClass = z.infer<typeof ErrorClassSchema>

export interface SerializedAppError {
  code: ErrorCode
  klass: ErrorClass
  userHint: string
}

export const SerializedAppErrorSchema = z.object({
  code: ErrorCodeSchema,
  klass: ErrorClassSchema,
  userHint: z.string().min(1)
})

interface AppErrorOptions extends ErrorOptions {
  klass?: ErrorClass
  userHint?: string
}

function inferErrorClass(code: ErrorCode): ErrorClass {
  if (code.startsWith('INPUT_')) return 'INPUT'
  if (code === 'GATE_BLOCKED') return 'GATE'
  if (code.startsWith('MODEL_') || code === 'PROVIDER_UNCONFIGURED') return 'MODEL'
  if (code.startsWith('SOURCE_') || code.startsWith('MCP_')) return 'SOURCE'
  return 'INTERNAL'
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    options?: AppErrorOptions
  ) {
    super(message, options)
    this.name = 'AppError'
    this.klass = options?.klass ?? inferErrorClass(code)
    this.userHint = options?.userHint ?? message
  }

  readonly klass: ErrorClass
  readonly userHint: string
}

export function serializeError(error: unknown): SerializedAppError {
  if (error instanceof AppError) {
    return { code: error.code, klass: error.klass, userHint: error.userHint }
  }
  return {
    code: 'INTERNAL_ERROR',
    klass: 'INTERNAL',
    userHint: '操作失败，请查看本机日志。'
  }
}
