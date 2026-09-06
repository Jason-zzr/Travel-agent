import React, { useState } from 'react'
import type {
  LeadDisposition,
  ManualResearchItem,
  NodeResearchPlanPreview,
  RouteNodeD4Snapshot,
  RouteNodeResearchMode,
  RouteNodeResearchState
} from '../../shared/schema/d4'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import type { ItineraryGoal, RouteNode } from '../../shared/schema/itinerary'
import { ManualResearchEditor } from './ManualResearchEditor'

export function RouteNodeResearchCard({
  snapshot,
  nodes,
  goal,
  claims,
  preview,
  operationId,
  onSelectNode,
  onPreview,
  onExecute,
  onCancel,
  onPaste,
  onPrepareManual,
  onManualDirtyChange,
  onDisposition,
  onConflict,
  onConfirm
}: {
  snapshot: RouteNodeD4Snapshot
  nodes: RouteNode[]
  goal?: ItineraryGoal | null
  claims: EvidenceClaim[]
  preview: NodeResearchPlanPreview | null
  operationId: string | null
  onSelectNode(nodeId: string): Promise<void>
  onPreview(mode: RouteNodeResearchMode): Promise<void>
  onExecute(): Promise<void>
  onCancel(): Promise<void>
  onPaste(event: React.FormEvent<HTMLFormElement>): Promise<void>
  onPrepareManual(items: ManualResearchItem[]): Promise<boolean>
  onManualDirtyChange(dirty: boolean): void
  onDisposition(entityId: string, disposition: LeadDisposition): Promise<void>
  onConflict(subject: string, predicate: string, selectedClaimId: string | null): Promise<void>
  onConfirm(): Promise<void>
}): React.JSX.Element {
  const [mode, setMode] = useState<RouteNodeResearchMode>('XHS_STRICT')
  const current = snapshot.currentNode
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]))
  const currentRouteNode = nodeById.get(current.scope.nodeId)
  const mandatoryNames = current.scope.mandatoryPlaceIds.map(
    (id) => goal?.mandatoryPlaces.find((place) => place.placeId === id)?.displayName ?? id
  )
  const editable = current.status !== 'SKIPPED' && current.status !== 'CONFIRMED'

  return (
    <article
      className="decision-card d4-card node-workbench"
      data-testid="route-node-research-card"
    >
      <nav className="node-route-rail" aria-label="路线研究节点">
        {goal ? (
          <div className="node-route-endpoint">
            <span className="rail-stop" aria-hidden="true" />
            <strong>{goal.originCity}</strong>
            <span>出发地</span>
            <small>{goal.startDate}</small>
          </div>
        ) : null}
        {snapshot.nodeSummaries.map((summary) => {
          const node = nodeById.get(summary.scope.nodeId)
          const active = summary.scope.nodeId === current.scope.nodeId
          return (
            <button
              className={`node-route-stop${active ? ' active' : ''}`}
              type="button"
              key={summary.scope.nodeId}
              disabled={Boolean(operationId) || active}
              aria-current={active ? 'step' : undefined}
              onClick={() => void onSelectNode(summary.scope.nodeId)}
            >
              <span className="rail-stop" aria-hidden="true" />
              <strong>{node?.city ?? summary.scope.city}</strong>
              <span>{node?.nodeKind === 'STAY' ? `${node.nights} 晚` : '交通中转'}</span>
              <small>
                {node
                  ? `${node.arrivalDate.slice(5).replace('-', '/')} — ${node.departureDate.slice(5).replace('-', '/')}`
                  : '日期待确认'}
              </small>
              <small className="rail-research-status">
                {researchStatusLabel(summary.status)}
                {summary.required ? ' · 必需' : ''}
              </small>
            </button>
          )
        })}
        {goal ? (
          <div className="node-route-endpoint">
            <span className="rail-stop" aria-hidden="true" />
            <strong>{goal.originCity}</strong>
            <span>返回出发地</span>
            <small>{goal.endDate}</small>
          </div>
        ) : null}
      </nav>
      <div className="node-workspace-grid">
        <div className="node-research-main">
          <h3>{current.scope.city} · 研究与选择</h3>
          <p className="visually-hidden">按已选路线逐站核验</p>
          <div className="node-research-overview">
            <p className="node-overview-title">当前研究概览</p>
            {mandatoryNames.length ? <p>必去：{mandatoryNames.join('、')}</p> : null}
            <p>先了解体验与体力要求，再核验开放与预约。</p>
            <div className="node-evidence-row">
              <div>
                <h4>体验与体力</h4>
                <p>路线体验、拥挤情况与家庭适配</p>
              </div>
              <span className="status status-unverified">
                {current.researchEntities.length ? '待逐项复核' : '待获取'}
              </span>
            </div>
            <div className="node-evidence-row">
              <div>
                <h4>开放与预约</h4>
                <p>查看逐项证据与核验状态</p>
              </div>
              <span className="status status-unverified">独立核验</span>
            </div>
          </div>

          {editable ? (
            <>
              <section className="research-entity node-plan" aria-label="当前节点自动研究计划">
                <div className="source-card-title">
                  <label>
                    研究方式
                    <select
                      value={mode}
                      disabled={Boolean(operationId) || Boolean(preview)}
                      onChange={(event) => setMode(event.target.value as RouteNodeResearchMode)}
                    >
                      <option value="STANDARD">标准研究</option>
                      <option value="XHS_STRICT">小红书严格 30 帖</option>
                    </select>
                  </label>
                </div>
                {!preview ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={Boolean(operationId)}
                    onClick={() => void onPreview(mode)}
                  >
                    查看研究计划
                  </button>
                ) : (
                  <div className="conflict-box">
                    <p>
                      {preview.mode} · 外部调用上限 {preview.totalExternalCalls} · 模型调用{' '}
                      {preview.totalModelCalls} · 超时 {preview.timeoutMs / 1000}s · 重试{' '}
                      {preview.retryCount}
                    </p>
                    <ol className="node-plan-list">
                      {preview.sourcePlan.map((item) => (
                        <li key={item.sequence}>
                          {item.sourceId} · {item.toolName} × {item.callCount}
                          <br />
                          {item.query}
                        </li>
                      ))}
                    </ol>
                    <ul className="node-plan-list">
                      {preview.modelPlan.map((item) => (
                        <li key={item.sequence}>
                          {item.role} · {item.provider} / {item.model} × {item.callCount} ·{' '}
                          {item.repairInvalid ? '允许结构修复' : '不修复重试'}
                        </li>
                      ))}
                    </ul>
                    <p>
                      <code>{preview.planId}</code>
                      <br />
                      <code>{preview.digest}</code>
                    </p>
                    <p>
                      一次性计划于 {preview.expiresAt} 过期；节点或运行时状态变化后必须重新预览。
                    </p>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={Boolean(operationId)}
                      onClick={() => void onExecute()}
                    >
                      明确执行此节点计划
                    </button>
                  </div>
                )}
                {operationId ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void onCancel()}
                  >
                    取消当前节点来源任务
                  </button>
                ) : null}
                <p className="card-note node-plan-explainer">
                  预览不会调用来源或模型，核对后再授权执行。
                </p>
              </section>
              <details className="node-supplement">
                <summary>提供已有线索</summary>
                <form className="clue-form" onSubmit={(event) => void onPaste(event)}>
                  <label>
                    粘贴当前节点攻略或截图文字（只作为未核验线索）
                    <textarea name="clue" rows={3} maxLength={20000} required />
                  </label>
                  <label>
                    来源 HTTPS URL（可选）
                    <input name="sourceUrl" type="url" placeholder="https://…" />
                  </label>
                  <button className="secondary-button" type="submit">
                    保存到 {current.scope.city} 节点
                  </button>
                </form>
              </details>
            </>
          ) : null}

          {current.sourceResearchFailures.map((failure) => (
            <p
              className="blocking-message"
              key={`${failure.sourceId}:${failure.queryKind ?? 'DEFAULT'}`}
            >
              {failure.sourceId} 失败：{failure.capabilityImpact}。手工替代：
              {failure.manualAlternative}
            </p>
          ))}

          <section id="node-research-results" className="node-results" aria-label="本节点研究结果">
            {current.researchEntities.length === 0 ? (
              <p className="empty-state">当前节点尚无可确认研究实体。</p>
            ) : (
              <div className="research-list">
                {current.researchEntities.map((entity) => (
                  <RouteResearchEntityCard
                    key={entity.entityId}
                    entity={entity}
                    state={current}
                    claims={claims}
                    onDisposition={onDisposition}
                    onConflict={onConflict}
                  />
                ))}
              </div>
            )}
          </section>

          {editable && current.researchEntities.length > 0 ? (
            <button
              className="primary-button"
              type="button"
              disabled={current.researchEntities.length === 0 || Boolean(operationId)}
              onClick={() => void onConfirm()}
            >
              确认 {current.scope.city} 节点
            </button>
          ) : null}
          {editable ? (
            <details className="node-manual">
              <summary>研究不足，改为人工核验</summary>
              <p className="card-note">
                自动研究失败或信息不足时，可选择此路径。人工核验保留用户来源身份。
              </p>
              <ManualResearchEditor
                key={`${snapshot.sessionId}:${snapshot.selectedRouteId}:${current.scope.nodeId}`}
                sessionId={snapshot.sessionId}
                pasteClaims={claims.filter((claim) => claim.sourceId === 'USER_PASTE')}
                onSubmit={onPrepareManual}
                onDirtyChange={onManualDirtyChange}
              />
            </details>
          ) : null}
          <p className="card-note">
            路线进度：{snapshot.nodeSummaries.filter((item) => item.status === 'CONFIRMED').length}{' '}
            已确认 / {snapshot.nodeSummaries.filter((item) => item.required).length} 必需节点
            {snapshot.routeResearchComplete ? ' · 已完成' : ''}
          </p>
        </div>
        <aside className="node-context" aria-label="当前路线节点">
          <h3>本站约束</h3>
          <div className="source-card-title">
            <div>
              <h4>
                {current.scope.city} ·{' '}
                {currentRouteNode?.nodeKind === 'STAY'
                  ? `停留 ${currentRouteNode.nights} 晚`
                  : '交通节点'}
              </h4>
              <p className="card-note">
                {currentRouteNode?.arrivalDate} → {currentRouteNode?.departureDate} ·{' '}
                {current.scope.nodeKind === 'STAY'
                  ? `${currentRouteNode?.nights ?? 0} 晚`
                  : '交通节点'}
              </p>
            </div>
            <span className={`status status-${statusClass(current.status)}`}>
              {researchStatusLabel(current.status)}
            </span>
          </div>
          {current.scope.mandatoryPlaceIds.length > 0 ? (
            <div className="node-context-item">
              <h4>必去</h4>
              <p>{mandatoryNames.join('、')}</p>
            </div>
          ) : null}
          <div className="node-context-item">
            <h4>旅行强度</h4>
            <p>
              {goal
                ? { RELAXED: '轻松', BALANCED: '均衡', INTENSIVE: '紧凑' }[goal.intensity]
                : '待确认'}
            </p>
          </div>
          <section className="node-source-note">
            <h3>来源与核验</h3>
            <p>小红书内容用于体验参考，不代表已核验的硬事实。</p>
            <p>开放时间、闭园与预约要求需要独立来源核验。</p>
            <a href="#node-research-results">查看本节点证据</a>
          </section>
          {current.skipReason ? <p className="card-note">跳过原因：{current.skipReason}</p> : null}
          {current.blockingReasons.map((reason) => (
            <p className="blocking-message" key={reason}>
              {reason}
            </p>
          ))}
        </aside>
      </div>
    </article>
  )
}

function RouteResearchEntityCard({
  entity,
  state,
  claims,
  onDisposition,
  onConflict
}: {
  entity: RouteNodeResearchState['researchEntities'][number]
  state: RouteNodeResearchState
  claims: EvidenceClaim[]
  onDisposition(entityId: string, disposition: LeadDisposition): Promise<void>
  onConflict(subject: string, predicate: string, selectedClaimId: string | null): Promise<void>
}): React.JSX.Element {
  const unresolved = new Set(entity.unresolvedConflictClaimIds)
  const conflictClaims = claims.filter((claim) => unresolved.has(claim.claimId))
  const predicates = [...new Set(conflictClaims.map((claim) => claim.predicate))]
  return (
    <section className="research-entity">
      <div className="source-card-title">
        <h4>{entity.canonicalSubject}</h4>
        <span className={`status status-${entity.verificationStatus.toLowerCase()}`}>
          {entity.verificationStatus}
        </span>
      </div>
      <p>
        类别：{entity.kind} · 身份：{entity.identityStatus} · 成员适配：{entity.fitness.status}
      </p>
      <p>{entity.fitness.reasons.join('；')}</p>
      <details>
        <summary>节点 Claim（{entity.claimIds.length}）</summary>
        <ul className="claim-id-list">
          {entity.claimIds.map((claimId) => (
            <li key={claimId}>
              <code>{claimId}</code>
            </li>
          ))}
        </ul>
      </details>
      <label>
        用户处置
        <select
          value={entity.disposition}
          onChange={(event) =>
            void onDisposition(entity.entityId, event.target.value as LeadDisposition)
          }
        >
          <option value="MUST_GO">必去</option>
          <option value="WANT">想去</option>
          <option value="NEUTRAL">中立</option>
          <option value="EXCLUDE">排除</option>
        </select>
      </label>
      {predicates.map((predicate) => {
        const matching = conflictClaims.filter((claim) => claim.predicate === predicate)
        const resolution = state.conflictResolutions.find(
          (item) => item.subject === entity.canonicalSubject && item.predicate === predicate
        )
        return (
          <details className="conflict-box" key={predicate} open>
            <summary>
              冲突：{predicate}（{resolution ? `已裁决 ${resolution.resolution}` : '尚未裁决'}）
            </summary>
            {matching.map((claim) => (
              <div className="conflict-claim" key={claim.claimId}>
                <code>{JSON.stringify(claim.value)}</code>
                <p>
                  {claim.sourceId} · {claim.sourceRef}
                </p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void onConflict(entity.canonicalSubject, predicate, claim.claimId)}
                >
                  采用此 Claim
                </button>
              </div>
            ))}
            <button
              className="secondary-button"
              type="button"
              onClick={() => void onConflict(entity.canonicalSubject, predicate, null)}
            >
              标记为暂不判断
            </button>
          </details>
        )
      })}
    </section>
  )
}

function researchStatusLabel(status: RouteNodeResearchState['status']): string {
  if (status === 'NOT_STARTED') return '未开始'
  if (status === 'REVIEW_REQUIRED') return '待复核'
  if (status === 'BLOCKED') return '受阻'
  if (status === 'CONFIRMED') return '已确认'
  return '已跳过'
}

function statusClass(status: RouteNodeResearchState['status']): string {
  if (status === 'CONFIRMED') return 'verified'
  if (status === 'BLOCKED') return 'conflicted'
  return 'unverified'
}
