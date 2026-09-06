import type { Context } from 'cordis'

export const KERNEL_SERVICE_KEYS = [
  'eventLog',
  'travelState',
  'session',
  'policy',
  'tools',
  'provider',
  'coordinator',
  'inspector'
] as const

export function assertKernelServices(context: Context): void {
  for (const key of KERNEL_SERVICE_KEYS) {
    if (!context.get(key)) throw new Error(`Cordis service ${key} did not register.`)
  }
}
