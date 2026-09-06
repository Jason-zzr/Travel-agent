import React, { useEffect, useRef, useState } from 'react'
import type { SessionSummary } from '../../shared/schema/chat'
import type {
  MultiSegmentD5Snapshot,
  RouteD5LegScope,
  RouteD5PlanAction,
  RouteD5PlanPreview,
  RouteD5Scope,
  RouteD5StayScope
} from '../../shared/schema/route-d5'
import {
  addRouteD5StayPaste,
  attachRouteD5ManualLeg,
  cancelRouteD5Operation,
  confirmRouteD5,
  executeRouteD5Plan,
  patchRouteD5Skeleton,
  prepareRouteD5Skeleton,
  previewRouteD5Plan,
  selectRouteD5Leg,
  selectRouteD5Stay,
  subscribeRouteD5Progress
} from './ipc'

interface RouteD5ViewProps {
  sessions: SessionSummary[]
  sessionId: string
  initialSnapshot: MultiSegmentD5Snapshot
  onSessionChange: (sessionId: string) => void
}

interface AddressDraft {
  from: string
  to: string
}

interface StayPasteDraft {
  name: string
  total: string
}

export function RouteD5View({
  sessions,
  sessionId,
  initialSnapshot,
  onSessionChange
}: RouteD5ViewProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [plan, setPlan] = useState<RouteD5PlanPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('按路线顺序完成每个路段、日级骨架与每个住宿段。')
  const [addressDrafts, setAddressDrafts] = useState<Record<string, AddressDraft>>({})
  const [manualClaims, setManualClaims] = useState<Record<string, string>>({})
  const [stayDrafts, setStayDrafts] = useState<Record<string, StayPasteDraft>>({})
  const [dayDrafts, setDayDrafts] = useState<Record<string, string>>({})
  const [activeOperation, setActiveOperation] = useState<{
    operationId: string
    scopeKey: string
  } | null>(null)
  const identityRef = useRef(routeIdentity(initialSnapshot))
  const activeOperationRef = useRef<{ operationId: string; scopeKey: string } | null>(null)

  useEffect(
    () =>
      subscribeRouteD5Progress((event) => {
        const active = activeOperationRef.current
        if (
          !active ||
          active.operationId !== event.operationId ||
          active.scopeKey !== scopeKey(event.scope) ||
          routeIdentityFromScope(event.scope) !== identityRef.current
        ) {
          return
        }
        setMessage(`${event.phase} · ${event.completedCalls}/${event.totalCalls} 次已授权来源调用`)
        if (
          event.phase === 'COMPLETED' ||
          event.phase === 'FAILED' ||
          event.phase === 'CANCELLED'
        ) {
          activeOperationRef.current = null
          setActiveOperation(null)
        }
      }),
    []
  )

  const routeScope = {
    kind: 'ROUTE' as const,
    sessionId: snapshot.sessionId,
    routeId: snapshot.selectedRouteId
  }
  const skeletonComplete = snapshot.days.length > 0

  async function preview(
    scope: RouteD5Scope,
    action: RouteD5PlanAction,
    draft: AddressDraft = { from: '', to: '' }
  ): Promise<void> {
    const capturedIdentity = routeIdentityFromScope(scope)
    setBusy(true)
    const pending = previewRouteD5Plan({
      scope,
      action,
      fromAddress: draft.from.trim() || null,
      toAddress: draft.to.trim() || null
    })
    if (action === 'PREPARE_TRANSFERS' && scope.kind === 'LEG') {
      setAddressDrafts((current) => ({ ...current, [scope.legId]: { from: '', to: '' } }))
    }
    const result = await pending
    if (capturedIdentity !== identityRef.current) return
    setBusy(false)
    if (!result.ok) return setMessage(result.error.userHint)
    setPlan(result.data)
    setMessage(
      `已冻结 ${result.data.totalExternalCalls} 次调用；请核对 planId 与 digest 后一次性授权。`
    )
  }

  async function executePlan(): Promise<void> {
    if (!plan) return setMessage('尚未生成 route-D5 调用计划。')
    const capturedIdentity = routeIdentityFromScope(plan.scope)
    const operationId = crypto.randomUUID()
    const active = { operationId, scopeKey: scopeKey(plan.scope) }
    activeOperationRef.current = active
    setActiveOperation(active)
    setBusy(true)
    const executing = plan
    setPlan(null)
    const result = await executeRouteD5Plan({
      scope: executing.scope,
      action: executing.action,
      operationId,
      planId: executing.planId,
      digest: executing.digest
    })
    if (capturedIdentity !== identityRef.current) return
    setBusy(false)
    activeOperationRef.current = null
    setActiveOperation(null)
    if (!result.ok) return setMessage(result.error.userHint)
    acceptSnapshot(result.data)
    setMessage('本次最小授权单元已执行并写入目标路段/住宿段。')
  }

  async function selectLeg(scope: RouteD5LegScope, trainNo: string): Promise<void> {
    await runScoped(
      scope,
      () => selectRouteD5Leg({ scope, trainNo }),
      '车次已锁定；下一步核验接驳。'
    )
  }

  async function attachManual(scope: RouteD5LegScope): Promise<void> {
    const claimIds = (manualClaims[scope.legId] ?? '')
      .split(/[，,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (claimIds.length === 0) return setMessage('请填写当前路段已有 Claim ID。')
    await runScoped(
      scope,
      () => attachRouteD5ManualLeg({ scope, claimIds }),
      '人工交通证据已与当前 legId 严格关联。'
    )
  }

  async function prepareSkeleton(): Promise<void> {
    await runScoped(
      routeScope,
      () => prepareRouteD5Skeleton({ scope: routeScope }),
      '整条路线已生成一日一条骨架；跨城日不会混排两地景点。'
    )
  }

  async function patchDay(date: string, currentEntityIds: string[]): Promise<void> {
    const attractionEntityIds = (dayDrafts[date] ?? currentEntityIds.join(', '))
      .split(/[，,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    setDayDrafts((current) => ({ ...current, [date]: attractionEntityIds.join(', ') }))
    await runScoped(
      routeScope,
      () => patchRouteD5Skeleton({ scope: routeScope, date, attractionEntityIds }),
      `仅重算 ${date} 与其所属住宿段；相邻节点保持不变。`
    )
  }

  async function addStayPaste(scope: RouteD5StayScope): Promise<void> {
    const draft = stayDrafts[scope.segmentId] ?? { name: '', total: '' }
    if (!draft.name.trim()) return setMessage('请填写当前住宿段的人工候选名称。')
    const total = draft.total.trim() ? Number(draft.total) : null
    if (total !== null && (!Number.isFinite(total) || total < 0)) {
      return setMessage('整段总价必须是非负数字。')
    }
    await runScoped(
      scope,
      () =>
        addRouteD5StayPaste({
          scope,
          name: draft.name.trim(),
          totalCostCents: total === null ? null : Math.round(total * 100),
          roomType: null,
          bedType: null,
          capacity: null,
          roomFitsParty: null,
          cancellationStatus: 'UNKNOWN',
          freeCancelUntil: null,
          positionAdvantage: '用户为当前住宿段补充，位置优势待核验'
        }),
      '人工住宿候选只写入当前 segmentId。'
    )
    setStayDrafts((current) => ({ ...current, [scope.segmentId]: { name: '', total: '' } }))
  }

  async function confirm(): Promise<void> {
    await runScoped(
      routeScope,
      () => confirmRouteD5({ scope: routeScope }),
      '多段 D5 Gate 已通过，已原子进入 STAGE-5。'
    )
  }

  async function runScoped(
    scope: RouteD5Scope,
    action: () => Promise<
      { ok: true; data: MultiSegmentD5Snapshot } | { ok: false; error: { userHint: string } }
    >,
    successMessage: string
  ): Promise<void> {
    const capturedIdentity = routeIdentityFromScope(scope)
    setBusy(true)
    const result = await action()
    if (capturedIdentity !== identityRef.current) return
    setBusy(false)
    if (!result.ok) return setMessage(result.error.userHint)
    acceptSnapshot(result.data)
    setPlan(null)
    setMessage(successMessage)
  }

  function acceptSnapshot(next: MultiSegmentD5Snapshot): void {
    if (routeIdentity(next) !== identityRef.current) return
    setSnapshot(next)
  }

  async function cancelActive(): Promise<void> {
    const active = activeOperationRef.current
    if (!active) return
    const result = await cancelRouteD5Operation(active.operationId)
    if (!result.ok) return setMessage(result.error.userHint)
    setMessage('已请求取消当前 route-D5 最小授权单元。')
  }

  return (
    <section className="d5-workspace route-d5-workspace">
      <aside className="panel d5-sidebar">
        <label>
          旅行会话
          <select value={sessionId} onChange={(event) => onSessionChange(event.target.value)}>
            {sessions.map((session) => (
              <option key={session.sessionId} value={session.sessionId}>
                {session.title ?? session.sessionId}
              </option>
            ))}
          </select>
        </label>
        <div className="route-d5-summary">
          <span>{snapshot.stage}</span>
          <strong>{snapshot.selectedRoute.profile}</strong>
          <small>
            {snapshot.legStates.filter((item) => item.status === 'READY').length}/
            {snapshot.legStates.length} 路段 ·{' '}
            {snapshot.stayStates.filter((item) => item.status === 'SELECTED').length}/
            {snapshot.stayStates.length} 住宿
          </small>
        </div>
        <p className="status-line" aria-live="polite">
          {message}
        </p>
        <button
          disabled={busy || snapshot.legStates.some((item) => item.status !== 'READY')}
          onClick={() => void prepareSkeleton()}
        >
          {snapshot.days.length > 0 ? '重新生成路线骨架' : '生成路线日级骨架'}
        </button>
        <button
          disabled={busy || snapshot.stage !== 'STAGE_4' || snapshot.blockingReasons.length > 0}
          onClick={() => void confirm()}
        >
          通过 D5 Gate 进入 STAGE-5
        </button>
        {activeOperation ? (
          <button disabled={!busy} onClick={() => void cancelActive()}>
            取消当前来源调用
          </button>
        ) : null}
        {snapshot.blockingReasons.length > 0 ? (
          <ul className="route-d5-blockers">
            {snapshot.blockingReasons.slice(0, 8).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </aside>

      <div className="d5-content route-d5-content">
        {plan ? (
          <section className="panel route-d5-plan" aria-label="一次性授权计划">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">ONE-SHOT PLAN</p>
                <h2>{plan.action}</h2>
              </div>
              <span>{plan.totalExternalCalls} calls · retry 0</span>
            </div>
            <ol>
              {plan.plannedCalls.map((call) => (
                <li key={`${call.sequence}-${call.label}`}>
                  {call.sequence}. {call.sourceId} · {call.label}
                </li>
              ))}
            </ol>
            <code>{plan.planId}</code>
            <code>{plan.digest}</code>
            <button disabled={busy} onClick={() => void executePlan()}>
              授权并执行此最小计划
            </button>
          </section>
        ) : null}

        <section className="panel route-d5-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ROUTE LEGS</p>
              <h2>按顺序核验每一段门到门交通</h2>
            </div>
            <span>{snapshot.legStates.length} 段</span>
          </div>
          <div className="route-d5-list">
            {snapshot.legStates.map((legState) => {
              const draft = addressDrafts[legState.scope.legId] ?? { from: '', to: '' }
              return (
                <article
                  className={`route-d5-item status-${legState.status.toLowerCase()}`}
                  key={legState.scope.legId}
                >
                  <header>
                    <div>
                      <small>
                        LEG {legState.sequence} · {legState.routeLeg.travelDate}
                      </small>
                      <h3>
                        {legState.routeLeg.fromCity} → {legState.routeLeg.toCity}
                      </h3>
                    </div>
                    <span className="status">{legState.status}</span>
                  </header>
                  <p>
                    {legState.routeLeg.mode} · {legState.routeLeg.label}
                  </p>
                  {legState.routeLeg.mode === 'RAIL' ? (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => void preview(legState.scope, 'DISCOVER_RAIL')}
                      >
                        预览本路段铁路查询
                      </button>
                      {legState.railOptions.length > 0 ? (
                        <div className="route-d5-options">
                          {legState.railOptions.map((option) => (
                            <button
                              className={
                                legState.selectedRailOption?.trainNo === option.trainNo
                                  ? 'selected'
                                  : ''
                              }
                              disabled={busy}
                              key={`${option.serviceDate}-${option.trainNo}`}
                              onClick={() => void selectLeg(legState.scope, option.trainNo)}
                            >
                              {option.trainNo} · {option.departureTime}–{option.arrivalTime}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {legState.selectedRailOption && legState.status !== 'READY' ? (
                        <div className="route-d5-transfer-form">
                          {legState.routeLeg.from.kind === 'ORIGIN' ? (
                            <label>
                              广州精确出发地点（仅本次 pending plan）
                              <input
                                autoComplete="street-address"
                                value={draft.from}
                                onChange={(event) =>
                                  setAddressDrafts((current) => ({
                                    ...current,
                                    [legState.scope.legId]: { ...draft, from: event.target.value }
                                  }))
                                }
                              />
                            </label>
                          ) : null}
                          {legState.routeLeg.to.kind === 'ORIGIN' ? (
                            <label>
                              广州返程终点（仅本次 pending plan）
                              <input
                                autoComplete="street-address"
                                value={draft.to}
                                onChange={(event) =>
                                  setAddressDrafts((current) => ({
                                    ...current,
                                    [legState.scope.legId]: { ...draft, to: event.target.value }
                                  }))
                                }
                              />
                            </label>
                          ) : null}
                          <button
                            disabled={
                              busy ||
                              (legState.routeLeg.from.kind === 'ORIGIN' && !draft.from.trim()) ||
                              (legState.routeLeg.to.kind === 'ORIGIN' && !draft.to.trim())
                            }
                            onClick={() => void preview(legState.scope, 'PREPARE_TRANSFERS', draft)}
                          >
                            预览本路段两端接驳
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="route-d5-manual-form">
                      <p className="blocking-message">
                        不自动查询航班/大巴；只接受端点、日期和方式完全一致的已有或用户 Claim。
                      </p>
                      <label>
                        Claim ID（多个以逗号分隔）
                        <input
                          value={manualClaims[legState.scope.legId] ?? ''}
                          onChange={(event) =>
                            setManualClaims((current) => ({
                              ...current,
                              [legState.scope.legId]: event.target.value
                            }))
                          }
                        />
                      </label>
                      <button disabled={busy} onClick={() => void attachManual(legState.scope)}>
                        严格关联到此路段
                      </button>
                    </div>
                  )}
                  {legState.plan ? (
                    <div className="route-d5-plan-summary">
                      <strong>{legState.plan.totalDurationMinutes} 分钟</strong>
                      <span>
                        {legState.plan.costComplete
                          ? `¥${((legState.plan.totalCostCents ?? 0) / 100).toFixed(0)}`
                          : '费用不完整，保持未知'}
                      </span>
                      <span>{legState.plan.boundaryAnchors.length}/2 边界锚点</span>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>

        <section className="panel route-d5-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ROUTE SKELETON</p>
              <h2>一日一条，跨城日独立</h2>
            </div>
            <span>{snapshot.days.length} 天</span>
          </div>
          <div className="route-d5-days">
            {snapshot.days.map((day) => {
              const transfer = day.dayType === 'INTERCITY_TRANSFER_DAY'
              return (
                <article className={transfer ? 'transfer-day' : ''} key={day.date}>
                  <strong>{day.date}</strong>
                  <span>{day.dayType}</span>
                  <small>
                    {day.routeLegId
                      ? `${day.fromNodeId ?? '广州'} → ${day.toNodeId ?? '广州'}`
                      : `${day.owningNodeId} · ${day.attractionEntityIds.length} 个节点内项目`}
                  </small>
                  {!transfer ? (
                    <div className="route-d5-day-patch">
                      <label>
                        当天已确认景点实体 ID（逗号分隔，可留空）
                        <input
                          value={dayDrafts[day.date] ?? day.attractionEntityIds.join(', ')}
                          onChange={(event) =>
                            setDayDrafts((current) => ({
                              ...current,
                              [day.date]: event.target.value
                            }))
                          }
                        />
                      </label>
                      <button
                        disabled={busy}
                        onClick={() => void patchDay(day.date, day.attractionEntityIds)}
                      >
                        仅更新当天
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>

        <section className="panel route-d5-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">STAY SEGMENTS</p>
              <h2>每个城市住宿独立查询与选择</h2>
            </div>
            <span>{snapshot.stayStates.length} 段</span>
          </div>
          <div className="route-d5-list">
            {snapshot.stayStates.map((stayState) => {
              const draft = stayDrafts[stayState.scope.segmentId] ?? { name: '', total: '' }
              return (
                <article className="route-d5-item" key={stayState.scope.segmentId}>
                  <header>
                    <div>
                      <small>STAY {stayState.sequence}</small>
                      <h3>
                        {stayState.segment.city} · {stayState.segment.nights} 晚
                      </h3>
                    </div>
                    <span className="status">{stayState.status}</span>
                  </header>
                  <p>
                    {stayState.segment.checkInDate} → {stayState.segment.checkOutDate}
                  </p>
                  <button
                    disabled={busy || !skeletonComplete}
                    onClick={() => void preview(stayState.scope, 'FETCH_STAY')}
                  >
                    预览此住宿段来源计划
                  </button>
                  <div className="route-d5-stay-candidates">
                    {stayState.candidates.map((candidate) => (
                      <button
                        className={
                          candidate.candidateId === stayState.selectedCandidateId ? 'selected' : ''
                        }
                        disabled={busy}
                        key={candidate.candidateId}
                        onClick={() =>
                          void runScoped(
                            stayState.scope,
                            () =>
                              selectRouteD5Stay({
                                scope: stayState.scope,
                                candidateId: candidate.candidateId
                              }),
                            '已选择当前住宿段候选。'
                          )
                        }
                      >
                        <strong>{candidate.name}</strong>
                        <span>
                          {candidate.sourceId} ·{' '}
                          {candidate.totalCostComplete
                            ? `¥${((candidate.totalCostCents ?? 0) / 100).toFixed(0)}`
                            : '整段总价未知'}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="route-d5-paste-form">
                    <label>
                      人工住宿名称
                      <input
                        value={draft.name}
                        onChange={(event) =>
                          setStayDrafts((current) => ({
                            ...current,
                            [stayState.scope.segmentId]: { ...draft, name: event.target.value }
                          }))
                        }
                      />
                    </label>
                    <label>
                      整段总价（元，可空）
                      <input
                        inputMode="decimal"
                        value={draft.total}
                        onChange={(event) =>
                          setStayDrafts((current) => ({
                            ...current,
                            [stayState.scope.segmentId]: { ...draft, total: event.target.value }
                          }))
                        }
                      />
                    </label>
                    <button disabled={busy} onClick={() => void addStayPaste(stayState.scope)}>
                      添加到此住宿段
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </section>
  )
}

function scopeKey(scope: RouteD5Scope): string {
  return scope.kind === 'ROUTE'
    ? `${scope.sessionId}:${scope.routeId}:ROUTE`
    : scope.kind === 'LEG'
      ? `${scope.sessionId}:${scope.routeId}:LEG:${scope.legId}`
      : `${scope.sessionId}:${scope.routeId}:STAY:${scope.nodeId}:${scope.segmentId}`
}

function routeIdentity(snapshot: MultiSegmentD5Snapshot): string {
  return `${snapshot.sessionId}:${snapshot.selectedRouteId}`
}

function routeIdentityFromScope(scope: RouteD5Scope): string {
  return `${scope.sessionId}:${scope.routeId}`
}
