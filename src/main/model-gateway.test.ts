import assert from 'node:assert/strict'
import test from 'node:test'
import { buildChatRequest, classifyProviderFailure, normalizeChatResponse } from './model-gateway'

test('model gateway builds minimal explicit-profile requests', () => {
  const deepSeek = buildChatRequest({
    profile: 'DEEPSEEK_OFFICIAL',
    baseUrl: 'https://api.deepseek.com/',
    apiKey: 'deepseek-test-key',
    model: 'deepseek-chat',
    system: 'system contract',
    user: 'user input',
    signal: AbortSignal.abort()
  })
  assert.equal(deepSeek.url, 'https://api.deepseek.com/v1/chat/completions')
  assert.equal(deepSeek.init.headers.authorization, 'Bearer deepseek-test-key')
  assert.deepEqual(Object.keys(JSON.parse(deepSeek.init.body)).sort(), [
    'messages',
    'model',
    'response_format',
    'stream'
  ])

  const shuai = buildChatRequest({
    profile: 'SHUAI_API',
    baseUrl: 'https://api.shuaiapi.com',
    apiKey: 'shuai-test-key',
    model: 'gemini-through-shuai',
    system: 'system contract',
    user: 'user input',
    signal: AbortSignal.abort()
  })
  assert.equal(shuai.url, 'https://api.shuaiapi.com/v1/chat/completions')
  assert.equal(shuai.init.headers.authorization, 'Bearer shuai-test-key')
})

test('model gateway keeps legacy endpoint compatibility without model-name routing', () => {
  const request = buildChatRequest({
    profile: 'OPENAI',
    baseUrl: 'https://legacy.example/v1/',
    apiKey: 'legacy-test-key',
    model: 'deepseek-named-but-openai-routed',
    system: 'system contract',
    user: 'user input',
    signal: AbortSignal.abort()
  })
  assert.equal(request.url, 'https://legacy.example/v1/chat/completions')
})

test('model gateway normalizes only the frozen response fields', () => {
  assert.deepEqual(
    normalizeChatResponse({
      id: 'not-retained',
      choices: [{ message: { content: '{"answer":"ok"}', ignored: 'value' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
    }),
    { text: '{"answer":"ok"}', usage: { inputTokens: 12, outputTokens: 4 } }
  )
  assert.throws(() => normalizeChatResponse({ choices: [] }))
  assert.throws(() =>
    normalizeChatResponse({ choices: [{ message: { content: '' } }], usage: 'drifted' })
  )
})

test('model gateway distinguishes rate limit from quota without retaining error values', () => {
  assert.equal(
    classifyProviderFailure(429, { error: { code: 'rate_limit_exceeded', message: 'secret' } }),
    'RATE_LIMITED'
  )
  assert.equal(
    classifyProviderFailure(429, { error: { code: 'insufficient_quota', message: 'secret' } }),
    'QUOTA_EXHAUSTED'
  )
  assert.equal(classifyProviderFailure(401, undefined), 'UNAUTHORIZED')
  assert.equal(classifyProviderFailure(403, undefined), 'POLICY_DENIED')
  assert.equal(classifyProviderFailure(404, undefined), 'CONFIGURATION')
  assert.equal(classifyProviderFailure(408, undefined), 'TIMEOUT')
  assert.equal(classifyProviderFailure(413, undefined), 'INPUT_REJECTED')
  assert.equal(classifyProviderFailure(500, undefined), 'UPSTREAM_UNAVAILABLE')
  assert.equal(classifyProviderFailure(502, undefined), 'UPSTREAM_UNAVAILABLE')
  assert.equal(classifyProviderFailure(503, undefined), 'UPSTREAM_UNAVAILABLE')
  assert.equal(classifyProviderFailure(418, { error: { message: 'ignored' } }), 'INVALID_RESPONSE')
})
