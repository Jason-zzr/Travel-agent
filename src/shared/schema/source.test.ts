import assert from 'node:assert/strict'
import test from 'node:test'
import { ExternalSourceUrlSchema } from './source'

test('external source URL safeParse rejects non-URLs without throwing', () => {
  const result = ExternalSourceUrlSchema.safeParse('SRC_MAP:maps_geo:v1-fixture')

  assert.equal(result.success, false)
})

test('external source URL accepts only credential-free HTTPS URLs', () => {
  assert.equal(ExternalSourceUrlSchema.safeParse('https://example.com/source?id=1').success, true)
  assert.equal(ExternalSourceUrlSchema.safeParse('http://example.com/source').success, false)
  assert.equal(
    ExternalSourceUrlSchema.safeParse('https://user:pass@example.com/source').success,
    false
  )
  assert.equal(
    ExternalSourceUrlSchema.safeParse('https://example.com/source?token=secret').success,
    false
  )
})
