import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const executable = path.join(process.cwd(), 'dist', 'win-unpacked', 'travel-harness.exe')
assert.equal(fs.existsSync(executable), true, `unpacked executable not found: ${executable}`)
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-d7-packaged-'))
try {
  const result = await run(executable, [
    `--user-data-dir=${userData}`,
    '--smoke-d7-packaged-once',
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
    .find((entry) => entry?.ok === true)
  assert.ok(outcome, `packaged smoke did not emit a successful result: ${result.stdout}`)
  assert.equal(outcome.recovered.currentVersion, 2)
  assert.equal(outcome.recovered.reservation, 'DONE')
  assert.equal(outcome.recovered.gateReady, true)
  assert.equal(outcome.externalCalls, 0)
  assert.equal(outcome.modelCalls, 0)
  assert.equal(outcome.irreversibleActions, 0)
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
      reject(new Error(`packaged smoke timed out\n${stdout}\n${stderr}`))
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
