import React from 'react'
import type { XhsLoginQrRequired } from '../../shared/schema/mcp/xiaohongshu'

export type XhsLoginPhase =
  'IDLE' | 'REQUESTING_QR' | 'WAITING_SCAN' | 'LOGGED_IN' | 'EXPIRED' | 'FAILED' | 'CANCELLED'

export interface XhsLoginViewState {
  phase: XhsLoginPhase
  qr: XhsLoginQrRequired | null
  errorMessage: string | null
}

interface XhsLoginDialogProps {
  state: XhsLoginViewState
  onClose(): void
  onCancel(): void
  onRetry(): void
}

export function XhsLoginDialog({
  state,
  onClose,
  onCancel,
  onRetry
}: XhsLoginDialogProps): React.JSX.Element | null {
  if (state.phase === 'IDLE') return null
  const waiting = state.phase === 'REQUESTING_QR' || state.phase === 'WAITING_SCAN'

  return (
    <div className="xhs-login-backdrop">
      <section
        className="xhs-login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="xhs-login-title"
        aria-describedby="xhs-login-status"
      >
        <header>
          <div>
            <p className="eyebrow">本机伴随服务</p>
            <h2 id="xhs-login-title">登录小红书</h2>
          </div>
          <button
            autoFocus
            className="secondary-button xhs-login-close"
            type="button"
            aria-label="关闭小红书登录窗口"
            onClick={onClose}
          >
            关闭
          </button>
        </header>

        {state.phase === 'REQUESTING_QR' ? (
          <p>正在准备内置组件；首次运行可能需要下载约 140–190MB。</p>
        ) : null}
        {state.phase === 'WAITING_SCAN' && state.qr ? (
          <div className="xhs-login-qr">
            <img src={state.qr.imageDataUrl} alt="小红书登录二维码" />
            <p>{state.qr.hint}</p>
          </div>
        ) : null}

        <p id="xhs-login-status" className="xhs-login-status" role="status" aria-live="polite">
          {loginStatusText(state)}
        </p>

        <div className="source-actions">
          {waiting ? (
            <button className="secondary-button" type="button" onClick={onCancel}>
              取消登录
            </button>
          ) : null}
          {state.phase === 'FAILED' || state.phase === 'EXPIRED' || state.phase === 'CANCELLED' ? (
            <button className="primary-button" type="button" onClick={onRetry}>
              重新获取二维码
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function loginStatusText(state: XhsLoginViewState): string {
  switch (state.phase) {
    case 'REQUESTING_QR':
      return '需要联网，可随时取消。组件准备完成后二维码会显示在这里。'
    case 'WAITING_SCAN':
      return '请使用小红书 App 扫码。应用会自动检查登录结果。'
    case 'LOGGED_IN':
      return '登录成功。现在可以关闭此窗口。'
    case 'EXPIRED':
      return '本次二维码已过期，请重新获取。'
    case 'FAILED':
      return state.errorMessage ?? '登录检查失败，请重新获取二维码。'
    case 'CANCELLED':
      return '登录已取消。'
    default:
      return ''
  }
}
