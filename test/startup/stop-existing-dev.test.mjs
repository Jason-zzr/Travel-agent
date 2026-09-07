import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test(
  'launcher helper stops only the existing electron-vite process for the same project',
  { skip: process.platform !== 'win32' },
  async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-launcher-test-'))
    const otherProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-launcher-other-'))
    const marker = `electron-vite dev ${projectRoot}`
    const otherMarker = `electron-vite dev ${otherProjectRoot}`
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)', marker], {
      stdio: 'ignore',
      windowsHide: true
    })
    const otherChild = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1_000)', otherMarker],
      {
        stdio: 'ignore',
        windowsHide: true
      }
    )

    try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(process.cwd(), 'scripts', 'stop-existing-travel-agent-dev.ps1'),
          '-ProjectRoot',
          projectRoot,
          '-Quiet'
        ],
        { encoding: 'utf8', windowsHide: true }
      )

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      await waitForExit(child)
      assert.notEqual(child.exitCode, null)
      assert.equal(otherChild.exitCode, null)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      if (otherChild.exitCode === null) otherChild.kill('SIGKILL')
      fs.rmSync(projectRoot, { recursive: true, force: true })
      fs.rmSync(otherProjectRoot, { recursive: true, force: true })
    }
  }
)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function waitForExit(child) {
  for (let attempt = 0; attempt < 40 && child.exitCode === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
