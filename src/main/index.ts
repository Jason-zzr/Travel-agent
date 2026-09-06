import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { bootstrapKernel, type AppKernel } from './bootstrap'
import { createCredentialStore } from './credentials'
import { createFlyaiRuntimePaths } from './paths'
import { registerCredentialIpc } from './ipc/credentials'
import { registerDomainIpc } from './ipc/domain'
import { runHotelAcceptanceOnce } from './probes/hotel-once'
import { runHotelLodgingStructureDiagnosticOnce } from './probes/hotel-lodging-structure-once'
import { runMapAcceptanceOnce } from './probes/map-once'
import { runMapGroundTransferStructureDiagnosticOnce } from './probes/map-ground-transfer-structure-once'
import { runMapStructureDiagnosticOnce } from './probes/map-structure-once'
import { runRailJourneyStructureDiagnosticOnce } from './probes/rail-journey-structure-once'
import { runSearchAcceptanceOnce } from './probes/search-once'
import { D7_PACKAGED_SMOKE_SESSION_ID, seedD7PackagedSmoke } from './probes/d7-packaged-smoke'
import {
  claimFlyaiFlightGate,
  FLYAI_FLIGHT_GATE_ARTIFACT_RELATIVE_PATH,
  parseFlyaiFlightGateClaimCliArgs
} from './probes/flyai-flight-gate'
import { inspectFlyaiBundle } from './probes/flyai-cli-runner'
import {
  flyaiFlightProbeErrorCode,
  flyaiFlightProbeFailureCategory,
  runFlyaiFlightProbeOnce
} from './probes/flyai-flight-once'
import { AppError } from '../shared/errors'

let kernel: AppKernel | undefined
let removeIpcHandlers: (() => void) | undefined
let shutdownStarted = false
let credentialStore: ReturnType<typeof createCredentialStore> | undefined

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

function bindIpc(window: BrowserWindow): void {
  if (!credentialStore || !kernel) throw new Error('App services are not initialized.')
  removeIpcHandlers?.()
  const removeCredentials = registerCredentialIpc(credentialStore, window.webContents)
  const removeDomain = registerDomainIpc(kernel.context, window.webContents)
  removeIpcHandlers = () => {
    removeCredentials()
    removeDomain()
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.travelharness.desktop')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  if (process.argv.includes('--smoke-flyai-path-only')) {
    try {
      const binding = await inspectFlyaiBundle(
        createFlyaiRuntimePaths({
          appPath: app.getAppPath(),
          resourcesPath: process.resourcesPath,
          isPackaged: app.isPackaged
        })
      )
      console.log(
        JSON.stringify({
          ok: true,
          mode: 'path-only',
          packageName: binding.packageName,
          packageVersion: binding.packageVersion,
          packageIntegrity: binding.packageIntegrity,
          bundleSha256: binding.bundleSha256,
          bundlePathDigest: binding.bundlePathDigest,
          launcherSha256: binding.launcherSha256,
          launcherPathDigest: binding.launcherPathDigest,
          externalCalls: 0,
          cliProcessAttempts: 0,
          credentialReads: 0,
          productionAllowlistMutations: 0
        })
      )
      shutdownStarted = true
      app.exit(0)
    } catch (error) {
      console.error(
        JSON.stringify({
          ok: false,
          mode: 'path-only',
          errorCode: error instanceof AppError ? error.code : 'PATH_SMOKE_FAILED',
          externalCalls: 0,
          cliProcessAttempts: 0,
          credentialReads: 0,
          productionAllowlistMutations: 0
        })
      )
      shutdownStarted = true
      app.exit(1)
    }
    return
  }

  const flyaiProbeArgumentIndex = process.argv.indexOf('--probe-flyai-flight-once')
  if (flyaiProbeArgumentIndex >= 0) {
    let stage: 'authorize' | 'prepare' | 'run' = 'authorize'
    let cliProcessAttempts: 0 | 1 = 0
    try {
      const request = parseFlyaiFlightGateClaimCliArgs(
        process.argv.slice(flyaiProbeArgumentIndex + 1)
      )
      const authorization = await claimFlyaiFlightGate(
        join(process.cwd(), FLYAI_FLIGHT_GATE_ARTIFACT_RELATIVE_PATH),
        request,
        { allowedRoot: process.cwd() }
      )
      stage = 'prepare'
      kernel = await bootstrapKernel(app.getPath('userData'), app.getAppPath(), {
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged
      })
      credentialStore = createCredentialStore(kernel.paths.credentials)
      kernel.context.tools.setCredentialReader((credentialId) =>
        credentialStore!.read(credentialId)
      )
      stage = 'run'
      const outcome = await runFlyaiFlightProbeOnce(
        kernel.context.tools,
        authorization,
        createFlyaiRuntimePaths({
          appPath: app.getAppPath(),
          resourcesPath: process.resourcesPath,
          isPackaged: app.isPackaged
        }),
        () => {
          cliProcessAttempts = 1
        }
      )
      console.log(JSON.stringify({ ok: true, stage, ...outcome }))
      shutdownStarted = true
      await kernel.stop()
      kernel = undefined
      app.exit(0)
    } catch (error) {
      console.error(
        JSON.stringify({
          ok: false,
          source: 'SRC_FLIGHT',
          tool: 'search-flight',
          transport: 'utility-process',
          stage,
          cliProcessAttempts,
          applicationRetryCount: 0,
          internalProviderRequestCount: 'UNKNOWN',
          internalProviderRetryCount: 'UNKNOWN',
          productionAllowlistMutations: 0,
          rawResponseRetained: false,
          valueRetention: false,
          errorCode: flyaiFlightProbeErrorCode(error),
          failureCategory: flyaiFlightProbeFailureCategory(error)
        })
      )
      shutdownStarted = true
      await kernel?.stop()
      kernel = undefined
      app.exit(1)
    }
    return
  }

  kernel = await bootstrapKernel(app.getPath('userData'), app.getAppPath(), {
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged
  })
  credentialStore = createCredentialStore(kernel.paths.credentials)
  kernel.context.provider.setCredentialReader((provider) => credentialStore!.read(provider))
  kernel.context.tools.setCredentialReader((credentialId) => credentialStore!.read(credentialId))
  if (process.argv.includes('--smoke-d7-packaged-once')) {
    try {
      const seeded = await seedD7PackagedSmoke(kernel.context)
      await kernel?.stop()
      kernel = await bootstrapKernel(app.getPath('userData'), app.getAppPath(), {
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged
      })
      const recovered = kernel.context.coordinator.d7Snapshot({
        sessionId: D7_PACKAGED_SMOKE_SESSION_ID
      })
      const counts = kernel.database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM tool_calls) AS toolCalls,
             (SELECT COUNT(*) FROM model_calls) AS modelCalls`
        )
        .get() as { toolCalls: number; modelCalls: number }
      const outcome = {
        ok:
          seeded.currentVersion === 2 &&
          recovered.currentVersion === 2 &&
          recovered.tasks[0]?.reservation === 'DONE' &&
          recovered.latestGateC?.ready === true &&
          counts.toolCalls === 0 &&
          counts.modelCalls === 0,
        seeded,
        recovered: {
          currentVersion: recovered.currentVersion,
          taskCount: recovered.tasks.length,
          reservation: recovered.tasks[0]?.reservation ?? null,
          gateReady: recovered.latestGateC?.ready ?? false
        },
        externalCalls: 0,
        modelCalls: counts.modelCalls,
        irreversibleActions: 0
      }
      console.log(JSON.stringify(outcome))
      shutdownStarted = true
      await kernel.stop()
      kernel = undefined
      app.exit(outcome.ok ? 0 : 1)
    } catch (error) {
      console.error(error)
      shutdownStarted = true
      await kernel?.stop()
      kernel = undefined
      app.exit(1)
    }
    return
  }
  if (process.argv.includes('--diagnose-rail-journey-structure-once')) {
    const outcome = await runRailJourneyStructureDiagnosticOnce(kernel.context.tools)
    const write = outcome.ok ? console.log : console.error
    write(JSON.stringify(outcome))
    shutdownStarted = true
    await kernel.stop()
    kernel = undefined
    app.exit(outcome.ok ? 0 : 1)
    return
  }
  if (process.argv.includes('--diagnose-map-ground-transfer-structure-once')) {
    const outcome = await runMapGroundTransferStructureDiagnosticOnce(kernel.context.tools)
    const write = outcome.ok ? console.log : console.error
    write(JSON.stringify(outcome))
    shutdownStarted = true
    await kernel.stop()
    kernel = undefined
    app.exit(outcome.ok ? 0 : 1)
    return
  }
  if (process.argv.includes('--diagnose-hotel-lodging-structure-once')) {
    const outcome = await runHotelLodgingStructureDiagnosticOnce(kernel.context.tools)
    const write = outcome.ok ? console.log : console.error
    write(JSON.stringify(outcome))
    shutdownStarted = true
    await kernel.stop()
    kernel = undefined
    app.exit(outcome.ok ? 0 : 1)
    return
  }
  if (process.argv.includes('--diagnose-map-structure-once')) {
    const outcome = await runMapStructureDiagnosticOnce(kernel.context.tools)
    const write = outcome.ok ? console.log : console.error
    write(JSON.stringify(outcome))
    shutdownStarted = true
    await kernel.stop()
    kernel = undefined
    app.exit(outcome.ok ? 0 : 1)
    return
  }
  if (process.argv.includes('--accept-map-once')) {
    const outcome = await runMapAcceptanceOnce(kernel.context.tools)
    const write = outcome.ok ? console.log : console.error
    write(JSON.stringify(outcome))
    shutdownStarted = true
    await kernel.stop()
    kernel = undefined
    app.exit(outcome.ok ? 0 : 1)
    return
  }
  if (process.argv.includes('--accept-hotel-once')) {
    const outcome = await runHotelAcceptanceOnce(kernel.context.tools)
    const write = outcome.ok ? console.log : console.error
    write(JSON.stringify(outcome))
    shutdownStarted = true
    await kernel.stop()
    kernel = undefined
    app.exit(outcome.ok ? 0 : 1)
    return
  }
  if (process.argv.includes('--accept-search-once')) {
    const outcome = await runSearchAcceptanceOnce(kernel.context.tools)
    const write = outcome.ok ? console.log : console.error
    write(JSON.stringify(outcome))
    shutdownStarted = true
    await kernel.stop()
    kernel = undefined
    app.exit(outcome.ok ? 0 : 1)
    return
  }
  const mainWindow = createWindow()
  bindIpc(mainWindow)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) bindIpc(createWindow())
  })
})

app.on('before-quit', (event) => {
  if (shutdownStarted) return
  event.preventDefault()
  shutdownStarted = true
  removeIpcHandlers?.()
  void (kernel?.stop() ?? Promise.resolve()).finally(() => app.quit())
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
