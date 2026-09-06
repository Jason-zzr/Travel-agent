import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import electronPath from 'electron'
import {
  PACKAGED_FLYAI_BUNDLE_PATH,
  PACKAGED_FLYAI_LAUNCHER_PATH,
  isAllowedPackagedPath,
  normalizeArchivePath
} from './verify-package-policy.mjs'

test('FlyAI probe script separates application arguments from Electron switches', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  )

  assert.equal(packageJson.scripts['probe:flyai:flight'], 'electron . -- --probe-flyai-flight-once')
})

test('FlyAI utility process launcher normalizes the Commander command to argv index 1', async () => {
  const appPath = fileURLToPath(new URL('./fixtures/flyai-utility-argv-app', import.meta.url))
  const result = await run(electronPath, ['--disable-gpu', appPath])

  assert.equal(result.code, 0, result.stderr || result.stdout)
  const outcome = result.stdout
    .split(/\r?\n/u)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .find((entry) => entry?.ok === true)
  assert.deepEqual(outcome, { ok: true, normalizedCommandIndex: 1 })
})

test('package policy allows only the exact FlyAI launcher resource', () => {
  for (const allowed of [
    'package.json',
    'out',
    'out/main/index.js',
    'node_modules',
    PACKAGED_FLYAI_BUNDLE_PATH,
    'resources',
    PACKAGED_FLYAI_LAUNCHER_PATH
  ]) {
    assert.equal(isAllowedPackagedPath(allowed), true, allowed)
  }

  for (const rejected of [
    'resources/extra.txt',
    'resources/nested/flyai-utility-process-launcher.cjs',
    'resources/flyai-utility-process-launcher.cjs.bak',
    'source/main/index.ts',
    'test/verify-package.mjs'
  ]) {
    assert.equal(isAllowedPackagedPath(rejected), false, rejected)
  }
})

test('package policy normalizes Windows and ASAR-root paths before matching', () => {
  assert.equal(
    normalizeArchivePath('\\resources\\flyai-utility-process-launcher.cjs'),
    PACKAGED_FLYAI_LAUNCHER_PATH
  )
  assert.equal(normalizeArchivePath('/out/main/index.js'), 'out/main/index.js')
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`FlyAI argv smoke timed out\n${stdout}\n${stderr}`))
    }, 15_000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolve({ code, stdout, stderr })
    })
  })
}
