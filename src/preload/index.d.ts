import type { TravelHarnessApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    api: TravelHarnessApi
  }
}

export {}
