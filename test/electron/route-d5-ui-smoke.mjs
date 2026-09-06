import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-route-d5-ui-'))
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

const SESSION_ID = 'route-d5-electron-smoke'
const ROUTE_ID = 'route-yunnan-electron-smoke'
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const ok = (data) => ({ ok: true, data })
const session = {
  sessionId: SESSION_ID,
  title: '广州到云南 10 天',
  stage: 'STAGE_4',
  linkedSessionGroup: null,
  splitIndex: null
}

const nodes = [
  ['node-dali', '大理', '2026-09-08', '2026-09-11', 'must-erhai'],
  ['node-lijiang', '丽江', '2026-09-11', '2026-09-14', 'must-yulong'],
  ['node-banna', '西双版纳', '2026-09-14', '2026-09-17', 'must-banna']
].map(([nodeId, city, arrivalDate, departureDate, placeId], index) => ({
  routeId: ROUTE_ID,
  nodeId,
  city,
  region: '云南',
  sequence: index + 1,
  arrivalDate,
  departureDate,
  nights: 3,
  nodeKind: 'STAY',
  mandatoryPlaceIds: [placeId],
  reason: `串联 ${city}`
}))

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const leg = (legId, from, to, fromCity, toCity, travelDate, mode) => ({
  routeId: ROUTE_ID,
  legId,
  from,
  to,
  fromCity,
  toCity,
  travelDate,
  mode,
  label: `${fromCity}→${toCity}`,
  durationMinutes: null,
  costCents: null,
  transferCount: 0,
  verificationStatus: 'UNVERIFIED',
  claimIds: [],
  riskFlags: ['UNVERIFIED'],
  critical: true
})
const legs = [
  leg(
    'leg-gz-dali',
    { kind: 'ORIGIN', city: '广州' },
    { kind: 'NODE', nodeId: 'node-dali' },
    '广州',
    '大理',
    '2026-09-08',
    'RAIL'
  ),
  leg(
    'leg-dali-lijiang',
    { kind: 'NODE', nodeId: 'node-dali' },
    { kind: 'NODE', nodeId: 'node-lijiang' },
    '大理',
    '丽江',
    '2026-09-11',
    'RAIL'
  ),
  leg(
    'leg-lijiang-banna',
    { kind: 'NODE', nodeId: 'node-lijiang' },
    { kind: 'NODE', nodeId: 'node-banna' },
    '丽江',
    '西双版纳',
    '2026-09-14',
    'MANUAL_FLIGHT'
  ),
  leg(
    'leg-banna-gz',
    { kind: 'NODE', nodeId: 'node-banna' },
    { kind: 'ORIGIN', city: '广州' },
    '西双版纳',
    '广州',
    '2026-09-17',
    'MANUAL_FLIGHT'
  )
]

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const addDay = (date, count) => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + count)
  return value.toISOString().slice(0, 10)
}
const staySegments = nodes.map((node, index) => ({
  routeId: ROUTE_ID,
  nodeId: node.nodeId,
  segmentId: `stay-${index + 1}`,
  city: node.city,
  checkInDate: node.arrivalDate,
  checkOutDate: node.departureDate,
  nights: 3,
  nightDates: [node.arrivalDate, addDay(node.arrivalDate, 1), addDay(node.arrivalDate, 2)],
  positionAssessment: { status: 'UNKNOWN', summary: '待 D5 核验', claimIds: [] }
}))
const route = {
  routeId: ROUTE_ID,
  profile: 'BALANCED',
  nodes,
  legs,
  staySegments,
  score: {
    hardConstraintPass: true,
    criticalEvidenceComplete: false,
    unverifiedLegCount: 4,
    transferCount: 0,
    overnightArrivalCount: 0,
    transitMinutes: null,
    backtrackingScore: 5,
    staminaRisk: 'MEDIUM',
    altitudeRisk: 'MEDIUM',
    knownCostCents: null,
    costComplete: false
  },
  isRecommended: false,
  materialDifferences: ['大理、丽江、西双版纳连续串联'],
  kunmingDecision: { included: false, reason: '当前连接不要求昆明停留。' },
  blockingReasons: ['具体路段与住宿待 D5 核验']
}
const railOption = {
  direction: 'OUTBOUND',
  trainNo: 'D1234',
  serviceDate: '2026-09-08',
  fromStation: '广州',
  toStation: '大理',
  departureTime: '08:00',
  arrivalTime: '14:00',
  startAt: '2026-09-08T08:00:00+08:00',
  endAt: '2026-09-08T14:00:00+08:00',
  title: '广州→大理 D1234'
}
const snapshot = {
  sessionId: SESSION_ID,
  stage: 'STAGE_4',
  selectedRouteId: ROUTE_ID,
  selectedRoute: route,
  legStates: legs.map((routeLeg, index) => ({
    scope: { kind: 'LEG', sessionId: SESSION_ID, routeId: ROUTE_ID, legId: routeLeg.legId },
    sequence: index + 1,
    routeLeg,
    status: index === 0 ? 'OPTIONS_READY' : routeLeg.mode === 'RAIL' ? 'NOT_STARTED' : 'BLOCKED',
    railOptions: index === 0 ? [railOption] : [],
    selectedRailOption: null,
    selectionClaimIds: [],
    plan: null,
    sourceOutcome: index === 0 ? 'SUCCEEDED' : 'NOT_RUN',
    blockingReasons: index < 2 ? [] : ['缺少端点、日期和方式完全一致的人工 Claim']
  })),
  stayStates: staySegments.map((segment, index) => ({
    scope: {
      kind: 'STAY',
      sessionId: SESSION_ID,
      routeId: ROUTE_ID,
      nodeId: segment.nodeId,
      segmentId: segment.segmentId
    },
    sequence: index + 1,
    segment,
    status: 'NOT_STARTED',
    candidates: [],
    selectedCandidateId: null,
    sourceOutcomes: [],
    blockingReasons: []
  })),
  days: [
    {
      sessionId: SESSION_ID,
      routeId: ROUTE_ID,
      date: '2026-09-09',
      dayType: 'NORMAL_DAY',
      owningNodeId: 'node-dali',
      segmentId: 'stay-1',
      routeLegId: null,
      routeLegIds: [],
      fromNodeId: null,
      toNodeId: null,
      intensity: 'MEDIUM',
      attractionEntityIds: ['must-erhai'],
      boundaryAnchors: [],
      notes: []
    }
  ],
  nextRequiredWorkItem: { kind: 'LEG', legId: 'leg-gz-dali' },
  blockingReasons: ['尚有路段与住宿段未完成'],
  confirmed: false
}
const preview = {
  scope: snapshot.legStates[0].scope,
  action: 'DISCOVER_RAIL',
  planId: '11111111-1111-4111-8111-111111111111',
  digest: `sha256:${'a'.repeat(64)}`,
  expiresAt: '2030-09-08T00:10:00.000Z',
  plannedCalls: [
    {
      sequence: 1,
      sourceId: 'SRC_RAIL',
      capability: 'RAIL_DISCOVERY',
      label: '查询广州到大理车次'
    }
  ],
  totalExternalCalls: 1,
  retryCount: 0,
  timeoutSeconds: 60
}

let previewCount = 0
let patchCount = 0
ipcMain.handle('sessions:list', () => ok([session]))
ipcMain.handle('d4:snapshot', () =>
  ok({
    sessionId: SESSION_ID,
    stage: 'STAGE_4',
    destinationCandidates: [],
    selectedDestinationCandidateId: null,
    researchEntities: [],
    researchChecklistConfirmed: true,
    conflictResolutions: [],
    sourceResearchFailures: []
  })
)
ipcMain.handle('evidence:list', () => ok([]))
ipcMain.handle('route-d5:snapshot', (_, request) => {
  assert.deepEqual(request, { sessionId: SESSION_ID })
  return ok(snapshot)
})
ipcMain.handle('route-d5:preview', (_, request) => {
  assert.deepEqual(request, {
    scope: snapshot.legStates[0].scope,
    action: 'DISCOVER_RAIL',
    fromAddress: null,
    toAddress: null
  })
  previewCount += 1
  return ok(preview)
})
ipcMain.handle('route-d5:skeleton-patch', (_, request) => {
  assert.deepEqual(request, {
    scope: { kind: 'ROUTE', sessionId: SESSION_ID, routeId: ROUTE_ID },
    date: '2026-09-09',
    attractionEntityIds: ['must-erhai']
  })
  patchCount += 1
  return ok(snapshot)
})

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 980,
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
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 200))'
      )
      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'SKELETON')?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 180))'
      )
      const initial = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(initial, /广州.*大理/)
      assert.match(initial, /丽江.*西双版纳/)
      assert.match(initial, /不自动查询航班\/大巴/)
      assert.match(initial, /每个城市住宿独立查询与选择/)
      assert.match(initial, /仅更新当天/)

      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '预览本路段铁路查询')?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      const planned = await window.webContents.executeJavaScript('document.body.innerText')
      assert.equal(previewCount, 1)
      assert.match(planned, /1 calls · retry 0/)
      assert.match(planned, /sha256:/)

      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '仅更新当天')?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      assert.equal(patchCount, 1)

      for (const width of [820, 320]) {
        window.setContentSize(width, 940)
        await window.webContents.executeJavaScript(
          'new Promise((resolve) => requestAnimationFrame(() => resolve()))'
        )
        const layout = await window.webContents.executeJavaScript(
          `({ innerWidth, scrollWidth: document.documentElement.scrollWidth })`
        )
        assert.ok(layout.scrollWidth <= layout.innerWidth, `${width}px layout must not overflow`)
      }

      const artifactDir = path.join(process.cwd(), 'test', 'artifacts')
      fs.mkdirSync(artifactDir, { recursive: true })
      fs.writeFileSync(
        path.join(artifactDir, 'route-d5-ui-smoke.json'),
        `${JSON.stringify({ ok: true, checked: { routeQueue: true, manualBlocker: true, zeroCallPreview: true, localPatch: true, responsive820: true, responsive320: true }, externalCalls: 0, modelCalls: 0, irreversibleActions: 0 }, null, 2)}\n`
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
