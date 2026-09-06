import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionSummary } from '../../shared/schema/chat'
import type { InspectorQuery, InspectorSnapshot } from '../../shared/schema/d7'
import { exportDiagnostic, getInspectorSnapshot, listSessions } from './ipc'

export function InspectorView(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionId, setSessionId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [limit, setLimit] = useState(100)
  const [snapshot, setSnapshot] = useState<InspectorSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('选择会话后读取本地安全审计摘要。')

  const query = useMemo<InspectorQuery | null>(() => {
    if (!sessionId) return null
    return {
      sessionId,
      ...(from ? { from: new Date(from).toISOString() } : {}),
      ...(to ? { to: new Date(to).toISOString() } : {}),
      limit
    }
  }, [from, limit, sessionId, to])

  const refresh = useCallback(async (nextQuery: InspectorQuery): Promise<void> => {
    setBusy(true)
    const result = await getInspectorSnapshot(nextQuery)
    setBusy(false)
    if (!result.ok) return setMessage(result.error.userHint)
    setSnapshot(result.data)
    setMessage('只显示事件元数据、参数摘要与结果码；不包含原始 payload、工具参数或响应。')
  }, [])

  useEffect(() => {
    let active = true
    void listSessions().then((result) => {
      if (!active) return
      if (!result.ok) return setMessage(result.error.userHint)
      setSessions(result.data)
      const first = result.data[0]?.sessionId ?? ''
      setSessionId(first)
      if (first) void refresh({ sessionId: first, limit: 100 })
      else setMessage('请先在 CHAT 中创建会话。')
    })
    return () => {
      active = false
    }
  }, [refresh])

  async function handleExport(): Promise<void> {
    if (!query || busy) return
    setBusy(true)
    const result = await exportDiagnostic(query)
    setBusy(false)
    setMessage(result.ok ? `安全诊断包已导出：${result.data.savedPath}` : result.error.userHint)
  }

  return (
    <div className="inspector-stack">
      <section className="settings-panel inspector-filter-panel">
        <div className="section-heading compact-heading">
          <div>
            <h2>审计筛选</h2>
            <p>按会话和时间窗口查看事件、工具调用、模型调用与拦截记录。</p>
          </div>
        </div>
        <div className="inspector-filters">
          <label>
            会话
            <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
              {sessions.map((session) => (
                <option key={session.sessionId} value={session.sessionId}>
                  {session.title ?? session.sessionId}
                </option>
              ))}
            </select>
          </label>
          <label>
            起始时间
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            截止时间
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <label>
            条数
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              {[50, 100, 200, 500].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={!query || busy}
            onClick={() => query && void refresh(query)}
          >
            {busy ? '读取中…' : '应用筛选'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!query || busy}
            onClick={() => void handleExport()}
          >
            导出安全诊断包
          </button>
        </div>
        <p className="inspector-message" role="status" aria-live="polite">
          {message}
        </p>
      </section>

      <section className="settings-panel">
        <div className="section-heading compact-heading">
          <div>
            <h2>数据源健康</h2>
            <p>降级影响与人工替代路径保持可见。</p>
          </div>
        </div>
        <div className="source-card-grid inspector-health">
          {(snapshot?.sourceHealth ?? []).map((entry) => (
            <article
              className={`source-card source-${entry.status.toLowerCase()}`}
              key={entry.sourceId}
            >
              <div className="source-card-title">
                <strong>{entry.sourceId}</strong>
                <span className={`status status-${entry.status.toLowerCase()}`}>
                  {entry.status}
                </span>
              </div>
              <p>
                {entry.status === 'DEGRADED'
                  ? `${entry.capabilityImpact}；${entry.manualAlternative}`
                  : `连续失败 ${entry.failStreak} 次`}
              </p>
              <small>
                最近成功：{entry.lastOkAt ? formatTime(entry.lastOkAt) : '无'} · 最近错误：
                {entry.lastErrorCode ?? '无'}
              </small>
            </article>
          ))}
        </div>
      </section>

      <AuditTable
        title="SessionEvent"
        description="仅显示事件 ID、序号、类型和时间，不显示 payload。"
        headers={['时间', '序号', '事件类型', '事件 ID']}
        rows={(snapshot?.events ?? []).map((event) => [
          formatTime(event.timestamp),
          String(event.seq),
          event.type,
          event.eventId
        ])}
      />
      <AuditTable
        title="ToolCallRecord"
        description="参数只保留不可逆摘要，不包含原始参数与响应正文。"
        headers={['时间', '来源 / 工具', '参数摘要', '耗时', '结果']}
        rows={(snapshot?.toolCalls ?? []).map((call) => [
          formatTime(call.createdAt),
          `${call.sourceId} / ${call.toolName}`,
          call.argsDigest,
          `${call.durationMs} ms`,
          call.ok ? 'OK' : (call.errorCode ?? 'ERROR')
        ])}
      />
      <AuditTable
        title="ModelCallRecord"
        description="显示路由、token、成本、耗时和结果，不显示 prompt 或响应。"
        headers={['时间', '角色', 'Provider / 模型', 'Tokens', '成本', '结果']}
        rows={(snapshot?.modelCalls ?? []).map((call) => [
          formatTime(call.createdAt),
          call.role,
          `${call.provider} / ${call.model}`,
          `${call.tokensIn} / ${call.tokensOut}`,
          `${call.costCents} minor`,
          call.ok ? 'OK' : 'ERROR'
        ])}
      />
      <AuditTable
        title="被拦截工具"
        description="不包含原始参数与响应正文。"
        headers={['时间', '来源 / 工具', '原因']}
        rows={(snapshot?.blockedTools ?? []).map((item) => [
          formatTime(item.createdAt),
          `${item.sourceId} / ${item.toolName}`,
          item.reason
        ])}
      />
    </div>
  )
}

function AuditTable({
  title,
  description,
  headers,
  rows
}: {
  title: string
  description: string
  headers: string[]
  rows: string[][]
}): React.JSX.Element {
  return (
    <section className="settings-panel">
      <div className="section-heading compact-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="audit-scroll">
        <table className="audit-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={`${row[0]}-${index}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cellIndex}-${cell}`}>{cell}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length}>暂无记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(
    new Date(value)
  )
}
