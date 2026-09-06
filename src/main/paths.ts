import { dirname, isAbsolute, join } from 'node:path'
import {
  FLYAI_BIN_RELATIVE_PATH,
  FLYAI_PACKAGE_NAME,
  FLYAI_UTILITY_PROCESS_LAUNCHER_RELATIVE_PATH
} from '../shared/schema/mcp/flyai-flight'

export interface AppPaths {
  userData: string
  database: string
  credentials: string
  flyaiDeviceIdentity: string
  providerConfig: string
  sourceConfig: string
  sessions: string
  logs: string
  cacheDirectory: string
  poiCacheDatabase: string
  deepSeekSearchMcpExecutable: string
  xhsMcpExecutable: string
  xhsMcpManifest: string
  xhsMcpCookies: string
  xhsMcpCacheDirectory: string
  xhsMcpWorkDirectory: string
}

export interface AppRuntimePathOptions {
  resourcesPath: string
  isPackaged: boolean
}

export interface FlyaiRuntimePaths {
  packageJson: string
  bundle: string
  launcher: string
}

export interface FlyaiRuntimePathOptions {
  appPath: string
  resourcesPath: string
  isPackaged: boolean
}

export function createAppPaths(
  userData: string,
  runtimeRoot = process.cwd(),
  runtimeOptions: AppRuntimePathOptions = {
    resourcesPath: process.resourcesPath,
    isPackaged: false
  }
): AppPaths {
  const deepSeekExecutable =
    process.platform === 'win32' ? 'deepseek-web-search-mcp.exe' : 'deepseek-web-search-mcp'
  const xhsResourceRoot = runtimeOptions.isPackaged
    ? join(runtimeOptions.resourcesPath, 'xhs-mcp')
    : join(runtimeRoot, 'resources', 'xhs-mcp')
  const xhsUserDataRoot = join(userData, 'xhs-mcp')
  return {
    userData,
    database: join(userData, 'travel-harness.db'),
    credentials: join(userData, 'credentials.json'),
    flyaiDeviceIdentity: join(userData, 'flyai-runtime', 'device-id'),
    providerConfig: join(userData, 'provider-config.json'),
    sourceConfig: join(userData, 'source-config.json'),
    sessions: join(userData, 'sessions'),
    logs: join(userData, 'logs'),
    cacheDirectory: join(userData, 'cache'),
    poiCacheDatabase: join(userData, 'cache', 'poi.db'),
    deepSeekSearchMcpExecutable: join(
      runtimeRoot,
      'mcp-servers',
      'deepseek-web-search',
      '.venv',
      process.platform === 'win32' ? 'Scripts' : 'bin',
      deepSeekExecutable
    ),
    xhsMcpExecutable: join(xhsResourceRoot, 'xiaohongshu-mcp-windows-amd64.exe'),
    xhsMcpManifest: join(xhsResourceRoot, 'manifest.json'),
    xhsMcpCookies: join(xhsUserDataRoot, 'cookies.json'),
    xhsMcpCacheDirectory: join(xhsUserDataRoot, 'cache'),
    xhsMcpWorkDirectory: join(xhsUserDataRoot, 'work')
  }
}

export function createFlyaiRuntimePaths(options: FlyaiRuntimePathOptions): FlyaiRuntimePaths {
  const packageSegments = ['node_modules', ...FLYAI_PACKAGE_NAME.split('/')]
  const packageRoot = join(options.appPath, ...packageSegments)
  const bundleRoot = options.isPackaged
    ? join(options.resourcesPath, 'app.asar.unpacked', ...packageSegments)
    : packageRoot
  return {
    packageJson: join(packageRoot, 'package.json'),
    bundle: join(bundleRoot, ...FLYAI_BIN_RELATIVE_PATH.split('/')),
    launcher: join(
      options.isPackaged ? options.resourcesPath : options.appPath,
      ...(options.isPackaged ? ['app.asar.unpacked'] : []),
      ...FLYAI_UTILITY_PROCESS_LAUNCHER_RELATIVE_PATH.split('/')
    )
  }
}

export function flyaiTemporaryDirectoryPrefix(temporaryRoot: string): string {
  if (!isAbsolute(temporaryRoot)) throw new Error('FlyAI temporary root must be absolute.')
  return join(temporaryRoot, 'travel-harness-flyai-')
}

export function sessionEventLogPath(paths: AppPaths, sessionId: string): string {
  return join(paths.sessions, sessionId, 'events.jsonl')
}

export function sessionSnapshotPath(paths: AppPaths, sessionId: string): string {
  return join(paths.sessions, sessionId, 'snapshot-v1.json')
}

export function exportTemporaryPath(targetPath: string): string {
  if (!isAbsolute(targetPath)) throw new Error('Export target must be an absolute path.')
  return join(
    dirname(targetPath),
    `.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.travel-export.tmp`
  )
}
