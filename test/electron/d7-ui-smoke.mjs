import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-d7-ui-'))
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
const session = {
  sessionId: 'd7-smoke',
  title: '成都任务中心夹具',
  stage: 'STAGE_5',
  linkedSessionGroup: null,
  splitIndex: null
}
let task = null
let currentVersion = 1
let gate = null
let externalOpenCount = 0
let exportCount = 0
let diagnosticExportCount = 0

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function d7Snapshot() {
  return {
    sessionId: session.sessionId,
    stage: 'STAGE_5',
    currentVersion,
    tasks: task ? [task] : [],
    latestGateC: gate,
    audit: { externalCalls: 0, modelCalls: 0, irreversibleActions: 0 }
  }
}

ipcMain.handle('sessions:list', () => ok([session]))
ipcMain.handle('d4:snapshot', () =>
  ok({
    sessionId: session.sessionId,
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
ipcMain.handle('d7:snapshot', (_, request) => {
  assert.equal(request.sessionId, session.sessionId)
  return ok(d7Snapshot())
})
ipcMain.handle('task:derive', (_, request) => {
  assert.equal(request.sessionId, session.sessionId)
  task = {
    taskId: 'task-reservation',
    sessionId: session.sessionId,
    sourceTimelineVersion: currentVersion,
    itemId: 'item-poi-v1',
    claimIds: ['claim-reservation'],
    kind: 'RESERVATION_TICKET',
    title: '办理“武侯祠”预约或购票',
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
      action: '由用户在武侯祠官方渠道办理预约。',
      channelLabel: '武侯祠官方预约页',
      channelUrl: 'https://official.example/reserve',
      requiredInformation: ['日期、时段与人数'],
      warnings: ['本应用不会代替用户支付。'],
      deadline: '2026-09-08T08:00:00.000Z',
      deadlineSource: 'EXPLICIT',
      checklist: ['确认对象、日期与时段', '完成后回填结果'],
      evidenceStatus: 'VERIFIED'
    },
    updatedAt: '2026-09-01T00:00:00.000Z'
  }
  return ok(d7Snapshot())
})
ipcMain.handle('task:update', (_, request) => {
  assert.equal(request.taskId, task.taskId)
  assert.equal(request.expectedUpdatedAt, task.updatedAt)
  assert.equal(request.action, 'CONFIRM_EXTERNAL_RESULT')
  currentVersion += 1
  task = {
    ...task,
    sourceTimelineVersion: currentVersion,
    itemId: 'item-poi-v2',
    userDecision: 'ACCEPTED',
    reservation: 'DONE',
    readiness: 'READY',
    updatedAt: '2026-09-01T01:00:00.000Z'
  }
  gate = null
  return ok(d7Snapshot())
})
ipcMain.handle('gate-c:run', () => {
  const ready = task?.readiness === 'READY'
  gate = {
    gateId: 'GATE_C',
    evaluatedAt: '2026-09-01T02:00:00.000Z',
    ready,
    timelineVersion: currentVersion,
    blockers: ready
      ? []
      : [
          {
            code: 'HIGH_PRIORITY_TASK_PENDING',
            message: '高优先级任务“武侯祠预约”尚未完成。',
            itemId: task?.itemId ?? null,
            taskId: task?.taskId ?? null,
            claimIds: ['claim-reservation']
          }
        ],
    taskIds: task ? [task.taskId] : [],
    claimIds: ['claim-reservation']
  }
  return ok(d7Snapshot())
})
ipcMain.handle('source:open-external', (_, request) => {
  assert.equal(request.url, 'https://official.example/reserve')
  externalOpenCount += 1
  return ok(true)
})
ipcMain.handle('itinerary:export', (_, request) => {
  exportCount += 1
  return ok({
    kind: request.format,
    savedPath: path.join(root, request.format === 'ICS' ? 'trip.ics' : 'trip.md'),
    itemCount: 2,
    bytes: 128
  })
})
ipcMain.handle('inspector:snapshot', (_, query) =>
  ok({
    query,
    events: [
      {
        eventId: 'event-task',
        sessionId: session.sessionId,
        seq: 8,
        type: 'task/updated',
        timestamp: '2026-09-01T01:00:00.000Z'
      }
    ],
    toolCalls: [],
    modelCalls: [
      {
        callId: 'model-call-1',
        sessionId: session.sessionId,
        role: 'PLANNING',
        provider: 'LOCAL_FIXTURE',
        model: 'none',
        tokensIn: 0,
        tokensOut: 0,
        costCents: 0,
        latencyMs: 0,
        ok: true,
        createdAt: '2026-09-01T01:00:00.000Z'
      }
    ],
    blockedTools: [],
    sourceHealth: []
  })
)
ipcMain.handle('inspector:diagnostic-export', () => {
  diagnosticExportCount += 1
  return ok({
    kind: 'DIAGNOSTIC',
    savedPath: path.join(root, 'diagnostic.json'),
    itemCount: 2,
    bytes: 96
  })
})

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 1280,
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
      await clickButton(window, 'TASKS')
      await wait(window, 120)
      await clickButton(window, '从当前时间轴生成任务')
      await wait(window, 100)
      let text = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(text, /武侯祠官方预约页/)
      assert.match(text, /外部调用 0 次/)
      await clickButton(window, '执行 GATE_C')
      await wait(window, 80)
      text = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(text, /出发前检查阻塞/)
      assert.match(text, /高优先级任务/)
      await clickButton(window, '打开官方渠道')
      await wait(window, 40)
      await clickButton(window, '我已在外部完成')
      await wait(window, 80)
      await clickButton(window, '执行 GATE_C')
      await wait(window, 80)
      text = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(text, /出发前检查通过/)
      assert.match(text, /READY/)
      await clickButton(window, '导出 ICS')
      await wait(window, 40)
      await clickButton(window, 'INSPECTOR')
      await wait(window, 120)
      text = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(text, /task\/updated/)
      assert.match(text, /LOCAL_FIXTURE \/ none/)
      assert.doesNotMatch(text, /rawPayload|credentials|sourceRef/)
      await clickButton(window, '导出安全诊断包')
      await wait(window, 40)

      assert.equal(externalOpenCount, 1)
      assert.equal(exportCount, 1)
      assert.equal(diagnosticExportCount, 1)
      const artifactDir = path.join(process.cwd(), 'test', 'artifacts')
      fs.mkdirSync(artifactDir, { recursive: true })
      fs.writeFileSync(
        path.join(artifactDir, 'd7-ui-smoke.png'),
        (await window.webContents.capturePage()).toPNG()
      )
      fs.writeFileSync(
        path.join(artifactDir, 'd7-ui-smoke.json'),
        `${JSON.stringify(
          {
            ok: true,
            checked: {
              taskDerivation: true,
              blockedGate: true,
              confirmedExternalResult: true,
              readyGate: true,
              itineraryExportIpc: true,
              inspectorFilters: true,
              diagnosticExportIpc: true
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
async function wait(window, milliseconds) {
  await window.webContents.executeJavaScript(
    `new Promise((resolve) => setTimeout(resolve, ${milliseconds}))`
  )
}
