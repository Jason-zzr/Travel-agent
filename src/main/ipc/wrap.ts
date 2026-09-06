import type { IpcResult } from '../../shared/ipc-contract'
import { serializeError } from '../../shared/errors'

export async function asIpcResult<T>(operation: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    return { ok: false, error: serializeError(error) }
  }
}
