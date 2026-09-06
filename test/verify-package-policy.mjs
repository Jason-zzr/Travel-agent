export const PACKAGED_FLYAI_BUNDLE_PATH = 'node_modules/@fly-ai/flyai-cli/dist/flyai-bundle.cjs'
export const PACKAGED_FLYAI_LAUNCHER_PATH = 'resources/flyai-utility-process-launcher.cjs'

const exactAllowedPaths = new Set([
  'package.json',
  'out',
  'node_modules',
  'resources',
  PACKAGED_FLYAI_LAUNCHER_PATH
])

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function normalizeArchivePath(archivePath) {
  return archivePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function isAllowedPackagedPath(normalizedPath) {
  return (
    exactAllowedPaths.has(normalizedPath) ||
    normalizedPath.startsWith('out/') ||
    normalizedPath.startsWith('node_modules/')
  )
}
