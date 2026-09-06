import React, { useState } from 'react'
import { WorkbenchShell, type View } from '../../src/renderer/src/App'
import { RouteNodeResearchCard } from '../../src/renderer/src/RouteNodeResearchCard'
import type { NodeResearchPlanPreview, RouteNodeD4Snapshot } from '../../src/shared/schema/d4'
import { ItineraryGoalSchema, type RouteNode } from '../../src/shared/schema/itinerary'
import '../../src/renderer/src/assets/main.css'
import '../../src/renderer/src/assets/workbench.css'

const goal = ItineraryGoalSchema.parse({
  regionGoal: '云南',
  originCity: '广州',
  startDate: '2026-09-08',
  endDate: '2026-09-17',
  totalDays: 10,
  totalNights: 9,
  travelers: [
    {
      count: 2,
      ageBand: 'ADULT',
      relationship: '家人',
      stamina: 'MEDIUM',
      careNeeds: [],
      functionalLimits: []
    }
  ],
  budget: {
    currency: 'CNY',
    basis: 'TOTAL',
    targetMinor: 3000000,
    flexibleRangeMinor: null,
    hardCapMinor: null,
    inclusions: ['TRANSPORT', 'ACCOMMODATION']
  },
  intensity: 'RELAXED',
  mandatoryPlaces: [
    { placeId: 'must-erhai', displayName: '洱海', nodeCity: '大理' },
    { placeId: 'must-yulong', displayName: '玉龙雪山', nodeCity: '丽江' },
    { placeId: 'must-banna', displayName: '西双版纳', nodeCity: '西双版纳' }
  ]
})
const nodes: RouteNode[] = goal.mandatoryPlaces.map((place, index) => ({
  routeId: 'demo-route',
  nodeId: `demo-node-${index}`,
  city: place.nodeCity,
  region: '云南',
  sequence: index + 1,
  arrivalDate: ['2026-09-08', '2026-09-11', '2026-09-14'][index]!,
  departureDate: ['2026-09-11', '2026-09-14', '2026-09-17'][index]!,
  nights: 3,
  nodeKind: 'STAY',
  mandatoryPlaceIds: [place.placeId],
  reason: place.displayName
}))

function snapshotFor(node: RouteNode): RouteNodeD4Snapshot {
  const scope = {
    sessionId: 'demo-session',
    routeId: node.routeId,
    nodeId: node.nodeId,
    city: node.city,
    nodeKind: node.nodeKind,
    mandatoryPlaceIds: node.mandatoryPlaceIds
  }
  return {
    sessionId: scope.sessionId,
    stage: 'STAGE_3',
    selectedRouteId: node.routeId,
    currentScope: scope,
    currentNode: {
      scope,
      sequence: node.sequence,
      required: true,
      status: 'NOT_STARTED',
      skipReason: null,
      researchEntities: [],
      researchChecklistConfirmed: false,
      conflictResolutions: [],
      sourceResearchFailures: [],
      xhsSampleSummary: null,
      manualResearchSummary: null,
      attractionRankings: [],
      blockingReasons: [],
      confirmedAt: null
    },
    nodeSummaries: nodes.map((item) => ({
      scope: {
        ...scope,
        nodeId: item.nodeId,
        city: item.city,
        mandatoryPlaceIds: item.mandatoryPlaceIds
      },
      sequence: item.sequence,
      required: true,
      status: 'NOT_STARTED',
      blockerCount: 0,
      entityCount: 0,
      confirmedAt: null,
      skipReason: null
    })),
    routeResearchComplete: false,
    nextRequiredNodeId: node.nodeId
  }
}

export function Preview(): React.JSX.Element {
  const [view, setView] = useState<View>('CHAT')
  const [node, setNode] = useState(nodes[1]!)
  const [preview, setPreview] = useState<NodeResearchPlanPreview | null>(null)
  const [notice, setNotice] = useState('示例行程 · 仅本地交互预览，不连接来源或模型。')
  const [dirty, setDirty] = useState(false)
  const snapshot = snapshotFor(node)
  const localAction = async (): Promise<void> => {
    setNotice('示例预览不会执行外部调用或保存旅行事实。')
  }
  return (
    <WorkbenchShell view={view} onNavigate={setView}>
      <section className="chat-layout">
        <div className="chat-panel">
          <header className="trip-workspace-heading">
            <div>
              <h2>
                云南十日 <span className="demo-badge">示例行程</span>
              </h2>
              <p>9月8日—17日 · 10天9晚</p>
            </div>
            <span className="trip-stage">目的地研究</span>
          </header>
          {view === 'CHAT' ? (
            <RouteNodeResearchCard
              key={node.nodeId}
              snapshot={snapshot}
              nodes={nodes}
              goal={goal}
              claims={[]}
              preview={preview}
              operationId={null}
              onSelectNode={async (id) => {
                if (dirty && !window.confirm('当前人工草稿尚未提交，仍要切换吗？')) return
                const next = nodes.find((item) => item.nodeId === id)
                if (next) {
                  setNode(next)
                  setPreview(null)
                  setDirty(false)
                }
              }}
              onPreview={async (mode) => {
                setPreview({
                  sessionId: snapshot.sessionId,
                  routeId: node.routeId,
                  nodeId: node.nodeId,
                  scope: snapshot.currentScope,
                  mode,
                  planId: crypto.randomUUID(),
                  digest: `sha256:${'0'.repeat(64)}`,
                  expiresAt: new Date(Date.now() + 600000).toISOString(),
                  sourcePlan: ['景点 推荐', '家庭 体验', '避雷', '注意事项']
                    .map((query, index) => ({
                      sequence: index + 1,
                      sourceId: 'SRC_XHS',
                      toolName: 'search_feeds',
                      query: `${node.city} ${query}`,
                      queryKind: null,
                      callCount: 1
                    }))
                    .concat([
                      {
                        sequence: 5,
                        sourceId: 'SRC_XHS',
                        toolName: 'get_feed_detail',
                        query: `读取冻结样本的${mode === 'XHS_STRICT' ? 30 : 10}篇详情`,
                        queryKind: null,
                        callCount: mode === 'XHS_STRICT' ? 30 : 10
                      }
                    ]),
                  modelPlan: [
                    {
                      sequence: 1,
                      role: 'EXTRACTION',
                      provider: '示例渠道',
                      model: '示例抽取模型',
                      callCount: mode === 'XHS_STRICT' ? 6 : 2,
                      repairInvalid: false
                    },
                    {
                      sequence: 2,
                      role: 'REVIEW',
                      provider: '示例渠道',
                      model: '示例复核模型',
                      callCount: 1,
                      repairInvalid: false
                    }
                  ],
                  totalExternalCalls: mode === 'XHS_STRICT' ? 34 : 14,
                  totalModelCalls: mode === 'XHS_STRICT' ? 7 : 3,
                  timeoutMs: 60000,
                  retryCount: 0
                })
                setNotice('示例计划已展开。没有连接任何来源或模型。')
              }}
              onExecute={async () => {
                setPreview(null)
                setNotice('演示：计划已消费。未执行真实来源、模型或事实写入。')
              }}
              onCancel={localAction}
              onPaste={async (event) => {
                event.preventDefault()
                event.currentTarget.reset()
                await localAction()
              }}
              onPrepareManual={async () => {
                await localAction()
                return false
              }}
              onManualDirtyChange={setDirty}
              onDisposition={localAction}
              onConflict={localAction}
              onConfirm={localAction}
            />
          ) : (
            <section className="preview-secondary">
              <h3>{view === 'EVIDENCE' ? '本行程尚无已获取证据' : '已切换工作区'}</h3>
              <p>此演示聚焦节点研究；完整应用中的对应页面保留原有功能。</p>
              <button className="secondary-button" onClick={() => setView('CHAT')}>
                返回规划
              </button>
            </section>
          )}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault()
              event.currentTarget.reset()
              setNotice('已体验信息输入；示例内容不会发送给模型。')
            }}
          >
            <textarea
              aria-label="补充旅行信息"
              name="message"
              rows={1}
              placeholder="补充偏好或已有信息，帮助 Agent 更好地研究…"
              required
            />
            <button type="submit" className="secondary-button">
              发送
            </button>
          </form>
          <p className="system-message" role="status">
            {notice}
          </p>
        </div>
      </section>
    </WorkbenchShell>
  )
}
