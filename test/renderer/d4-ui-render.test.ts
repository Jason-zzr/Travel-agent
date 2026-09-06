import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { D4Snapshot, XhsRankingPreview } from '../../src/shared/schema/d4'
import type { EvidenceClaim } from '../../src/shared/schema/evidence'
import { DestinationCandidatesCard, ResearchChecklistCard } from '../../src/renderer/src/ChatView'

const claims: EvidenceClaim[] = [
  {
    claimId: 'hours-a',
    sessionId: 'd4-render',
    subject: '武侯祠',
    predicate: 'openingHours',
    value: '09:00-18:00',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://official.example/hours',
    contentIdentity: 'OFFICIAL',
    verificationStatus: 'CONFLICTED',
    observedAt: '2026-08-26T04:00:00.000Z',
    validUntil: '2026-09-02T04:00:00.000Z',
    confidence: 0.9,
    conflictsWith: ['hours-b'],
    notes: null
  },
  {
    claimId: 'hours-b',
    sessionId: 'd4-render',
    subject: '成都武侯祠博物馆',
    predicate: 'openingHours',
    value: '08:30-17:00',
    sourceId: 'SRC_MAP',
    sourceRef: 'SRC_MAP:maps_geo:hours-fixture',
    contentIdentity: 'OFFICIAL',
    verificationStatus: 'CONFLICTED',
    observedAt: '2026-08-26T04:00:00.000Z',
    validUntil: '2026-09-02T04:00:00.000Z',
    confidence: 0.8,
    conflictsWith: ['hours-a'],
    notes: null
  },
  {
    claimId: 'xhs-positive',
    sessionId: 'd4-render',
    subject: '成都',
    predicate: 'xiaohongshuPositiveResult',
    value: { queryKind: 'POSITIVE_LOCATION', title: '适合家庭慢游的街区' },
    sourceId: 'SRC_XHS',
    sourceRef: 'https://www.xiaohongshu.com/explore/note0001',
    contentIdentity: 'INDEPENDENT_UGC',
    verificationStatus: 'UNVERIFIED',
    observedAt: '2026-08-26T04:00:00.000Z',
    validUntil: '2026-09-02T04:00:00.000Z',
    confidence: null,
    conflictsWith: [],
    notes: 'UGC 仅作线索'
  },
  {
    claimId: 'xhs-negative',
    sessionId: 'd4-render',
    subject: '成都',
    predicate: 'xiaohongshuAvoidanceResult',
    value: { queryKind: 'NEGATIVE_AVOIDANCE', title: '节假日排队避雷提醒' },
    sourceId: 'SRC_XHS',
    sourceRef: 'https://www.xiaohongshu.com/explore/note0002',
    contentIdentity: 'INDEPENDENT_UGC',
    verificationStatus: 'UNVERIFIED',
    observedAt: '2026-08-26T04:00:00.000Z',
    validUntil: '2026-09-02T04:00:00.000Z',
    confidence: null,
    conflictsWith: [],
    notes: 'UGC 仅作线索'
  }
]

const snapshot: D4Snapshot = {
  sessionId: 'd4-render',
  stage: 'STAGE_3',
  destinationCandidates: [],
  selectedDestinationCandidateId: 'chengdu',
  researchEntities: [
    {
      entityId: 'wuhou-shrine',
      destinationCity: '成都',
      canonicalSubject: '武侯祠',
      aliases: ['武侯祠', '成都武侯祠博物馆', '武侯祠·锦里'],
      kind: 'ATTRACTION',
      claimIds: ['hours-a', 'hours-b'],
      identityStatus: 'DETERMINISTIC',
      verificationStatus: 'CONFLICTED',
      contentIdentities: ['OFFICIAL'],
      validUntil: '2026-09-02T04:00:00.000Z',
      promotionOnlySupport: false,
      fitness: {
        status: 'RISK',
        reasons: ['同行含老人和儿童，长时间爬坡与大量台阶会增加体力风险']
      },
      disposition: 'MUST_GO',
      blockingReasons: ['开放时间存在未裁决冲突'],
      unresolvedConflictClaimIds: ['hours-a', 'hours-b']
    },
    {
      entityId: 'promo-only',
      destinationCity: '成都',
      canonicalSubject: '锦里优惠体验',
      aliases: [],
      kind: 'EXPERIENCE',
      claimIds: ['promotion'],
      identityStatus: 'PROPOSED',
      verificationStatus: 'UNVERIFIED',
      contentIdentities: ['SUSPECTED_PROMOTION'],
      validUntil: '2027-02-26T04:00:00.000Z',
      promotionOnlySupport: true,
      fitness: { status: 'UNKNOWN', reasons: ['缺少成员适配证据'] },
      disposition: 'NEUTRAL',
      blockingReasons: ['推广内容不能单独支撑推荐'],
      unresolvedConflictClaimIds: []
    }
  ],
  researchChecklistConfirmed: false,
  conflictResolutions: [],
  sourceResearchFailures: [
    {
      sourceId: 'SRC_MAP',
      status: 'FAILED',
      errorCode: 'SOURCE_UNREACHABLE',
      capabilityImpact: '地点坐标无法自动补充',
      manualAlternative: '在 EVIDENCE 中粘贴官方地点链接'
    }
  ]
}

test('D4 research UI renders grouping, promotion, fitness, failures and both conflict sides without external calls', () => {
  let externalCalls = 0
  const noExternalCall = async (): Promise<void> => {
    externalCalls += 1
  }
  const markup = renderToStaticMarkup(
    createElement(ResearchChecklistCard, {
      snapshot,
      claims,
      operationId: null,
      onPrepare: noExternalCall,
      rankingPreview: null,
      onPreviewRanking: noExternalCall,
      onExecuteRanking: noExternalCall,
      onCancel: noExternalCall,
      onPaste: noExternalCall,
      onDisposition: noExternalCall,
      onConflict: noExternalCall,
      onConfirm: noExternalCall
    })
  )

  assert.match(markup, /STAGE-3 · 研究与证据确认/)
  assert.match(markup, /成都武侯祠博物馆/)
  assert.match(markup, /成员适配：RISK/)
  assert.match(markup, /老人和儿童/)
  assert.match(markup, /锦里优惠体验/)
  assert.match(markup, /推广内容不能单独支撑推荐/)
  assert.match(markup, /09:00-18:00/)
  assert.match(markup, /08:30-17:00/)
  assert.match(markup, /地点坐标无法自动补充/)
  assert.match(markup, /尚未裁决/)
  assert.match(markup, /小红书正负向交叉验证/)
  assert.match(markup, /小红书正向检索结果/)
  assert.match(markup, /适合家庭慢游的街区/)
  assert.match(markup, /小红书避雷检索结果/)
  assert.match(markup, /节假日排队避雷提醒/)
  assert.match(markup, /UGC · UNVERIFIED/)
  assert.doesNotMatch(markup, /xsec/)
  assert.equal(externalCalls, 0)
})

test('D4 XHS ranking UI renders the exact authorization digest and deterministic score breakdown', () => {
  let calls = 0
  const noCall = async (): Promise<void> => {
    calls += 1
  }
  const rankingPreview: XhsRankingPreview = {
    sessionId: 'd4-render',
    planId: '123e4567-e89b-12d3-a456-426614174000',
    digest: `sha256:${'a'.repeat(64)}`,
    expiresAt: '2026-08-30T12:00:00.000Z',
    destinationCity: '昆明',
    queries: [
      '昆明 景点推荐 亲子 老人',
      '昆明 小众景点 轻松 少走路',
      '昆明 景点避雷 排队',
      '昆明 景点踩雷 步行 坡度'
    ],
    filters: {
      sort_by: '综合',
      note_type: '图文',
      publish_time: '半年内',
      search_scope: '不限',
      location: '不限'
    },
    recommendSampleSize: 15,
    avoidSampleSize: 15,
    searchCalls: 4,
    detailCalls: 30,
    detailCharacterLimit: 4000,
    extractionCalls: 6,
    reviewCalls: 1,
    retryCount: 0,
    loadAllComments: false,
    extractionRoute: { provider: 'SHUAI_API', model: 'extract-model' },
    reviewRoute: { provider: 'DEEPSEEK_OFFICIAL', model: 'review-model' }
  }
  const rankingSnapshot: D4Snapshot = {
    ...snapshot,
    xhsSampleSummary: {
      destinationCity: '昆明',
      recommendPostCount: 15,
      avoidPostCount: 15,
      searchCalls: 4,
      detailCalls: 30,
      extractionCalls: 6,
      reviewCalls: 1,
      retryCount: 0,
      loadAllComments: false
    },
    attractionRankings: [
      {
        rank: 1,
        entityId: 'cuihu',
        subject: '翠湖公园',
        score: -1,
        recommendPostCount: 1,
        avoidPostCount: 1,
        familyFit: 'UNKNOWN',
        familyFitAdjustment: 0,
        familyFitReasons: [],
        recommendationEvidence: [
          {
            claimId: 'rank-positive',
            sourceRef: 'https://www.xiaohongshu.com/explore/rank0001',
            reason: '适合慢游'
          }
        ],
        avoidanceEvidence: [
          {
            claimId: 'rank-negative',
            sourceRef: 'https://www.xiaohongshu.com/explore/rank0002',
            reason: '高峰排队明显'
          }
        ],
        claimIds: ['rank-positive', 'rank-negative'],
        verificationStatus: 'UNVERIFIED'
      }
    ]
  }

  const markup = renderToStaticMarkup(
    createElement(ResearchChecklistCard, {
      snapshot: rankingSnapshot,
      claims,
      operationId: null,
      onPrepare: noCall,
      rankingPreview,
      onPreviewRanking: noCall,
      onExecuteRanking: noCall,
      onCancel: noCall,
      onPaste: noCall,
      onDisposition: noCall,
      onConflict: noCall,
      onConfirm: noCall
    })
  )

  assert.match(markup, /来源读取 4\+30 · 模型调用 6\+1 · 重试 0/)
  assert.match(markup, /昆明 景点推荐 亲子 老人/)
  assert.match(markup, /SHUAI_API \/ extract-model/)
  assert.match(markup, /DEEPSEEK_OFFICIAL \/ review-model/)
  assert.match(markup, /明确执行此 30 帖研究计划/)
  assert.match(markup, /景点确定性排序/)
  assert.match(markup, /#1 翠湖公园 · -1 分/)
  assert.match(markup, /3×1 − 4×1 \+ 0（UNKNOWN）/)
  assert.match(markup, /高峰排队明显/)
  assert.match(markup, /https:\/\/www\.xiaohongshu\.com\/explore\/rank0002/)
  assert.match(markup, /UGC 未核验/)
  assert.doesNotMatch(markup, /xsec_token|评论内容|raw response/i)
  assert.equal(calls, 0)
})

test('D4 fixed destination UI requires an explicit confirmation and hides candidate generation', () => {
  let calls = 0
  const noCall = async (): Promise<void> => {
    calls += 1
  }
  const fixedSnapshot: D4Snapshot = {
    sessionId: 'd4-fixed-render',
    stage: 'STAGE_2',
    fixedDestinationCity: '成都',
    destinationCandidates: [],
    selectedDestinationCandidateId: null,
    researchEntities: [],
    researchChecklistConfirmed: false,
    conflictResolutions: [],
    sourceResearchFailures: []
  }
  const markup = renderToStaticMarkup(
    createElement(DestinationCandidatesCard, {
      snapshot: fixedSnapshot,
      operationId: null,
      busy: false,
      onGenerate: noCall,
      onConfirmFixed: noCall,
      onSelect: noCall,
      onCancel: noCall
    })
  )

  assert.match(markup, /目的地已明确：成都/)
  assert.match(markup, /确认 成都，进入研究/)
  assert.match(markup, /不会自动推进阶段/)
  assert.doesNotMatch(markup, />生成候选</)
  assert.equal(calls, 0)
})

test('D4 destination UI exposes no action before the current snapshot loads', () => {
  const noCall = async (): Promise<void> => undefined
  const markup = renderToStaticMarkup(
    createElement(DestinationCandidatesCard, {
      snapshot: null,
      operationId: null,
      busy: false,
      onGenerate: noCall,
      onConfirmFixed: noCall,
      onSelect: noCall,
      onCancel: noCall
    })
  )

  assert.match(markup, /正在读取目的地状态/)
  assert.match(markup, /aria-busy="true"/)
  assert.doesNotMatch(markup, /生成候选/)
  assert.doesNotMatch(markup, /进入研究/)
})

test('D4 fuzzy destination UI keeps the candidate-generation path', () => {
  const noCall = async (): Promise<void> => undefined
  const fuzzySnapshot: D4Snapshot = {
    sessionId: 'd4-fuzzy-render',
    stage: 'STAGE_2',
    fixedDestinationCity: null,
    destinationCandidates: [],
    selectedDestinationCandidateId: null,
    researchEntities: [],
    researchChecklistConfirmed: false,
    conflictResolutions: [],
    sourceResearchFailures: []
  }
  const markup = renderToStaticMarkup(
    createElement(DestinationCandidatesCard, {
      snapshot: fuzzySnapshot,
      operationId: null,
      busy: false,
      onGenerate: noCall,
      onConfirmFixed: noCall,
      onSelect: noCall,
      onCancel: noCall
    })
  )

  assert.match(markup, /生成候选/)
  assert.doesNotMatch(markup, /确认 成都，进入研究/)
})

test('D4 manual research UI renders the in-memory editor and user-confirmed evidence without calls', () => {
  let calls = 0
  const noCall = async (): Promise<void> => {
    calls += 1
  }
  const noManualCall = async (): Promise<boolean> => {
    calls += 1
    return true
  }
  const noDirtyCall = (): void => {
    calls += 1
  }
  const manualClaims: EvidenceClaim[] = [
    {
      claimId: 'manual-summary',
      sessionId: 'd4-render',
      subject: '武侯祠',
      predicate: 'manualResearchSummary',
      value: {
        summary: '适合家庭慢游。',
        sourceLabel: '武侯祠官方公众号',
        sourceUrl: 'https://example.com/official-notice',
        sourceClaimId: 'paste-source'
      },
      sourceId: 'USER_RESEARCH',
      sourceRef: 'USER_RESEARCH:digest',
      contentIdentity: 'OFFICIAL',
      verificationStatus: 'VERIFIED_BY_USER',
      observedAt: '2026-08-30T04:00:00.000Z',
      validUntil: '2026-09-06T04:00:00.000Z',
      confidence: null,
      conflictsWith: [],
      notes: '用户逐项确认。'
    },
    {
      claimId: 'manual-opening',
      sessionId: 'd4-render',
      subject: '武侯祠',
      predicate: 'openingHours',
      value: {
        kind: 'OPENING_HOURS',
        status: 'KNOWN',
        value: '09:00-18:00',
        checkedAt: '2026-08-30T04:00:00.000Z',
        sourceLabel: '武侯祠官方公众号',
        sourceUrl: 'https://example.com/official-notice',
        sourceClaimId: 'paste-source'
      },
      sourceId: 'USER_RESEARCH',
      sourceRef: 'USER_RESEARCH:digest',
      contentIdentity: 'OFFICIAL',
      verificationStatus: 'VERIFIED_BY_USER',
      observedAt: '2026-08-30T04:00:00.000Z',
      validUntil: '2026-08-31T04:00:00.000Z',
      confidence: null,
      conflictsWith: [],
      notes: '用户逐项确认。'
    }
  ]
  const manualSnapshot: D4Snapshot = {
    ...snapshot,
    manualResearchSummary: {
      mode: 'USER_CONFIRMED',
      itemCount: 1,
      linkedPasteCount: 1,
      confirmedAt: '2026-08-30T04:00:00.000Z'
    },
    researchEntities: [
      {
        entityId: 'manual-wuhou',
        destinationCity: '成都',
        canonicalSubject: '武侯祠',
        aliases: ['成都武侯祠博物馆'],
        kind: 'ATTRACTION',
        claimIds: ['manual-summary', 'manual-opening'],
        identityStatus: 'DETERMINISTIC',
        verificationStatus: 'VERIFIED_BY_USER',
        contentIdentities: ['OFFICIAL'],
        validUntil: '2026-08-31T04:00:00.000Z',
        promotionOnlySupport: false,
        fitness: { status: 'FIT', reasons: ['有休息点'] },
        disposition: 'MUST_GO',
        blockingReasons: [],
        unresolvedConflictClaimIds: []
      }
    ]
  }
  const markup = renderToStaticMarkup(
    createElement(ResearchChecklistCard, {
      snapshot: manualSnapshot,
      claims: manualClaims,
      operationId: null,
      onPrepare: noCall,
      rankingPreview: null,
      onPreviewRanking: noCall,
      onExecuteRanking: noCall,
      onCancel: noCall,
      onPaste: noCall,
      onPrepareManual: noManualCall,
      onManualDirtyChange: noDirtyCall,
      onDisposition: noCall,
      onConflict: noCall,
      onConfirm: noCall
    })
  )

  assert.match(markup, /人工逐项核验/)
  assert.match(markup, /externalCalls=0 · modelCalls=0/)
  assert.match(markup, /生成 USER_RESEARCH 清单/)
  assert.match(markup, /USER_RESEARCH · VERIFIED_BY_USER/)
  assert.match(markup, /用户核验，非独立来源佐证/)
  assert.match(markup, /武侯祠官方公众号/)
  assert.match(markup, /https:\/\/example\.com\/official-notice/)
  assert.match(markup, /开放时间：KNOWN · 09:00-18:00/)
  assert.match(markup, /关联原始线索/)
  assert.equal(calls, 0)
})
