import React, { useEffect, useMemo, useState } from 'react'
import type { ChatTurnOutcome, SessionSummary, UsageTotal } from '../../shared/schema/chat'
import type {
  D4Snapshot,
  LeadDisposition,
  ManualResearchItem,
  NodeResearchPlanPreview,
  ResearchEntity,
  RouteNodeD4Snapshot,
  RouteNodeResearchMode,
  XhsRankingPreview
} from '../../shared/schema/d4'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import type { EnvelopeComparison } from '../../shared/schema/envelope'
import type { TravelBasics } from '../../shared/schema/interview'
import type {
  ManualRouteLegEvidenceRequest,
  MultiCityRouteSnapshot,
  RoutePlanPreview
} from '../../shared/schema/itinerary'
import {
  chooseEnvelope,
  applyManualRouteLegEvidence,
  addUserPaste,
  addRouteNodeUserPaste,
  cancelD4Operation,
  cancelRouteNodeResearchOperation,
  confirmFixedDestination,
  confirmRouteNodeResearch,
  confirmResearch,
  confirmBasics,
  cancelMultiCityRouteOperation,
  createSession,
  generateDestinationCandidates,
  getD4Snapshot,
  getMultiCityRouteSnapshot,
  getUsage,
  listEvidence,
  listSessions,
  prepareManualResearch,
  prepareResearch,
  previewMultiCityRoutes,
  previewXhsRanking,
  executeXhsRanking,
  executeRouteNodeResearch,
  getRouteNodeResearchSnapshot,
  prepareManualRouteNodeResearch,
  previewRouteNodeResearch,
  resolveResearchConflict,
  resolveRouteNodeResearchConflict,
  selectDestination,
  selectMultiCityRoute,
  setResearchDisposition,
  setRouteNodeResearchDisposition,
  subscribeD4Progress,
  subscribeMultiCityRouteProgress,
  subscribeRouteNodeResearchProgress,
  submitChat,
  updateConfirmation,
  executeMultiCityRoutes
} from './ipc'
import { ManualResearchEditor } from './ManualResearchEditor'
import { ItineraryRouteCard } from './ItineraryRouteCard'
import { RouteNodeResearchCard } from './RouteNodeResearchCard'

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

export function ChatView(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [outcome, setOutcome] = useState<ChatTurnOutcome | null>(null)
  const [comparison, setComparison] = useState<EnvelopeComparison | null>(null)
  const [usage, setUsage] = useState<UsageTotal[]>([])
  const [d4, setD4] = useState<D4Snapshot | null>(null)
  const [d4Claims, setD4Claims] = useState<EvidenceClaim[]>([])
  const [d4OperationId, setD4OperationId] = useState<string | null>(null)
  const [xhsRankingPreview, setXhsRankingPreview] = useState<XhsRankingPreview | null>(null)
  const [routeSnapshot, setRouteSnapshot] = useState<MultiCityRouteSnapshot | null>(null)
  const [routePreview, setRoutePreview] = useState<RoutePlanPreview | null>(null)
  const [routeOperationId, setRouteOperationId] = useState<string | null>(null)
  const [routeNodeSnapshot, setRouteNodeSnapshot] = useState<RouteNodeD4Snapshot | null>(null)
  const [routeNodePreview, setRouteNodePreview] = useState<NodeResearchPlanPreview | null>(null)
  const [routeNodeOperationId, setRouteNodeOperationId] = useState<string | null>(null)
  const [activeRouteNodeId, setActiveRouteNodeId] = useState<string | null>(null)
  const [autoSelectRouteNode, setAutoSelectRouteNode] = useState(true)
  const [manualDraftDirty, setManualDraftDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('新建会话后，用自然语言描述你的旅行。')
  const active = sessions.find((session) => session.sessionId === activeId) ?? null
  const linked = useMemo(
    () =>
      active?.linkedSessionGroup
        ? sessions.filter((session) => session.linkedSessionGroup === active.linkedSessionGroup)
        : [],
    [active, sessions]
  )
  const selectedRoute = useMemo(
    () =>
      routeSnapshot?.selectedRouteId
        ? (routeSnapshot.candidates.find(
            (candidate) => candidate.routeId === routeSnapshot.selectedRouteId
          ) ?? null)
        : null,
    [routeSnapshot]
  )
  const currentRouteNodeId = useMemo(() => {
    if (!selectedRoute || (active?.stage !== 'STAGE_3' && active?.stage !== 'STAGE_4')) {
      return null
    }
    if (
      activeRouteNodeId &&
      selectedRoute.nodes.some((node) => node.nodeId === activeRouteNodeId)
    ) {
      return activeRouteNodeId
    }
    return (
      selectedRoute.nodes.find(
        (node) => node.nodeKind === 'STAY' || node.mandatoryPlaceIds.length > 0
      )?.nodeId ??
      selectedRoute.nodes[0]?.nodeId ??
      null
    )
  }, [active?.stage, activeRouteNodeId, selectedRoute])

  useEffect(() => {
    void listSessions().then((result) => {
      if (!result.ok) return setNotice(result.error.userHint)
      setSessions(result.data)
      setActiveId(result.data[0]?.sessionId ?? null)
    })
  }, [])

  useEffect(() => {
    if (!activeId) return
    let current = true
    void Promise.all([
      getD4Snapshot(activeId),
      listEvidence(activeId),
      getMultiCityRouteSnapshot(activeId)
    ]).then(([snapshotResult, evidenceResult, routeResult]) => {
      if (!current) return
      if (snapshotResult.ok) setD4(snapshotResult.data)
      else setNotice(snapshotResult.error.userHint)
      if (evidenceResult.ok) setD4Claims(evidenceResult.data)
      if (routeResult.ok && routeResult.data.sessionId === activeId) {
        setRouteSnapshot(routeResult.data)
      }
    })
    return () => {
      current = false
    }
  }, [activeId])

  useEffect(
    () =>
      subscribeD4Progress((event) => {
        if (event.operationId !== d4OperationId || event.sessionId !== activeId) return
        setNotice(event.message)
      }),
    [activeId, d4OperationId]
  )

  useEffect(
    () =>
      subscribeMultiCityRouteProgress((event) => {
        if (event.operationId !== routeOperationId || event.sessionId !== activeId) return
        setNotice(event.message)
      }),
    [activeId, routeOperationId]
  )

  useEffect(
    () =>
      subscribeRouteNodeResearchProgress((event) => {
        if (
          event.operationId !== routeNodeOperationId ||
          event.sessionId !== activeId ||
          event.routeId !== selectedRoute?.routeId ||
          event.nodeId !== currentRouteNodeId
        ) {
          return
        }
        setNotice(event.message)
      }),
    [activeId, currentRouteNodeId, routeNodeOperationId, selectedRoute?.routeId]
  )

  useEffect(() => {
    if (!activeId || !selectedRoute || !currentRouteNodeId) return
    let current = true
    void getRouteNodeResearchSnapshot({
      sessionId: activeId,
      routeId: selectedRoute.routeId,
      nodeId: currentRouteNodeId
    }).then((result) => {
      if (!current) return
      if (!result.ok) {
        setNotice(result.error.userHint)
        return
      }
      if (
        result.data.sessionId !== activeId ||
        result.data.selectedRouteId !== selectedRoute.routeId ||
        result.data.currentScope.nodeId !== currentRouteNodeId
      ) {
        return
      }
      if (
        autoSelectRouteNode &&
        result.data.nextRequiredNodeId &&
        result.data.nextRequiredNodeId !== currentRouteNodeId
      ) {
        setActiveRouteNodeId(result.data.nextRequiredNodeId)
        return
      }
      setRouteNodeSnapshot(result.data)
      setAutoSelectRouteNode(false)
    })
    return () => {
      current = false
    }
  }, [activeId, autoSelectRouteNode, currentRouteNodeId, selectedRoute])

  async function handleCreate(): Promise<void> {
    if (manualDraftDirty && !window.confirm('当前人工研究草稿尚未提交，仍要新建会话吗？')) return
    const result = await createSession('新旅行')
    if (!result.ok) return setNotice(result.error.userHint)
    setSessions((current) => [...current, result.data])
    setActiveId(result.data.sessionId)
    setTurns([])
    setOutcome(null)
    setComparison(null)
    setD4(null)
    setD4Claims([])
    setRouteSnapshot(null)
    setRoutePreview(null)
    setRouteOperationId(null)
    setRouteNodeSnapshot(null)
    setRouteNodePreview(null)
    setRouteNodeOperationId(null)
    setActiveRouteNodeId(null)
    setAutoSelectRouteNode(true)
    setXhsRankingPreview(null)
    setManualDraftDirty(false)
    setNotice('会话已创建。请描述出发地、目的地和大致时间。')
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const form = event.currentTarget
    const text = new FormData(form).get('message')
    if (!activeId || typeof text !== 'string' || !text.trim()) return
    setBusy(true)
    setTurns((current) => [...current, { role: 'user', text: text.trim() }])
    form.reset()
    const result = await submitChat(activeId, text.trim())
    setBusy(false)
    if (!result.ok) {
      setNotice(result.error.userHint)
      setComparison(result.comparison ?? null)
      if (result.dependency) setNotice(`${result.error.userHint} 依赖：${result.dependency}`)
    } else {
      setOutcome(result.data)
      setComparison(null)
      setTurns((current) => [...current, { role: 'assistant', text: result.data.assistantText }])
    }
    await refreshUsage(activeId)
  }

  async function handleConfirm(): Promise<void> {
    if (!activeId) return
    setBusy(true)
    const result = await confirmBasics(activeId)
    setBusy(false)
    if (!result.ok) {
      setNotice(result.error.userHint)
      setComparison(result.comparison ?? null)
      return
    }
    setSessions((current) =>
      current.map((item) => (item.sessionId === activeId ? result.data : item))
    )
    setOutcome(null)
    setNotice('基础信息已确认，进入 STAGE-2。')
    await Promise.all([refreshD4(activeId), refreshRoute(activeId)])
  }

  async function handleCorrection(
    event: React.FormEvent<HTMLFormElement>,
    basics: TravelBasics
  ): Promise<void> {
    event.preventDefault()
    if (!activeId) return
    const data = new FormData(event.currentTarget)
    const destinations = String(data.get('destinations'))
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean)
    const budget = Number(data.get('budget'))
    const isMultiCity = basics.itineraryIntent?.kind === 'MULTI_CITY_ROUTE'
    const originGatewayCity = isMultiCity
      ? String(data.get('originGatewayCity') ?? '').trim() || null
      : (basics.originGatewayCity ?? null)
    const originPlaceLabel = isMultiCity
      ? String(data.get('originPlaceLabel') ?? '').trim() || null
      : (basics.originPlaceLabel ?? null)
    const corrected: TravelBasics = {
      ...basics,
      originCities: isMultiCity
        ? originGatewayCity
          ? [originGatewayCity]
          : basics.originCities
        : String(data.get('origins'))
            .split(/[，,]/)
            .map((item) => item.trim())
            .filter(Boolean),
      originGatewayCity,
      originPlaceLabel,
      destinationCities: destinations,
      budget: { ...basics.budget, targetMinor: Math.round(budget * 100) },
      intensity: String(data.get('intensity')) as TravelBasics['intensity']
    }
    const result = await updateConfirmation({ sessionId: activeId, basics: corrected })
    if (!result.ok) {
      setNotice(result.error.userHint)
      setComparison(result.comparison ?? null)
      return
    }
    setOutcome(result.data)
    setNotice('确认卡已按字段更新。')
  }

  async function handleEnvelope(decision: 'SPLIT' | 'ADJUST'): Promise<void> {
    if (!activeId) return
    const retained =
      decision === 'ADJUST' ? window.prompt('请输入要保留的一个目的地城市')?.trim() : undefined
    if (decision === 'ADJUST' && !retained) return
    const result = await chooseEnvelope({
      sessionId: activeId,
      decision,
      rationale: decision === 'SPLIT' ? '保留完整行程范围' : `保留 ${retained}`,
      retainedDestinationCities: retained ? [retained] : []
    })
    if (!result.ok) return setNotice(result.error.userHint)
    if (decision === 'SPLIT') {
      setSessions((current) => [
        ...current,
        ...result.data.filter((item) => !current.some((old) => old.sessionId === item.sessionId))
      ])
      setXhsRankingPreview(null)
      setActiveId(result.data[0]?.sessionId ?? activeId)
      setNotice('已创建关联子会话；段间衔接仍需手工确认。')
    } else {
      setSessions((current) =>
        current.map((item) => (item.sessionId === activeId ? result.data[0]! : item))
      )
      setNotice('已缩小到 M0 包络并记录被舍弃范围。')
    }
    setComparison(null)
  }

  async function refreshUsage(sessionId: string): Promise<void> {
    const result = await getUsage(sessionId)
    if (result.ok) setUsage(result.data)
  }

  async function refreshD4(sessionId: string): Promise<void> {
    const [snapshotResult, evidenceResult] = await Promise.all([
      getD4Snapshot(sessionId),
      listEvidence(sessionId)
    ])
    if (snapshotResult.ok) {
      setD4(snapshotResult.data)
      syncSessionStage(snapshotResult.data)
    } else setNotice(snapshotResult.error.userHint)
    if (evidenceResult.ok) setD4Claims(evidenceResult.data)
  }

  async function refreshRoute(sessionId: string): Promise<void> {
    const result = await getMultiCityRouteSnapshot(sessionId)
    if (result.ok && result.data.sessionId === sessionId) setRouteSnapshot(result.data)
    else if (!result.ok) setNotice(result.error.userHint)
  }

  function syncSessionStage(snapshot: Pick<D4Snapshot, 'sessionId' | 'stage'>): void {
    setSessions((current) =>
      current.map((session) =>
        session.sessionId === snapshot.sessionId ? { ...session, stage: snapshot.stage } : session
      )
    )
  }

  async function handleGenerateDestinations(): Promise<void> {
    if (!activeId) return
    const operationId = crypto.randomUUID()
    setD4OperationId(operationId)
    const result = await generateDestinationCandidates({ sessionId: activeId, operationId })
    setD4OperationId(null)
    if (!result.ok) return setNotice(result.error.userHint)
    setD4(result.data)
    await refreshUsage(activeId)
    setNotice('候选已生成；系统不会自动替你选择。')
  }

  async function handleConfirmFixedDestination(city: string): Promise<void> {
    if (!activeId) return
    setBusy(true)
    const result = await confirmFixedDestination({ sessionId: activeId, city })
    setBusy(false)
    if (!result.ok) return setNotice(result.error.userHint)
    setD4(result.data)
    syncSessionStage(result.data)
    setNotice(`已确认 ${city}，进入 STAGE-3 研究。`)
  }

  async function handleSelectDestination(candidateId: string): Promise<void> {
    if (!activeId) return
    const result = await selectDestination({ sessionId: activeId, candidateId })
    if (!result.ok) return setNotice(result.error.userHint)
    setD4(result.data)
    syncSessionStage(result.data)
    setNotice('目的地已确认，进入 STAGE-3 研究。')
  }

  async function handlePrepareResearch(): Promise<void> {
    if (!activeId) return
    const operationId = crypto.randomUUID()
    setD4OperationId(operationId)
    const result = await prepareResearch({ sessionId: activeId, operationId })
    setD4OperationId(null)
    if (!result.ok) return setNotice(result.error.userHint)
    setD4(result.data)
    await refreshD4(activeId)
    await refreshUsage(activeId)
    setNotice('研究清单已更新；请逐项处置并检查冲突。')
  }

  async function handlePrepareManualResearch(items: ManualResearchItem[]): Promise<boolean> {
    if (!activeId) return false
    setBusy(true)
    const result = await prepareManualResearch({ sessionId: activeId, items })
    setBusy(false)
    if (!result.ok) {
      setNotice(result.error.userHint)
      return false
    }
    setD4(result.data)
    await refreshD4(activeId)
    setNotice('人工清单已原子写入：USER_RESEARCH / VERIFIED_BY_USER；外部与模型调用均为 0。')
    return true
  }

  async function handlePreviewXhsRanking(): Promise<void> {
    if (!activeId) return
    const result = await previewXhsRanking(activeId)
    if (!result.ok) return setNotice(result.error.userHint)
    if (result.data.sessionId !== activeId) return
    setXhsRankingPreview(result.data)
    setNotice('30 帖研究计划已生成；预览阶段未调用任何来源或模型。请核对后再明确执行。')
  }

  async function handleExecuteXhsRanking(): Promise<void> {
    if (!activeId || !xhsRankingPreview || xhsRankingPreview.sessionId !== activeId) return
    const operationId = crypto.randomUUID()
    setD4OperationId(operationId)
    const result = await executeXhsRanking({
      sessionId: activeId,
      planId: xhsRankingPreview.planId,
      digest: xhsRankingPreview.digest,
      operationId
    })
    setD4OperationId(null)
    setXhsRankingPreview(null)
    if (!result.ok) return setNotice(result.error.userHint)
    setD4(result.data)
    await refreshD4(activeId)
    await refreshUsage(activeId)
    setNotice('30 帖研究与本地确定性排序已完成；结果仍是 UGC 未核验线索。')
  }

  async function handleCancelD4(): Promise<void> {
    if (!d4OperationId) return
    await cancelD4Operation(d4OperationId)
    setNotice('已请求取消当前 D4 来源任务。')
  }

  async function handlePreviewRoutes(): Promise<void> {
    if (!activeId) return
    const result = await previewMultiCityRoutes(activeId)
    if (!result.ok) return setNotice(result.error.userHint)
    if (result.data.sessionId !== activeId) return
    setRoutePreview(result.data)
    setNotice(
      `路线核验计划已生成：${result.data.totalExternalCalls} 次只读调用，预览阶段外部调用为 0。`
    )
  }

  async function handleExecuteRoutes(): Promise<void> {
    if (!activeId || !routePreview || routePreview.sessionId !== activeId) return
    const operationId = crypto.randomUUID()
    setRouteOperationId(operationId)
    const result = await executeMultiCityRoutes({
      sessionId: activeId,
      planId: routePreview.planId,
      digest: routePreview.digest,
      operationId
    })
    setRouteOperationId(null)
    setRoutePreview(null)
    if (!result.ok) return setNotice(result.error.userHint)
    if (result.data.sessionId !== activeId) return
    setRouteSnapshot(result.data)
    setNotice(
      result.data.blockingReasons.length === 0
        ? '路线候选已生成；请比较顺序、在途、体力、证据和昆明取舍后选择。'
        : '路线候选已生成，但关键交通证据仍有缺口，暂不能推进。'
    )
  }

  async function handleCancelRoutes(): Promise<void> {
    if (!routeOperationId) return
    await cancelMultiCityRouteOperation(routeOperationId)
    setNotice('已请求取消当前路线核验。')
  }

  async function handleSelectRoute(routeId: string): Promise<void> {
    if (!activeId || routeSnapshot?.sessionId !== activeId) return
    const result = await selectMultiCityRoute({ sessionId: activeId, routeId })
    if (!result.ok) return setNotice(result.error.userHint)
    if (result.data.sessionId !== activeId) return
    setRouteSnapshot(result.data)
    setRouteNodeSnapshot(null)
    setRouteNodePreview(null)
    setRouteNodeOperationId(null)
    setActiveRouteNodeId(null)
    setAutoSelectRouteNode(true)
    syncSessionStage(result.data)
    await refreshD4(activeId)
    setNotice('路线与住宿段日期已冻结，进入 STAGE-3；后续研究仍需逐项核验。')
  }

  async function handleApplyManualRouteLegEvidence(
    request: ManualRouteLegEvidenceRequest
  ): Promise<boolean> {
    if (!activeId || request.sessionId !== activeId || routeSnapshot?.sessionId !== activeId) {
      return false
    }
    const result = await applyManualRouteLegEvidence(request)
    if (!result.ok) {
      setNotice(result.error.userHint)
      return false
    }
    if (result.data.sessionId !== activeId) return false
    setRouteSnapshot(result.data)
    setNotice(
      result.data.blockingReasons.length === 0
        ? '人工交通证据已写入本地事件，路线已重新计算；外部调用 0，模型调用 0。'
        : '人工交通证据已写入本地事件并重新计算；仍有其他关键交通腿待补证；外部调用 0，模型调用 0。'
    )
    return true
  }

  function currentRouteNodeIdentity(): {
    sessionId: string
    routeId: string
    nodeId: string
  } | null {
    if (
      !activeId ||
      !selectedRoute ||
      !currentRouteNodeId ||
      routeNodeSnapshot?.sessionId !== activeId ||
      routeNodeSnapshot.selectedRouteId !== selectedRoute.routeId ||
      routeNodeSnapshot.currentScope.nodeId !== currentRouteNodeId
    ) {
      return null
    }
    return { sessionId: activeId, routeId: selectedRoute.routeId, nodeId: currentRouteNodeId }
  }

  async function refreshRouteNodeEvidence(sessionId: string): Promise<void> {
    const result = await listEvidence(sessionId)
    if (result.ok) setD4Claims(result.data)
  }

  async function handleSelectRouteNode(nodeId: string): Promise<void> {
    if (!selectedRoute?.nodes.some((node) => node.nodeId === nodeId)) return
    if (manualDraftDirty && !window.confirm('当前节点人工研究草稿尚未提交，仍要切换节点吗？')) {
      return
    }
    if (routeNodeOperationId) await cancelRouteNodeResearchOperation(routeNodeOperationId)
    setRouteNodeSnapshot(null)
    setRouteNodePreview(null)
    setRouteNodeOperationId(null)
    setManualDraftDirty(false)
    setAutoSelectRouteNode(false)
    setActiveRouteNodeId(nodeId)
  }

  async function handlePreviewRouteNode(mode: RouteNodeResearchMode): Promise<void> {
    const identity = currentRouteNodeIdentity()
    if (!identity) return
    const result = await previewRouteNodeResearch({ ...identity, mode })
    if (!result.ok) return setNotice(result.error.userHint)
    if (
      result.data.sessionId !== identity.sessionId ||
      result.data.routeId !== identity.routeId ||
      result.data.nodeId !== identity.nodeId
    ) {
      return
    }
    setRouteNodePreview(result.data)
    setNotice(
      `已生成 ${result.data.scope.city} 节点零调用预览：外部 ${result.data.totalExternalCalls}，模型 ${result.data.totalModelCalls}。`
    )
  }

  async function handleExecuteRouteNode(): Promise<void> {
    const identity = currentRouteNodeIdentity()
    if (
      !identity ||
      !routeNodePreview ||
      routeNodePreview.sessionId !== identity.sessionId ||
      routeNodePreview.routeId !== identity.routeId ||
      routeNodePreview.nodeId !== identity.nodeId
    ) {
      return
    }
    const operationId = crypto.randomUUID()
    setRouteNodeOperationId(operationId)
    const result = await executeRouteNodeResearch({
      ...identity,
      planId: routeNodePreview.planId,
      digest: routeNodePreview.digest,
      operationId
    })
    setRouteNodeOperationId(null)
    setRouteNodePreview(null)
    if (!result.ok) return setNotice(result.error.userHint)
    if (
      result.data.sessionId !== identity.sessionId ||
      result.data.selectedRouteId !== identity.routeId ||
      result.data.currentScope.nodeId !== identity.nodeId
    ) {
      return
    }
    setRouteNodeSnapshot(result.data)
    await Promise.all([
      refreshRouteNodeEvidence(identity.sessionId),
      refreshUsage(identity.sessionId)
    ])
    setNotice('当前路线节点研究已完成；请逐项处置、解决冲突并确认。')
  }

  async function handlePrepareManualRouteNode(items: ManualResearchItem[]): Promise<boolean> {
    const identity = currentRouteNodeIdentity()
    if (!identity) return false
    setBusy(true)
    const result = await prepareManualRouteNodeResearch({ ...identity, items })
    setBusy(false)
    if (!result.ok) {
      setNotice(result.error.userHint)
      return false
    }
    if (
      result.data.sessionId !== identity.sessionId ||
      result.data.selectedRouteId !== identity.routeId ||
      result.data.currentScope.nodeId !== identity.nodeId
    ) {
      return false
    }
    setRouteNodeSnapshot(result.data)
    await refreshRouteNodeEvidence(identity.sessionId)
    setNotice('人工清单仅写入当前节点；external/model calls=0。')
    return true
  }

  async function handleRouteNodePaste(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const identity = currentRouteNodeIdentity()
    if (!identity) return
    const form = event.currentTarget
    const data = new FormData(form)
    const text = String(data.get('clue')).trim()
    const sourceUrlValue = String(data.get('sourceUrl')).trim()
    if (!text) return
    const result = await addRouteNodeUserPaste({
      ...identity,
      text,
      sourceUrl: sourceUrlValue || null
    })
    if (!result.ok) return setNotice(result.error.userHint)
    if (
      result.data.scope?.kind !== 'ROUTE_NODE' ||
      result.data.scope.routeId !== identity.routeId ||
      result.data.scope.nodeId !== identity.nodeId
    ) {
      return
    }
    form.reset()
    setD4Claims((current) => [
      ...current.filter((claim) => claim.claimId !== result.data.claimId),
      result.data
    ])
    setNotice('线索已保存到当前路线节点，仍为 USER_PASTE / UNVERIFIED。')
  }

  async function handleRouteNodeDisposition(
    entityId: string,
    disposition: LeadDisposition
  ): Promise<void> {
    const identity = currentRouteNodeIdentity()
    if (!identity) return
    const result = await setRouteNodeResearchDisposition({ ...identity, entityId, disposition })
    if (!result.ok) return setNotice(result.error.userHint)
    setRouteNodeSnapshot(result.data)
    setNotice('当前节点的线索处置已记录。')
  }

  async function handleRouteNodeConflict(
    subject: string,
    predicate: string,
    selectedClaimId: string | null
  ): Promise<void> {
    const identity = currentRouteNodeIdentity()
    if (!identity) return
    const result = await resolveRouteNodeResearchConflict({
      ...identity,
      subject,
      predicate,
      resolution: selectedClaimId ? 'CLAIM_SELECTED' : 'UNKNOWN',
      selectedClaimId
    })
    if (!result.ok) return setNotice(result.error.userHint)
    setRouteNodeSnapshot(result.data)
    setNotice('当前节点的冲突裁决已记录。')
  }

  async function handleConfirmRouteNode(): Promise<void> {
    const identity = currentRouteNodeIdentity()
    if (!identity) return
    if (manualDraftDirty && !window.confirm('当前节点人工研究草稿尚未提交，仍要确认现有清单吗？')) {
      return
    }
    const result = await confirmRouteNodeResearch(identity)
    if (!result.ok) return setNotice(result.error.userHint)
    setRouteNodeSnapshot(result.data)
    setManualDraftDirty(false)
    syncSessionStage(result.data)
    if (result.data.routeResearchComplete) {
      setNotice('所有必需路线节点均已确认，已原子进入 STAGE-4。')
      return
    }
    if (result.data.nextRequiredNodeId) {
      setRouteNodeSnapshot(null)
      setRouteNodePreview(null)
      setAutoSelectRouteNode(false)
      setActiveRouteNodeId(result.data.nextRequiredNodeId)
    }
    setNotice('当前节点已确认，已切换到下一个未确认必需节点。')
  }

  async function handleCancelRouteNode(): Promise<void> {
    if (!routeNodeOperationId) return
    await cancelRouteNodeResearchOperation(routeNodeOperationId)
    setRouteNodeOperationId(null)
    setNotice('已请求取消当前节点来源任务。')
  }

  async function handleUserPaste(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!activeId) return
    const form = event.currentTarget
    const data = new FormData(form)
    const text = String(data.get('clue')).trim()
    const sourceUrlValue = String(data.get('sourceUrl')).trim()
    if (!text) return
    const result = await addUserPaste({
      sessionId: activeId,
      text,
      sourceUrl: sourceUrlValue || null
    })
    if (!result.ok) return setNotice(result.error.userHint)
    form.reset()
    setD4Claims((current) => [
      ...current.filter((claim) => claim.claimId !== result.data.claimId),
      result.data
    ])
    setNotice('线索已作为 USER_PASTE / UNVERIFIED 保存，不会直接支撑推荐。')
  }

  async function handleDisposition(entityId: string, disposition: LeadDisposition): Promise<void> {
    if (!activeId) return
    const result = await setResearchDisposition({ sessionId: activeId, entityId, disposition })
    if (!result.ok) return setNotice(result.error.userHint)
    setD4(result.data)
    setNotice('线索处置已记录为用户决策。')
  }

  async function handleConflict(
    subject: string,
    predicate: string,
    selectedClaimId: string | null
  ): Promise<void> {
    if (!activeId) return
    const result = await resolveResearchConflict({
      sessionId: activeId,
      subject,
      predicate,
      resolution: selectedClaimId ? 'CLAIM_SELECTED' : 'UNKNOWN',
      selectedClaimId
    })
    if (!result.ok) return setNotice(result.error.userHint)
    setD4(result.data)
    setNotice('冲突裁决已记录；原始冲突证据仍会保留。')
  }

  async function handleConfirmResearch(): Promise<void> {
    if (!activeId) return
    if (
      manualDraftDirty &&
      !window.confirm('当前人工研究草稿尚未提交，仍要确认现有研究清单并离开 STAGE-3 吗？')
    ) {
      return
    }
    const result = await confirmResearch({ sessionId: activeId })
    if (!result.ok) return setNotice(result.error.userHint)
    setD4(result.data)
    syncSessionStage(result.data)
    setNotice('研究清单已确认，进入 STAGE-4。')
  }

  return (
    <section className="chat-layout">
      <aside className="session-sidebar">
        <button className="primary-button" type="button" onClick={() => void handleCreate()}>
          ＋ 新旅行
        </button>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              className={session.sessionId === activeId ? 'session-item active' : 'session-item'}
              type="button"
              key={session.sessionId}
              onClick={() => {
                if (
                  manualDraftDirty &&
                  session.sessionId !== activeId &&
                  !window.confirm('当前人工研究草稿尚未提交，仍要切换会话吗？')
                ) {
                  return
                }
                setXhsRankingPreview(null)
                setRouteSnapshot(null)
                setRoutePreview(null)
                setRouteOperationId(null)
                setRouteNodeSnapshot(null)
                setRouteNodePreview(null)
                setRouteNodeOperationId(null)
                setActiveRouteNodeId(null)
                setAutoSelectRouteNode(true)
                setManualDraftDirty(false)
                setActiveId(session.sessionId)
              }}
            >
              <strong>{session.title ?? '未命名旅行'}</strong>
              <span>{session.stage}</span>
            </button>
          ))}
        </div>
      </aside>
      <div className="chat-panel">
        <header className="trip-workspace-heading">
          <div>
            <h2>{active?.title ?? '开始一段新旅行'}</h2>
            {routeSnapshot?.sessionId === activeId && routeSnapshot.goal ? (
              <p>
                {routeSnapshot.goal.startDate} — {routeSnapshot.goal.endDate} ·{' '}
                {routeSnapshot.goal.totalDays}天{routeSnapshot.goal.totalNights}晚
              </p>
            ) : (
              <p>把旅行偏好，变成有依据的选择。</p>
            )}
          </div>
          <span className="trip-stage">
            {active
              ? {
                  STAGE_1: '需求确认',
                  STAGE_2: '路线选择',
                  STAGE_3: '目的地研究',
                  STAGE_4: '日程安排',
                  STAGE_5: '出发准备',
                  DONE: '已完成'
                }[active.stage]
              : '旅行规划'}
          </span>
        </header>
        {linked.length > 0 && (
          <div className="linked-strip">
            关联行程：{linked.map((item) => `#${item.splitIndex} ${item.title}`).join(' · ')}
          </div>
        )}
        <div className="turn-list" aria-live="polite">
          {turns.length === 0 && (!active || active.stage === 'STAGE_1') && (
            <div className="empty-chat">
              <span>出发前</span>
              <h2>先讲清楚旅行，再开始规划</h2>
              <p>系统一次只问一个主要问题，并在五轮内形成可编辑确认卡。</p>
            </div>
          )}
          {turns.map((turn, index) => (
            <div className={`turn turn-${turn.role}`} key={`${turn.role}-${index}`}>
              {turn.text}
            </div>
          ))}
          {outcome?.kind === 'CONFIRMATION' && (
            <ConfirmationCard
              outcome={outcome}
              busy={busy}
              onConfirm={handleConfirm}
              onCorrection={handleCorrection}
            />
          )}
          {comparison && <ComparisonCard comparison={comparison} onChoose={handleEnvelope} />}
          {active?.stage === 'STAGE_2' && !routeSnapshot?.goal && (
            <DestinationCandidatesCard
              snapshot={d4?.sessionId === activeId ? d4 : null}
              operationId={d4OperationId}
              busy={busy}
              onGenerate={handleGenerateDestinations}
              onConfirmFixed={handleConfirmFixedDestination}
              onSelect={handleSelectDestination}
              onCancel={handleCancelD4}
            />
          )}
          {routeSnapshot?.sessionId === activeId &&
            routeSnapshot.goal &&
            (active?.stage === 'STAGE_2' || routeSnapshot.selectedRouteId) && (
              <details className="selected-route-details" open={!routeSnapshot.selectedRouteId}>
                <summary>
                  {routeSnapshot.selectedRouteId ? '查看已选路线与交通证据' : '比较路线方案'}
                </summary>
                <ItineraryRouteCard
                  snapshot={routeSnapshot}
                  preview={routePreview?.sessionId === activeId ? routePreview : null}
                  operationId={routeOperationId}
                  onPreview={handlePreviewRoutes}
                  onExecute={handleExecuteRoutes}
                  onCancel={handleCancelRoutes}
                  onSelect={handleSelectRoute}
                  onApplyManualEvidence={handleApplyManualRouteLegEvidence}
                  onManualDirtyChange={setManualDraftDirty}
                />
              </details>
            )}
          {active?.stage === 'STAGE_3' && !selectedRoute && d4?.sessionId === activeId && (
            <ResearchChecklistCard
              snapshot={d4}
              claims={d4Claims}
              operationId={d4OperationId}
              onPrepare={handlePrepareResearch}
              rankingPreview={xhsRankingPreview}
              onPreviewRanking={handlePreviewXhsRanking}
              onExecuteRanking={handleExecuteXhsRanking}
              onCancel={handleCancelD4}
              onPaste={handleUserPaste}
              onPrepareManual={handlePrepareManualResearch}
              onManualDirtyChange={setManualDraftDirty}
              onDisposition={handleDisposition}
              onConflict={handleConflict}
              onConfirm={handleConfirmResearch}
            />
          )}
          {(active?.stage === 'STAGE_3' || active?.stage === 'STAGE_4') &&
            selectedRoute &&
            routeNodeSnapshot?.sessionId === activeId &&
            routeNodeSnapshot.selectedRouteId === selectedRoute.routeId &&
            routeNodeSnapshot.currentScope.nodeId === currentRouteNodeId && (
              <RouteNodeResearchCard
                key={`${activeId}:${selectedRoute.routeId}:${currentRouteNodeId}`}
                snapshot={routeNodeSnapshot}
                nodes={selectedRoute.nodes}
                goal={routeSnapshot?.sessionId === activeId ? routeSnapshot.goal : null}
                claims={d4Claims.filter(
                  (claim) =>
                    claim.scope?.kind === 'ROUTE_NODE' &&
                    claim.scope.routeId === selectedRoute.routeId &&
                    claim.scope.nodeId === currentRouteNodeId
                )}
                preview={
                  routeNodePreview?.sessionId === activeId &&
                  routeNodePreview.routeId === selectedRoute.routeId &&
                  routeNodePreview.nodeId === currentRouteNodeId
                    ? routeNodePreview
                    : null
                }
                operationId={routeNodeOperationId}
                onSelectNode={handleSelectRouteNode}
                onPreview={handlePreviewRouteNode}
                onExecute={handleExecuteRouteNode}
                onCancel={handleCancelRouteNode}
                onPaste={handleRouteNodePaste}
                onPrepareManual={handlePrepareManualRouteNode}
                onManualDirtyChange={setManualDraftDirty}
                onDisposition={handleRouteNodeDisposition}
                onConflict={handleRouteNodeConflict}
                onConfirm={handleConfirmRouteNode}
              />
            )}
        </div>
        <div className="usage-strip">
          {usage.length === 0
            ? '尚无模型用量'
            : usage
                .map(
                  (item) =>
                    `${item.provider} · ${item.tokensIn + item.tokensOut} tokens · ${item.costMinor === null ? '费率未知' : `${item.costMinor} ${item.currency}`}`
                )
                .join('  |  ')}
        </div>
        <form className="composer" onSubmit={(event) => void handleSubmit(event)}>
          <textarea
            aria-label="补充旅行信息"
            name="message"
            rows={2}
            disabled={!activeId || busy}
            placeholder={activeId ? '回答当前问题，或补充已知信息…' : '请先新建旅行'}
          />
          <button className="primary-button" type="submit" disabled={!activeId || busy}>
            {busy ? '处理中…' : '发送'}
          </button>
        </form>
        <p className="system-message" role="status">
          {notice}
        </p>
      </div>
    </section>
  )
}

export function DestinationCandidatesCard({
  snapshot,
  operationId,
  busy,
  onGenerate,
  onConfirmFixed,
  onSelect,
  onCancel
}: {
  snapshot: D4Snapshot | null
  operationId: string | null
  busy: boolean
  onGenerate(): Promise<void>
  onConfirmFixed(city: string): Promise<void>
  onSelect(candidateId: string): Promise<void>
  onCancel(): Promise<void>
}): React.JSX.Element {
  if (!snapshot) {
    return (
      <article className="decision-card d4-card" aria-busy="true">
        <p className="card-kicker">STAGE-2 · 目的地收敛</p>
        <h3>正在读取目的地状态…</h3>
        <p className="card-note">状态确认前不会显示固定城市确认或候选生成操作。</p>
      </article>
    )
  }
  const candidates = snapshot.destinationCandidates
  const fixedDestinationCity = snapshot.fixedDestinationCity ?? null
  return (
    <article className="decision-card d4-card">
      <p className="card-kicker">STAGE-2 · 目的地收敛</p>
      {fixedDestinationCity ? (
        <>
          <h3>目的地已明确：{fixedDestinationCity}</h3>
          <p className="card-note">进入研究前仍需要你的显式确认；系统不会自动推进阶段。</p>
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => void onConfirmFixed(fixedDestinationCity)}
          >
            {busy ? '确认中…' : `确认 ${fixedDestinationCity}，进入研究`}
          </button>
        </>
      ) : (
        <>
          <h3>从有来源证据中选择一个城市</h3>
          <p className="card-note">
            系统只生成候选，不会替你自动选择。Claim ID 可在 EVIDENCE 中核对。
          </p>
          {candidates.length === 0 ? (
            <p className="empty-state">
              尚无候选。请先在 EVIDENCE 添加目的地证据，再生成 2–4 个候选。
            </p>
          ) : (
            <div className="candidate-grid">
              {candidates.map((candidate) => (
                <section className="candidate-option" key={candidate.id}>
                  <h4>{candidate.city}</h4>
                  <p>
                    <strong>适配：</strong>
                    {candidate.fitReasons.join('；')}
                  </p>
                  <p>
                    <strong>代价：</strong>
                    {candidate.tradeoffs.join('；')}
                  </p>
                  <p>
                    <strong>风险：</strong>
                    {candidate.risks.length ? candidate.risks.join('；') : '未发现明确风险'}
                  </p>
                  <details>
                    <summary>查看支撑 Claim（{candidate.claimIds.length}）</summary>
                    <ul className="claim-id-list">
                      {candidate.claimIds.map((claimId) => (
                        <li key={claimId}>
                          <code>{claimId}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void onSelect(candidate.id)}
                  >
                    选择 {candidate.city}
                  </button>
                </section>
              ))}
            </div>
          )}
          <div className="source-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={Boolean(operationId)}
              onClick={() => void onGenerate()}
            >
              {operationId ? '生成中…' : candidates.length ? '重新生成候选' : '生成候选'}
            </button>
            {operationId ? (
              <button className="secondary-button" type="button" onClick={() => void onCancel()}>
                取消来源任务
              </button>
            ) : null}
          </div>
        </>
      )}
    </article>
  )
}

export function ResearchChecklistCard({
  snapshot,
  claims,
  operationId,
  onPrepare,
  rankingPreview,
  onPreviewRanking,
  onExecuteRanking,
  onCancel,
  onPaste,
  onPrepareManual,
  onManualDirtyChange,
  onDisposition,
  onConflict,
  onConfirm
}: {
  snapshot: D4Snapshot
  claims: EvidenceClaim[]
  operationId: string | null
  onPrepare(): Promise<void>
  rankingPreview: XhsRankingPreview | null
  onPreviewRanking(): Promise<void>
  onExecuteRanking(): Promise<void>
  onCancel(): Promise<void>
  onPaste(event: React.FormEvent<HTMLFormElement>): Promise<void>
  onPrepareManual?(items: ManualResearchItem[]): Promise<boolean>
  onManualDirtyChange?(dirty: boolean): void
  onDisposition(entityId: string, disposition: LeadDisposition): Promise<void>
  onConflict(subject: string, predicate: string, selectedClaimId: string | null): Promise<void>
  onConfirm(): Promise<void>
}): React.JSX.Element {
  const xhsSignals = xiaohongshuSignals(claims)
  return (
    <article className="decision-card d4-card">
      <p className="card-kicker">STAGE-3 · 研究与证据确认</p>
      <h3>景点、体验与餐饮线索</h3>
      <form className="clue-form" onSubmit={(event) => void onPaste(event)}>
        <label>
          粘贴攻略或截图文字（只作为未核验线索）
          <textarea name="clue" rows={3} maxLength={20000} required />
        </label>
        <label>
          来源 HTTPS URL（可选）
          <input name="sourceUrl" type="url" placeholder="https://…" />
        </label>
        <button className="secondary-button" type="submit">
          保存为 USER_PASTE
        </button>
      </form>
      {onPrepareManual && onManualDirtyChange ? (
        <ManualResearchEditor
          key={snapshot.sessionId}
          sessionId={snapshot.sessionId}
          pasteClaims={claims.filter((claim) => claim.sourceId === 'USER_PASTE')}
          onSubmit={onPrepareManual}
          onDirtyChange={onManualDirtyChange}
        />
      ) : null}
      {snapshot.manualResearchSummary ? (
        <p className="local-only-note">
          人工清单：{snapshot.manualResearchSummary.itemCount} 项 · 关联 USER_PASTE{' '}
          {snapshot.manualResearchSummary.linkedPasteCount} 项 · USER_CONFIRMED · external/model
          calls=0
        </p>
      ) : null}
      <div className="source-actions">
        <button
          className="primary-button"
          type="button"
          disabled={Boolean(operationId)}
          onClick={() => void onPrepare()}
        >
          {operationId
            ? '研究中…'
            : snapshot.researchEntities.length
              ? '重新研究并核验'
              : '开始有界研究'}
        </button>
        {operationId ? (
          <button className="secondary-button" type="button" onClick={() => void onCancel()}>
            取消来源任务
          </button>
        ) : null}
      </div>
      <section className="research-entity" aria-label="小红书 30 帖研究计划">
        <div className="source-card-title">
          <h4>小红书 30 帖景点排序</h4>
          <span className="status status-unverified">UGC · UNVERIFIED</span>
        </div>
        <p className="card-note">
          固定 4 次搜索 → 推荐/避雷各 15 帖 → 30 次串行详情 → 6 次 EXTRACTION → 1 次 REVIEW；
          全程零重试、零回退，评论分页关闭。
        </p>
        {!rankingPreview ? (
          <button
            className="secondary-button"
            type="button"
            disabled={Boolean(operationId)}
            onClick={() => void onPreviewRanking()}
          >
            预览 30 帖研究计划（零外部调用）
          </button>
        ) : (
          <div className="conflict-box">
            <p>目的地：{rankingPreview.destinationCity} · 来源读取 4+30 · 模型调用 6+1 · 重试 0</p>
            <p>
              工具顺序：search_feeds×4 → get_feed_detail×30；每篇正文最多{' '}
              {rankingPreview.detailCharacterLimit.toLocaleString()} 字符，load_all_comments=false。
            </p>
            <p>
              filters：{rankingPreview.filters.sort_by} / {rankingPreview.filters.note_type} /{' '}
              {rankingPreview.filters.publish_time} / {rankingPreview.filters.search_scope} /{' '}
              {rankingPreview.filters.location}
            </p>
            <ol className="claim-id-list">
              {rankingPreview.queries.map((query) => (
                <li key={query}>{query}</li>
              ))}
            </ol>
            <p>
              EXTRACTION：{rankingPreview.extractionRoute.provider} /{' '}
              {rankingPreview.extractionRoute.model}；REVIEW：{rankingPreview.reviewRoute.provider}{' '}
              / {rankingPreview.reviewRoute.model}
            </p>
            <p>
              <code>{rankingPreview.digest}</code>
            </p>
            <p>
              该一次性计划于 {rankingPreview.expiresAt} 过期；状态或模型路由变化后必须重新预览。
            </p>
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(operationId)}
              onClick={() => void onExecuteRanking()}
            >
              {operationId ? '严格执行中…' : '明确执行此 30 帖研究计划'}
            </button>
          </div>
        )}
      </section>
      {snapshot.sourceResearchFailures.map((failure) => (
        <p
          className="blocking-message"
          key={`${failure.sourceId}:${failure.queryKind ?? 'DEFAULT'}`}
        >
          {failure.sourceId}
          {failure.queryKind ? ` · ${xhsQueryKindLabel(failure.queryKind)}` : ''} 失败：
          {failure.capabilityImpact}。手工替代：{failure.manualAlternative}
        </p>
      ))}
      {xhsSignals.positive.length > 0 || xhsSignals.negative.length > 0 ? (
        <section className="research-entity" aria-label="小红书正负向交叉验证">
          <div className="source-card-title">
            <h4>小红书正负向交叉验证</h4>
            <span className="status status-unverified">UGC · UNVERIFIED</span>
          </div>
          <p className="card-note">
            正向地点词与“避雷 + 地点”分别检索；标签只表示查询方向，不代表内容已被判定为正面或负面。
          </p>
          <XhsSignalGroup title="小红书正向检索结果" signals={xhsSignals.positive} />
          <XhsSignalGroup title="小红书避雷检索结果" signals={xhsSignals.negative} />
        </section>
      ) : null}
      {snapshot.researchEntities.length === 0 ? (
        <p className="empty-state">
          尚无可确认的研究实体。来源失败或只有 USER_PASTE 时不会生成事实。
        </p>
      ) : (
        <div className="research-list">
          {snapshot.researchEntities.map((entity) => (
            <ResearchEntityCard
              key={entity.entityId}
              entity={entity}
              claims={claims}
              snapshot={snapshot}
              onDisposition={onDisposition}
              onConflict={onConflict}
            />
          ))}
        </div>
      )}
      {(snapshot.attractionRankings ?? []).length > 0 ? (
        <section className="research-entity" aria-label="小红书景点确定性排序">
          <div className="source-card-title">
            <h4>景点确定性排序</h4>
            <span className="status status-unverified">UGC 未核验</span>
          </div>
          <p className="card-note">
            score = 3×推荐帖数 − 4×避雷帖数 + 家庭适配；避雷只扣分，不自动删除。
          </p>
          <ol className="research-list">
            {(snapshot.attractionRankings ?? []).map((ranking) => (
              <li className="candidate-option" key={ranking.entityId}>
                <h4>
                  #{ranking.rank} {ranking.subject} · {ranking.score} 分
                </h4>
                <p>
                  3×{ranking.recommendPostCount} − 4×{ranking.avoidPostCount} +{' '}
                  {ranking.familyFitAdjustment}（{ranking.familyFit}）
                </p>
                <p>
                  家庭适配：
                  {ranking.familyFitReasons.length
                    ? ranking.familyFitReasons.join('；')
                    : 'UNKNOWN'}
                </p>
                {ranking.avoidanceEvidence.length > 0 ? (
                  <details>
                    <summary>避雷原因与原帖（{ranking.avoidanceEvidence.length}）</summary>
                    <ul className="claim-id-list">
                      {ranking.avoidanceEvidence.map((evidence) => (
                        <li key={evidence.sourceRef}>
                          {evidence.reason} · <code>{evidence.sourceRef}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <p>避雷原因：本批未抽取到；不代表没有风险。</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      <button
        className="primary-button"
        type="button"
        disabled={snapshot.researchEntities.length === 0 || Boolean(operationId)}
        onClick={() => void onConfirm()}
      >
        明确确认整份清单并进入 STAGE-4
      </button>
    </article>
  )
}

interface XhsSignalView {
  claimId: string
  title: string
  sourceRef: string
  verificationStatus: EvidenceClaim['verificationStatus']
}

function XhsSignalGroup({
  title,
  signals
}: {
  title: string
  signals: XhsSignalView[]
}): React.JSX.Element {
  return (
    <details open>
      <summary>
        {title}（{signals.length}）
      </summary>
      {signals.length === 0 ? (
        <p className="empty-state">本轮没有保留可追溯笔记。</p>
      ) : (
        <ul className="claim-id-list">
          {signals.map((signal) => (
            <li key={signal.claimId}>
              <strong>{signal.title}</strong> · {signal.verificationStatus}
              <br />
              <code>{signal.sourceRef}</code>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

function xiaohongshuSignals(claims: EvidenceClaim[]): {
  positive: XhsSignalView[]
  negative: XhsSignalView[]
} {
  const positive: XhsSignalView[] = []
  const negative: XhsSignalView[] = []
  for (const claim of claims) {
    if (claim.sourceId !== 'SRC_XHS') continue
    const value = isRecord(claim.value) ? claim.value : {}
    const queryKind = value.queryKind
    if (queryKind !== 'POSITIVE_LOCATION' && queryKind !== 'NEGATIVE_AVOIDANCE') continue
    const signal = {
      claimId: claim.claimId,
      title:
        typeof value.title === 'string' && value.title.trim() ? value.title.trim() : claim.subject,
      sourceRef: claim.sourceRef,
      verificationStatus: claim.verificationStatus
    }
    if (queryKind === 'POSITIVE_LOCATION') positive.push(signal)
    else negative.push(signal)
  }
  return { positive, negative }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function xhsQueryKindLabel(kind: 'POSITIVE_LOCATION' | 'NEGATIVE_AVOIDANCE'): string {
  return kind === 'POSITIVE_LOCATION' ? '正向地点检索' : '避雷检索'
}

function ResearchEntityCard({
  entity,
  claims,
  snapshot,
  onDisposition,
  onConflict
}: {
  entity: ResearchEntity
  claims: EvidenceClaim[]
  snapshot: D4Snapshot
  onDisposition(entityId: string, disposition: LeadDisposition): Promise<void>
  onConflict(subject: string, predicate: string, selectedClaimId: string | null): Promise<void>
}): React.JSX.Element {
  const groups = conflictGroups(entity, claims)
  const manual = manualEntityMetadata(entity, claims)
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
      {manual ? (
        <div className="manual-verification-summary">
          <strong>USER_RESEARCH · VERIFIED_BY_USER（用户核验，非独立来源佐证）</strong>
          <p>来源：{manual.sourceLabel}</p>
          {manual.sourceUrl ? (
            <p>
              URL：<code>{manual.sourceUrl}</code>
            </p>
          ) : null}
          <p>摘要：{manual.summary}</p>
          {manual.sourceClaimId ? (
            <p>
              关联原始线索：<code>{manual.sourceClaimId}</code>
            </p>
          ) : null}
          {manual.hardAnchors.length ? (
            <ul className="claim-id-list">
              {manual.hardAnchors.map((anchor) => (
                <li key={anchor.kind}>
                  {hardAnchorKindLabel(anchor.kind)}：{anchor.status}
                  {anchor.value ? ` · ${anchor.value}` : ''} · 最近核验 {anchor.checkedAt}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {entity.aliases.length ? <p>别名：{entity.aliases.join('、')}</p> : null}
      {entity.blockingReasons.map((reason) => (
        <p className="blocking-message" key={reason}>
          {reason}
        </p>
      ))}
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
      {groups.map(([predicate, conflictClaims]) => {
        const resolution = snapshot.conflictResolutions.find(
          (item) => item.subject === entity.canonicalSubject && item.predicate === predicate
        )
        return (
          <details className="conflict-box" key={predicate} open>
            <summary>
              冲突：{predicate}（{resolution ? `已裁决 ${resolution.resolution}` : '尚未裁决'}）
            </summary>
            {conflictClaims.map((claim) => (
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

interface ManualEntityMetadata {
  sourceLabel: string
  sourceUrl: string | null
  sourceClaimId: string | null
  summary: string
  hardAnchors: Array<{
    kind: string
    status: string
    value: string | null
    checkedAt: string
  }>
}

function manualEntityMetadata(
  entity: ResearchEntity,
  claims: EvidenceClaim[]
): ManualEntityMetadata | null {
  const related = claims.filter(
    (claim) => claim.sourceId === 'USER_RESEARCH' && entity.claimIds.includes(claim.claimId)
  )
  const summaryClaim = related.find((claim) => claim.predicate === 'manualResearchSummary')
  if (!summaryClaim || !isRecord(summaryClaim.value)) return null
  const sourceLabel = summaryClaim.value.sourceLabel
  const summary = summaryClaim.value.summary
  if (typeof sourceLabel !== 'string' || typeof summary !== 'string') return null
  return {
    sourceLabel,
    sourceUrl:
      typeof summaryClaim.value.sourceUrl === 'string' ? summaryClaim.value.sourceUrl : null,
    sourceClaimId:
      typeof summaryClaim.value.sourceClaimId === 'string'
        ? summaryClaim.value.sourceClaimId
        : null,
    summary,
    hardAnchors: related.flatMap((claim) => {
      if (!isRecord(claim.value)) return []
      const { kind, status, value, checkedAt } = claim.value
      if (typeof kind !== 'string' || typeof status !== 'string' || typeof checkedAt !== 'string') {
        return []
      }
      return [
        {
          kind,
          status,
          value: typeof value === 'string' ? value : null,
          checkedAt
        }
      ]
    })
  }
}

function hardAnchorKindLabel(kind: string): string {
  if (kind === 'OPENING_HOURS') return '开放时间'
  if (kind === 'CLOSURE_SCHEDULE') return '闭园安排'
  if (kind === 'RESERVATION_REQUIREMENT') return '预约要求'
  return kind
}

function conflictGroups(
  entity: ResearchEntity,
  claims: EvidenceClaim[]
): Array<[string, EvidenceClaim[]]> {
  const unresolved = new Set(entity.unresolvedConflictClaimIds)
  const groups = new Map<string, EvidenceClaim[]>()
  for (const claim of claims) {
    if (!unresolved.has(claim.claimId)) continue
    const group = groups.get(claim.predicate) ?? []
    group.push(claim)
    groups.set(claim.predicate, group)
  }
  return [...groups.entries()]
}

function ConfirmationCard({
  outcome,
  busy,
  onConfirm,
  onCorrection
}: {
  outcome: Extract<ChatTurnOutcome, { kind: 'CONFIRMATION' }>
  busy: boolean
  onConfirm(): Promise<void>
  onCorrection(event: React.FormEvent<HTMLFormElement>, basics: TravelBasics): Promise<void>
}): React.JSX.Element {
  const { basics } = outcome.card
  return (
    <article className="decision-card">
      <p className="card-kicker">基础信息确认</p>
      <h3>
        {basics.itineraryIntent?.kind === 'MULTI_CITY_ROUTE'
          ? (basics.originGatewayCity ?? '待补出发网关城市')
          : basics.originCities.join('、')}{' '}
        →{' '}
        {basics.itineraryIntent?.kind === 'MULTI_CITY_ROUTE'
          ? `${basics.itineraryIntent.regionGoal}（多城市串联）`
          : basics.destinationCities.length > 0
            ? basics.destinationCities.join('、')
            : `待筛选（${basics.destinationIntent?.themes.join('、') || '模糊意向'}）`}
      </h3>
      {basics.itineraryIntent?.kind === 'MULTI_CITY_ROUTE' ? (
        <>
          <p className="route-goal-confirmation">
            必去：
            {basics.itineraryIntent.mandatoryPlaces
              .map((place) => `${place.displayName}（${place.nodeCity}）`)
              .join('、')}
            。城市顺序不是输入事实，将由交通、停留与风险证据综合推荐。
          </p>
          {!basics.originGatewayCity ? (
            <p className="blocking-message">生成跨城路线前必须明确一个出发网关城市。</p>
          ) : null}
        </>
      ) : null}
      <form className="correction-form" onSubmit={(event) => void onCorrection(event, basics)}>
        {basics.itineraryIntent?.kind === 'MULTI_CITY_ROUTE' ? (
          <>
            <label>
              出发网关城市（用于城际路线）
              <input
                name="originGatewayCity"
                defaultValue={basics.originGatewayCity ?? ''}
                required
              />
            </label>
            <label>
              具体出发点（可选，仅用于本地展示）
              <input name="originPlaceLabel" defaultValue={basics.originPlaceLabel ?? ''} />
            </label>
          </>
        ) : (
          <label>
            出发城市
            <input name="origins" defaultValue={basics.originCities.join('，')} />
          </label>
        )}
        <label>
          {basics.itineraryIntent?.kind === 'MULTI_CITY_ROUTE' ? '必去节点城市（无序）' : '目的地'}
          <input name="destinations" defaultValue={basics.destinationCities.join('，')} />
        </label>
        <label>
          目标预算（元）
          <input name="budget" type="number" defaultValue={basics.budget.targetMinor / 100} />
        </label>
        <label>
          旅行强度
          <select name="intensity" defaultValue={basics.intensity}>
            <option value="RELAXED">轻松</option>
            <option value="BALANCED">均衡</option>
            <option value="INTENSIVE">紧凑</option>
          </select>
        </label>
        <button className="secondary-button" type="submit">
          更新字段
        </button>
      </form>
      <p className="card-note">
        日期：
        {basics.dates.kind === 'FIXED'
          ? `${basics.dates.startDate} 至 ${basics.dates.endDate}`
          : `${basics.dates.month} · ${basics.dates.durationDays} 天`}{' '}
        · 高峰状态：{outcome.card.peakCalendarStatus}
      </p>
      <button
        className="primary-button"
        type="button"
        disabled={busy}
        onClick={() => void onConfirm()}
      >
        明确确认并进入 STAGE-2
      </button>
    </article>
  )
}

function ComparisonCard({
  comparison,
  onChoose
}: {
  comparison: EnvelopeComparison
  onChoose(decision: 'SPLIT' | 'ADJUST'): Promise<void>
}): React.JSX.Element {
  return (
    <article className="decision-card warning-card">
      <p className="card-kicker">超出 M0 能力边界</p>
      {comparison.assessment.violations.map((violation) => (
        <p className="violation" key={violation.dimension}>
          {violation.message}
        </p>
      ))}
      <div className="option-grid">
        {comparison.options.map((option) => (
          <section key={option.id}>
            <h4>{option.id === 'SPLIT' ? '拆成关联会话' : '缩小到包络内'}</h4>
            <dl>
              <dt>能拿到</dt>
              <dd>{option.gains}</dd>
              <dt>拿不到</dt>
              <dd>{option.losses}</dd>
              <dt>手工承担</dt>
              <dd>{option.manualBurden}</dd>
              <dt>质量差异</dt>
              <dd>{option.qualityDifference}</dd>
            </dl>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void onChoose(option.id === 'SPLIT' ? 'SPLIT' : 'ADJUST')}
            >
              选择此方案
            </button>
          </section>
        ))}
      </div>
    </article>
  )
}
