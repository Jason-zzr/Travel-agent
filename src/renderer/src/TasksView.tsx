import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '../../shared/schema/chat'
import type { D7Snapshot, PreparationTask, TaskUpdateAction } from '../../shared/schema/d7'
import {
  deriveTasks,
  exportItinerary,
  getD7Snapshot,
  listSessions,
  openExternalSource,
  runGateC,
  updateTask
} from './ipc'

export interface TasksViewProps {
  initialSessions?: SessionSummary[]
  initialSnapshot?: D7Snapshot | null
  onShowTimeline?: (sessionId: string) => void
  onShowEvidence?: (sessionId: string, claimIds: string[]) => void
}

type KindFilter = 'ALL' | PreparationTask['kind']
type PriorityFilter = 'ALL' | PreparationTask['priority']
type ReadinessFilter = 'ALL' | PreparationTask['readiness']

export function TasksView({
  initialSessions = [],
  initialSnapshot = null,
  onShowTimeline,
  onShowEvidence
}: TasksViewProps): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>(initialSessions)
  const [sessionId, setSessionId] = useState(
    initialSnapshot?.sessionId ?? initialSessions[0]?.sessionId ?? ''
  )
  const [snapshot, setSnapshot] = useState<D7Snapshot | null>(initialSnapshot)
  const [kind, setKind] = useState<KindFilter>('ALL')
  const [priority, setPriority] = useState<PriorityFilter>('ALL')
  const [readiness, setReadiness] = useState<ReadinessFilter>('ALL')
  const [busy, setBusy] = useState(false)
  const requestEpoch = useRef(0)
  const [message, setMessage] = useState('选择一个已发布时间轴的 STAGE-5 会话。')

  const refresh = useCallback(async (targetSessionId: string): Promise<void> => {
    if (!targetSessionId) return
    const epoch = ++requestEpoch.current
    const result = await getD7Snapshot(targetSessionId)
    if (epoch !== requestEpoch.current) return
    if (!result.ok) return setMessage(result.error.userHint)
    setSnapshot(result.data)
    setMessage(
      result.data.tasks.length > 0
        ? `已读取 ${result.data.tasks.length} 项出发前任务。`
        : '当前没有已派生任务；先从当前时间轴生成。'
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
      if (first) void refresh(first)
      else setMessage('请先在 CHAT 中创建会话。')
    })
    return () => {
      active = false
    }
  }, [initialSessions.length, initialSnapshot, refresh])

  const visibleTasks = useMemo(
    () =>
      (snapshot?.tasks ?? []).filter(
        (task) =>
          (kind === 'ALL' || task.kind === kind) &&
          (priority === 'ALL' || task.priority === priority) &&
          (readiness === 'ALL' || task.readiness === readiness)
      ),
    [kind, priority, readiness, snapshot?.tasks]
  )

  async function perform(operation: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await operation()
    } finally {
      setBusy(false)
    }
  }

  async function handleDerive(): Promise<void> {
    await perform(async () => {
      const epoch = ++requestEpoch.current
      const targetSessionId = sessionId
      setMessage('正在从当前时间轴与已落盘 Claims 派生任务…')
      const result = await deriveTasks(targetSessionId, snapshot?.routeId ?? undefined)
      if (epoch !== requestEpoch.current) return
      if (!result.ok) return setMessage(result.error.userHint)
      setSnapshot(result.data)
      setMessage(`已派生 ${result.data.tasks.length} 项任务；外部调用 0 次。`)
    })
  }

  async function handleTask(task: PreparationTask, action: TaskUpdateAction): Promise<void> {
    await perform(async () => {
      const epoch = ++requestEpoch.current
      const targetSessionId = sessionId
      const result = await updateTask({
        sessionId: targetSessionId,
        routeId: task.routeContext?.routeId ?? snapshot?.routeId ?? undefined,
        taskId: task.taskId,
        expectedUpdatedAt: task.updatedAt,
        action
      })
      if (epoch !== requestEpoch.current) return
      if (!result.ok) return setMessage(result.error.userHint)
      setSnapshot(result.data)
      setMessage(
        action === 'CONFIRM_EXTERNAL_RESULT'
          ? '外部办理结果已回填；已生成新的当前时间轴版本和 DecisionLog。'
          : action === 'SKIP'
            ? '任务已跳过；GATE_C 将继续把它视为未就绪。'
            : '任务已标记完成。'
      )
    })
  }

  async function handleGate(): Promise<void> {
    await perform(async () => {
      const epoch = ++requestEpoch.current
      const result = await runGateC(sessionId, snapshot?.routeId ?? undefined)
      if (epoch !== requestEpoch.current) return
      if (!result.ok) return setMessage(result.error.userHint)
      setSnapshot(result.data)
      setMessage(
        result.data.latestGateC?.ready
          ? 'GATE_C READY：未发现出发前阻塞项。'
          : `GATE_C BLOCKED：${result.data.latestGateC?.blockers.length ?? 0} 项需处理。`
      )
    })
  }

  async function handleExport(format: 'ICS' | 'MARKDOWN'): Promise<void> {
    await perform(async () => {
      const epoch = ++requestEpoch.current
      const result = await exportItinerary({
        sessionId,
        routeId: snapshot?.routeId ?? undefined,
        format
      })
      if (epoch !== requestEpoch.current) return
      if (!result.ok) return setMessage(result.error.userHint)
      setMessage(`${format} 已导出：${result.data.savedPath}`)
    })
  }

  async function handleOpenChannel(task: PreparationTask): Promise<void> {
    if (!task.handover.channelUrl) return
    const result = await openExternalSource(task.handover.channelUrl)
    setMessage(
      result.ok
        ? '已打开已核验官方渠道；本应用不会代替你预约、支付或提交信息。'
        : result.error.userHint
    )
  }

  return (
    <section className="tasks-workspace">
      <aside className="panel tasks-sidebar">
        <label>
          旅行会话
          <select
            value={sessionId}
            onChange={(event) => {
              const next = event.target.value
              setSessionId(next)
              requestEpoch.current += 1
              setBusy(false)
              setSnapshot(null)
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
          disabled={busy || !sessionId || snapshot?.stage !== 'STAGE_5'}
          onClick={() => void handleDerive()}
        >
          从当前时间轴生成任务
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={busy || !sessionId || !snapshot?.currentVersion}
          onClick={() => void handleGate()}
        >
          执行 GATE_C
        </button>
        <div className="export-actions" aria-label="行程导出">
          <button
            className="secondary-button"
            type="button"
            disabled={busy || !snapshot?.currentVersion}
            onClick={() => void handleExport('ICS')}
          >
            导出 ICS
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy || !snapshot?.currentVersion}
            onClick={() => void handleExport('MARKDOWN')}
          >
            导出 Markdown
          </button>
        </div>
        <p className="status-line" role="status" aria-live="polite">
          {message}
        </p>
        <p className="local-only-note">任务与门禁只读本机状态 · 外部调用 0 次</p>
      </aside>

      <div className="tasks-content">
        <GateCPanel snapshot={snapshot} />
        <section className="panel tasks-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">TASK CENTER</p>
              <h2>出发前任务</h2>
              <p>预约与购票只提供交接说明；结果必须由你从外部办理后回填。</p>
              {snapshot?.routeId ? (
                <p className="route-scope-line">整程路线：{snapshot.routeId}</p>
              ) : null}
            </div>
            <span>{visibleTasks.length} 项</span>
          </div>
          <div className="task-filters">
            <Filter
              label="类型"
              value={kind}
              onChange={(value) => setKind(value as KindFilter)}
              options={['ALL', 'PREPARATION', 'RESERVATION_TICKET']}
            />
            <Filter
              label="优先级"
              value={priority}
              onChange={(value) => setPriority(value as PriorityFilter)}
              options={['ALL', 'HIGH', 'NORMAL', 'LOW']}
            />
            <Filter
              label="就绪状态"
              value={readiness}
              onChange={(value) => setReadiness(value as ReadinessFilter)}
              options={['ALL', 'UNKNOWN', 'READY', 'BLOCKED']}
            />
          </div>
          <div className="task-list">
            {visibleTasks.length === 0 ? (
              <p className="empty-state">没有符合当前筛选条件的任务。</p>
            ) : (
              visibleTasks.map((task) => (
                <TaskCard
                  key={task.taskId}
                  task={task}
                  busy={busy}
                  onAction={(action) => void handleTask(task, action)}
                  onOpen={() => void handleOpenChannel(task)}
                  onShowTimeline={onShowTimeline ? () => onShowTimeline(sessionId) : undefined}
                  onShowEvidence={
                    onShowEvidence && task.claimIds.length > 0
                      ? () => onShowEvidence(sessionId, task.claimIds)
                      : undefined
                  }
                />
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  )
}

function GateCPanel({ snapshot }: { snapshot: D7Snapshot | null }): React.JSX.Element {
  const gate = snapshot?.latestGateC ?? null
  return (
    <section className={`panel timeline-gate ${gate?.ready ? 'gate-ready' : 'gate-blocked'}`}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">GATE_C</p>
          <h2>{gate ? (gate.ready ? '出发前检查通过' : '出发前检查阻塞') : '尚未执行检查'}</h2>
        </div>
        <span>{gate?.blockers.length ?? 0} 项</span>
      </div>
      {gate?.blockers.length ? (
        <ul className="blocking-list">
          {gate.blockers.map((blocker, index) => (
            <li key={`${blocker.code}-${blocker.taskId ?? blocker.itemId ?? index}`}>
              <strong>{blocker.code}</strong>
              <span>{blocker.message}</span>
              {blocker.routeContext ? (
                <span className="route-scope-line">
                  {[
                    blocker.routeContext.nodeId,
                    blocker.routeContext.segmentId,
                    blocker.routeContext.routeLegId
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="gate-copy">
          {gate
            ? '高优先级任务、硬锚点、天气与闭园公告已通过本地检查。'
            : '执行后会明确列出放行或阻塞依据。'}
        </p>
      )}
    </section>
  )
}

function TaskCard({
  task,
  busy,
  onAction,
  onOpen,
  onShowTimeline,
  onShowEvidence
}: {
  task: PreparationTask
  busy: boolean
  onAction: (action: TaskUpdateAction) => void
  onOpen: () => void
  onShowTimeline?: () => void
  onShowEvidence?: () => void
}): React.JSX.Element {
  const completed = task.readiness === 'READY'
  return (
    <article className={`task-card task-${task.readiness.toLowerCase()}`}>
      <header>
        <div>
          <strong>{task.title}</strong>
          <p>
            {task.kind} · {task.priority} · {task.readiness}
          </p>
        </div>
        <span className={`status status-${task.readiness.toLowerCase()}`}>{task.readiness}</span>
      </header>
      <dl>
        <dt>负责人</dt>
        <dd>{task.owner}</dd>
        <dt>截止</dt>
        <dd>{formatTime(task.dueAt)}</dd>
        <dt>复核</dt>
        <dd>{formatTime(task.recheckAt)}</dd>
        <dt>证据</dt>
        <dd>
          {task.handover.evidenceStatus} · {task.claimIds.length} 条
        </dd>
      </dl>
      {task.routeContext ? (
        <p className="route-scope-line">
          {[task.routeContext.nodeId, task.routeContext.segmentId, task.routeContext.routeLegId]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      <div className="handover-box">
        <strong>外部交接</strong>
        <p>{task.handover.action}</p>
        {task.handover.channelLabel ? <p>官方渠道：{task.handover.channelLabel}</p> : null}
        <ol>
          {task.handover.checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        {task.handover.warnings.map((warning) => (
          <p className="blocking-message" key={warning}>
            {warning}
          </p>
        ))}
      </div>
      <div className="task-actions">
        {task.handover.channelUrl ? (
          <button className="secondary-button" type="button" onClick={onOpen}>
            打开官方渠道
          </button>
        ) : null}
        {onShowTimeline ? (
          <button className="evidence-link" type="button" onClick={onShowTimeline}>
            查看时间轴
          </button>
        ) : null}
        {onShowEvidence ? (
          <button className="evidence-link" type="button" onClick={onShowEvidence}>
            定位证据
          </button>
        ) : null}
        <button
          className="primary-button"
          type="button"
          disabled={busy || completed || task.userDecision === 'SKIPPED'}
          onClick={() =>
            onAction(task.kind === 'RESERVATION_TICKET' ? 'CONFIRM_EXTERNAL_RESULT' : 'MARK_DONE')
          }
        >
          {task.kind === 'RESERVATION_TICKET' ? '我已在外部完成' : '标记完成'}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={busy || completed || task.userDecision === 'SKIPPED'}
          onClick={() => onAction('SKIP')}
        >
          跳过
        </button>
      </div>
    </article>
  )
}

function Filter({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  )
}
