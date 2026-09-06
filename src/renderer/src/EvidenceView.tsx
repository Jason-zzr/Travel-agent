import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '../../shared/schema/chat'
import type { EvidenceClaim } from '../../shared/schema/evidence'
import type { SearchAudit, SearchSource, SearchUsage } from '../../shared/schema/mcp/search'
import { XhsQueryKindSchema, type XhsQueryKind } from '../../shared/schema/mcp/xiaohongshu'
import type { ExternalSourceId, RepresentativeSourceQuery } from '../../shared/schema/source'
import { ExternalSourceUrlSchema } from '../../shared/schema/source'
import {
  cancelSourceOperation,
  listEvidence,
  listSessions,
  openExternalSource,
  runSourceQuery,
  subscribeSourceProgress
} from './ipc'

const SOURCE_LABELS: Record<ExternalSourceId, string> = {
  SRC_RAIL: '12306 当前日期',
  SRC_MAP: '高德地点坐标',
  SRC_HOTEL: 'RollingGo 酒店候选',
  SRC_SEARCH: 'Serper Search + DeepSeek 流式生成',
  SRC_XHS: '小红书 UGC',
  SRC_FLIGHT: 'VariFlight 航班（发现待审批）'
}

type RepresentativeSourceId = Exclude<ExternalSourceId, 'SRC_XHS' | 'SRC_FLIGHT'>
const QUERY_SOURCE_IDS: RepresentativeSourceId[] = [
  'SRC_RAIL',
  'SRC_MAP',
  'SRC_HOTEL',
  'SRC_SEARCH'
]

export interface EvidenceFocus {
  sessionId: string
  claimIds: string[]
}

export function EvidenceView({
  focus = null
}: {
  focus?: EvidenceFocus | null
}): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionId, setSessionId] = useState('')
  const [claims, setClaims] = useState<EvidenceClaim[]>([])
  const [verificationFilter, setVerificationFilter] = useState<
    'ALL' | EvidenceClaim['verificationStatus']
  >('ALL')
  const [identityFilter, setIdentityFilter] = useState<'ALL' | EvidenceClaim['contentIdentity']>(
    'ALL'
  )
  const [sourceFilter, setSourceFilter] = useState<'ALL' | ExternalSourceId>('ALL')
  const [xhsQueryFilter, setXhsQueryFilter] = useState<'ALL' | XhsQueryKind>('ALL')
  const [sourceId, setSourceId] = useState<RepresentativeSourceId>('SRC_RAIL')
  const [operationId, setOperationId] = useState<string | null>(null)
  const activeOperation = useRef<string | null>(null)
  const [searchAnswer, setSearchAnswer] = useState('')
  const [searchSources, setSearchSources] = useState<SearchSource[]>([])
  const [searchUsage, setSearchUsage] = useState<SearchUsage | null>(null)
  const [searchAudit, setSearchAudit] = useState<SearchAudit | null>(null)
  const [message, setMessage] = useState('正在读取本机会话…')
  const filteredClaims = useMemo(
    () =>
      claims.filter(
        (claim) =>
          (focus === null || focus.claimIds.includes(claim.claimId)) &&
          (verificationFilter === 'ALL' || claim.verificationStatus === verificationFilter) &&
          (identityFilter === 'ALL' || claim.contentIdentity === identityFilter) &&
          (sourceFilter === 'ALL' || claim.sourceId === sourceFilter) &&
          (xhsQueryFilter === 'ALL' || queryKindFromClaim(claim) === xhsQueryFilter)
      ),
    [claims, focus, identityFilter, sourceFilter, verificationFilter, xhsQueryFilter]
  )

  useEffect(() => {
    let active = true
    void listSessions().then((result) => {
      if (!active) return
      if (!result.ok) return setMessage(result.error.userHint)
      setSessions(result.data)
      const first = focus?.sessionId ?? result.data[0]?.sessionId ?? ''
      setSessionId(first)
      if (!first) return setMessage('请先在 CHAT 中创建会话。')
      void listEvidence(first).then((evidenceResult) => {
        if (!active) return
        if (!evidenceResult.ok) return setMessage(evidenceResult.error.userHint)
        setClaims(evidenceResult.data)
        setMessage(
          focus
            ? `已定位 ${evidenceResult.data.filter((claim) => focus.claimIds.includes(claim.claimId)).length} 条时间轴证据。`
            : `已读取 ${evidenceResult.data.length} 条本地证据。`
        )
      })
    })
    return () => {
      active = false
    }
  }, [focus])

  useEffect(
    () =>
      subscribeSourceProgress((event) => {
        if (event.operationId !== activeOperation.current) return
        const payload = event.payload
        switch (payload.kind) {
          case 'SEARCH_STARTED':
            setMessage('Serper Search 正在检索公开网页…')
            break
          case 'SEARCH_RESULTS':
            setSearchSources(payload.sources)
            setMessage(`已获得 ${payload.sources.length} 条完整搜索结果，DeepSeek 正在生成…`)
            break
          case 'ANSWER_DELTA':
            setSearchAnswer((current) => current + payload.delta)
            setMessage('DeepSeek 正在流式生成答案…')
            break
          case 'USAGE':
            setSearchUsage(payload.usage)
            setSearchAudit(payload.audit)
            setMessage('流式生成完成，正在校验并写入证据…')
            break
        }
      }),
    []
  )

  async function refreshEvidence(targetSessionId = sessionId): Promise<void> {
    const result = await listEvidence(targetSessionId)
    if (!result.ok) return setMessage(result.error.userHint)
    setClaims(result.data)
    setMessage(`已读取 ${result.data.length} 条本地证据。`)
  }

  async function handleQuery(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!sessionId) return setMessage('请先选择会话。')
    const operation = crypto.randomUUID()
    const data = new FormData(event.currentTarget)
    const query = buildQuery(sourceId, sessionId, data)
    activeOperation.current = operation
    setOperationId(operation)
    setSearchAnswer('')
    setSearchSources([])
    setSearchUsage(null)
    setSearchAudit(null)
    setMessage(`${SOURCE_LABELS[sourceId]}正在执行只读查询…`)
    const result = await runSourceQuery(query, operation)
    if (activeOperation.current === operation) activeOperation.current = null
    setOperationId((current) => (current === operation ? null : current))
    if (!result.ok) return setMessage(result.error.userHint)
    if (result.data.search) {
      setSearchAnswer(result.data.search.answer)
      setSearchSources(result.data.search.sources)
      setSearchUsage(result.data.search.usage)
      setSearchAudit(result.data.search.audit)
    }
    await refreshEvidence(sessionId)
    setMessage(
      result.data.search
        ? `查询完成，列出 ${result.data.search.sources.length} 条来源并写入 ${result.data.claims.length} 条结构化证据。`
        : `查询完成，写入 ${result.data.claims.length} 条结构化证据${result.data.fromCache ? '（来自本地缓存）' : ''}。`
    )
  }

  async function handleCancel(): Promise<void> {
    if (!operationId) return
    await cancelSourceOperation(operationId)
    setMessage('已请求取消查询。')
  }

  async function handleOpenExternal(url: string): Promise<void> {
    const result = await openExternalSource(url)
    if (!result.ok) setMessage(result.error.userHint)
  }

  return (
    <section className="evidence-layout">
      <div className="query-panel">
        <div className="section-heading compact-heading">
          <div>
            <h2>代表性只读查询</h2>
            <p>每次操作都需要你主动点击；成功结果会先校验再写入证据事件。</p>
          </div>
        </div>
        <form className="query-form" onSubmit={(event) => void handleQuery(event)}>
          <label>
            会话
            <select
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              required
            >
              <option value="">请选择</option>
              {sessions.map((session) => (
                <option key={session.sessionId} value={session.sessionId}>
                  {session.title ?? session.sessionId}
                </option>
              ))}
            </select>
          </label>
          <label>
            数据源
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value as RepresentativeSourceId)}
            >
              {QUERY_SOURCE_IDS.map((id) => (
                <option key={id} value={id}>
                  {SOURCE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <SourceFields sourceId={sourceId} />
          <div className="source-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={Boolean(operationId) || !sessionId}
            >
              {operationId ? '查询中…' : '执行一次只读查询'}
            </button>
            {operationId ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => void handleCancel()}
              >
                取消
              </button>
            ) : null}
          </div>
        </form>
        <p className="system-message" role="status" aria-live="polite">
          {message}
        </p>
        {searchAnswer || searchSources.length > 0 ? (
          <SearchOutput
            answer={searchAnswer}
            sources={searchSources}
            usage={searchUsage}
            audit={searchAudit}
          />
        ) : null}
      </div>

      <div className="evidence-panel">
        <div className="section-heading compact-heading">
          <div>
            <h2>EvidenceClaim</h2>
            <p>仅展示结构化、可追溯字段。</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={!sessionId}
            onClick={() => void refreshEvidence()}
          >
            刷新
          </button>
        </div>
        <div className="evidence-filters" aria-label="证据筛选">
          {focus ? <span>时间轴定位：{focus.claimIds.length} 个 claimId</span> : null}
          <label>
            核验状态
            <select
              value={verificationFilter}
              onChange={(event) =>
                setVerificationFilter(
                  event.target.value as 'ALL' | EvidenceClaim['verificationStatus']
                )
              }
            >
              <option value="ALL">全部</option>
              {[
                'VERIFIED',
                'CORROBORATED',
                'ESTIMATED',
                'UNVERIFIED',
                'CONFLICTED',
                'STALE',
                'VERIFIED_BY_USER'
              ].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label>
            内容身份
            <select
              value={identityFilter}
              onChange={(event) =>
                setIdentityFilter(event.target.value as 'ALL' | EvidenceClaim['contentIdentity'])
              }
            >
              <option value="ALL">全部</option>
              {[
                'OFFICIAL',
                'TRANSACTION',
                'INDEPENDENT_UGC',
                'COMMERCIAL_OFFER',
                'SUSPECTED_PROMOTION',
                'UNKNOWN'
              ].map((identity) => (
                <option key={identity} value={identity}>
                  {identity}
                </option>
              ))}
            </select>
          </label>
          <label>
            来源
            <select
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as 'ALL' | ExternalSourceId)}
            >
              <option value="ALL">全部</option>
              {Object.entries(SOURCE_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            小红书检索方向
            <select
              value={xhsQueryFilter}
              onChange={(event) => setXhsQueryFilter(event.target.value as 'ALL' | XhsQueryKind)}
            >
              <option value="ALL">全部</option>
              <option value="POSITIVE_LOCATION">正向检索结果</option>
              <option value="NEGATIVE_AVOIDANCE">避雷检索结果</option>
            </select>
          </label>
          <span>
            {filteredClaims.length} / {claims.length} 条
          </span>
        </div>
        <div className="evidence-list">
          {claims.length === 0 ? (
            <p className="empty-state">当前会话还没有证据。</p>
          ) : filteredClaims.length === 0 ? (
            <p className="empty-state">当前筛选条件没有匹配证据。</p>
          ) : (
            filteredClaims.map((claim) => (
              <article className="evidence-card" key={claim.claimId}>
                <div className="source-card-title">
                  <strong>
                    {claim.subject} · {claim.predicate}
                  </strong>
                  <span className={`status status-${claim.verificationStatus.toLowerCase()}`}>
                    {claim.verificationStatus}
                  </span>
                </div>
                <code>{summarizeValue(claim.value)}</code>
                <dl>
                  <dt>来源</dt>
                  <dd>{evidenceSourceDescription(claim)}</dd>
                  <dt>引用</dt>
                  <dd>
                    <code>{claim.sourceRef}</code>
                    {ExternalSourceUrlSchema.safeParse(claim.sourceRef).success ? (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void handleOpenExternal(claim.sourceRef)}
                      >
                        打开原始页面
                      </button>
                    ) : null}
                  </dd>
                  <dt>观察</dt>
                  <dd>{formatTime(claim.observedAt)}</dd>
                  <dt>有效至</dt>
                  <dd>
                    {formatTime(claim.validUntil)} · {freshnessLabel(claim.validUntil)}
                  </dd>
                  <dt>置信度</dt>
                  <dd>
                    {claim.confidence === null ? '未知' : `${Math.round(claim.confidence * 100)}%`}
                  </dd>
                  <dt>说明</dt>
                  <dd>{claim.notes ?? '无补充说明'}</dd>
                </dl>
                {claim.conflictsWith.length > 0 ? (
                  <details className="conflict-box">
                    <summary>展开冲突双方（{claim.conflictsWith.length + 1} 条）</summary>
                    <ConflictEvidence current={claim} claims={claims} />
                  </details>
                ) : null}
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

function SearchOutput(input: {
  answer: string
  sources: SearchSource[]
  usage: SearchUsage | null
  audit: SearchAudit | null
}): React.JSX.Element {
  return (
    <section className="search-output" aria-labelledby="search-output-heading">
      <h3 id="search-output-heading">流式搜索结果</h3>
      <div className="stream-answer" aria-live="polite">
        {input.answer || '等待 DeepSeek 输出…'}
      </div>
      <h4>全部来源（{input.sources.length}）</h4>
      <ol className="search-source-list">
        {input.sources.map((source) => (
          <li key={source.url}>
            <strong>{source.title}</strong>
            <code>{source.url}</code>
            {source.snippet ? <p>{source.snippet}</p> : null}
          </li>
        ))}
      </ol>
      {input.usage && input.audit ? (
        <dl className="token-audit">
          <dt>DeepSeek token</dt>
          <dd>
            输入 {input.usage.inputTokens} / 输出 {input.usage.outputTokens} / 推理{' '}
            {input.usage.reasoningTokens} / 总计 {input.usage.totalTokens}
          </dd>
          <dt>检索上下文</dt>
          <dd>
            {input.audit.searchResultCount} 条结果 / {input.audit.groundingCharacters} 字符
          </dd>
          <dt>open_page</dt>
          <dd>
            {input.audit.nativeOpenPageCalls} 次 / {input.audit.openPageTokens}{' '}
            token（原生工具已禁用）
          </dd>
        </dl>
      ) : null}
    </section>
  )
}

function SourceFields({
  sourceId
}: {
  sourceId: RepresentativeSourceId
}): React.JSX.Element | null {
  if (sourceId === 'SRC_RAIL') return null
  if (sourceId === 'SRC_MAP')
    return (
      <>
        <label>
          地址
          <input name="address" required />
        </label>
        <label>
          城市
          <input name="city" required />
        </label>
      </>
    )
  if (sourceId === 'SRC_HOTEL')
    return (
      <>
        <label>
          目的地
          <input name="place" required />
        </label>
        <label>
          入住日
          <input name="checkInDate" type="date" required />
        </label>
        <label>
          晚数
          <input name="stayNights" type="number" min="1" max="28" defaultValue="1" required />
        </label>
        <label>
          成人
          <input name="adultCount" type="number" min="1" max="6" defaultValue="2" required />
        </label>
      </>
    )
  return (
    <label>
      公开网页查询
      <input name="query" required />
    </label>
  )
}

function buildQuery(
  sourceId: RepresentativeSourceId,
  sessionId: string,
  data: FormData
): RepresentativeSourceQuery {
  if (sourceId === 'SRC_RAIL') return { sourceId, sessionId, input: {} }
  if (sourceId === 'SRC_MAP')
    return {
      sourceId,
      sessionId,
      input: { address: String(data.get('address')), city: String(data.get('city')) }
    }
  if (sourceId === 'SRC_HOTEL')
    return {
      sourceId,
      sessionId,
      input: {
        place: String(data.get('place')),
        checkInDate: String(data.get('checkInDate')),
        stayNights: Number(data.get('stayNights')),
        adultCount: Number(data.get('adultCount'))
      }
    }
  return {
    sourceId,
    sessionId,
    input: { query: String(data.get('query')) }
  }
}

function ConflictEvidence({
  current,
  claims
}: {
  current: EvidenceClaim
  claims: EvidenceClaim[]
}): React.JSX.Element {
  const paired = [
    current,
    ...current.conflictsWith
      .map((claimId) => claims.find((claim) => claim.claimId === claimId))
      .filter((claim): claim is EvidenceClaim => claim !== undefined)
  ]
  return (
    <div className="conflict-evidence-list">
      {paired.map((claim) => (
        <div className="conflict-claim" key={claim.claimId}>
          <code>{summarizeValue(claim.value)}</code>
          <p>
            {claim.sourceId} · {claim.sourceRef}
          </p>
          <small>{claim.claimId}</small>
        </div>
      ))}
    </div>
  )
}

function freshnessLabel(validUntil: string): string {
  const remaining = Date.parse(validUntil) - Date.now()
  if (remaining < 0) return '已过期'
  if (remaining <= 24 * 60 * 60 * 1000) return '临期'
  return '有效'
}

function queryKindFromClaim(claim: EvidenceClaim): XhsQueryKind | null {
  if (claim.sourceId !== 'SRC_XHS' || claim.value === null || Array.isArray(claim.value))
    return null
  if (typeof claim.value !== 'object') return null
  const parsed = XhsQueryKindSchema.safeParse(claim.value['queryKind'])
  return parsed.success ? parsed.data : null
}

function xhsQueryKindLabel(queryKind: XhsQueryKind): string {
  return queryKind === 'POSITIVE_LOCATION' ? '正向检索结果' : '避雷检索结果'
}

function evidenceSourceDescription(claim: EvidenceClaim): string {
  const queryKind = queryKindFromClaim(claim)
  return `${SOURCE_LABELS[claim.sourceId]} · ${claim.contentIdentity}${queryKind ? ` · ${xhsQueryKindLabel(queryKind)}` : ''}`
}

function summarizeValue(value: EvidenceClaim['value']): string {
  const text = JSON.stringify(value)
  return text.length > 220 ? `${text.slice(0, 217)}…` : text
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value)
  )
}
