import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RouteNodeResearchCard } from '../../src/renderer/src/RouteNodeResearchCard'
import type { RouteNodeD4Snapshot } from '../../src/shared/schema/d4'
import type { EvidenceClaim } from '../../src/shared/schema/evidence'
import type { RouteNode } from '../../src/shared/schema/itinerary'

const SESSION_ID = 'route-node-render'
const ROUTE_ID = 'route-yunnan-render'
const claimScope = { kind: 'ROUTE_NODE' as const, routeId: ROUTE_ID, nodeId: 'node-dali' }

const nodes: RouteNode[] = [
  {
    routeId: ROUTE_ID,
    nodeId: 'node-dali',
    city: '大理',
    region: '云南',
    sequence: 1,
    arrivalDate: '2026-09-08',
    departureDate: '2026-09-11',
    nights: 3,
    nodeKind: 'STAY',
    mandatoryPlaceIds: ['must-erhai'],
    reason: '洱海'
  },
  {
    routeId: ROUTE_ID,
    nodeId: 'node-kunming',
    city: '昆明',
    region: '云南',
    sequence: 2,
    arrivalDate: '2026-09-11',
    departureDate: '2026-09-11',
    nights: 0,
    nodeKind: 'TRANSIT',
    mandatoryPlaceIds: [],
    reason: '交通决定是否中转'
  },
  {
    routeId: ROUTE_ID,
    nodeId: 'node-lijiang',
    city: '丽江',
    region: '云南',
    sequence: 3,
    arrivalDate: '2026-09-11',
    departureDate: '2026-09-14',
    nights: 3,
    nodeKind: 'STAY',
    mandatoryPlaceIds: ['must-yulong'],
    reason: '玉龙雪山'
  },
  {
    routeId: ROUTE_ID,
    nodeId: 'node-banna',
    city: '西双版纳',
    region: '云南',
    sequence: 4,
    arrivalDate: '2026-09-14',
    departureDate: '2026-09-17',
    nights: 3,
    nodeKind: 'STAY',
    mandatoryPlaceIds: ['must-banna'],
    reason: '西双版纳'
  }
]

const claim: EvidenceClaim = {
  claimId: 'claim-erhai-hours',
  sessionId: SESSION_ID,
  subject: '洱海',
  predicate: 'openingHours',
  value: '全天开放区域以现场公告为准',
  sourceId: 'USER_RESEARCH',
  sourceRef: 'manual:erhai',
  contentIdentity: 'OFFICIAL',
  verificationStatus: 'VERIFIED_BY_USER',
  observedAt: '2026-08-31T00:00:00.000Z',
  validUntil: '2026-09-01T00:00:00.000Z',
  confidence: null,
  conflictsWith: [],
  notes: null,
  scope: claimScope
}

const snapshot: RouteNodeD4Snapshot = {
  sessionId: SESSION_ID,
  stage: 'STAGE_3',
  selectedRouteId: ROUTE_ID,
  currentScope: {
    sessionId: SESSION_ID,
    routeId: ROUTE_ID,
    nodeId: 'node-dali',
    city: '大理',
    nodeKind: 'STAY',
    mandatoryPlaceIds: ['must-erhai']
  },
  currentNode: {
    scope: {
      sessionId: SESSION_ID,
      routeId: ROUTE_ID,
      nodeId: 'node-dali',
      city: '大理',
      nodeKind: 'STAY',
      mandatoryPlaceIds: ['must-erhai']
    },
    sequence: 1,
    required: true,
    status: 'REVIEW_REQUIRED',
    skipReason: null,
    researchEntities: [
      {
        entityId: 'entity-erhai',
        destinationCity: '大理',
        canonicalSubject: '洱海',
        aliases: [],
        kind: 'ATTRACTION',
        claimIds: [claim.claimId],
        identityStatus: 'DETERMINISTIC',
        verificationStatus: 'VERIFIED_BY_USER',
        contentIdentities: ['OFFICIAL'],
        validUntil: '2026-09-01T00:00:00.000Z',
        promotionOnlySupport: false,
        fitness: { status: 'FIT', reasons: ['家庭可按体力调整环湖范围'] },
        disposition: 'MUST_GO',
        blockingReasons: [],
        unresolvedConflictClaimIds: [],
        scope: claimScope
      }
    ],
    researchChecklistConfirmed: false,
    conflictResolutions: [],
    sourceResearchFailures: [],
    xhsSampleSummary: null,
    manualResearchSummary: null,
    attractionRankings: [],
    blockingReasons: [],
    confirmedAt: null
  },
  nodeSummaries: nodes.map((node) => ({
    scope: {
      sessionId: SESSION_ID,
      routeId: ROUTE_ID,
      nodeId: node.nodeId,
      city: node.city,
      nodeKind: node.nodeKind,
      mandatoryPlaceIds: node.mandatoryPlaceIds
    },
    sequence: node.sequence,
    required: node.nodeKind === 'STAY',
    status: node.nodeKind === 'TRANSIT' ? ('SKIPPED' as const) : ('NOT_STARTED' as const),
    blockerCount: 0,
    entityCount: node.nodeId === 'node-dali' ? 1 : 0,
    confirmedAt: null,
    skipReason: node.nodeKind === 'TRANSIT' ? '只作交通中转，无需景点研究。' : null
  })),
  routeResearchComplete: false,
  nextRequiredNodeId: 'node-dali'
}

test('route node D4 UI renders isolated node queue, optional Kunming and zero-call authorization', () => {
  let calls = 0
  const html = renderToStaticMarkup(
    createElement(RouteNodeResearchCard, {
      snapshot,
      nodes,
      claims: [claim],
      preview: null,
      operationId: null,
      onSelectNode: async () => {
        calls += 1
      },
      onPreview: async () => {
        calls += 1
      },
      onExecute: async () => {
        calls += 1
      },
      onCancel: async () => {
        calls += 1
      },
      onPaste: async () => {
        calls += 1
      },
      onPrepareManual: async () => {
        calls += 1
        return true
      },
      onManualDirtyChange: () => {
        calls += 1
      },
      onDisposition: async () => {
        calls += 1
      },
      onConflict: async () => {
        calls += 1
      },
      onConfirm: async () => {
        calls += 1
      }
    })
  )

  assert.match(html, /按已选路线逐站核验/)
  assert.match(html, /大理/)
  assert.match(html, /昆明<\/strong>[\s\S]*?已跳过/)
  assert.match(html, /丽江/)
  assert.match(html, /西双版纳/)
  assert.match(html, /洱海/)
  assert.match(html, /查看研究计划/)
  assert.match(html, /value="XHS_STRICT" selected=""/)
  assert.match(html, /<details class="node-manual">/)
  assert.doesNotMatch(html, /明确执行此节点计划/)
  assert.match(html, /确认 大理 节点/)
  assert.equal(calls, 0)
})
