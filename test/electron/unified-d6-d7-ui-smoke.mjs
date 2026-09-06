import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-unified-d6-d7-ui-'))
app.setPath('userData', root)
app.disableHardwareAcceleration()
if (process.argv.includes('--smoke-no-gpu')) {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}
app.once('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* platform cache may still be open */
  }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const ok = (data) => ({ ok: true, data })
const routeId = 'route-yunnan-unified'
const yunnanSession = {
  sessionId: 'unified-route-smoke',
  title: '广州到云南 10 天统一路线',
  stage: 'STAGE_5',
  linkedSessionGroup: null,
  splitIndex: null
}
const legacySession = {
  sessionId: 'legacy-route-smoke',
  title: '旧单城市兼容会话',
  stage: 'STAGE_5',
  linkedSessionGroup: null,
  splitIndex: null
}
const sessions = [yunnanSession, legacySession]
const legContext = {
  routeId,
  dayType: 'INTERCITY_TRANSFER_DAY',
  role: 'INTERCITY_LEG',
  nodeId: 'node-dali',
  segmentId: null,
  routeLegId: 'leg-guangzhou-dali',
  fromNodeId: 'node-guangzhou',
  toNodeId: 'node-dali'
}
const stayContext = {
  routeId,
  dayType: 'INTERCITY_TRANSFER_DAY',
  role: 'STAY_CHECKIN',
  nodeId: 'node-dali',
  segmentId: 'stay-dali',
  routeLegId: 'leg-guangzhou-dali',
  fromNodeId: null,
  toNodeId: 'node-dali'
}
const sourceOutcomes = [
  {
    sourceId: 'SRC_MAP',
    capability: 'ROUTE_ETA',
    status: 'SUCCEEDED',
    claimCount: 1,
    externalCallCount: 0,
    errorCode: null,
    capabilityImpact: null,
    manualAlternative: null
  }
]
const timelineItems = [
  {
    itemId: 'route-leg-guangzhou-dali',
    date: '2026-10-01',
    startTime: '08:00',
    endTime: '12:00',
    crossesMidnight: false,
    title: '广州前往大理',
    itemClass: 'FIXED',
    anchorClass: 'HARD_LOCKED',
    location: {
      name: '大理站',
      kind: 'STATION',
      address: null,
      coordinates: null
    },
    arrivalTransport: {
      mode: 'RAIL',
      from: '广州南站',
      to: '大理站',
      etaMinutes: 240,
      claimIds: ['claim-leg-guangzhou-dali']
    },
    bufferMinutes: 30,
    costCents: null,
    claimIds: ['claim-leg-guangzhou-dali'],
    verificationSummary: {
      status: 'VERIFIED',
      claimCount: 1,
      allClaimsUsable: true
    },
    routeContext: legContext
  },
  {
    itemId: 'route-backup-dali',
    date: '2026-10-01',
    startTime: '18:00',
    endTime: '18:00',
    crossesMidnight: false,
    title: '大理雨天备用项',
    itemClass: 'BACKUP',
    anchorClass: 'FLEXIBLE',
    location: {
      name: '大理室内备用点',
      kind: 'POI',
      address: null,
      coordinates: null
    },
    arrivalTransport: null,
    bufferMinutes: 0,
    costCents: null,
    claimIds: ['claim-backup-dali'],
    verificationSummary: {
      status: 'CORROBORATED',
      claimCount: 1,
      allClaimsUsable: true
    },
    routeContext: {
      routeId,
      dayType: 'INTERCITY_TRANSFER_DAY',
      role: 'BACKUP',
      nodeId: 'node-dali',
      segmentId: 'stay-dali',
      routeLegId: null,
      fromNodeId: null,
      toNodeId: null
    }
  }
]

let routeDraft = null
let routeVersion = null
let routeTask = null
let routeGate = null
let firstD6RouteSnapshot = true
let firstD7RouteSnapshot = true
let exportCount = 0

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function d6Snapshot(sessionId) {
  if (sessionId === legacySession.sessionId) {
    return {
      sessionId,
      stage: 'STAGE_5',
      currentVersion: null,
      versions: [],
      selectedVersion: null,
      draft: null,
      publishability: { publishable: false, blockingItems: [] },
      sourceOutcomes: []
    }
  }
  return {
    sessionId,
    routeId,
    stage: 'STAGE_5',
    currentVersion: routeVersion?.version ?? null,
    versions: routeVersion
      ? [
          {
            version: routeVersion.version,
            createdAt: routeVersion.createdAt,
            summary: routeVersion.summary,
            isCurrent: true,
            routeId
          }
        ]
      : [],
    selectedVersion: routeVersion,
    draft: routeDraft,
    publishability:
      routeDraft?.gate ??
      (routeVersion
        ? { publishable: true, blockingItems: [] }
        : { publishable: false, blockingItems: [] }),
    sourceOutcomes
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function d7Snapshot(sessionId) {
  if (sessionId === legacySession.sessionId) {
    return {
      sessionId,
      stage: 'STAGE_5',
      currentVersion: 1,
      tasks: [],
      latestGateC: null,
      audit: { externalCalls: 0, modelCalls: 0, irreversibleActions: 0 }
    }
  }
  return {
    sessionId,
    routeId,
    stage: 'STAGE_5',
    currentVersion: 1,
    tasks: routeTask ? [routeTask] : [],
    latestGateC: routeGate,
    audit: { externalCalls: 0, modelCalls: 0, irreversibleActions: 0 }
  }
}

ipcMain.handle('sessions:list', () => ok(sessions))
ipcMain.handle('d4:snapshot', (_, request) =>
  ok({
    sessionId: request.sessionId,
    stage: 'STAGE_5',
    destinationCandidates: [],
    selectedDestinationCandidateId: null,
    researchEntities: [],
    researchChecklistConfirmed: true,
    conflictResolutions: [],
    sourceResearchFailures: []
  })
)
ipcMain.handle('evidence:list', () => ok([]))
ipcMain.handle('timeline:snapshot', async (_, request) => {
  if (request.sessionId === yunnanSession.sessionId && firstD6RouteSnapshot) {
    firstD6RouteSnapshot = false
    await delay(220)
  }
  return ok(d6Snapshot(request.sessionId))
})
ipcMain.handle('timeline:prepare', (_, request) => {
  assert.equal(request.sessionId, yunnanSession.sessionId)
  assert.equal(request.routeId, routeId)
  assert.match(request.operationId, /^[0-9a-f-]{36}$/)
  routeDraft = {
    draftId: '11111111-1111-4111-8111-111111111111',
    sessionId: yunnanSession.sessionId,
    routeId,
    createdAt: '2026-08-31T08:00:00.000Z',
    summary: '广州到云南 10 天统一时间轴',
    items: timelineItems,
    gate: { publishable: true, blockingItems: [] },
    sourceOutcomes,
    changedDates: ['2026-10-01']
  }
  return ok(d6Snapshot(request.sessionId))
})
ipcMain.handle('timeline:publish', (_, request) => {
  assert.equal(request.sessionId, yunnanSession.sessionId)
  assert.equal(request.routeId, routeId)
  assert.equal(request.draftId, routeDraft?.draftId)
  routeVersion = {
    version: 1,
    createdAt: '2026-08-31T08:01:00.000Z',
    summary: routeDraft.summary,
    isCurrent: true,
    routeId,
    items: routeDraft.items,
    decision: {
      decisionId: 'decision-unified-route',
      category: 'TIMELINE_PUBLISH',
      selected: 'version-1',
      reason: '整条路线发布门禁通过',
      alternatives: [],
      claimIds: timelineItems.flatMap((item) => item.claimIds)
    }
  }
  routeDraft = null
  return ok(d6Snapshot(request.sessionId))
})
ipcMain.handle('d6:cancel', () => ok(true))
ipcMain.handle('d7:snapshot', async (_, request) => {
  if (request.sessionId === yunnanSession.sessionId && firstD7RouteSnapshot) {
    firstD7RouteSnapshot = false
    await delay(220)
  }
  return ok(d7Snapshot(request.sessionId))
})
ipcMain.handle('task:derive', (_, request) => {
  assert.equal(request.sessionId, yunnanSession.sessionId)
  assert.equal(request.routeId, routeId)
  routeTask = {
    taskId: 'task-stay-dali',
    sessionId: yunnanSession.sessionId,
    sourceTimelineVersion: 1,
    itemId: 'route-leg-guangzhou-dali',
    claimIds: ['claim-leg-guangzhou-dali'],
    kind: 'RESERVATION_TICKET',
    title: '确认大理住宿入住信息',
    owner: 'USER',
    dueAt: '2026-09-30T08:00:00.000Z',
    recheckAt: '2026-09-29T08:00:00.000Z',
    priority: 'HIGH',
    userDecision: 'PENDING',
    reservation: 'NOT_STARTED',
    readiness: 'UNKNOWN',
    payment: 'NA',
    document: 'NA',
    refund: 'NA',
    reminder: 'NA',
    handover: {
      action: '由用户核对大理住宿入住信息。',
      channelLabel: null,
      channelUrl: null,
      requiredInformation: ['入住日期与人数'],
      warnings: ['缺少可核验官方渠道。'],
      deadline: '2026-09-30T08:00:00.000Z',
      deadlineSource: 'EXPLICIT',
      checklist: ['核对住宿段与入住日期', '完成后回填结果'],
      evidenceStatus: 'VERIFIED'
    },
    routeContext: stayContext,
    updatedAt: '2026-08-31T08:02:00.000Z'
  }
  return ok(d7Snapshot(request.sessionId))
})
ipcMain.handle('gate-c:run', (_, request) => {
  assert.equal(request.sessionId, yunnanSession.sessionId)
  assert.equal(request.routeId, routeId)
  routeGate = {
    gateId: 'GATE_C',
    evaluatedAt: '2026-08-31T08:03:00.000Z',
    ready: false,
    timelineVersion: 1,
    routeId,
    blockers: [
      {
        code: 'STAY_SEGMENT_UNVERIFIED',
        message: '大理住宿段仍需核验。',
        itemId: routeTask.itemId,
        taskId: routeTask.taskId,
        claimIds: routeTask.claimIds,
        routeContext: stayContext
      }
    ],
    taskIds: [routeTask.taskId],
    claimIds: routeTask.claimIds
  }
  return ok(d7Snapshot(request.sessionId))
})
ipcMain.handle('itinerary:export', (_, request) => {
  assert.equal(request.sessionId, yunnanSession.sessionId)
  assert.equal(request.routeId, routeId)
  exportCount += 1
  return ok({
    kind: request.format,
    savedPath: path.join(root, request.format === 'ICS' ? 'yunnan.ics' : 'yunnan.md'),
    itemCount: timelineItems.length,
    bytes: 256
  })
})

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 820,
      height: 940,
      show: false,
      webPreferences: {
        preload: path.join(process.cwd(), 'out', 'preload', 'index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    try {
      await window.loadFile(path.join(process.cwd(), 'out', 'renderer', 'index.html'))
      await wait(window, 180)
      await clickButton(window, 'TIMELINE')
      await wait(window, 30)
      await selectSession(window, '.d6-sidebar select', legacySession.sessionId)
      await wait(window, 300)
      let text = await window.webContents.executeJavaScript('document.body.innerText')
      assert.doesNotMatch(text, new RegExp(routeId))

      await selectSession(window, '.d6-sidebar select', yunnanSession.sessionId)
      await wait(window, 100)
      await clickButton(window, '生成分钟级草稿')
      await wait(window, 100)
      text = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(text, new RegExp(`整程路线：${routeId}`))
      assert.match(text, /跨城路段/)
      assert.match(text, /leg-guangzhou-dali/)
      await clickButton(window, '发布为新版本')
      await wait(window, 100)

      await assertNoHorizontalOverflow(window, 820)
      await assertNoHorizontalOverflow(window, 320)

      await clickButton(window, 'TASKS')
      await wait(window, 30)
      await selectSession(window, '.tasks-sidebar select', legacySession.sessionId)
      await wait(window, 300)
      text = await window.webContents.executeJavaScript('document.body.innerText')
      assert.doesNotMatch(text, new RegExp(routeId))

      await selectSession(window, '.tasks-sidebar select', yunnanSession.sessionId)
      await wait(window, 100)
      await clickButton(window, '从当前时间轴生成任务')
      await wait(window, 100)
      await clickButton(window, '执行 GATE_C')
      await wait(window, 100)
      text = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(text, new RegExp(`整程路线：${routeId}`))
      assert.match(text, /stay-dali/)
      assert.match(text, /大理住宿段仍需核验/)
      await clickButton(window, '导出 Markdown')
      await wait(window, 60)
      assert.equal(exportCount, 1)
      assert.doesNotMatch(text, /sourceRef|rawPayload|credentials/)
      await assertNoHorizontalOverflow(window, 320)

      const artifactDir = path.join(process.cwd(), 'test', 'artifacts')
      fs.mkdirSync(artifactDir, { recursive: true })
      fs.writeFileSync(
        path.join(artifactDir, 'unified-d6-d7-ui-smoke.png'),
        (await window.webContents.capturePage()).toPNG()
      )
      fs.writeFileSync(
        path.join(artifactDir, 'unified-d6-d7-ui-smoke.json'),
        `${JSON.stringify(
          {
            ok: true,
            checked: {
              routeScopedD6Mutations: true,
              routeScopedD7Mutations: true,
              staleSessionResponsesIgnored: true,
              legacySessionCompatible: true,
              widths: [820, 320]
            },
            externalCalls: 0,
            modelCalls: 0,
            irreversibleActions: 0
          },
          null,
          2
        )}\n`
      )
      console.log(
        JSON.stringify({ ok: true, externalCalls: 0, modelCalls: 0, irreversibleActions: 0 })
      )
    } finally {
      window.destroy()
      app.quit()
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function clickButton(window, text) {
  await window.webContents.executeJavaScript(
    `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === ${JSON.stringify(text)})?.click()`
  )
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function selectSession(window, selector, sessionId) {
  await window.webContents.executeJavaScript(
    `(() => { const select = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, ${JSON.stringify(sessionId)}); select.dispatchEvent(new Event('change', { bubbles: true })); })()`
  )
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function assertNoHorizontalOverflow(window, width) {
  window.setBounds({ width, height: 940 })
  await wait(window, 100)
  const layout = await window.webContents.executeJavaScript(
    `({ innerWidth, scrollWidth: document.documentElement.scrollWidth })`
  )
  assert.equal(layout.innerWidth, width)
  assert.ok(
    layout.scrollWidth <= width,
    `horizontal overflow at ${width}px: ${layout.scrollWidth}px`
  )
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function wait(window, milliseconds) {
  await window.webContents.executeJavaScript(
    `new Promise((resolve) => setTimeout(resolve, ${milliseconds}))`
  )
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
