import { createHash } from 'node:crypto'
import { AppError } from '../../shared/errors'
import {
  TaskUpdatedPayloadWriteSchema,
  type PreparationTask,
  type TaskUpdateAction,
  type TaskUpdatedPayload
} from '../../shared/schema/d7'
import { TimelineVersionSchema, type TimelineVersion } from '../../shared/schema/d6'

export interface ApplyTaskUpdateInput {
  tasks: PreparationTask[]
  currentTimeline: TimelineVersion
  taskId: string
  expectedUpdatedAt: string
  action: TaskUpdateAction
  now: string
}

export function applyTaskUpdate(input: ApplyTaskUpdateInput): TaskUpdatedPayload {
  const task = input.tasks.find((candidate) => candidate.taskId === input.taskId)
  if (!task) throw new AppError('INPUT_INVALID', '任务不存在或已被替换。')
  if (task.updatedAt !== input.expectedUpdatedAt) {
    throw new AppError('INPUT_INVALID', '任务已更新，请刷新后重试。')
  }

  if (input.action === 'CONFIRM_EXTERNAL_RESULT') {
    if (task.kind !== 'RESERVATION_TICKET') {
      throw new AppError('INPUT_INVALID', '只有预约票务任务可以回填外部办理结果。')
    }
    return confirmReservation(input, task)
  }

  const updatedTask: PreparationTask = {
    ...task,
    userDecision: input.action === 'SKIP' ? 'SKIPPED' : 'ACCEPTED',
    readiness: input.action === 'SKIP' ? 'BLOCKED' : 'READY',
    updatedAt: input.now
  }
  return TaskUpdatedPayloadWriteSchema.parse({
    tasks: input.tasks.map((candidate) =>
      candidate.taskId === task.taskId ? updatedTask : candidate
    ),
    updatedTaskId: task.taskId,
    reason: input.action === 'SKIP' ? 'USER_SKIPPED' : 'USER_CONFIRMED',
    replacementTimeline: null,
    decision: null
  })
}

function confirmReservation(
  input: ApplyTaskUpdateInput,
  task: PreparationTask
): TaskUpdatedPayload {
  const nextVersion = input.currentTimeline.version + 1
  const itemIdMap = new Map(
    input.currentTimeline.items.map((item) => [
      item.itemId,
      stableId('item', `${item.itemId}\n${nextVersion}`)
    ])
  )
  if (!itemIdMap.has(task.itemId)) {
    throw new AppError('INTERNAL_INVARIANT_VIOLATED', '任务关联的时间轴项目不存在。')
  }
  const decision = {
    decisionId: stableId('decision', `${task.taskId}\n${input.now}`),
    category: 'EXTERNAL_RESULT_CONFIRMED',
    selected: `${task.taskId}:confirmed`,
    reason: `用户确认已在外部完成“${task.title}”。`,
    alternatives: [`保持“${task.title}”为未确认状态`],
    claimIds: task.claimIds
  }
  const replacementTimeline = TimelineVersionSchema.parse({
    version: nextVersion,
    createdAt: input.now,
    summary: `确认外部办理结果：${task.title}`,
    isCurrent: true,
    routeId: input.currentTimeline.routeId ?? null,
    items: input.currentTimeline.items.map((item) => ({
      ...item,
      itemId: itemIdMap.get(item.itemId),
      anchorClass: item.itemId === task.itemId ? 'CONFIRMED_EXTERNAL' : item.anchorClass
    })),
    decision
  })
  const tasks = input.tasks.map((candidate) => ({
    ...candidate,
    sourceTimelineVersion: nextVersion,
    itemId: itemIdMap.get(candidate.itemId),
    userDecision: candidate.taskId === task.taskId ? 'ACCEPTED' : candidate.userDecision,
    reservation: candidate.taskId === task.taskId ? 'DONE' : candidate.reservation,
    readiness: candidate.taskId === task.taskId ? 'READY' : candidate.readiness,
    updatedAt: input.now
  }))
  return TaskUpdatedPayloadWriteSchema.parse({
    tasks,
    updatedTaskId: task.taskId,
    reason: 'USER_CONFIRMED',
    replacementTimeline,
    decision
  })
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 32)}`
}
