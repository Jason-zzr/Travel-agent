import { appendFileSync, writeFileSync } from 'node:fs'
import readline from 'node:readline'

const mode = process.argv[2]
const pidPath = process.argv[3]
const tracePath = process.argv[4]

if (!mode || !pidPath) {
  process.exitCode = 2
} else {
  writeFileSync(pidPath, String(process.pid), 'utf8')
  run(mode)
}

function run(selectedMode: string): void {
  if (selectedMode === 'cache-miss') {
    process.stderr.write('npm error code ENOTCACHED\nprivate-path-should-not-leak\n')
    process.exitCode = 1
    return
  }
  if (selectedMode === 'early-exit') {
    process.exitCode = 2
    return
  }

  const lines = readline.createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    if (selectedMode === 'hang') return
    if (selectedMode === 'invalid-protocol') {
      process.stdout.write('{"jsonrpc":"2.0","invalid":true}\n')
      return
    }

    const request: unknown = JSON.parse(line)
    if (!isRecord(request) || typeof request.method !== 'string') return
    if (tracePath) appendFileSync(tracePath, `${request.method}\n`, 'utf8')
    const id = typeof request.id === 'string' || typeof request.id === 'number' ? request.id : null
    if (request.method === 'initialize') {
      const params = isRecord(request.params) ? request.params : {}
      const protocolVersion =
        typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-11-25'
      respond(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'travel-harness-stdio-fixture', version: '1.0.0' }
      })
      return
    }
    if (request.method === 'tools/list') {
      respond(id, {
        tools:
          selectedMode === 'rail-round-trip'
            ? [
                {
                  name: 'get-tickets',
                  description: 'read-only local rail fixture',
                  inputSchema: { type: 'object' }
                }
              ]
            : [
                {
                  name: 'fixture-read',
                  description: 'read-only local fixture',
                  inputSchema: { type: 'object', additionalProperties: false }
                }
              ]
      })
      return
    }
    if (request.method === 'tools/call') {
      if (selectedMode === 'rail-round-trip') {
        const params = isRecord(request.params) ? request.params : {}
        const args = isRecord(params.arguments) ? params.arguments : {}
        const outbound = args.fromStation === '上海'
        respond(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify([
                {
                  train_no: outbound ? '5l000G19740A' : '5l000G19730A',
                  start_train_code: outbound ? 'G1974' : 'G1973',
                  start_time: outbound ? '11:00' : '09:00',
                  arrive_time: outbound ? '16:00' : '14:00'
                }
              ])
            }
          ]
        })
        return
      }
      respond(id, {
        content: [{ type: 'text', text: JSON.stringify({ ok: true }) }]
      })
    }
  })
}

function respond(id: string | number | null, result: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
