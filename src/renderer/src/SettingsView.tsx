import React, { useEffect, useRef, useState } from 'react'
import {
  CredentialIdSchema,
  type CredentialId,
  type CredentialStatusEntry
} from '../../shared/schema/credentials'
import {
  ModelRoleSchema,
  ProviderChannelSchema,
  ProviderConfigSchema,
  type ProviderConfigSummary
} from '../../shared/schema/provider'
import {
  clearCredential,
  getXhsConnectionStatus,
  getXhsLoginQr,
  getProviderConfig,
  listCredentials,
  listSourceHealth,
  probeSource,
  cancelSourceOperation,
  saveCredential,
  saveProviderConfig
} from './ipc'
import type { ExternalSourceId, SourceHealthEntry } from '../../shared/schema/source'
import type { XhsConnectionStatus } from '../../shared/schema/mcp/xiaohongshu'
import { XhsLoginDialog, type XhsLoginViewState } from './XhsLoginDialog'

const SOURCE_LABELS: Record<CredentialId, string> = {
  AMAP: '高德地图',
  ROLLINGGO: 'RollingGo 酒店',
  OPENAI: 'OpenAI',
  DEEPSEEK: 'DeepSeek',
  GEMINI: 'Gemini',
  SHUAI_API: '帅 API（第三方模型）',
  BRAVE_SEARCH: 'Brave Search（旧版，已停用）',
  SERPER_SEARCH: 'Serper Search（独立搜索）',
  XIAOHONGSHU_MCP_AUTH: '小红书 MCP 访问令牌（可选）',
  FLYAI: '飞猪 FlyAI'
}

const STATUS_LABELS: Record<CredentialStatusEntry['status'], string> = {
  CONFIGURED: '已配置',
  UNCONFIGURED: '未配置',
  REENTRY_REQUIRED: '需重新录入'
}

const SOURCE_CARDS: Array<{ id: ExternalSourceId; label: string }> = [
  { id: 'SRC_RAIL', label: '12306 车次' },
  { id: 'SRC_MAP', label: '高德地图' },
  { id: 'SRC_HOTEL', label: 'RollingGo 酒店' },
  { id: 'SRC_SEARCH', label: 'Serper Search + DeepSeek 流式生成' },
  { id: 'SRC_XHS', label: '小红书正向 / 避雷交叉验证' }
]

const VISIBLE_CREDENTIAL_IDS = CredentialIdSchema.options.filter(
  (id) => id !== 'OPENAI' && id !== 'BRAVE_SEARCH' && id !== 'XIAOHONGSHU_MCP_AUTH'
)

const INITIAL_XHS_LOGIN_STATE: XhsLoginViewState = {
  phase: 'IDLE',
  qr: null,
  errorMessage: null
}

export function SettingsView(): React.JSX.Element {
  const [statuses, setStatuses] = useState<CredentialStatusEntry[]>([])
  const [busyId, setBusyId] = useState<CredentialId | null>(null)
  const [provider, setProvider] = useState<ProviderConfigSummary | null>(null)
  const [health, setHealth] = useState<SourceHealthEntry[]>([])
  const [xhsStatus, setXhsStatus] = useState<XhsConnectionStatus | null>(null)
  const [sourceOperation, setSourceOperation] = useState<{
    id: string
    sourceId: ExternalSourceId
  } | null>(null)
  const [xhsLogin, setXhsLogin] = useState<XhsLoginViewState>(INITIAL_XHS_LOGIN_STATE)
  const xhsLoginEpoch = useRef(0)
  const xhsLoginOperation = useRef<string | null>(null)
  const xhsLoginLifecycleOperation = useRef<string | null>(null)
  const xhsLoginTimer = useRef<number | null>(null)
  const [message, setMessage] = useState('正在读取本机配置…')

  useEffect(() => {
    let active = true
    void Promise.allSettled([listCredentials(), getProviderConfig(), listSourceHealth()]).then(
      ([credentials, config, sourceHealth]) => {
        if (!active) return
        const failures: string[] = []
        if (credentials.status === 'fulfilled' && credentials.value.ok)
          setStatuses(credentials.value.data)
        else failures.push('密钥状态')
        if (config.status === 'fulfilled' && config.value.ok) setProvider(config.value.data)
        else failures.push('Provider 配置')
        if (sourceHealth.status === 'fulfilled' && sourceHealth.value.ok)
          setHealth(sourceHealth.value.data)
        else failures.push('数据源状态')
        setMessage(
          failures.length === 0
            ? '密钥与非密钥配置已分开保存在本机。'
            : `以下本机配置读取失败：${failures.join('、')}。其他设置仍可录入。`
        )
      }
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(
    () => () => {
      xhsLoginEpoch.current += 1
      clearXhsLoginTimer()
      requestXhsSidecarStop()
    },
    []
  )

  function clearXhsLoginTimer(): void {
    if (xhsLoginTimer.current !== null) {
      window.clearTimeout(xhsLoginTimer.current)
      xhsLoginTimer.current = null
    }
  }

  function requestXhsSidecarStop(): void {
    const operationId = xhsLoginOperation.current ?? xhsLoginLifecycleOperation.current
    xhsLoginOperation.current = null
    xhsLoginLifecycleOperation.current = null
    if (!operationId) return
    void cancelSourceOperation(operationId)
  }

  function expireXhsLogin(epoch: number): void {
    if (xhsLoginEpoch.current !== epoch) return
    clearXhsLoginTimer()
    requestXhsSidecarStop()
    setXhsLogin({ phase: 'EXPIRED', qr: null, errorMessage: null })
    setMessage('小红书登录二维码已过期。')
  }

  function scheduleXhsStatusCheck(epoch: number, expiresAt: string): void {
    if (xhsLoginEpoch.current !== epoch) return
    clearXhsLoginTimer()
    const remaining = new Date(expiresAt).getTime() - Date.now()
    if (remaining <= 0) return expireXhsLogin(epoch)
    xhsLoginTimer.current = window.setTimeout(
      () => void checkXhsLoginStatus(epoch, expiresAt),
      Math.min(3000, remaining)
    )
  }

  async function checkXhsLoginStatus(epoch: number, expiresAt: string): Promise<void> {
    if (xhsLoginEpoch.current !== epoch) return
    if (Date.now() >= new Date(expiresAt).getTime()) return expireXhsLogin(epoch)
    const operationId = crypto.randomUUID()
    xhsLoginOperation.current = operationId
    try {
      const result = await getXhsConnectionStatus(operationId)
      if (xhsLoginEpoch.current !== epoch) return
      if (xhsLoginOperation.current === operationId) xhsLoginOperation.current = null
      if (Date.now() >= new Date(expiresAt).getTime()) return expireXhsLogin(epoch)
      if (!result.ok) {
        requestXhsSidecarStop()
        setXhsLogin({ phase: 'FAILED', qr: null, errorMessage: result.error.userHint })
        setMessage(result.error.userHint)
        return
      }
      setXhsStatus(result.data)
      if (result.data.loggedIn) {
        requestXhsSidecarStop()
        setXhsLogin({ phase: 'LOGGED_IN', qr: null, errorMessage: null })
        setMessage('小红书登录成功。')
        try {
          const refreshed = await listSourceHealth()
          if (xhsLoginEpoch.current === epoch && refreshed.ok) setHealth(refreshed.data)
        } catch {
          // Login succeeded independently; a secondary health refresh must not erase that result.
        }
        return
      }
      scheduleXhsStatusCheck(epoch, expiresAt)
    } catch {
      if (xhsLoginEpoch.current !== epoch) return
      if (xhsLoginOperation.current === operationId) xhsLoginOperation.current = null
      requestXhsSidecarStop()
      const errorMessage = '小红书登录状态检查未完成，请重新获取二维码。'
      setXhsLogin({ phase: 'FAILED', qr: null, errorMessage })
      setMessage(errorMessage)
    }
  }

  async function handleStartXhsLogin(): Promise<void> {
    if (
      sourceOperation ||
      xhsStatus?.loggedIn ||
      xhsLogin.phase === 'REQUESTING_QR' ||
      xhsLogin.phase === 'WAITING_SCAN'
    ) {
      return
    }
    const epoch = xhsLoginEpoch.current + 1
    xhsLoginEpoch.current = epoch
    clearXhsLoginTimer()
    const operationId = crypto.randomUUID()
    xhsLoginOperation.current = operationId
    xhsLoginLifecycleOperation.current = operationId
    setXhsLogin({ phase: 'REQUESTING_QR', qr: null, errorMessage: null })
    setMessage('正在准备内置小红书组件；首次运行可能下载约 140–190MB…')
    try {
      const result = await getXhsLoginQr(operationId)
      if (xhsLoginEpoch.current !== epoch) return
      if (xhsLoginOperation.current === operationId) xhsLoginOperation.current = null
      if (!result.ok) {
        requestXhsSidecarStop()
        setXhsLogin({ phase: 'FAILED', qr: null, errorMessage: result.error.userHint })
        setMessage(result.error.userHint)
        return
      }
      if (result.data.status === 'ALREADY_LOGGED_IN') {
        requestXhsSidecarStop()
        setXhsStatus({ connected: true, loggedIn: true, authTokenConfigured: true })
        setXhsLogin({ phase: 'LOGGED_IN', qr: null, errorMessage: null })
        setMessage('小红书账号已登录，无需重复扫码。')
        return
      }
      setXhsLogin({ phase: 'WAITING_SCAN', qr: result.data, errorMessage: null })
      setMessage('二维码已生成，请使用小红书 App 扫码。')
      scheduleXhsStatusCheck(epoch, result.data.expiresAt)
    } catch {
      if (xhsLoginEpoch.current !== epoch) return
      if (xhsLoginOperation.current === operationId) xhsLoginOperation.current = null
      requestXhsSidecarStop()
      const errorMessage = '内置小红书组件未能准备登录二维码，请检查网络后重试。'
      setXhsLogin({ phase: 'FAILED', qr: null, errorMessage })
      setMessage(errorMessage)
    }
  }

  function stopXhsLogin(next: 'IDLE' | 'CANCELLED'): void {
    xhsLoginEpoch.current += 1
    clearXhsLoginTimer()
    requestXhsSidecarStop()
    setXhsLogin(
      next === 'IDLE'
        ? INITIAL_XHS_LOGIN_STATE
        : { phase: 'CANCELLED', qr: null, errorMessage: null }
    )
    if (next === 'CANCELLED') setMessage('小红书登录已取消。')
  }

  async function handleCredentialSave(
    event: React.FormEvent<HTMLFormElement>,
    id: CredentialId
  ): Promise<void> {
    event.preventDefault()
    const form = event.currentTarget
    const value = new FormData(form).get('credential')
    if (typeof value !== 'string' || !value.trim()) return setMessage('请输入完整凭据。')
    setBusyId(id)
    try {
      const result = await saveCredential(id, value)
      if (!result.ok) return setMessage(result.error.userHint)
      setStatuses((current) => current.map((item) => (item.id === id ? result.data : item)))
      setMessage(`${SOURCE_LABELS[id]}：已配置。`)
    } catch {
      setMessage(`${SOURCE_LABELS[id]}：保存未完成，请重试。`)
    } finally {
      form.reset()
      setBusyId(null)
    }
  }

  async function handleProbe(sourceId: ExternalSourceId): Promise<void> {
    const operation = { id: crypto.randomUUID(), sourceId }
    setSourceOperation(operation)
    setMessage(`${sourceId} 正在执行只读探测…`)
    if (sourceId === 'SRC_XHS') {
      const result = await getXhsConnectionStatus(operation.id)
      setSourceOperation((current) => (current?.id === operation.id ? null : current))
      if (!result.ok) return setMessage(result.error.userHint)
      setXhsStatus(result.data)
      const refreshed = await listSourceHealth()
      if (refreshed.ok) setHealth(refreshed.data)
      setMessage(
        result.data.loggedIn
          ? '小红书伴随服务已连接，账号已登录。'
          : '小红书伴随服务已连接，但账号未登录。'
      )
      return
    }
    const result = await probeSource(sourceId, operation.id)
    setSourceOperation((current) => (current?.id === operation.id ? null : current))
    if (!result.ok) return setMessage(result.error.userHint)
    setHealth((current) => current.map((item) => (item.sourceId === sourceId ? result.data : item)))
    setMessage(`${sourceId} 探测通过。`)
  }

  async function handleCancelProbe(): Promise<void> {
    if (!sourceOperation) return
    const operationId = sourceOperation.id
    await cancelSourceOperation(operationId)
    setMessage('已请求取消数据源探测。')
  }

  async function handleCredentialClear(id: CredentialId): Promise<void> {
    setBusyId(id)
    try {
      const result = await clearCredential(id)
      if (!result.ok) return setMessage(result.error.userHint)
      setStatuses((current) => current.map((item) => (item.id === id ? result.data : item)))
      setMessage(`${SOURCE_LABELS[id]}：已清除。`)
    } catch {
      setMessage(`${SOURCE_LABELS[id]}：清除未完成，请重试。`)
    } finally {
      setBusyId(null)
    }
  }

  async function handleProviderSave(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    try {
      const config = ProviderConfigSchema.parse({
        version: 2,
        channels: {
          DEEPSEEK_OFFICIAL: { baseUrl: String(data.get('DEEPSEEK_OFFICIAL-baseUrl')) },
          SHUAI_API: { baseUrl: String(data.get('SHUAI_API-baseUrl')) }
        },
        roles: Object.fromEntries(
          ModelRoleSchema.options.map((role) => [
            role,
            {
              channel: String(data.get(`${role}-channel`)),
              model: String(data.get(`${role}-model`)),
              currency: String(data.get(`${role}-currency`)),
              inputMinorPerMillion: optionalRate(data.get(`${role}-input`)),
              outputMinorPerMillion: optionalRate(data.get(`${role}-output`))
            }
          ])
        )
      })
      const result = await saveProviderConfig(config)
      if (!result.ok) return setMessage(result.error.userHint)
      setProvider(result.data)
      setMessage('模型角色路由已保存；调用时不自动切换渠道或重试。')
    } catch {
      setMessage('模型路由不完整：请填写两个 HTTPS 根地址，并为四个角色选择渠道和模型。')
    }
  }

  return (
    <div className="settings-stack">
      <section className="settings-panel" aria-labelledby="provider-heading">
        <div className="section-heading">
          <div>
            <h2 id="provider-heading">模型路由</h2>
            <p>每个角色显式选择渠道；不按模型名猜测，不自动回退或重试。</p>
          </div>
          <span className="status status-configured">
            {provider?.configured
              ? provider.version === 2
                ? '按角色已配置'
                : `${provider.provider}（旧版）`
              : '未配置'}
          </span>
        </div>
        <form
          className="provider-form"
          key={JSON.stringify(provider)}
          onSubmit={(event) => void handleProviderSave(event)}
        >
          <div className="provider-basics">
            {ProviderChannelSchema.options.map((channel) => (
              <label key={channel}>
                {channel === 'DEEPSEEK_OFFICIAL' ? 'DeepSeek 官方根地址' : '帅 API 根地址'}
                <input
                  name={`${channel}-baseUrl`}
                  type="url"
                  defaultValue={providerBaseUrl(provider, channel)}
                  placeholder={
                    channel === 'DEEPSEEK_OFFICIAL'
                      ? 'https://api.deepseek.com'
                      : 'https://api.shuaiapi.com'
                  }
                  required
                />
              </label>
            ))}
          </div>
          <div className="role-grid">
            {ModelRoleSchema.options.map((role) => (
              <div className="role-row" key={role}>
                <strong>{role}</strong>
                <select
                  aria-label={`${role} 渠道`}
                  name={`${role}-channel`}
                  defaultValue={providerRoleChannel(provider, role)}
                >
                  <option value="DEEPSEEK_OFFICIAL">DeepSeek 官方</option>
                  <option value="SHUAI_API">帅 API</option>
                </select>
                <input
                  aria-label={`${role} 模型`}
                  name={`${role}-model`}
                  defaultValue={provider?.routes?.[role].model ?? provider?.models?.[role] ?? ''}
                  placeholder="模型名（必填）"
                  required
                />
                <select
                  aria-label={`${role} 计费币种`}
                  name={`${role}-currency`}
                  defaultValue={provider?.routes?.[role].currency ?? 'CNY'}
                >
                  <option>USD</option>
                  <option>CNY</option>
                </select>
                <input
                  name={`${role}-input`}
                  inputMode="numeric"
                  defaultValue={provider?.routes?.[role].inputMinorPerMillion ?? ''}
                  placeholder="输入费率/百万"
                />
                <input
                  name={`${role}-output`}
                  inputMode="numeric"
                  defaultValue={provider?.routes?.[role].outputMinorPerMillion ?? ''}
                  placeholder="输出费率/百万"
                />
              </div>
            ))}
          </div>
          <button className="primary-button" type="submit">
            保存模型路由
          </button>
        </form>
      </section>

      <section className="settings-panel" aria-labelledby="credentials-heading">
        <div className="section-heading">
          <div>
            <h2 id="credentials-heading">数据源与模型密钥</h2>
            <p>只显示状态，不显示字符、掩码或真实前缀。</p>
          </div>
        </div>
        <div className="credential-list">
          {VISIBLE_CREDENTIAL_IDS.map((id) => {
            const status = statuses.find((item) => item.id === id)?.status ?? 'UNCONFIGURED'
            const busy = busyId === id
            return (
              <article className="credential-row" key={id}>
                <div className="credential-meta">
                  <h3>{SOURCE_LABELS[id]}</h3>
                  <span className={`status status-${status.toLowerCase()}`}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>
                <form onSubmit={(event) => void handleCredentialSave(event, id)}>
                  <label>
                    <span className="sr-only">{SOURCE_LABELS[id]} 凭据</span>
                    <input
                      name="credential"
                      type="password"
                      autoComplete="off"
                      disabled={busy}
                      placeholder="录入后不会回显"
                    />
                  </label>
                  <button type="submit" disabled={busy}>
                    {busy ? '处理中…' : '保存'}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || status === 'UNCONFIGURED'}
                    onClick={() => void handleCredentialClear(id)}
                  >
                    清除
                  </button>
                </form>
              </article>
            )
          })}
        </div>
      </section>
      <section className="settings-panel" aria-labelledby="sources-heading">
        <div className="section-heading">
          <div>
            <h2 id="sources-heading">只读数据源</h2>
            <p>状态读取不会联网；只有点击“探测”才会发起一次显式只读请求。</p>
          </div>
        </div>
        <div className="source-card-grid">
          {SOURCE_CARDS.map((source) => {
            const entry = health.find((item) => item.sourceId === source.id)
            const busy = sourceOperation?.sourceId === source.id
            const xhsLoginBusy =
              xhsLogin.phase === 'REQUESTING_QR' || xhsLogin.phase === 'WAITING_SCAN'
            return (
              <article
                className={`source-card source-${entry?.status.toLowerCase() ?? 'unconfigured'}`}
                key={source.id}
              >
                <div className="source-card-title">
                  <h3>{source.label}</h3>
                  <span
                    className={`status status-${entry?.status.toLowerCase() ?? 'unconfigured'}`}
                  >
                    {entry?.status ?? 'UNCONFIGURED'}
                  </span>
                </div>
                <p>
                  {source.id === 'SRC_XHS' && xhsStatus
                    ? xhsStatus.loggedIn
                      ? `内置组件已就绪；账号已登录${xhsStatus.authTokenConfigured ? '；本机鉴权已启用' : ''}。`
                      : '内置组件已就绪；账号未登录，请点击“准备并登录小红书”。'
                    : source.id === 'SRC_XHS'
                      ? '内置组件随应用提供。首次点击登录时需联网下载约 140–190MB 浏览器组件，可取消；启动应用不会后台下载。'
                      : entry?.status === 'DEGRADED'
                        ? `${entry.capabilityImpact}；${entry.manualAlternative}`
                        : entry?.lastOkAt
                          ? `最近成功：${formatTime(entry.lastOkAt)}`
                          : '尚无成功探测记录。'}
                </p>
                <div className="source-actions">
                  {source.id !== 'SRC_XHS' ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={Boolean(sourceOperation) || xhsLoginBusy}
                      onClick={() => void handleProbe(source.id)}
                    >
                      {busy ? '探测中…' : '显式探测'}
                    </button>
                  ) : null}
                  {source.id === 'SRC_XHS' ? (
                    <button
                      className="primary-button"
                      type="button"
                      disabled={Boolean(sourceOperation) || xhsLoginBusy || xhsStatus?.loggedIn}
                      onClick={() => void handleStartXhsLogin()}
                    >
                      {xhsStatus?.loggedIn
                        ? '已登录'
                        : xhsLoginBusy
                          ? '组件准备中…'
                          : '准备并登录小红书'}
                    </button>
                  ) : null}
                  {busy ? (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void handleCancelProbe()}
                    >
                      取消
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </section>
      <p className="system-message" role="status" aria-live="polite">
        {message}
      </p>
      <XhsLoginDialog
        state={xhsLogin}
        onClose={() => stopXhsLogin('IDLE')}
        onCancel={() => stopXhsLogin('CANCELLED')}
        onRetry={() => void handleStartXhsLogin()}
      />
    </div>
  )
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value)
  )
}

function optionalRate(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function providerBaseUrl(
  provider: ProviderConfigSummary | null,
  channel: 'DEEPSEEK_OFFICIAL' | 'SHUAI_API'
): string {
  const configured = provider?.routes
    ? ModelRoleSchema.options
        .map((role) => provider.routes?.[role])
        .find((route) => route?.channel === channel)?.baseUrl
    : undefined
  if (configured) return configured
  return channel === 'DEEPSEEK_OFFICIAL' ? 'https://api.deepseek.com' : 'https://api.shuaiapi.com'
}

function providerRoleChannel(
  provider: ProviderConfigSummary | null,
  role: (typeof ModelRoleSchema.options)[number]
): 'DEEPSEEK_OFFICIAL' | 'SHUAI_API' {
  return provider?.routes?.[role].channel === 'SHUAI_API' ? 'SHUAI_API' : 'DEEPSEEK_OFFICIAL'
}
