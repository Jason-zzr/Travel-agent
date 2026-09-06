import React, { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ManualRouteLegEvidenceRequest,
  MultiCityRouteSnapshot,
  RouteCandidate,
  RouteLeg,
  RoutePlanPreview
} from '../../shared/schema/itinerary'

export function ItineraryRouteCard({
  snapshot,
  preview,
  operationId,
  onPreview,
  onExecute,
  onCancel,
  onSelect,
  onApplyManualEvidence,
  onManualDirtyChange
}: {
  snapshot: MultiCityRouteSnapshot
  preview: RoutePlanPreview | null
  operationId: string | null
  onPreview(): Promise<void>
  onExecute(): Promise<void>
  onCancel(): Promise<void>
  onSelect(routeId: string): Promise<void>
  onApplyManualEvidence(request: ManualRouteLegEvidenceRequest): Promise<boolean>
  onManualDirtyChange(dirty: boolean): void
}): React.JSX.Element {
  const canAct = snapshot.stage === 'STAGE_2'
  const failedSources = snapshot.sourceOutcomes.filter((outcome) => outcome.status !== 'SUCCEEDED')
  const dirtyLegIds = useRef(new Set<string>())
  useEffect(() => () => onManualDirtyChange(false), [onManualDirtyChange])
  const handleManualDirtyChange = useCallback(
    (legId: string, dirty: boolean): void => {
      if (dirty) dirtyLegIds.current.add(legId)
      else dirtyLegIds.current.delete(legId)
      onManualDirtyChange(dirtyLegIds.current.size > 0)
    },
    [onManualDirtyChange]
  )
  return (
    <article className="decision-card route-decision-card" aria-label="多城市路线比较">
      <header className="route-card-heading">
        <div>
          <p className="card-kicker">STAGE-2 · 多城市路线决策</p>
          <h3>
            {snapshot.goal?.originCity ?? '出发地'} ⇄ {snapshot.goal?.regionGoal ?? '目的区域'}
          </h3>
          {snapshot.goal?.originPlaceLabel ? (
            <p className="card-note">具体出发点：{snapshot.goal.originPlaceLabel}</p>
          ) : null}
        </div>
        <span className="route-scope-badge">一个总目标 · 不拆会话</span>
      </header>
      {snapshot.goal ? (
        <div className="route-goal-strip">
          <span>{snapshot.goal.totalDays} 天</span>
          <span>{snapshot.goal.totalNights} 晚</span>
          <span>
            必去：{snapshot.goal.mandatoryPlaces.map((place) => place.displayName).join('、')}
          </span>
        </div>
      ) : (
        <p className="empty-state">当前会话没有可用的多城市目标。</p>
      )}

      {canAct && snapshot.candidates.length === 0 && !preview ? (
        <div className="route-authorization">
          <p>
            系统会先列出只读交通查询计划；预览不调用来源。你确认后才串行核验，最多 24 次、零重试。
          </p>
          <button className="secondary-button" type="button" onClick={() => void onPreview()}>
            预览路线核验计划（零外部调用）
          </button>
        </div>
      ) : null}

      {canAct && preview ? (
        <section className="route-plan-box" aria-label="路线来源授权计划">
          <div>
            <strong>{preview.totalExternalCalls} 次只读铁路调用</strong>
            <p>串行 · retry=0 · 计划于 {formatTimestamp(preview.expiresAt)} 过期</p>
          </div>
          <details>
            <summary>查看候选拓扑与摘要</summary>
            <ul>
              {preview.topologySignatures.map((signature) => (
                <li key={signature}>{signature}</li>
              ))}
            </ul>
            <code>{preview.digest}</code>
          </details>
          <div className="source-actions">
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(operationId)}
              onClick={() => void onExecute()}
            >
              {operationId ? '正在核验交通腿…' : '明确执行此路线核验计划'}
            </button>
            {operationId ? (
              <button className="secondary-button" type="button" onClick={() => void onCancel()}>
                取消核验
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {snapshot.blockingReasons.map((reason) => (
        <p className="blocking-message" key={reason}>
          {reason}
        </p>
      ))}
      {failedSources.length > 0 ? (
        <details className="route-source-gaps">
          <summary>来源缺口（{failedSources.length}）</summary>
          <ul>
            {failedSources.map((outcome) => (
              <li key={outcome.callId}>
                {outcome.status} · {outcome.capabilityImpact ?? '能力影响 UNKNOWN'}
                {outcome.manualAlternative ? ` 手工替代：${outcome.manualAlternative}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {snapshot.candidates.length > 0 ? (
        <div className="route-candidate-grid">
          {snapshot.candidates.map((candidate) => (
            <RouteCandidateCard
              key={candidate.routeId}
              candidate={candidate}
              selected={snapshot.selectedRouteId === candidate.routeId}
              canAct={canAct}
              onSelect={onSelect}
              sessionId={snapshot.sessionId}
              onApplyManualEvidence={onApplyManualEvidence}
              onManualDirtyChange={handleManualDirtyChange}
            />
          ))}
        </div>
      ) : null}
    </article>
  )
}

function RouteCandidateCard({
  candidate,
  selected,
  canAct,
  onSelect,
  sessionId,
  onApplyManualEvidence,
  onManualDirtyChange
}: {
  candidate: RouteCandidate
  selected: boolean
  canAct: boolean
  onSelect(routeId: string): Promise<void>
  sessionId: string
  onApplyManualEvidence(request: ManualRouteLegEvidenceRequest): Promise<boolean>
  onManualDirtyChange(legId: string, dirty: boolean): void
}): React.JSX.Element {
  const eligible =
    candidate.score.hardConstraintPass &&
    candidate.score.criticalEvidenceComplete &&
    candidate.blockingReasons.length === 0
  const nodeById = new Map(candidate.nodes.map((node) => [node.nodeId, node]))
  const comparison = comparisonSections(candidate)
  return (
    <section
      className={`route-candidate${candidate.isRecommended ? ' recommended' : ''}${selected ? ' selected' : ''}`}
      aria-label={`${profileLabel(candidate.profile)}路线${candidate.isRecommended ? '，系统推荐' : ''}`}
    >
      <header>
        <div>
          <p className="route-profile">{profileLabel(candidate.profile)}</p>
          <h4>{candidate.nodes.map((node) => node.city).join(' → ')}</h4>
        </div>
        {candidate.isRecommended ? <span className="recommended-badge">综合推荐</span> : null}
        {selected ? <span className="selected-badge">已选择</span> : null}
      </header>

      <div className="route-score-row" aria-label="路线评分摘要">
        <span>硬约束 {candidate.score.hardConstraintPass ? '通过' : '未通过'}</span>
        <span>关键证据 {candidate.score.criticalEvidenceComplete ? '完整' : '不完整'}</span>
        <span>未核验腿 {candidate.score.unverifiedLegCount}</span>
        <span>{candidate.score.transferCount} 次换乘</span>
        <span>夜间到达 {candidate.score.overnightArrivalCount}</span>
        <span>总在途 {formatDuration(candidate.score.transitMinutes)}</span>
        <span>折返分 {candidate.score.backtrackingScore}</span>
        <span>体力 {candidate.score.staminaRisk}</span>
        <span>海拔 {candidate.score.altitudeRisk}</span>
        <span>{formatCost(candidate.score.knownCostCents, candidate.score.costComplete)}</span>
        <span>费用完整度 {candidate.score.costComplete ? '完整' : '不完整'}</span>
      </div>

      <div className="route-comparison-grid" aria-label="路线优劣比较">
        <section className="route-comparison-section advantage" aria-label="路线优势">
          <h5>优势</h5>
          <ul>
            {comparison.strengths.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="route-comparison-section caution" aria-label="路线代价与未知项">
          <h5>代价与未知项</h5>
          <ul>
            {comparison.tradeoffs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="route-spine">
        <div className="route-node origin-node">
          <span className="route-dot" aria-hidden="true" />
          <div>
            <strong>{candidate.legs[0]?.fromCity}</strong>
            <small>总目标出发地</small>
          </div>
        </div>
        {candidate.legs.map((leg) => {
          const destination = leg.to.kind === 'NODE' ? nodeById.get(leg.to.nodeId) : undefined
          return (
            <div className="route-spine-section" key={leg.legId}>
              <div
                className={`route-leg${leg.verificationStatus === 'UNVERIFIED' ? ' unknown' : ''}`}
              >
                <span>{leg.travelDate}</span>
                <strong>{leg.mode}</strong>
                <span>{formatDuration(leg.durationMinutes)}</span>
                <span>{formatCost(leg.costCents, leg.costCents !== null)}</span>
                <span>{leg.verificationStatus}</span>
              </div>
              {canAct && leg.critical && leg.verificationStatus === 'UNVERIFIED' ? (
                <ManualRouteLegEvidenceForm
                  key={`${sessionId}:${candidate.routeId}:${leg.legId}`}
                  sessionId={sessionId}
                  routeId={candidate.routeId}
                  leg={leg}
                  onApply={onApplyManualEvidence}
                  onDirtyChange={onManualDirtyChange}
                />
              ) : null}
              <div className="route-node">
                <span className="route-dot" aria-hidden="true" />
                <div>
                  <strong>{leg.toCity}</strong>
                  <small>
                    {destination
                      ? `${destination.nights} 晚 · ${destination.nodeKind}${
                          destination.mandatoryPlaceIds.length
                            ? ` · ${destination.mandatoryPlaceIds.join('、')}`
                            : ''
                        }`
                      : '返回总目标出发地'}
                  </small>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="route-tradeoffs">
        {comparison.notes.map((difference) => (
          <p key={difference}>{difference}</p>
        ))}
        <p>
          <strong>昆明：</strong>
          {candidate.kunmingDecision.included ? '纳入路线。' : '不纳入路线。'}
          {candidate.kunmingDecision.reason}
        </p>
      </div>
      {canAct && eligible ? (
        <button
          className={candidate.isRecommended ? 'primary-button' : 'secondary-button'}
          type="button"
          onClick={() => void onSelect(candidate.routeId)}
        >
          选择这条路线并进入 STAGE-3
        </button>
      ) : null}
    </section>
  )
}

function ManualRouteLegEvidenceForm({
  sessionId,
  routeId,
  leg,
  onApply,
  onDirtyChange
}: {
  sessionId: string
  routeId: string
  leg: RouteLeg
  onApply(request: ManualRouteLegEvidenceRequest): Promise<boolean>
  onDirtyChange(legId: string, dirty: boolean): void
}): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => () => onDirtyChange(leg.legId, false), [leg.legId, onDirtyChange])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const rawCost = String(data.get('costYuan') ?? '').trim()
    const costYuan = rawCost ? Number(rawCost) : null
    if (costYuan !== null && (!Number.isFinite(costYuan) || costYuan < 0)) return
    setSubmitting(true)
    const applied = await onApply({
      sessionId,
      routeId,
      legId: leg.legId,
      mode: String(data.get('mode')) as ManualRouteLegEvidenceRequest['mode'],
      startAt: localDateTimeWithOffset(String(data.get('startAt'))),
      endAt: localDateTimeWithOffset(String(data.get('endAt'))),
      label: String(data.get('label')),
      costCents: costYuan === null ? null : Math.round(costYuan * 100),
      sourceLabel: String(data.get('sourceLabel')),
      sourceUrl: String(data.get('sourceUrl')),
      summary: String(data.get('summary')),
      confirmed: true
    })
    setSubmitting(false)
    if (applied) {
      form.reset()
      onDirtyChange(leg.legId, false)
    }
  }

  return (
    <form
      className="correction-form route-plan-box"
      aria-label={`${leg.fromCity}到${leg.toCity}人工交通证据`}
      onChange={() => onDirtyChange(leg.legId, true)}
      onSubmit={(event) => void handleSubmit(event)}
    >
      <p className="card-note">
        人工补证范围（只读）：{leg.fromCity} → {leg.toCity} · {leg.travelDate}
      </p>
      <label>
        交通类型
        <select name="mode" defaultValue="MANUAL_FLIGHT" required>
          <option value="MANUAL_FLIGHT">人工航班</option>
          <option value="MANUAL_COACH">人工客运</option>
        </select>
      </label>
      <label>
        出发时间
        <input
          name="startAt"
          type="datetime-local"
          defaultValue={`${leg.travelDate}T08:00`}
          required
        />
      </label>
      <label>
        到达时间
        <input
          name="endAt"
          type="datetime-local"
          defaultValue={`${leg.travelDate}T10:00`}
          required
        />
      </label>
      <label>
        班次或线路名称
        <input name="label" maxLength={240} required />
      </label>
      <label>
        费用（元，可选）
        <input name="costYuan" type="number" min="0" step="0.01" />
      </label>
      <label>
        来源名称
        <input name="sourceLabel" maxLength={160} required />
      </label>
      <label>
        来源链接（HTTPS）
        <input name="sourceUrl" type="url" pattern="https://.*" maxLength={1000} required />
      </label>
      <label>
        核对摘要
        <textarea name="summary" maxLength={500} required />
      </label>
      <label>
        <input name="confirmed" type="checkbox" required />
        我已逐项核对班次、端点、日期和时间，并理解这是用户确认的人工证据。
      </label>
      <button className="secondary-button" type="submit" disabled={submitting}>
        {submitting ? '正在应用…' : '应用人工证据并重新计算路线'}
      </button>
      <p className="card-note">此操作只写本地事件，不调用交通来源或模型。</p>
    </form>
  )
}

function profileLabel(profile: RouteCandidate['profile']): string {
  if (profile === 'LOW_TRANSIT') return '低在途'
  if (profile === 'RELAXED') return '舒缓适配'
  return '综合平衡'
}

function comparisonSections(candidate: RouteCandidate): {
  strengths: string[]
  tradeoffs: string[]
  notes: string[]
} {
  const strengths = candidate.materialDifferences
    .filter((item) => item.startsWith('优势：'))
    .map((item) => item.slice('优势：'.length))
  const tradeoffs = candidate.materialDifferences
    .filter((item) => item.startsWith('代价：') || item.startsWith('未知：'))
    .map((item) => item.slice(item.indexOf('：') + 1))
  const notes = candidate.materialDifferences.filter(
    (item) => !item.startsWith('优势：') && !item.startsWith('代价：') && !item.startsWith('未知：')
  )
  if (strengths.length === 0 && notes[0]) strengths.push(notes.shift()!)
  if (!candidate.score.hardConstraintPass) tradeoffs.push('硬约束未通过。')
  if (!candidate.score.criticalEvidenceComplete) tradeoffs.push('关键交通证据不完整。')
  if (candidate.score.unverifiedLegCount > 0) {
    tradeoffs.push(`${candidate.score.unverifiedLegCount} 条交通腿未核验。`)
  }
  if (candidate.score.transitMinutes === null) tradeoffs.push('总在途时间 UNKNOWN。')
  if (candidate.score.altitudeRisk === 'UNKNOWN') tradeoffs.push('海拔风险 UNKNOWN。')
  if (!candidate.score.costComplete) tradeoffs.push('费用 UNKNOWN。')
  tradeoffs.push(...candidate.blockingReasons)
  return {
    strengths: [...new Set(strengths)],
    tradeoffs:
      tradeoffs.length > 0 ? [...new Set(tradeoffs)] : ['当前量化字段未显示额外代价或未知项。'],
    notes
  }
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return '时长 UNKNOWN'
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return hours > 0 ? `${hours} 小时${remainder ? ` ${remainder} 分` : ''}` : `${remainder} 分钟`
}

function formatCost(costCents: number | null, complete: boolean): string {
  if (costCents === null) return '费用 UNKNOWN'
  return complete
    ? `总费用 ¥${(costCents / 100).toFixed(0)}`
    : `已知费用 ¥${(costCents / 100).toFixed(0)} · 总费用不完整`
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function localDateTimeWithOffset(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return value
  const local = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0)
  )
  const offsetMinutes = -local.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(
    absolute % 60
  ).padStart(2, '0')}`
  return `${value.length === 16 ? `${value}:00` : value}${offset}`
}
