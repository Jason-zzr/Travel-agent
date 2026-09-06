import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsView } from '../../src/renderer/src/SettingsView'
import { XhsLoginDialog } from '../../src/renderer/src/XhsLoginDialog'

test('Settings renders a non-revealing FlyAI credential entry without external work', () => {
  const externalCalls = 0
  const markup = renderToStaticMarkup(createElement(SettingsView))

  assert.match(markup, /飞猪 FlyAI/)
  assert.match(markup, /type="password"/)
  assert.match(markup, /录入后不会回显/)
  assert.doesNotMatch(markup, /FLYAI_API_KEY/)
  assert.equal(externalCalls, 0)
})

test('Settings exposes an explicit Xiaohongshu login action without creating a QR on render', () => {
  const markup = renderToStaticMarkup(createElement(SettingsView))

  assert.match(markup, /准备并登录小红书/)
  assert.match(markup, /首次点击登录时需联网下载约 140–190MB/)
  assert.doesNotMatch(markup, /检测连接与登录/)
  assert.doesNotMatch(markup, /小红书 MCP 访问令牌/)
  assert.doesNotMatch(markup, /role="dialog"/)
  assert.doesNotMatch(markup, /data:image\/png;base64/)
})

test('Xiaohongshu login dialog renders a scan-only accessible flow', () => {
  const markup = renderToStaticMarkup(
    createElement(XhsLoginDialog, {
      state: {
        phase: 'WAITING_SCAN',
        qr: {
          status: 'QR_REQUIRED',
          imageDataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          hint: '请扫码登录。',
          expiresAt: '2026-09-04T12:05:00.000Z'
        },
        errorMessage: null
      },
      onClose: () => undefined,
      onCancel: () => undefined,
      onRetry: () => undefined
    })
  )

  assert.match(markup, /role="dialog"/)
  assert.match(markup, /aria-modal="true"/)
  assert.match(markup, /alt="小红书登录二维码"/)
  assert.match(markup, /使用小红书 App 扫码/)
  assert.match(markup, /取消登录/)
  assert.doesNotMatch(markup, /密码|Cookie|token/i)
})

test('Xiaohongshu login dialog exposes terminal states and retry only when appropriate', () => {
  const renderPhase = (
    phase: 'LOGGED_IN' | 'EXPIRED' | 'FAILED' | 'CANCELLED',
    errorMessage: string | null = null
  ): string =>
    renderToStaticMarkup(
      createElement(XhsLoginDialog, {
        state: { phase, qr: null, errorMessage },
        onClose: () => undefined,
        onCancel: () => undefined,
        onRetry: () => undefined
      })
    )

  const loggedIn = renderPhase('LOGGED_IN')
  assert.match(loggedIn, /登录成功。现在可以关闭此窗口。/)
  assert.doesNotMatch(loggedIn, /重新获取二维码|取消登录/)

  const expired = renderPhase('EXPIRED')
  assert.match(expired, /本次二维码已过期/)
  assert.match(expired, /重新获取二维码/)

  const failed = renderPhase('FAILED', '本机伴随服务暂不可用。')
  assert.match(failed, /本机伴随服务暂不可用。/)
  assert.match(failed, /重新获取二维码/)

  const cancelled = renderPhase('CANCELLED')
  assert.match(cancelled, /登录已取消。/)
  assert.match(cancelled, /重新获取二维码/)
})
