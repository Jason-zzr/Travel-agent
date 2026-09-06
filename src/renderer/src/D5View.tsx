import React, { useEffect, useRef, useState } from 'react'
import type {
  D5Snapshot,
  D5SourceOutcome,
  D5SourcePlanPreview,
  RailDiscoveryPreview,
  RailDiscoveryResult,
  RailSelectionResult
} from '../../shared/schema/d5'
import type { SessionSummary } from '../../shared/schema/chat'
import type { MultiSegmentD5Snapshot } from '../../shared/schema/route-d5'
import {
  addStayPaste,
  confirmSkeleton,
  discoverRailOptions,
  executeD5SourcePlan,
  getD5Snapshot,
  getRouteD5Snapshot,
  getRailDiscoveryPreview,
  listSessions,
  patchSkeleton,
  prepareSkeleton,
  prepareStay,
  previewD5SourcePlan,
  selectRailOptions,
  selectStay,
  selectTransport,
  subscribeD5Progress
} from './ipc'
import { RouteD5View } from './RouteD5View'

export function D5View(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionId, setSessionId] = useState('')
  const [snapshot, setSnapshot] = useState<D5Snapshot | null>(null)
  const [routeSnapshot, setRouteSnapshot] = useState<MultiSegmentD5Snapshot | null>(null)
  const refreshToken = useRef(0)
  const [message, setMessage] = useState('选择一个已进入 STAGE-4 或 STAGE-5 的会话。')
  const [busy, setBusy] = useState(false)
  const [pasteName, setPasteName] = useState('')
  const [pasteTotal, setPasteTotal] = useState('')
  const [railPreview, setRailPreview] = useState<RailDiscoveryPreview | null>(null)
  const [railDiscovery, setRailDiscovery] = useState<RailDiscoveryResult | null>(null)
  const [railSelection, setRailSelection] = useState<RailSelectionResult | null>(null)
  const [outboundTrainNo, setOutboundTrainNo] = useState('')
  const [returnTrainNo, setReturnTrainNo] = useState('')
  const [exactAddress, setExactAddress] = useState('')
  const [sourcePlan, setSourcePlan] = useState<D5SourcePlanPreview | null>(null)
  const [sourcePlanExecuted, setSourcePlanExecuted] = useState(false)
  const [authorizedHotelOutcome, setAuthorizedHotelOutcome] = useState<D5SourceOutcome | null>(null)

  function clearSourceFlow(): void {
    setRailPreview(null)
    setRailDiscovery(null)
    setRailSelection(null)
    setOutboundTrainNo('')
    setReturnTrainNo('')
    setExactAddress('')
    setSourcePlan(null)
    setSourcePlanExecuted(false)
    setAuthorizedHotelOutcome(null)
  }

  async function refresh(id: string): Promise<void> {
    const token = ++refreshToken.current
    const routeResult = await getRouteD5Snapshot(id)
    if (token !== refreshToken.current) return
    if (routeResult.ok) {
      setRouteSnapshot(routeResult.data)
      setSnapshot(null)
      setMessage('已载入当前已选多城市路线的分段 D5 工作队列。')
      return
    }
    setRouteSnapshot(null)
    const result = await getD5Snapshot(id)
    if (token !== refreshToken.current) return
    if (!result.ok) return setMessage(result.error.userHint)
    setSnapshot(result.data)
    if (result.data.stage !== 'STAGE_4') return
    const preview = await getRailDiscoveryPreview(id)
    if (preview.ok) setRailPreview(preview.data)
    else setMessage(preview.error.userHint)
  }

  useEffect(() => {
    void listSessions().then((result) => {
      if (!result.ok) return setMessage(result.error.userHint)
      setSessions(result.data)
      const firstSessionId = result.data[0]?.sessionId ?? ''
      setSessionId(firstSessionId)
      if (firstSessionId) void refresh(firstSessionId)
    })
    return subscribeD5Progress((event) => setMessage(event.message))
  }, [])

  async function run(
    action: () => Promise<
      { ok: true; data: D5Snapshot } | { ok: false; error: { userHint: string } }
    >
  ): Promise<void> {
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (result.ok) setSnapshot(result.data)
    else setMessage(result.error.userHint)
  }

  async function submitStayPaste(): Promise<void> {
    if (!pasteName.trim()) return setMessage('请先填写住宿名称。')
    const numericTotal = pasteTotal.trim() ? Number(pasteTotal) : null
    if (numericTotal !== null && (!Number.isFinite(numericTotal) || numericTotal < 0)) {
      return setMessage('整段总价必须是非负数字。')
    }
    setBusy(true)
    const saved = await addStayPaste({
      sessionId,
      name: pasteName.trim(),
      totalCostCents: numericTotal === null ? null : Math.round(numericTotal * 100),
      roomType: null,
      bedType: null,
      capacity: null,
      roomFitsParty: null,
      cancellationStatus: 'UNKNOWN',
      freeCancelUntil: null,
      positionAdvantage: '用户粘贴，位置优势待核验'
    })
    if (!saved.ok) {
      setBusy(false)
      return setMessage(saved.error.userHint)
    }
    const refreshed = await prepareStay({ sessionId, operationId: crypto.randomUUID() })
    setBusy(false)
    if (refreshed.ok) {
      setSnapshot(refreshed.data)
      setPasteName('')
      setPasteTotal('')
      setMessage('手工住宿候选已保存并重新汇总。')
    } else setMessage(refreshed.error.userHint)
  }

  async function authorizeRailDiscovery(): Promise<void> {
    if (!railPreview) return setMessage('车次查询预览尚未就绪。')
    setBusy(true)
    const result = await discoverRailOptions({
      sessionId,
      operationId: crypto.randomUUID(),
      digest: railPreview.digest
    })
    setBusy(false)
    if (!result.ok) return setMessage(result.error.userHint)
    setRailDiscovery(result.data)
    setRailSelection(null)
    setSourcePlan(null)
    setSourcePlanExecuted(false)
    setOutboundTrainNo(result.data.outboundOptions[0]?.trainNo ?? '')
    setReturnTrainNo(result.data.returnOptions[0]?.trainNo ?? '')
    setMessage('往返车次候选已返回；请选择车次，本步骤不会再次调用来源。')
  }

  async function confirmRailSelection(): Promise<void> {
    if (!railDiscovery || !outboundTrainNo || !returnTrainNo) {
      return setMessage('请先选择往返车次。')
    }
    setBusy(true)
    const result = await selectRailOptions({
      sessionId,
      discoveryId: railDiscovery.discoveryId,
      outboundTrainNo,
      returnTrainNo
    })
    setBusy(false)
    if (!result.ok) return setMessage(result.error.userHint)
    setRailSelection(result.data)
    setSourcePlan(null)
    setSourcePlanExecuted(false)
    setMessage('车次选择已锁定在短期缓存中；请输入本次出发地点。')
  }

  async function createSourcePlanPreview(): Promise<void> {
    const address = exactAddress.trim()
    if (!railSelection || !address) return setMessage('请先选择车次并填写精确出发地点。')
    setBusy(true)
    const pending = previewD5SourcePlan({
      sessionId,
      discoveryId: railSelection.discoveryId,
      exactAddress: address,
      originLabel: '出发地点'
    })
    setExactAddress('')
    const result = await pending
    setBusy(false)
    if (!result.ok) return setMessage(result.error.userHint)
    setSourcePlan(result.data)
    setSourcePlanExecuted(false)
    setMessage('来源调用清单已生成；地址输入已从界面清除，等待一次性授权。')
  }

  async function authorizeSourcePlan(): Promise<void> {
    if (!sourcePlan) return setMessage('来源调用清单尚未生成。')
    setBusy(true)
    const result = await executeD5SourcePlan({
      sessionId,
      operationId: crypto.randomUUID(),
      planId: sourcePlan.planId,
      digest: sourcePlan.digest
    })
    setBusy(false)
    if (!result.ok) return setMessage(result.error.userHint)
    setSnapshot(result.data.snapshot)
    setAuthorizedHotelOutcome(result.data.hotelOutcome)
    setSourcePlanExecuted(true)
    setMessage(
      result.data.hotelOutcome.status === 'FAILED' ||
        result.data.hotelOutcome.status === 'CANCELLED'
        ? '交通候选已生成；酒店来源失败已明确保留，可在住宿阶段手工补充。'
        : '交通候选与住宿来源已按一次性授权装配。'
    )
  }

  if (routeSnapshot) {
    return (
      <RouteD5View
        key={`${routeSnapshot.sessionId}:${routeSnapshot.selectedRouteId}`}
        sessions={sessions}
        sessionId={sessionId}
        initialSnapshot={routeSnapshot}
        onSessionChange={(nextSessionId) => {
          clearSourceFlow()
          setRouteSnapshot(null)
          setSessionId(nextSessionId)
          void refresh(nextSessionId)
        }}
      />
    )
  }

  return (
    <section className="d5-workspace">
      <aside className="panel d5-sidebar">
        <label>
          旅行会话
          <select
            value={sessionId}
            onChange={(event) => {
              clearSourceFlow()
              setSessionId(event.target.value)
              void refresh(event.target.value)
            }}
          >
            {sessions.map((session) => (
              <option key={session.sessionId} value={session.sessionId}>
                {session.title ?? session.sessionId}
              </option>
            ))}
          </select>
        </label>
        <p className="status-line">{message}</p>
        <button
          disabled={busy || !snapshot?.selectedTransportCandidateId || snapshot.stage !== 'STAGE_4'}
          onClick={() =>
            run(() => prepareSkeleton({ sessionId, operationId: crypto.randomUUID() }))
          }
        >
          生成日级骨架
        </button>
        <button
          disabled={busy || !snapshot?.staySegment || snapshot.stage !== 'STAGE_4'}
          onClick={() => run(() => confirmSkeleton({ sessionId }))}
        >
          确认骨架并进入住宿
        </button>
        <button
          disabled={busy || snapshot?.stage !== 'STAGE_5'}
          onClick={() => run(() => prepareStay({ sessionId, operationId: crypto.randomUUID() }))}
        >
          汇总住宿候选
        </button>
      </aside>
      <div className="d5-content">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">TRANSPORT</p>
              <h2>门到门交通</h2>
            </div>
            <span>{snapshot?.stage ?? '—'}</span>
          </div>
          {snapshot?.stage === 'STAGE_4' ? (
            <div className="source-authorization-flow">
              <h3>来源参数自动装配</h3>
              <p>
                日期、城市、住宿夜数和成人数来自已确认行程；车次来自 12306
                候选，坐标与四段接驳来自地图，酒店参数由住宿段派生。
              </p>
              {railPreview ? (
                <div className="authorization-step">
                  <strong>第 1 次授权：查询往返车次</strong>
                  <p>
                    去程 {railPreview.outbound.date} · {railPreview.outbound.fromStation} →{' '}
                    {railPreview.outbound.toStation}
                    <br />
                    返程 {railPreview.return.date} · {railPreview.return.fromStation} →{' '}
                    {railPreview.return.toStation}
                  </p>
                  <p>
                    将调用 12306 共 {railPreview.estimatedExternalCalls} 次；不重试、不自动换车次。
                  </p>
                  <button disabled={busy} onClick={() => void authorizeRailDiscovery()}>
                    授权查询往返车次
                  </button>
                </div>
              ) : null}
              {railDiscovery ? (
                <div className="authorization-step">
                  <strong>选择本次候选中的车次</strong>
                  <label>
                    去程车次
                    <select
                      value={outboundTrainNo}
                      onChange={(event) => {
                        setOutboundTrainNo(event.target.value)
                        setRailSelection(null)
                        setSourcePlan(null)
                      }}
                    >
                      {railDiscovery.outboundOptions.map((option) => (
                        <option key={`outbound-${option.trainNo}`} value={option.trainNo}>
                          {option.trainNo} · {option.departureTime}–{option.arrivalTime}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    返程车次
                    <select
                      value={returnTrainNo}
                      onChange={(event) => {
                        setReturnTrainNo(event.target.value)
                        setRailSelection(null)
                        setSourcePlan(null)
                      }}
                    >
                      {railDiscovery.returnOptions.map((option) => (
                        <option key={`return-${option.trainNo}`} value={option.trainNo}>
                          {option.trainNo} · {option.departureTime}–{option.arrivalTime}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={busy} onClick={() => void confirmRailSelection()}>
                    确认所选车次（不调用来源）
                  </button>
                </div>
              ) : null}
              {railSelection ? (
                <div className="authorization-step">
                  <strong>生成第 2 次授权清单</strong>
                  <p>
                    已选 {railSelection.outbound.trainNo} / {railSelection.return.trainNo}
                    。精确地址只用于本次地图地理编码，不写入证据、日志或行程状态。
                  </p>
                  <label>
                    精确出发地点
                    <input
                      autoComplete="street-address"
                      value={exactAddress}
                      onChange={(event) => setExactAddress(event.target.value)}
                      placeholder="例如：街道、门牌号或可定位建筑"
                    />
                  </label>
                  <button
                    disabled={busy || !exactAddress.trim()}
                    onClick={() => void createSourcePlanPreview()}
                  >
                    生成来源调用清单并清空地址
                  </button>
                </div>
              ) : null}
              {sourcePlan ? (
                <div className="authorization-step">
                  <strong>第 2 次授权：按清单装配来源</strong>
                  <p>
                    已选车次 {sourcePlan.selectedTrains.outbound.trainNo} /{' '}
                    {sourcePlan.selectedTrains.return.trainNo}；预计外部调用{' '}
                    {sourcePlan.totalExternalCalls} 次，铁路不会再次查询。
                  </p>
                  <ul>
                    {sourcePlan.geocodes.map((location) => (
                      <li key={location.locationId}>
                        {location.label} · {location.city} ·{' '}
                        {location.cached ? '坐标缓存命中' : '需要地图地理编码'}
                      </li>
                    ))}
                  </ul>
                  <ol>
                    {sourcePlan.plannedCalls.map((call) => (
                      <li key={`${call.sequence}-${call.label}`}>
                        {call.sourceId} · {call.label}
                      </li>
                    ))}
                  </ol>
                  <p>
                    酒店：{sourcePlan.hotelQuery.place} · {sourcePlan.hotelQuery.checkInDate} 起{' '}
                    {sourcePlan.hotelQuery.stayNights} 晚 · {sourcePlan.hotelQuery.adultCount}{' '}
                    名成人
                  </p>
                  <button
                    disabled={busy || sourcePlanExecuted}
                    onClick={() => void authorizeSourcePlan()}
                  >
                    {sourcePlanExecuted ? '本次清单已执行' : '授权并执行此清单'}
                  </button>
                </div>
              ) : null}
              {authorizedHotelOutcome ? (
                <p>
                  酒店来源：{authorizedHotelOutcome.status} ·{' '}
                  {authorizedHotelOutcome.candidateCount} 个候选
                  {authorizedHotelOutcome.capabilityImpact
                    ? `；${authorizedHotelOutcome.capabilityImpact}`
                    : ''}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="candidate-grid">
            {snapshot?.transportCandidates.map((candidate) => (
              <article
                className={`candidate-option ${snapshot.selectedTransportCandidateId === candidate.candidateId ? 'selected' : ''}`}
                key={candidate.candidateId}
              >
                <h4>{candidate.title}</h4>
                <p>
                  {candidate.doorToDoorTotalMinutes} 分钟 ·{' '}
                  {candidate.costComplete
                    ? `¥${(candidate.totalCostCents! / 100).toFixed(0)}`
                    : '费用未知'}{' '}
                  · 舒适度 {candidate.comfort}
                </p>
                <ol>
                  {candidate.outbound.legs.map((leg) => (
                    <li key={leg.kind}>
                      {leg.label} · {leg.durationMinutes} 分钟
                    </li>
                  ))}
                </ol>
                <button
                  disabled={busy || snapshot.stage !== 'STAGE_4'}
                  onClick={() =>
                    run(() => selectTransport({ sessionId, candidateId: candidate.candidateId }))
                  }
                >
                  选择此方案
                </button>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">SKELETON</p>
              <h2>日级行程骨架</h2>
            </div>
            <span>{snapshot?.boundaryAnchors.length ?? 0}/2 锚点</span>
          </div>
          <div className="skeleton-grid">
            {snapshot?.daySkeletons.map((day) => (
              <article className="day-card" key={day.date}>
                <strong>{day.date}</strong>
                <small>
                  {day.dayType} · {day.intensity}
                </small>
                <p>
                  {[day.morning, day.afternoon, day.evening]
                    .filter(Boolean)
                    .flatMap((slot) => slot!.items.map((item) => item.title))
                    .join(' · ') || '留白/转场'}
                </p>
                {day.morning?.items[0] ? (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        patchSkeleton({
                          sessionId,
                          date: day.date,
                          period: 'AFTERNOON',
                          entityId: day.morning!.items[0]!.entityId
                        })
                      )
                    }
                  >
                    将首个上午项目移到下午
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">STAY</p>
              <h2>整段住宿候选</h2>
            </div>
            <span>{snapshot?.staySegment ? `${snapshot.staySegment.nights} 晚` : '未生成'}</span>
          </div>
          {snapshot?.staySegment ? (
            <p className="stay-segment-summary">
              {snapshot.staySegment.areaHint} · {snapshot.staySegment.checkInDate} 入住 ·{' '}
              {snapshot.staySegment.checkOutDate} 离店 · {snapshot.staySegment.nights} 晚
            </p>
          ) : null}
          <div className="source-summary">
            {snapshot?.staySourceOutcomes.map((outcome) => (
              <span key={outcome.sourceId}>
                {outcome.sourceId}: {outcome.candidateCount} · {outcome.status}
                {outcome.sourceId === 'SRC_HOTEL' && outcome.status === 'EMPTY'
                  ? '（酒店源本次无结果）'
                  : ''}
                {outcome.capabilityImpact ? `；${outcome.capabilityImpact}` : ''}
                {outcome.manualAlternative ? `；${outcome.manualAlternative}` : ''}
              </span>
            ))}
            {snapshot && snapshot.staySourceOutcomes.length > 0 ? (
              <strong>
                总计{' '}
                {snapshot.staySourceOutcomes.reduce((sum, item) => sum + item.candidateCount, 0)}
              </strong>
            ) : null}
          </div>
          {snapshot?.stage === 'STAGE_5' ? (
            <>
              <p>
                酒店的地点、入住日、夜数与成人数由已确认行程自动派生；如授权查询失败，可在下方手工补充整段报价。
              </p>
              <div className="stay-paste-form">
                <label>
                  手工住宿名称
                  <input value={pasteName} onChange={(event) => setPasteName(event.target.value)} />
                </label>
                <label>
                  整段总价（元，可空）
                  <input
                    inputMode="decimal"
                    value={pasteTotal}
                    onChange={(event) => setPasteTotal(event.target.value)}
                  />
                </label>
                <button disabled={busy} onClick={() => void submitStayPaste()}>
                  添加手工候选
                </button>
              </div>
            </>
          ) : null}
          <div className="candidate-grid">
            {snapshot?.stayCandidates.map((candidate) => (
              <article
                className={`candidate-option ${snapshot.selectedStayCandidateId === candidate.candidateId ? 'selected' : ''}`}
                key={candidate.candidateId}
              >
                <h4>{candidate.name}</h4>
                <p>
                  {candidate.sourceId} ·{' '}
                  {candidate.totalCostComplete
                    ? `整段 ¥${(candidate.totalCostCents! / 100).toFixed(0)}`
                    : '整段价格未知'}{' '}
                  · {candidate.contentIdentity} · {candidate.verificationStatus}
                </p>
                <p>
                  {candidate.roomFitsParty === true
                    ? '入住人数满足'
                    : candidate.roomFitsParty === false
                      ? `不满足 ${snapshot.partySize} 人入住`
                      : '人数信息缺失'}{' '}
                  ·{' '}
                  {candidate.cancellation.status === 'FREE_UNTIL'
                    ? `可免费取消至 ${candidate.cancellation.freeCancelUntil}`
                    : candidate.cancellation.status === 'NON_REFUNDABLE'
                      ? '不可免费取消'
                      : '取消信息缺失'}
                  {candidate.recommendationEligible ? ' · 可推荐' : ' · 不进入推荐位'}
                </p>
                <small>{candidate.positionAdvantage}</small>
                <button
                  disabled={busy || snapshot.stage !== 'STAGE_5'}
                  onClick={() =>
                    run(() => selectStay({ sessionId, candidateId: candidate.candidateId }))
                  }
                >
                  选择住宿
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  )
}
