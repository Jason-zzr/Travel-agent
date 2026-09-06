import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '../../shared/schema/chat'
import type { D6Snapshot, TimelineItem, TimelineVersionMetadata } from '../../shared/schema/d6'
import {
  cancelD6Operation,
  getD6Snapshot,
  listSessions,
  prepareTimeline,
  publishTimeline,
  subscribeD6Progress
} from './ipc'

export interface D6ViewProps {
  initialSessions?: SessionSummary[]
  initialSnapshot?: D6Snapshot | null
  onShowEvidence?: (sessionId: string, claimIds: string[]) => void
}

const EMPTY_SESSIONS: SessionSummary[] = []

export function D6View(props: D6ViewProps = {}): React.JSX.Element {
  const initialSessions = props.initialSessions ?? EMPTY_SESSIONS
  const initialSnapshot = props.initialSnapshot ?? null
  const onShowEvidence = props.onShowEvidence
  const [sessions, setSessions] = useState(initialSessions)
  const [sessionId, setSessionId] = useState(
    initialSnapshot?.sessionId ?? initialSessions[0]?.sessionId ?? ''
  )
  const [snapshot, setSnapshot] = useState<D6Snapshot | null>(initialSnapshot)
  const [showDraft, setShowDraft] = useState(Boolean(initialSnapshot?.draft))
  const [busy, setBusy] = useState(false)
  const [operationId, setOperationId] = useState<string | null>(null)
  const activeOperation = useRef<string | null>(null)
  const requestEpoch = useRef(0)
  const [message, setMessage] = useState('选择一个已完成 D5 的 STAGE-5 会话。')

  const refresh = useCallback(async (targetSessionId: string, version?: number): Promise<void> => {
    if (!targetSessionId) return
    const epoch = ++requestEpoch.current
    const result = await getD6Snapshot(targetSessionId, version)
    if (epoch !== requestEpoch.current) return
    if (!result.ok) return setMessage(result.error.userHint)
    setSnapshot(result.data)
    setShowDraft(Boolean(result.data.draft) && version === undefined)
    setMessage(
      result.data.currentVersion === null
        ? '当前尚未发布时间轴，可先用本地证据生成草稿。'
        : `已读取时间轴 v${result.data.currentVersion}；历史版本切换为只读。`
    )
  }, [])

  useEffect(() => {
    if (initialSessions.length > 0 || initialSnapshot) return
    let active = true
    void listSessions().then((result) => {
      if (!active) return
      if (!result.ok) return setMessage(result.error.userHint)
      setSessions(result.data)
      const first = result.data[0]?.sessionId ?? ''
      setSessionId(first)
      if (!first) return setMessage('请先在 CHAT 中创建会话。')
      void refresh(first)
    })
    return () => {
      active = false
    }
  }, [initialSessions, initialSnapshot, refresh])

  useEffect(
    () =>
      subscribeD6Progress((event) => {
        if (event.operationId !== activeOperation.current) return
        setMessage(event.message)
      }),
    []
  )

  async function handlePrepare(): Promise<void> {
    if (!sessionId || !snapshot || busy) return
    const targetSessionId = sessionId
    const targetRouteId = snapshot.routeId ?? undefined
    const epoch = ++requestEpoch.current
    const nextOperationId = crypto.randomUUID()
    activeOperation.current = nextOperationId
    setOperationId(nextOperationId)
    setBusy(true)
    setMessage('正在从已落盘证据细化路线与时间轴…')
    const result = await prepareTimeline({
      sessionId: targetSessionId,
      routeId: targetRouteId,
      operationId: nextOperationId
    })
    if (activeOperation.current === nextOperationId) activeOperation.current = null
    setOperationId((current) => (current === nextOperationId ? null : current))
    if (epoch !== requestEpoch.current) return
    setBusy(false)
    if (!result.ok) return setMessage(result.error.userHint)
    setSnapshot(result.data)
    setShowDraft(true)
    setMessage(
      result.data.draft?.gate.publishable
        ? '草稿已完成本地主进程校验，可以发布。'
        : '草稿已生成，但发布门禁仍有阻塞项。'
    )
  }

  async function handlePublish(): Promise<void> {
    const draft = snapshot?.draft
    if (!draft || !draft.gate.publishable || busy) return
    const epoch = ++requestEpoch.current
    const targetSessionId = sessionId
    setBusy(true)
    setMessage('正在重新校验并发布新版本…')
    const result = await publishTimeline({
      sessionId: targetSessionId,
      routeId: draft.routeId ?? undefined,
      draftId: draft.draftId
    })
    if (epoch !== requestEpoch.current) return
    setBusy(false)
    if (!result.ok) return setMessage(result.error.userHint)
    setSnapshot(result.data)
    setShowDraft(false)
    setMessage(`时间轴 v${result.data.currentVersion ?? '—'} 已发布并写入本地事件日志。`)
  }

  async function handleCancel(): Promise<void> {
    if (!operationId) return
    const result = await cancelD6Operation(operationId)
    if (!result.ok) return setMessage(result.error.userHint)
    setMessage('已请求取消；不会发布半成品时间轴。')
  }

  async function handleVersionChange(value: string): Promise<void> {
    if (value === 'DRAFT') {
      setShowDraft(true)
      return
    }
    setShowDraft(false)
    await refresh(sessionId, Number(value))
  }

  const displayedItems = showDraft
    ? (snapshot?.draft?.items ?? [])
    : (snapshot?.selectedVersion?.items ?? [])
  const displayedSummary = showDraft
    ? (snapshot?.draft?.summary ?? '未发布草稿')
    : (snapshot?.selectedVersion?.summary ?? '尚无已发布版本')

  return (
    <section className="d6-workspace">
      <aside className="panel d6-sidebar">
        <label>
          旅行会话
          <select
            value={sessionId}
            onChange={(event) => {
              const next = event.target.value
              setSessionId(next)
              requestEpoch.current += 1
              activeOperation.current = null
              setOperationId(null)
              setBusy(false)
              setSnapshot(null)
              setShowDraft(false)
              void refresh(next)
            }}
          >
            {sessions.map((session) => (
              <option key={session.sessionId} value={session.sessionId}>
                {session.title ?? session.sessionId}
              </option>
            ))}
          </select>
        </label>

        <button
          className="primary-button"
          type="button"
          disabled={busy || !sessionId || !snapshot || snapshot.stage !== 'STAGE_5'}
          onClick={() => void handlePrepare()}
        >
          {busy ? '准备中…' : '生成分钟级草稿'}
        </button>
        {operationId ? (
          <button className="secondary-button" type="button" onClick={() => void handleCancel()}>
            取消准备
          </button>
        ) : null}
        <button
          className="secondary-button"
          type="button"
          disabled={busy || !snapshot?.draft?.gate.publishable || !showDraft}
          onClick={() => void handlePublish()}
        >
          发布为新版本
        </button>

        <VersionPicker
          snapshot={snapshot}
          showDraft={showDraft}
          onChange={(value) => void handleVersionChange(value)}
        />
        <p className="status-line" role="status" aria-live="polite">
          {message}
        </p>
        <p className="local-only-note">本轮仅编译已落盘证据 · 外部调用 0 次</p>
      </aside>

      <div className="d6-content">
        <TimelineGate snapshot={snapshot} showDraft={showDraft} />
        <section className="panel timeline-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">FINAL TIMELINE</p>
              <h2>
                {showDraft ? '未发布草稿' : `版本 v${snapshot?.selectedVersion?.version ?? '—'}`}
              </h2>
              <p>{displayedSummary}</p>
              {snapshot?.routeId ? (
                <p className="route-scope-line">整程路线：{snapshot.routeId}</p>
              ) : null}
            </div>
            <span>
              {showDraft ? 'DRAFT' : snapshot?.selectedVersion?.isCurrent ? 'CURRENT' : 'HISTORY'}
            </span>
          </div>
          <TimelineDays
            items={displayedItems}
            sessionId={sessionId}
            onShowEvidence={onShowEvidence}
          />
        </section>
      </div>
    </section>
  )
}

function VersionPicker({
  snapshot,
  showDraft,
  onChange
}: {
  snapshot: D6Snapshot | null
  showDraft: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const selectedValue = showDraft
    ? 'DRAFT'
    : String(snapshot?.selectedVersion?.version ?? snapshot?.currentVersion ?? '')
  return (
    <label>
      只读版本
      <select value={selectedValue} onChange={(event) => onChange(event.target.value)}>
        {snapshot?.draft ? <option value="DRAFT">草稿（未发布）</option> : null}
        {(snapshot?.versions ?? []).map((version) => (
          <VersionOption key={version.version} version={version} />
        ))}
      </select>
    </label>
  )
}

function VersionOption({ version }: { version: TimelineVersionMetadata }): React.JSX.Element {
  return (
    <option value={version.version}>
      v{version.version} · {version.isCurrent ? 'current' : '历史'} ·{' '}
      {new Date(version.createdAt).toLocaleString('zh-CN')}
    </option>
  )
}

function TimelineGate({
  snapshot,
  showDraft
}: {
  snapshot: D6Snapshot | null
  showDraft: boolean
}): React.JSX.Element {
  const gate = showDraft ? snapshot?.draft?.gate : snapshot?.publishability
  return (
    <section className={`panel timeline-gate ${gate?.publishable ? 'gate-ready' : 'gate-blocked'}`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">VERIFICATION GATE</p>
          <h2>{gate?.publishable ? '发布门禁通过' : '发布门禁阻塞'}</h2>
        </div>
        <span>{gate?.blockingItems.length ?? 0} 项</span>
      </div>
      {!gate || gate.blockingItems.length === 0 ? (
        <p className="gate-copy">硬锚点、时间冲突、交通缓冲、证据与每日备用项已校验。</p>
      ) : (
        <ul className="blocking-list">
          {gate.blockingItems.map((item, index) => (
            <li key={`${item.itemId ?? item.code}-${index}`}>
              <strong>{item.title}</strong>
              <span>{item.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TimelineDays({
  items,
  sessionId,
  onShowEvidence
}: {
  items: TimelineItem[]
  sessionId: string
  onShowEvidence?: (sessionId: string, claimIds: string[]) => void
}): React.JSX.Element {
  const days = useMemo(() => {
    const grouped = new Map<string, TimelineItem[]>()
    for (const item of items) grouped.set(item.date, [...(grouped.get(item.date) ?? []), item])
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [items])

  if (days.length === 0) return <p className="empty-state timeline-empty">尚无时间轴条目。</p>
  return (
    <div className="timeline-days">
      {days.map(([date, dayItems]) => {
        const mainItems = dayItems.filter((item) => item.itemClass !== 'BACKUP')
        const backups = dayItems.filter((item) => item.itemClass === 'BACKUP')
        return (
          <article className="timeline-day" key={date}>
            <header>
              <strong>{date}</strong>
              <span>
                {mainItems.length} 个主线项目 · {backups.length} 个备用项
              </span>
            </header>
            <ol className="timeline-items">
              {mainItems.map((item) => (
                <TimelineRow
                  key={item.itemId}
                  item={item}
                  sessionId={sessionId}
                  onShowEvidence={onShowEvidence}
                />
              ))}
            </ol>
            <details className="timeline-backups">
              <summary>展开当日备用项（{backups.length}）</summary>
              <div>
                {backups.map((item) => (
                  <TimelineRow
                    key={item.itemId}
                    item={item}
                    sessionId={sessionId}
                    onShowEvidence={onShowEvidence}
                  />
                ))}
              </div>
            </details>
          </article>
        )
      })}
    </div>
  )
}

function TimelineRow({
  item,
  sessionId,
  onShowEvidence
}: {
  item: TimelineItem
  sessionId: string
  onShowEvidence?: (sessionId: string, claimIds: string[]) => void
}): React.JSX.Element {
  return (
    <li className={`timeline-row item-${item.itemClass.toLowerCase()}`}>
      <time>
        {item.startTime}–{item.endTime}
        {item.crossesMidnight ? ' +1' : ''}
      </time>
      <div className="timeline-row-body">
        <div className="timeline-row-title">
          <strong>{item.title}</strong>
          <span>{item.itemClass}</span>
          <span>{item.anchorClass}</span>
          {item.routeContext ? <span>{routeRoleLabel(item.routeContext.role)}</span> : null}
        </div>
        <p>
          {item.location.name} · {item.location.kind}
          {item.costCents === null
            ? ' · 费用未知'
            : ` · 预计 ¥${(item.costCents / 100).toFixed(0)}`}
        </p>
        {item.routeContext ? (
          <p className="route-scope-line">
            {[item.routeContext.nodeId, item.routeContext.segmentId, item.routeContext.routeLegId]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
        {item.arrivalTransport ? (
          <p className="transport-line">
            {item.arrivalTransport.mode} · {item.arrivalTransport.from} → {item.arrivalTransport.to}{' '}
            · ETA {item.arrivalTransport.etaMinutes} 分钟 · 缓冲 {item.bufferMinutes} 分钟
          </p>
        ) : (
          <p className="transport-line">无到达交通 · 缓冲 {item.bufferMinutes} 分钟</p>
        )}
        <div className="verification-line">
          <span className={`status status-${item.verificationSummary.status.toLowerCase()}`}>
            {item.verificationSummary.status}
          </span>
          <span>{item.claimIds.length} 条结构化证据</span>
          {item.claimIds.length > 0 && onShowEvidence ? (
            <button
              className="evidence-link"
              type="button"
              onClick={() => onShowEvidence(sessionId, item.claimIds)}
            >
              定位证据
            </button>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function routeRoleLabel(role: NonNullable<TimelineItem['routeContext']>['role']): string {
  const labels: Record<typeof role, string> = {
    STAY_ACTIVITY: '节点活动',
    STAY_CHECKOUT: '退房',
    LOCAL_TRANSFER: '接驳',
    INTERCITY_LEG: '跨城路段',
    STAY_CHECKIN: '入住',
    BACKUP: '备用'
  }
  return labels[role]
}
