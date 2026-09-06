import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from '../../shared/errors'
import type { GateCReport, InspectorSnapshot, PreparationTask } from '../../shared/schema/d7'
import type { TimelineItem, TimelineVersion } from '../../shared/schema/d6'
import { exportTemporaryPath } from '../paths'

export interface PreparedExport {
  kind: 'ICS' | 'MARKDOWN' | 'DIAGNOSTIC'
  suggestedFileName: string
  content: string
  itemCount: number
}

export interface ItineraryExportInput {
  sessionId: string
  timeline: TimelineVersion
  tasks: PreparationTask[]
  gate: GateCReport | null
}

const SensitiveKey =
  /(?:api[_-]?key|authorization|bearer|credential|secret|password|ciphertext|encrypted)/i
const SensitiveValue =
  /(?:\bsk-[A-Za-z0-9_-]{16,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*|\b(?:v10|v11)[A-Za-z0-9+/=]{20,}\b)/i

export function prepareItineraryExport(
  input: ItineraryExportInput,
  format: 'ICS' | 'MARKDOWN'
): PreparedExport {
  const content =
    format === 'ICS' ? buildIcs(input.sessionId, input.timeline) : buildMarkdown(input)
  assertNoSecrets(content)
  return {
    kind: format,
    suggestedFileName: `travel-${safeFileSegment(input.sessionId)}-v${input.timeline.version}.${format === 'ICS' ? 'ics' : 'md'}`,
    content,
    itemCount: input.timeline.items.length
  }
}

export function prepareDiagnosticExport(snapshot: InspectorSnapshot): PreparedExport {
  const safe = stripSensitiveFields(snapshot)
  const content = `${JSON.stringify({ formatVersion: 1, generatedAt: new Date().toISOString(), inspector: safe }, null, 2)}\n`
  assertNoSecrets(content)
  return {
    kind: 'DIAGNOSTIC',
    suggestedFileName: `travel-diagnostic-${safeFileSegment(snapshot.query.sessionId)}.json`,
    content,
    itemCount:
      snapshot.events.length +
      snapshot.toolCalls.length +
      snapshot.modelCalls.length +
      snapshot.blockedTools.length
  }
}

export async function writePreparedExport(
  targetPath: string,
  prepared: PreparedExport
): Promise<{ bytes: number }> {
  assertNoSecrets(prepared.content)
  const temporaryPath = exportTemporaryPath(targetPath)
  await mkdir(dirname(targetPath), { recursive: true })
  const handle = await open(temporaryPath, 'wx', 0o600)
  let closed = false
  try {
    await handle.writeFile(prepared.content, 'utf8')
    await handle.sync()
    await handle.close()
    closed = true
    await rename(temporaryPath, targetPath)
    return { bytes: Buffer.byteLength(prepared.content, 'utf8') }
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export function assertNoSecrets(content: string): void {
  if (SensitiveKey.test(content) || SensitiveValue.test(content)) {
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', '导出内容触发凭据安全检查。', {
      userHint: '导出已中止，未写入文件。请在 Inspector 查看本机诊断信息。'
    })
  }
}

function buildIcs(sessionId: string, timeline: TimelineVersion): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Travel Harness//M0//ZH-CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`行程 ${sessionId}${timeline.routeId ? ` / 路线 ${timeline.routeId}` : ''}`)}`
  ]
  for (const item of timeline.items) {
    const eventLines = [
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(`${item.itemId}@travel-harness.local`)}`,
      `DTSTAMP:${formatIcsUtc(timeline.createdAt)}`,
      `DTSTART:${formatTimelineTime(item, false)}`,
      `SUMMARY:${escapeIcsText(`${routeRolePrefix(item)}${item.title}`)}`,
      `LOCATION:${escapeIcsText(
        timeline.routeId
          ? item.location.name
          : [item.location.name, item.location.address].filter(Boolean).join('，')
      )}`,
      `DESCRIPTION:${escapeIcsText(
        [item.itemClass, item.anchorClass, item.verificationSummary.status, routeScopeLabel(item)]
          .filter(Boolean)
          .join(' / ')
      )}`
    ]
    if (item.itemClass !== 'BACKUP') {
      eventLines.splice(4, 0, `DTEND:${formatTimelineTime(item, true)}`)
    }
    lines.push(...eventLines, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.flatMap(foldIcsLine).join('\r\n')}\r\n`
}

function buildMarkdown(input: ItineraryExportInput): string {
  const byDate = Map.groupBy([...input.timeline.items].sort(compareItems), (item) => item.date)
  const lines = [
    `# 行程 ${input.sessionId}`,
    '',
    `- 时间轴版本：v${input.timeline.version}`,
    ...(input.timeline.routeId ? [`- 路线：${input.timeline.routeId}`] : []),
    `- 生成时间：${input.timeline.createdAt}`,
    `- GATE_C：${input.gate ? (input.gate.ready ? 'READY' : 'BLOCKED') : '尚未执行'}`,
    ''
  ]
  if (input.timeline.routeId) {
    lines.push('## 整程路线', '', ...routeSpine(input.timeline).map((entry) => `- ${entry}`), '')
  }
  for (const [date, items] of byDate) {
    lines.push(`## ${date}`, '')
    for (const item of items) {
      const time = item.itemClass === 'BACKUP' ? '备用' : `${item.startTime}–${item.endTime}`
      lines.push(
        `- ${time} ${item.title}（${item.itemClass} / ${item.anchorClass}）`,
        `  - 地点：${item.location.name}${!input.timeline.routeId && item.location.address ? `，${item.location.address}` : ''}`,
        `  - 核验：${item.verificationSummary.status}；Claim ${item.claimIds.length} 条`,
        ...(item.routeContext ? [`  - 路线作用域：${routeScopeLabel(item)}`] : [])
      )
    }
    lines.push('')
  }
  lines.push('## 出发前任务', '')
  if (input.tasks.length === 0) lines.push('- 暂无任务。')
  for (const task of input.tasks) {
    lines.push(
      `- [${task.readiness === 'READY' ? 'x' : ' '}] ${task.title}`,
      `  - 截止：${task.dueAt}；优先级：${task.priority}；状态：${task.readiness}`,
      `  - 交接：${task.handover.action}`,
      ...(task.routeContext
        ? [
            `  - 路线作用域：${[
              task.routeContext.nodeId,
              task.routeContext.segmentId,
              task.routeContext.routeLegId
            ]
              .filter(Boolean)
              .join(' / ')}`
          ]
        : [])
    )
    if (task.handover.channelLabel) lines.push(`  - 官方渠道：${task.handover.channelLabel}`)
    if (task.handover.channelUrl) lines.push(`  - 链接：${task.handover.channelUrl}`)
  }
  if (input.gate && input.gate.blockers.length > 0) {
    lines.push('', '## GATE_C 阻塞项', '')
    for (const blocker of input.gate.blockers) lines.push(`- ${blocker.message}`)
  }
  return `${lines.join('\n').trimEnd()}\n`
}

function routeSpine(timeline: TimelineVersion): string[] {
  const result: string[] = []
  for (const item of [...timeline.items].sort(compareItems)) {
    const context = item.routeContext
    if (!context || context.role === 'BACKUP') continue
    const label =
      context.role === 'INTERCITY_LEG'
        ? `${context.fromNodeId ?? '广州'} → ${context.toNodeId ?? '广州'}（${context.routeLegId}）`
        : context.nodeId
          ? `${context.nodeId}（${context.segmentId ?? context.role}）`
          : null
    if (label && result.at(-1) !== label) result.push(label)
  }
  return result
}

function routeRolePrefix(item: TimelineItem): string {
  if (item.routeContext?.role === 'INTERCITY_LEG') return '[跨城] '
  if (item.routeContext?.role === 'STAY_CHECKIN') return '[入住] '
  if (item.routeContext?.role === 'STAY_CHECKOUT') return '[退房] '
  if (item.routeContext && item.anchorClass === 'MUST') return '[必去] '
  return ''
}

function routeScopeLabel(item: TimelineItem): string {
  const context = item.routeContext
  if (!context) return ''
  return [context.routeId, context.nodeId, context.segmentId, context.routeLegId, context.role]
    .filter(Boolean)
    .join(' / ')
}

function stripSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitiveFields)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SensitiveKey.test(key))
        .map(([key, child]) => [key, stripSensitiveFields(child)])
    )
  }
  return value
}

function formatTimelineTime(item: TimelineItem, end: boolean): string {
  const base = new Date(`${item.date}T${end ? item.endTime : item.startTime}:00+08:00`)
  if (end && item.crossesMidnight) base.setUTCDate(base.getUTCDate() + 1)
  return formatIcsUtc(base.toISOString())
}

function formatIcsUtc(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function foldIcsLine(line: string): string[] {
  const chunks: string[] = []
  let remaining = line
  while (Buffer.byteLength(remaining, 'utf8') > 73) {
    let offset = 1
    while (
      offset < remaining.length &&
      Buffer.byteLength(remaining.slice(0, offset + 1), 'utf8') <= 73
    ) {
      offset += 1
    }
    chunks.push(remaining.slice(0, offset))
    remaining = ` ${remaining.slice(offset)}`
  }
  chunks.push(remaining)
  return chunks
}

function compareItems(left: TimelineItem, right: TimelineItem): number {
  return left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime)
}

function safeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80)
}
