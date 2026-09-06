import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { extractFile, listPackage, statFile } from '@electron/asar'
import {
  PACKAGED_FLYAI_BUNDLE_PATH,
  PACKAGED_FLYAI_LAUNCHER_PATH,
  isAllowedPackagedPath,
  normalizeArchivePath
} from './verify-package-policy.mjs'

const asarPath = path.join(process.cwd(), 'dist', 'win-unpacked', 'resources', 'app.asar')
const installerPath = path.join(process.cwd(), 'dist', 'travel-harness-1.0.0-setup.exe')
const packagedXhsRoot = path.join(process.cwd(), 'dist', 'win-unpacked', 'resources', 'xhs-mcp')
const packagedXhsExecutable = path.join(packagedXhsRoot, 'xiaohongshu-mcp-windows-amd64.exe')
const packagedXhsManifest = path.join(packagedXhsRoot, 'manifest.json')
const packagedXhsLicense = path.join(packagedXhsRoot, 'LICENSE.txt')
assert.equal(fs.existsSync(asarPath), true, `missing app.asar: ${asarPath}`)
assert.equal(fs.existsSync(installerPath), true, `missing NSIS artifact: ${installerPath}`)
const entries = listPackage(asarPath)
const archiveEntries = entries.map((archivePath) => ({
  archivePath,
  normalizedPath: normalizeArchivePath(archivePath)
}))
const normalizedEntries = archiveEntries.map((entry) => entry.normalizedPath)
const unexpectedEntries = normalizedEntries.filter((entry) => !isAllowedPackagedPath(entry))
assert.deepEqual(
  unexpectedEntries,
  [],
  `unexpected packaged paths: ${unexpectedEntries.slice(0, 20).join(', ')}`
)
const forbiddenPath =
  /(?:^|\/)(?:\.tmp|test|tests|\.trellis|\.agents|\.codex|mcp-servers|sessions|logs|cache)(?:\/|$)|(?:credentials|provider-config|source-config)\.json$|(?:^|\/)\.env(?:\.|$)|\.(?:db|db-shm|db-wal|jsonl|log)$/i
const forbiddenEntries = normalizedEntries.filter(
  (entry) => !entry.startsWith('node_modules/') && forbiddenPath.test(entry)
)
assert.deepEqual(
  forbiddenEntries,
  [],
  `forbidden packaged paths: ${forbiddenEntries.slice(0, 20).join(', ')}`
)

for (const unpackedPath of [PACKAGED_FLYAI_LAUNCHER_PATH, PACKAGED_FLYAI_BUNDLE_PATH]) {
  assertUnpackedIntegrity(asarPath, unpackedPath)
}

const xhsEntries = fs.readdirSync(packagedXhsRoot).sort()
assert.deepEqual(xhsEntries, ['LICENSE.txt', 'manifest.json', 'xiaohongshu-mcp-windows-amd64.exe'])
for (const packagedPath of [packagedXhsExecutable, packagedXhsManifest, packagedXhsLicense]) {
  const fileStat = fs.lstatSync(packagedPath)
  assert.equal(fileStat.isFile(), true, `${path.basename(packagedPath)} must be a regular file`)
  assert.equal(
    fileStat.isSymbolicLink(),
    false,
    `${path.basename(packagedPath)} must not be a link`
  )
  assert.equal(
    path.dirname(fs.realpathSync(packagedPath)),
    fs.realpathSync(packagedXhsRoot),
    `${path.basename(packagedPath)} escaped xhs-mcp resources`
  )
}
const xhsManifest = JSON.parse(fs.readFileSync(packagedXhsManifest, 'utf8'))
assert.deepEqual(xhsManifest, {
  name: 'xiaohongshu-mcp',
  version: '2.5.0',
  commit: '6583124dfda92312b6bc19a042a6acfae63fe498',
  platform: 'windows',
  arch: 'x64',
  file: 'xiaohongshu-mcp-windows-amd64.exe',
  size: 15601664,
  sha256: '3578c9fcf3e7be0b79564aeceef8c4f38e0072d9357ca1f911ee14cd37bd454c',
  source: 'https://github.com/xpzouying/xiaohongshu-mcp/releases/tag/v2.5.0',
  browserVersion: '148.0.7778.215'
})
assert.equal(fs.statSync(packagedXhsExecutable).size, xhsManifest.size)
assert.equal(
  createHash('sha256').update(fs.readFileSync(packagedXhsExecutable)).digest('hex'),
  xhsManifest.sha256,
  'bundled xiaohongshu-mcp digest mismatch'
)
assert.match(fs.readFileSync(packagedXhsLicense, 'utf8'), /Apache License\s+Version 2\.0/)

const secretValue =
  /(?:\bsk-[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*|\b(?:v10|v11)[A-Za-z0-9+/=]{20,}\b)/i
const suspicious = []
for (const entry of archiveEntries.filter(
  (item) =>
    (item.normalizedPath === 'package.json' ||
      item.normalizedPath === PACKAGED_FLYAI_LAUNCHER_PATH ||
      item.normalizedPath.startsWith('out/')) &&
    /\.(?:js|json|html)$/i.test(item.normalizedPath)
)) {
  const content = extractFile(asarPath, entry.normalizedPath.split('/').join(path.sep))
  if (content.length <= 8 * 1024 * 1024 && secretValue.test(content.toString('utf8'))) {
    suspicious.push(entry.normalizedPath)
  }
}
assert.deepEqual(
  suspicious,
  [],
  `credential-shaped value found in product bundle: ${suspicious.slice(0, 20).join(', ')}`
)
const installer = fs.statSync(installerPath)
assert.ok(installer.size > 0, 'NSIS artifact is empty')
console.log(
  JSON.stringify({
    ok: true,
    asarEntries: entries.length,
    forbiddenEntries: 0,
    credentialShapedValues: 0,
    unpackedIntegrityFiles: 2,
    xhsSidecarFiles: 3,
    installerBytes: installer.size,
    installerExecuted: false
  })
)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function assertUnpackedIntegrity(archivePath, normalizedPath) {
  const archiveStat = statFile(archivePath, normalizedPath.split('/').join(path.sep))
  assert.equal(archiveStat.unpacked, true, `${normalizedPath} must be ASAR-unpacked`)
  assert.equal(
    archiveStat.integrity?.algorithm,
    'SHA256',
    `${normalizedPath} must have SHA256 integrity metadata`
  )
  assert.match(
    archiveStat.integrity?.hash ?? '',
    /^[a-f0-9]{64}$/,
    `${normalizedPath} must have a SHA256 integrity digest`
  )

  const unpackedPath = path.join(`${archivePath}.unpacked`, ...normalizedPath.split('/'))
  const unpackedStat = fs.lstatSync(unpackedPath)
  assert.equal(
    unpackedStat.isFile(),
    true,
    `${normalizedPath} unpacked path must be a regular file`
  )
  const digest = createHash('sha256').update(fs.readFileSync(unpackedPath)).digest('hex')
  assert.equal(digest, archiveStat.integrity.hash, `${normalizedPath} unpacked digest mismatch`)
}
