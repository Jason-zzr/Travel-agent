import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-d6-ui-'))
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
  sessionId: 'd6-smoke',
  title: '成都四日时间轴夹具',
  stage: 'STAGE_5',
  linkedSessionGroup: null,
  splitIndex: null
}
const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
const draftIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
]
let prepareCount = 0
let publishCount = 0
let draft = null
const versions = []

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function timelineItems(blocked = false) {
  return dates.flatMap((date, index) => {
    const hardAnchor = index === 0 || index === dates.length - 1
    const unverified = blocked && index === 0
    const station = hardAnchor
    const claimId = `claim-main-${index}`
    const main = {
      itemId: `main-${index}-${prepareCount}`,
      date,
      startTime: index === 0 ? '16:00' : index === dates.length - 1 ? '15:00' : '10:00',
      endTime: index === 0 ? '16:30' : index === dates.length - 1 ? '15:30' : '11:30',
      crossesMidnight: false,
      title:
        index === 0
          ? '抵达成都东站'
          : index === dates.length - 1
            ? '前往返程车站'
            : `成都主线项目 ${index}`,
      itemClass: hardAnchor ? 'FIXED' : 'RECOMMENDED',
      anchorClass: hardAnchor ? 'HARD_LOCKED' : 'PREFERRED',
      location: {
        name: station ? '成都东站' : `成都地点 ${index}`,
        kind: station ? 'STATION' : 'POI',
        address: null,
        coordinates: null
      },
      arrivalTransport:
        index === 0
          ? null
          : {
              mode: index === dates.length - 1 ? 'TRANSIT' : 'WALKING',
              from: index === dates.length - 1 ? '住宿' : `成都地点 ${index - 1}`,
              to: station ? '成都东站' : `成都地点 ${index}`,
              etaMinutes: index === dates.length - 1 ? 40 : 15,
              claimIds: [`claim-route-${index}`]
            },
      bufferMinutes: index === 0 ? 0 : index === dates.length - 1 ? 30 : 10,
      costCents: index === 1 ? 8000 : null,
      claimIds: [claimId],
      verificationSummary: {
        status: unverified ? 'UNVERIFIED' : 'VERIFIED',
        claimCount: 1,
        allClaimsUsable: !unverified
      }
    }
    const backup = {
      itemId: `backup-${index}-${prepareCount}`,
      date,
      startTime: '18:00',
      endTime: '18:00',
      crossesMidnight: false,
      title: `雨天备用项 ${index + 1}`,
      itemClass: 'BACKUP',
      anchorClass: 'FLEXIBLE',
      location: {
        name: `室内地点 ${index + 1}`,
        kind: 'POI',
        address: null,
        coordinates: null
      },
      arrivalTransport: null,
      bufferMinutes: 0,
      costCents: null,
      claimIds: [`claim-backup-${index}`],
      verificationSummary: {
        status: 'CORROBORATED',
        claimCount: 1,
        allClaimsUsable: true
      }
    }
    return [main, backup]
  })
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function gate(blocked) {
  return blocked
    ? {
        publishable: false,
        blockingItems: [
          {
            itemId: `main-0-${prepareCount}`,
            title: '抵达成都东站',
            code: 'UNVERIFIED_HARD_ANCHOR',
            message: '未核验硬锚点不能发布。'
          }
        ]
      }
    : { publishable: true, blockingItems: [] }
}

const sourceOutcomes = [
  {
    sourceId: 'SRC_MAP',
    capability: 'ROUTE_ETA',
    status: 'SUCCEEDED',
    claimCount: 4,
    externalCallCount: 0,
    errorCode: null,
    capabilityImpact: null,
    manualAlternative: null
  },
  {
    sourceId: 'SRC_SEARCH',
    capability: 'RESTAURANT',
    status: 'NOT_REQUIRED',
    claimCount: 0,
    externalCallCount: 0,
    errorCode: null,
    capabilityImpact: null,
    manualAlternative: null
  }
]

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function snapshot(request = {}) {
  const current = versions.at(-1) ?? null
  const selected =
    request.version === undefined
      ? current
      : (versions.find((version) => version.version === request.version) ?? null)
  return {
    sessionId: session.sessionId,
    stage: 'STAGE_5',
    currentVersion: current?.version ?? null,
    versions: [...versions].reverse().map((version) => ({
      version: version.version,
      createdAt: version.createdAt,
      summary: version.summary,
      isCurrent: version.isCurrent
    })),
    selectedVersion: selected,
    draft,
    publishability:
      draft?.gate ??
      (current
        ? { publishable: true, blockingItems: [] }
        : {
            publishable: false,
            blockingItems: [
              {
                itemId: null,
                title: '时间轴',
                code: 'MISSING_PREREQUISITE',
                message: '尚未准备时间轴草稿。'
              }
            ]
          }),
    sourceOutcomes: draft?.sourceOutcomes ?? sourceOutcomes
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
ipcMain.handle('timeline:snapshot', (_, request) => {
  assert.equal(request.sessionId, session.sessionId)
  return ok(snapshot(request))
})
ipcMain.handle('timeline:prepare', (_, request) => {
  assert.equal(request.sessionId, session.sessionId)
  assert.match(request.operationId, /^[0-9a-f-]{36}$/)
  prepareCount += 1
  const blocked = prepareCount === 3
  draft = {
    draftId: draftIds[prepareCount - 1],
    sessionId: session.sessionId,
    createdAt: '2026-08-29T10:00:00.000Z',
    summary: blocked ? '含未核验硬锚点的草稿' : '成都四日分钟级时间轴',
    items: timelineItems(blocked),
    gate: gate(blocked),
    sourceOutcomes,
    changedDates: dates
  }
  return ok(snapshot())
})
ipcMain.handle('timeline:publish', (_, request) => {
  assert.equal(request.sessionId, session.sessionId)
  assert.equal(request.draftId, draft?.draftId)
  assert.equal(draft?.gate.publishable, true)
  publishCount += 1
  for (const version of versions) version.isCurrent = false
  versions.push({
    version: publishCount,
    createdAt: `2026-08-29T10:0${publishCount}:00.000Z`,
    summary: draft.summary,
    isCurrent: true,
    items: draft.items,
    decision: {
      decisionId: `decision-${publishCount}`,
      category: 'TIMELINE_PUBLISH',
      selected: `version-${publishCount}`,
      reason: '全部发布门禁通过',
      alternatives: [],
      claimIds: draft.items.flatMap((item) => item.claimIds)
    }
  })
  draft = null
  return ok(snapshot())
})
ipcMain.handle('d6:cancel', () => ok(true))

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 1240,
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
      await wait(window, 200)
      await clickButton(window, 'TIMELINE')
      await wait(window, 150)
      await clickButton(window, '生成分钟级草稿')
      await wait(window, 120)
      const draftState = await window.webContents.executeJavaScript(
        `({ text: document.body.innerText, days: document.querySelectorAll('.timeline-day').length, openBackups: document.querySelectorAll('.timeline-backups[open]').length })`
      )
      assert.equal(draftState.days, 4)
      assert.equal(draftState.openBackups, 0)
      assert.match(draftState.text, /ETA 15 分钟/)
      assert.match(draftState.text, /缓冲 10 分钟/)
      assert.match(draftState.text, /缓冲 30 分钟/)
      assert.match(draftState.text, /展开当日备用项（1）/)
      assert.match(draftState.text, /外部调用 0 次/)

      await clickButton(window, '发布为新版本')
      await wait(window, 100)
      await clickButton(window, '生成分钟级草稿')
      await wait(window, 100)
      await clickButton(window, '发布为新版本')
      await wait(window, 120)
      assert.equal(publishCount, 2)

      await window.webContents.executeJavaScript(
        `(() => { const select = document.querySelectorAll('.d6-sidebar select')[1]; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, '1'); select.dispatchEvent(new Event('change', { bubbles: true })); })()`
      )
      await wait(window, 120)
      const historyState = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(historyState, /版本 v1/)
      assert.match(historyState, /HISTORY/)
      assert.equal(versions.at(-1).version, 2)
      assert.equal(versions.at(-1).isCurrent, true)

      await clickButton(window, '生成分钟级草稿')
      await wait(window, 120)
      const blockedState = await window.webContents.executeJavaScript(
        `({ text: document.body.innerText, publishDisabled: [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '发布为新版本')?.disabled })`
      )
      assert.match(blockedState.text, /未核验硬锚点不能发布/)
      assert.equal(blockedState.publishDisabled, true)
      assert.equal(publishCount, 2)

      const artifactDir = path.join(process.cwd(), 'test', 'artifacts')
      fs.mkdirSync(artifactDir, { recursive: true })
      fs.writeFileSync(
        path.join(artifactDir, 'd6-ui-smoke.png'),
        (await window.webContents.capturePage()).toPNG()
      )
      fs.writeFileSync(
        path.join(artifactDir, 'd6-ui-smoke.json'),
        `${JSON.stringify(
          {
            ok: true,
            checked: {
              fourDayTimeline: true,
              buffers: true,
              backupsCollapsed: true,
              twoVersions: true,
              historyReadOnly: true,
              hardAnchorGate: true
            },
            externalCalls: 0
          },
          null,
          2
        )}\n`
      )
      console.log(JSON.stringify({ ok: true, externalCalls: 0 }))
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
