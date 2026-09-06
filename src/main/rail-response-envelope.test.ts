import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'zod'
import { SOURCE_DEFINITIONS } from './mcp/source-catalog'

const getTicketsContract = SOURCE_DEFINITIONS.SRC_RAIL.tools['get-tickets']!
const jsonResultSchema = getTicketsContract.resultForArgs!({ format: 'json' })

const textEnvelope = (text: string, isError?: boolean): unknown => ({
  content: [{ type: 'text', text }],
  ...(isError === undefined ? {} : { isError })
})

test('Rail JSON contract maps pinned package Error text to a tool error envelope', () => {
  const result = jsonResultSchema.parse(textEnvelope('  Error: Station not found. '))
  assert.equal(result.isError, true)
})

test('Rail JSON contract preserves explicit MCP tool errors without parsing their payload', () => {
  const result = jsonResultSchema.parse(textEnvelope('opaque tool failure', true))
  assert.equal(result.isError, true)
})

test('Rail JSON contract preserves valid ticket arrays', () => {
  const result = jsonResultSchema.parse(
    textEnvelope(
      JSON.stringify([
        {
          train_no: 'internal-code',
          start_train_code: 'G2976',
          start_time: '07:25',
          arrive_time: '16:36'
        }
      ])
    )
  )
  assert.equal(result.isError, undefined)
})

test('Rail JSON contract still rejects malformed or schema-invalid success payloads', () => {
  assert.throws(() => jsonResultSchema.parse(textEnvelope('not-json')), z.ZodError)
  assert.throws(
    () =>
      jsonResultSchema.parse(
        textEnvelope(JSON.stringify([{ train_no: 'x', start_time: '25:00', arrive_time: '09:00' }]))
      ),
    z.ZodError
  )
})

test('Rail JSON contract still rejects empty, non-text, and structuredContent-only envelopes', () => {
  assert.throws(() => jsonResultSchema.parse({ content: [] }), z.ZodError)
  assert.throws(
    () =>
      jsonResultSchema.parse({ content: [{ type: 'image', data: 'x', mimeType: 'image/png' }] }),
    z.ZodError
  )
  assert.throws(() => jsonResultSchema.parse({ structuredContent: { tickets: [] } }), z.ZodError)
})
