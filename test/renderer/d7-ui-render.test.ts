import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TasksView } from '../../src/renderer/src/TasksView'
import { D7SnapshotSchema } from '../../src/shared/schema/d7'

test('D7 task center renders handover, blockers, controlled actions and local-only audit', () => {
  const snapshot = D7SnapshotSchema.parse({
    sessionId: 'session-d7-ui',
    routeId: 'route-yunnan',
    stage: 'STAGE_5',
    currentVersion: 1,
    tasks: [
      {
        taskId: 'task-reservation',
        sessionId: 'session-d7-ui',
        sourceTimelineVersion: 1,
        itemId: 'item-poi',
        claimIds: ['claim-reservation'],
        kind: 'RESERVATION_TICKET',
        title: '办理“预约景点”预约或购票',
        owner: 'USER',
        dueAt: '2026-09-08T08:00:00.000Z',
        recheckAt: '2026-09-07T08:00:00.000Z',
        priority: 'HIGH',
        userDecision: 'PENDING',
        reservation: 'NOT_STARTED',
        readiness: 'UNKNOWN',
        payment: 'NA',
        document: 'NA',
        refund: 'NA',
        reminder: 'NA',
        handover: {
          action: '由用户在外部官方渠道办理预约。',
          channelLabel: '景点官方预约页',
          channelUrl: 'https://official.example/reserve',
          requiredInformation: ['日期、时段与人数'],
          warnings: ['系统不会代替用户支付。'],
          deadline: '2026-09-08T08:00:00.000Z',
          deadlineSource: 'EXPLICIT',
          checklist: ['确认对象、日期与时段', '完成后回填结果'],
          evidenceStatus: 'VERIFIED'
        },
        routeContext: {
          routeId: 'route-yunnan',
          dayType: 'INTERCITY_TRANSFER_DAY',
          role: 'STAY_CHECKIN',
          nodeId: 'node-dali',
          segmentId: 'stay-dali',
          routeLegId: 'leg-gz-dali',
          fromNodeId: null,
          toNodeId: 'node-dali'
        },
        updatedAt: '2026-09-01T00:00:00.000Z'
      }
    ],
    latestGateC: {
      gateId: 'GATE_C',
      evaluatedAt: '2026-09-01T00:00:00.000Z',
      ready: false,
      timelineVersion: 1,
      routeId: 'route-yunnan',
      blockers: [
        {
          code: 'HIGH_PRIORITY_TASK_PENDING',
          message: '高优先级任务尚未完成。',
          itemId: 'item-poi',
          taskId: 'task-reservation',
          claimIds: ['claim-reservation'],
          routeContext: {
            routeId: 'route-yunnan',
            dayType: 'INTERCITY_TRANSFER_DAY',
            role: 'STAY_CHECKIN',
            nodeId: 'node-dali',
            segmentId: 'stay-dali',
            routeLegId: 'leg-gz-dali',
            fromNodeId: null,
            toNodeId: 'node-dali'
          }
        }
      ],
      taskIds: ['task-reservation'],
      claimIds: ['claim-reservation']
    },
    audit: { externalCalls: 0, modelCalls: 0, irreversibleActions: 0 }
  })
  const markup = renderToStaticMarkup(
    createElement(TasksView, {
      initialSessions: [
        {
          sessionId: snapshot.sessionId,
          title: 'D7 行程',
          stage: 'STAGE_5',
          linkedSessionGroup: null,
          splitIndex: null
        }
      ],
      initialSnapshot: snapshot,
      onShowTimeline: () => undefined,
      onShowEvidence: () => undefined
    })
  )

  assert.match(markup, /出发前检查阻塞/)
  assert.match(markup, /高优先级任务尚未完成/)
  assert.match(markup, /景点官方预约页/)
  assert.match(markup, /打开官方渠道/)
  assert.match(markup, /我已在外部完成/)
  assert.match(markup, /定位证据/)
  assert.match(markup, /外部调用 0 次/)
  assert.match(markup, /整程路线：route-yunnan/)
  assert.match(markup, /node-dali · stay-dali · leg-gz-dali/)
  assert.doesNotMatch(markup, /apiKey|credentials|rawPayload|sourceRef/)
})
