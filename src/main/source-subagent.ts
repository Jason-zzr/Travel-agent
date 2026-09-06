import { randomUUID } from 'node:crypto'
import { AppError } from '../shared/errors'
import {
  SourceSubagentResultSchema,
  SourceSubagentTaskSchema,
  type SourceSubagentResult,
  type SourceSubagentTask
} from '../shared/schema/d4'

export type SourceSubagentCapability = (
  task: Readonly<SourceSubagentTask>,
  operationId?: string
) => Promise<readonly string[]>

const FAILURE_DETAILS = {
  SRC_SEARCH: {
    capabilityImpact: '公开页面与最新公告无法自动检索',
    manualAlternative: '请粘贴官方页面或手工确认开放信息。'
  },
  SRC_MAP: {
    capabilityImpact: '地点身份与坐标无法自动核验',
    manualAlternative: '请从可信地图复制地点名称与地址，作为待核验线索。'
  },
  SRC_XHS: {
    capabilityImpact: '小红书正向体验与避雷信号无法自动交叉核验',
    manualAlternative: '请手工搜索目的地和“避雷 + 目的地”，再粘贴公开链接。'
  }
} as const

export function buildXhsDestinationTasks(input: {
  sessionId: string
  destination: string
  memberConstraints: SourceSubagentTask['memberConstraints']
  scope?: SourceSubagentTask['scope']
}): SourceSubagentTask[] {
  const destination = input.destination.normalize('NFKC').trim()
  return [
    SourceSubagentTaskSchema.parse({
      taskId: randomUUID(),
      sessionId: input.sessionId,
      sourceId: 'SRC_XHS',
      destination,
      query: destination,
      queryKind: 'POSITIVE_LOCATION',
      toolName: 'search_feeds',
      memberConstraints: input.memberConstraints,
      scope: input.scope ?? null
    }),
    SourceSubagentTaskSchema.parse({
      taskId: randomUUID(),
      sessionId: input.sessionId,
      sourceId: 'SRC_XHS',
      destination,
      query: `避雷 ${destination}`,
      queryKind: 'NEGATIVE_AVOIDANCE',
      toolName: 'search_feeds',
      memberConstraints: input.memberConstraints,
      scope: input.scope ?? null
    })
  ]
}

export class SourceSubagentRunner {
  private serialTail: Promise<void> = Promise.resolve()

  constructor(private readonly invokeReviewedTool: SourceSubagentCapability) {}

  async runSerial(
    tasks: readonly SourceSubagentTask[],
    operationId?: string
  ): Promise<SourceSubagentResult[]> {
    const parsedTasks = tasks.map((task) => Object.freeze(SourceSubagentTaskSchema.parse(task)))
    const results: SourceSubagentResult[] = []
    for (const task of parsedTasks) {
      const run = this.serialTail.then(() => this.runOne(task, operationId))
      this.serialTail = run.then(
        () => undefined,
        () => undefined
      )
      results.push(await run)
    }
    return results
  }

  private async runOne(
    task: Readonly<SourceSubagentTask>,
    operationId?: string
  ): Promise<SourceSubagentResult> {
    try {
      const claimIds = [...(await this.invokeReviewedTool(task, operationId))]
      return SourceSubagentResultSchema.parse({
        taskId: task.taskId,
        sourceId: task.sourceId,
        status: 'SUCCEEDED',
        ...(task.sourceId === 'SRC_XHS' ? { queryKind: task.queryKind } : {}),
        claimIds,
        scope: task.scope
      })
    } catch (error) {
      const details = FAILURE_DETAILS[task.sourceId]
      return SourceSubagentResultSchema.parse({
        taskId: task.taskId,
        sourceId: task.sourceId,
        status: 'FAILED',
        ...(task.sourceId === 'SRC_XHS' ? { queryKind: task.queryKind } : {}),
        claimIds: [],
        errorCode: error instanceof AppError ? error.code : 'SOURCE_UNREACHABLE',
        capabilityImpact: details.capabilityImpact,
        manualAlternative: details.manualAlternative,
        scope: task.scope
      })
    }
  }
}
