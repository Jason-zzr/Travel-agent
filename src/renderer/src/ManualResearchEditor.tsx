import React, { useEffect, useState } from 'react'
import {
  ManualResearchChecklistRequestSchema,
  type LeadDisposition,
  type ManualResearchContentIdentity,
  type ManualResearchHardAnchorKind,
  type ManualResearchHardAnchorStatus,
  type ManualResearchItem,
  type ResearchEntityKind
} from '../../shared/schema/d4'
import type { EvidenceClaim } from '../../shared/schema/evidence'

type DraftAnchorStatus = ManualResearchHardAnchorStatus | ''

interface DraftAnchor {
  kind: ManualResearchHardAnchorKind
  status: DraftAnchorStatus
  value: string
  checkedAt: string
  confirmed: boolean
}

interface DraftItem {
  itemId: string
  subject: string
  kind: ResearchEntityKind
  aliases: string
  disposition: LeadDisposition
  sourceLabel: string
  sourceUrl: string
  sourceClaimId: string
  contentIdentity: ManualResearchContentIdentity | ''
  summary: string
  fitnessStatus: 'FIT' | 'RISK' | 'UNKNOWN' | 'EXCLUDED'
  fitnessReasons: string
  hardAnchors: DraftAnchor[]
  confirmed: boolean
}

export function ManualResearchEditor({
  sessionId,
  pasteClaims,
  onSubmit,
  onDirtyChange
}: {
  sessionId: string
  pasteClaims: EvidenceClaim[]
  onSubmit(items: ManualResearchItem[]): Promise<boolean>
  onDirtyChange(dirty: boolean): void
}): React.JSX.Element {
  const [items, setItems] = useState<DraftItem[]>(() => [createDraftItem()])
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function updateItem(itemId: string, patch: Partial<DraftItem>): void {
    setItems((current) =>
      current.map((item) => (item.itemId === itemId ? { ...item, ...patch } : item))
    )
    setDirty(true)
    setError(null)
  }

  function updateAnchor(
    itemId: string,
    kind: ManualResearchHardAnchorKind,
    patch: Partial<DraftAnchor>
  ): void {
    setItems((current) =>
      current.map((item) =>
        item.itemId === itemId
          ? {
              ...item,
              hardAnchors: item.hardAnchors.map((anchor) =>
                anchor.kind === kind ? { ...anchor, ...patch } : anchor
              )
            }
          : item
      )
    )
    setDirty(true)
    setError(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const request = {
      sessionId,
      items: items.map((item) => ({
        itemId: item.itemId,
        subject: item.subject,
        kind: item.kind,
        aliases: splitList(item.aliases),
        disposition: item.disposition,
        sourceLabel: item.sourceLabel,
        sourceUrl: item.sourceUrl.trim() || null,
        sourceClaimId: item.sourceClaimId || null,
        contentIdentity: item.contentIdentity,
        summary: item.summary,
        fitness: { status: item.fitnessStatus, reasons: splitList(item.fitnessReasons) },
        hardAnchors:
          item.disposition === 'MUST_GO'
            ? item.hardAnchors.map((anchor) => ({
                kind: anchor.kind,
                status: anchor.status,
                value: anchor.status === 'KNOWN' ? anchor.value.trim() || null : null,
                checkedAt: dateTimeLocalToIso(anchor.checkedAt),
                confirmed: anchor.confirmed
              }))
            : [],
        confirmed: item.confirmed
      }))
    }
    const parsed = ManualResearchChecklistRequestSchema.safeParse(request)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '人工研究表单未通过校验。')
      return
    }
    if (!(await onSubmit(parsed.data.items))) return
    setItems([createDraftItem()])
    setDirty(false)
    setError(null)
  }

  return (
    <section className="manual-research-editor" aria-label="人工研究清单编辑器">
      <div className="source-card-title">
        <div>
          <h4>人工逐项核验</h4>
          <p className="card-note">完整替代本次自动来源与模型：externalCalls=0 · modelCalls=0</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={items.length >= 30}
          onClick={() => {
            setItems((current) => [...current, createDraftItem()])
            setDirty(true)
          }}
        >
          ＋ 添加研究项
        </button>
      </div>
      <p className="card-note">
        USER_PASTE 只是可选线索。只有你逐项确认的结构化字段会成为 USER_RESEARCH /
        VERIFIED_BY_USER；这不代表独立来源佐证。
      </p>
      <form className="manual-research-form" onSubmit={(event) => void submit(event)}>
        {items.map((item, index) => (
          <section className="manual-research-item" key={item.itemId}>
            <div className="source-card-title">
              <h5>研究项 {index + 1}</h5>
              {items.length > 1 ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setItems((current) =>
                      current.filter((candidate) => candidate.itemId !== item.itemId)
                    )
                    setDirty(true)
                  }}
                >
                  删除
                </button>
              ) : null}
            </div>
            <div className="manual-research-grid">
              <label>
                名称
                <input
                  value={item.subject}
                  maxLength={300}
                  required
                  onChange={(event) => updateItem(item.itemId, { subject: event.target.value })}
                />
              </label>
              <label>
                类型
                <select
                  value={item.kind}
                  onChange={(event) =>
                    updateItem(item.itemId, {
                      kind: event.target.value as ResearchEntityKind
                    })
                  }
                >
                  <option value="ATTRACTION">景点</option>
                  <option value="EXPERIENCE">体验</option>
                  <option value="FOOD">餐饮</option>
                </select>
              </label>
              <label>
                处置
                <select
                  value={item.disposition}
                  onChange={(event) =>
                    updateItem(item.itemId, {
                      disposition: event.target.value as LeadDisposition
                    })
                  }
                >
                  <option value="NEUTRAL">中立</option>
                  <option value="WANT">想去</option>
                  <option value="MUST_GO">必去</option>
                  <option value="EXCLUDE">排除</option>
                </select>
              </label>
              <label>
                来源身份
                <select
                  value={item.contentIdentity}
                  required
                  onChange={(event) =>
                    updateItem(item.itemId, {
                      contentIdentity: event.target.value as ManualResearchContentIdentity
                    })
                  }
                >
                  <option value="">请选择</option>
                  <option value="OFFICIAL">官方</option>
                  <option value="INDEPENDENT_UGC">独立 UGC</option>
                  <option value="COMMERCIAL_OFFER">商业报价</option>
                  <option value="SUSPECTED_PROMOTION">疑似推广</option>
                  <option value="UNKNOWN">未知</option>
                </select>
              </label>
              <label>
                来源名称
                <input
                  value={item.sourceLabel}
                  maxLength={200}
                  required
                  placeholder="公众号、电话、现场公告或网页名称"
                  onChange={(event) => updateItem(item.itemId, { sourceLabel: event.target.value })}
                />
              </label>
              <label>
                安全 HTTPS URL（可选）
                <input
                  value={item.sourceUrl}
                  type="url"
                  placeholder="https://…"
                  onChange={(event) => updateItem(item.itemId, { sourceUrl: event.target.value })}
                />
              </label>
              <label>
                关联 USER_PASTE（可选）
                <select
                  value={item.sourceClaimId}
                  onChange={(event) =>
                    updateItem(item.itemId, { sourceClaimId: event.target.value })
                  }
                >
                  <option value="">直接填写，不关联原始线索</option>
                  {pasteClaims.map((claim) => (
                    <option key={claim.claimId} value={claim.claimId}>
                      {claim.claimId}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                别名（逗号分隔）
                <input
                  value={item.aliases}
                  onChange={(event) => updateItem(item.itemId, { aliases: event.target.value })}
                />
              </label>
              <label>
                成员适配
                <select
                  value={item.fitnessStatus}
                  onChange={(event) =>
                    updateItem(item.itemId, {
                      fitnessStatus: event.target.value as DraftItem['fitnessStatus']
                    })
                  }
                >
                  <option value="UNKNOWN">未知</option>
                  <option value="FIT">适合</option>
                  <option value="RISK">有风险</option>
                  <option value="EXCLUDED">不适合</option>
                </select>
              </label>
            </div>
            <label>
              研究摘要
              <textarea
                value={item.summary}
                rows={3}
                maxLength={4000}
                required
                onChange={(event) => updateItem(item.itemId, { summary: event.target.value })}
              />
            </label>
            <label>
              成员适配理由（逗号分隔，可留空表示未知）
              <input
                value={item.fitnessReasons}
                onChange={(event) =>
                  updateItem(item.itemId, { fitnessReasons: event.target.value })
                }
              />
            </label>
            {item.disposition === 'MUST_GO' ? (
              <fieldset className="manual-hard-anchors">
                <legend>MUST_GO 独立硬锚点（每项都要单独确认，24 小时有效）</legend>
                {item.hardAnchors.map((anchor) => (
                  <div className="manual-hard-anchor" key={anchor.kind}>
                    <strong>{hardAnchorLabel(anchor.kind)}</strong>
                    <label>
                      状态
                      <select
                        value={anchor.status}
                        required
                        onChange={(event) =>
                          updateAnchor(item.itemId, anchor.kind, {
                            status: event.target.value as DraftAnchorStatus,
                            value: event.target.value === 'KNOWN' ? anchor.value : ''
                          })
                        }
                      >
                        <option value="">请选择</option>
                        <option value="KNOWN">已知</option>
                        <option value="UNKNOWN">未知</option>
                        <option value="NOT_APPLICABLE">不适用</option>
                      </select>
                    </label>
                    {anchor.status === 'KNOWN' ? (
                      <label>
                        核验值
                        <input
                          value={anchor.value}
                          maxLength={1000}
                          required
                          onChange={(event) =>
                            updateAnchor(item.itemId, anchor.kind, { value: event.target.value })
                          }
                        />
                      </label>
                    ) : null}
                    <label>
                      最近核验时间
                      <input
                        value={anchor.checkedAt}
                        type="datetime-local"
                        required
                        onChange={(event) =>
                          updateAnchor(item.itemId, anchor.kind, { checkedAt: event.target.value })
                        }
                      />
                    </label>
                    <label className="manual-confirmation">
                      <input
                        checked={anchor.confirmed}
                        type="checkbox"
                        onChange={(event) =>
                          updateAnchor(item.itemId, anchor.kind, {
                            confirmed: event.target.checked
                          })
                        }
                      />
                      我已单独核对这条硬锚点
                    </label>
                  </div>
                ))}
              </fieldset>
            ) : null}
            <label className="manual-confirmation">
              <input
                checked={item.confirmed}
                type="checkbox"
                onChange={(event) => updateItem(item.itemId, { confirmed: event.target.checked })}
              />
              我确认本研究项的结构化事实与来源名称
            </label>
          </section>
        ))}
        {dirty ? (
          <p className="blocking-message">当前人工研究草稿尚未提交，刷新或切换会话会丢失。</p>
        ) : null}
        {error ? (
          <p className="blocking-message" role="alert">
            {error}
          </p>
        ) : null}
        <button className="primary-button" type="submit">
          生成 USER_RESEARCH 清单（0 次外部调用 / 0 次模型调用）
        </button>
      </form>
    </section>
  )
}

function createDraftItem(): DraftItem {
  return {
    itemId: crypto.randomUUID(),
    subject: '',
    kind: 'ATTRACTION',
    aliases: '',
    disposition: 'NEUTRAL',
    sourceLabel: '',
    sourceUrl: '',
    sourceClaimId: '',
    contentIdentity: '',
    summary: '',
    fitnessStatus: 'UNKNOWN',
    fitnessReasons: '',
    hardAnchors: (['OPENING_HOURS', 'CLOSURE_SCHEDULE', 'RESERVATION_REQUIREMENT'] as const).map(
      (kind) => ({ kind, status: '', value: '', checkedAt: '', confirmed: false })
    ),
    confirmed: false
  }
}

function splitList(value: string): string[] {
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function dateTimeLocalToIso(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value
}

function hardAnchorLabel(kind: ManualResearchHardAnchorKind): string {
  if (kind === 'OPENING_HOURS') return '开放时间'
  if (kind === 'CLOSURE_SCHEDULE') return '闭园安排'
  return '预约要求'
}
