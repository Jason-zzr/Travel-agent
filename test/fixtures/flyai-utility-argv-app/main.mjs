import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { app, utilityProcess } from 'electron'

const fixture = fileURLToPath(new URL('../flyai-commander-argv-fixture.cjs', import.meta.url))
const launcher = fileURLToPath(
  new URL('../../../resources/flyai-utility-process-launcher.cjs', import.meta.url)
)
const expected = {
  origin: '西双版纳',
  destination: '广州',
  depDate: '2099-09-17'
}

app.whenReady().then(async () => {
  try {
    const result = await runUtilityProcess(launcher, [
      fixture,
      'search-flight',
      '--origin',
      expected.origin,
      '--destination',
      expected.destination,
      '--dep-date',
      expected.depDate
    ])

    assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`)
    const outcome = JSON.parse(result.stdout.trim())
    assert.equal(outcome.argv[1], 'search-flight')
    assert.equal(outcome.argv[2], '--origin')
    assert.deepEqual(
      {
        origin: outcome.origin,
        destination: outcome.destination,
        depDate: outcome.depDate
      },
      expected
    )
    console.log(JSON.stringify({ ok: true, normalizedCommandIndex: 1 }))
    app.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error))
    app.exit(1)
  }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function runUtilityProcess(modulePath, args) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(modulePath, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      serviceName: 'FlyAI argv smoke'
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`utility process timed out\n${stdout}\n${stderr}`))
    }, 10_000)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
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
