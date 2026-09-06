import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const executable = path.join(process.cwd(), 'dist', 'win-unpacked', 'travel-harness.exe')
assert.equal(fs.existsSync(executable), true, `unpacked executable not found: ${executable}`)
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-flyai-path-'))
try {
  const result = await run(executable, [
    `--user-data-dir=${userData}`,
    '--smoke-flyai-path-only',
    '--disable-gpu',
    '--disable-gpu-compositing'
  ])
  assert.equal(result.code, 0, result.stderr || result.stdout)
  const outcome = result.stdout
    .split(/\r?\n/)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .find((entry) => entry?.ok === true && entry?.mode === 'path-only')
  assert.ok(outcome, `packaged path smoke did not emit a successful result: ${result.stdout}`)
  assert.equal(outcome.packageName, '@fly-ai/flyai-cli')
  assert.equal(outcome.packageVersion, '1.0.16')
  assert.match(outcome.bundleSha256, /^sha256:[a-f0-9]{64}$/)
  assert.match(outcome.bundlePathDigest, /^sha256:[a-f0-9]{64}$/)
  assert.match(outcome.launcherSha256, /^sha256:[a-f0-9]{64}$/)
  assert.match(outcome.launcherPathDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(outcome.externalCalls, 0)
  assert.equal(outcome.cliProcessAttempts, 0)
  assert.equal(outcome.credentialReads, 0)
  assert.equal(outcome.productionAllowlistMutations, 0)
  console.log(JSON.stringify({ ok: true, executable, userDataIsolation: true, ...outcome }))
} finally {
  fs.rmSync(userData, { recursive: true, force: true })
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`packaged path smoke timed out\n${stdout}\n${stderr}`))
    }, 60_000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}
