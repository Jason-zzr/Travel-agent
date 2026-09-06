import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-d5-ui-'))
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
const autoSession = {
  sessionId: 'd5-auto-smoke',
  title: '自动来源装配夹具',
  stage: 'STAGE_4',
  linkedSessionGroup: null,
  splitIndex: null
}
const session = {
  sessionId: 'd5-smoke',
  title: '成都 D5 夹具',
  stage: 'STAGE_5',
  linkedSessionGroup: null,
  splitIndex: null
}
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const leg = (kind, label, from, to, startAt, endAt, durationMinutes, sourceId, claimId) => ({
  kind,
  label,
  from,
  to,
  startAt,
  endAt,
  durationMinutes,
  costCents: 1000,
  sourceId,
  claimIds: [claimId],
  verificationStatus: 'VERIFIED'
})
const outboundLegs = [
  leg(
    'FIRST_MILE',
    '出发地到车站',
    '上海住所',
    '上海虹桥',
    '2026-10-01T01:30:00.000Z',
    '2026-10-01T02:10:00.000Z',
    40,
    'SRC_MAP',
    'map-1'
  ),
  leg(
    'WAIT',
    '候车',
    '上海虹桥',
    '上海虹桥',
    '2026-10-01T02:10:00.000Z',
    '2026-10-01T02:55:00.000Z',
    45,
    'SRC_RAIL',
    'rail-1'
  ),
  leg(
    'INTERCITY',
    '高铁',
    '上海虹桥',
    '成都东',
    '2026-10-01T03:00:00.000Z',
    '2026-10-01T08:00:00.000Z',
    300,
    'SRC_RAIL',
    'rail-1'
  ),
  leg(
    'LAST_MILE',
    '车站到住区',
    '成都东',
    '成都住区',
    '2026-10-01T08:00:00.000Z',
    '2026-10-01T08:40:00.000Z',
    40,
    'SRC_MAP',
    'map-2'
  )
]
const returnLegs = [
  leg(
    'FIRST_MILE',
    '住区到车站',
    '成都住区',
    '成都东',
    '2026-10-04T07:30:00.000Z',
    '2026-10-04T08:10:00.000Z',
    40,
    'SRC_MAP',
    'map-3'
  ),
  leg(
    'WAIT',
    '候车',
    '成都东',
    '成都东',
    '2026-10-04T08:10:00.000Z',
    '2026-10-04T08:55:00.000Z',
    45,
    'SRC_RAIL',
    'rail-2'
  ),
  leg(
    'INTERCITY',
    '高铁',
    '成都东',
    '上海虹桥',
    '2026-10-04T09:00:00.000Z',
    '2026-10-04T14:00:00.000Z',
    300,
    'SRC_RAIL',
    'rail-2'
  ),
  leg(
    'LAST_MILE',
    '车站到住所',
    '上海虹桥',
    '上海住所',
    '2026-10-04T14:00:00.000Z',
    '2026-10-04T14:40:00.000Z',
    40,
    'SRC_MAP',
    'map-4'
  )
]
const slot = {
  kind: 'PROJECTS',
  area: '武侯区',
  items: [
    {
      entityId: 'wuhou',
      title: '武侯祠',
      coordinates: { lng: 104.047, lat: 30.645 },
      claimIds: ['poi-1']
    }
  ],
  note: null
}
let selectedStayCandidateId = null
let patchCount = 0
let railAuthorizationCount = 0
let sourcePlanAuthorizationCount = 0
let receivedExactAddress = null
let autoExecuted = false
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const stayCandidate = (candidateId, sourceId, name, roomFitsParty, cancellation) => ({
  candidateId,
  segmentId: 'stay-d5-smoke',
  sourceId,
  name,
  claimId: `claim-${candidateId}`,
  contentIdentity: sourceId === 'SRC_HOTEL' ? 'COMMERCIAL_OFFER' : 'UNKNOWN',
  verificationStatus: sourceId === 'SRC_HOTEL' ? 'VERIFIED' : 'UNVERIFIED',
  totalCostCents: 138800,
  totalCostComplete: true,
  roomType: '家庭房',
  bedType: '双床',
  capacity: roomFitsParty === false ? 2 : null,
  roomFitsParty,
  cancellation,
  positionAdvantage: '靠近已确认项目区域',
  recommendationEligible: false
})
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const snapshot = () => ({
  sessionId: session.sessionId,
  stage: 'STAGE_5',
  partySize: 4,
  transportCandidates: [
    {
      candidateId: 'transport-1',
      title: '高铁往返',
      mode: 'RAIL',
      outbound: {
        direction: 'OUTBOUND',
        legs: outboundLegs,
        totalDurationMinutes: 425,
        totalCostCents: 4000
      },
      return: {
        direction: 'RETURN',
        legs: returnLegs,
        totalDurationMinutes: 425,
        totalCostCents: 4000
      },
      doorToDoorTotalMinutes: 850,
      totalCostCents: 8000,
      costComplete: true,
      arrivalUsableMinutes: 800,
      departureUsableMinutes: 450,
      comfort: 'GOOD',
      comfortReasons: ['四段完整'],
      isRecommended: true,
      materialDifferences: ['门到门总时长最短'],
      claimIds: ['map-1', 'map-2', 'map-3', 'map-4', 'rail-1', 'rail-2']
    }
  ],
  selectedTransportCandidateId: 'transport-1',
  boundaryAnchors: [
    {
      kind: 'ARRIVAL',
      date: '2026-10-01',
      time: '08:40',
      at: '2026-10-01T08:40:00.000Z',
      location: '成都住区',
      usableMinutes: 800,
      anchorClass: 'HARD_LOCKED',
      claimIds: ['map-2']
    },
    {
      kind: 'DEPARTURE',
      date: '2026-10-04',
      time: '07:30',
      at: '2026-10-04T07:30:00.000Z',
      location: '成都住区',
      usableMinutes: 450,
      anchorClass: 'HARD_LOCKED',
      claimIds: ['map-3']
    }
  ],
  daySkeletons: [
    {
      date: '2026-10-01',
      dayType: 'ARRIVAL_DAY',
      intensity: 'LOW',
      morning: null,
      afternoon: null,
      evening: null,
      mealAnchors: [{ period: 'DINNER', area: '武侯区', routeReason: '顺路' }],
      localTransport: {
        strategy: 'WALK_TRANSIT',
        budgetImpact: '公共交通基准',
        staminaImpact: '减少折返'
      }
    },
    {
      date: '2026-10-02',
      dayType: 'NORMAL_DAY',
      intensity: 'MEDIUM',
      morning: slot,
      afternoon: null,
      evening: null,
      mealAnchors: [{ period: 'LUNCH', area: '武侯区', routeReason: '顺路' }],
      localTransport: {
        strategy: 'WALK_TRANSIT',
        budgetImpact: '公共交通基准',
        staminaImpact: '减少折返'
      }
    },
    {
      date: '2026-10-03',
      dayType: 'NORMAL_DAY',
      intensity: 'MEDIUM',
      morning: null,
      afternoon: null,
      evening: null,
      mealAnchors: [],
      localTransport: {
        strategy: 'WALK_TRANSIT',
        budgetImpact: '公共交通基准',
        staminaImpact: '减少折返'
      }
    },
    {
      date: '2026-10-04',
      dayType: 'DEPARTURE_DAY',
      intensity: 'LOW',
      morning: null,
      afternoon: null,
      evening: null,
      mealAnchors: [],
      localTransport: { strategy: 'TAXI', budgetImpact: '费用较高', staminaImpact: '降低体力压力' }
    }
  ],
  staySegment: {
    segmentId: 'stay-d5-smoke',
    areaHint: '武侯区',
    checkInDate: '2026-10-01',
    checkOutDate: '2026-10-04',
    nights: 3,
    nightDates: ['2026-10-01', '2026-10-02', '2026-10-03'],
    positionAssessment: { status: 'ESTIMATED', summary: '靠近项目区域', claimIds: ['poi-1'] }
  },
  stayCandidates: [
    stayCandidate('hotel-1', 'SRC_HOTEL', '酒店源家庭房', false, {
      status: 'NON_REFUNDABLE',
      freeCancelUntil: null
    }),
    stayCandidate('paste-1', 'USER_PASTE', '手工候选', null, {
      status: 'UNKNOWN',
      freeCancelUntil: null
    })
  ],
  selectedStayCandidateId,
  staySourceOutcomes: [
    {
      sourceId: 'SRC_HOTEL',
      status: 'SUCCEEDED',
      candidateCount: 1,
      errorCode: null,
      capabilityImpact: null,
      manualAlternative: null
    },
    {
      sourceId: 'SRC_SEARCH',
      status: 'EMPTY',
      candidateCount: 0,
      errorCode: null,
      capabilityImpact: '搜索源本轮没有可用的整段住宿报价',
      manualAlternative: '可手工粘贴'
    },
    {
      sourceId: 'USER_PASTE',
      status: 'SUCCEEDED',
      candidateCount: 1,
      errorCode: null,
      capabilityImpact: null,
      manualAlternative: null
    }
  ]
})

const outboundOption = {
  direction: 'OUTBOUND',
  trainNo: 'G1974',
  serviceDate: '2026-10-01',
  fromStation: '上海',
  toStation: '成都',
  departureTime: '11:00',
  arrivalTime: '16:00',
  startAt: '2026-10-01T11:00:00+08:00',
  endAt: '2026-10-01T16:00:00+08:00',
  title: '上海→成都 G1974'
}
const returnOption = {
  direction: 'RETURN',
  trainNo: 'G1973',
  serviceDate: '2026-10-04',
  fromStation: '成都',
  toStation: '上海',
  departureTime: '09:00',
  arrivalTime: '14:00',
  startAt: '2026-10-04T09:00:00+08:00',
  endAt: '2026-10-04T14:00:00+08:00',
  title: '成都→上海 G1973'
}
const railPreview = {
  sessionId: autoSession.sessionId,
  outbound: {
    direction: 'OUTBOUND',
    date: '2026-10-01',
    fromStation: '上海',
    toStation: '成都'
  },
  return: {
    direction: 'RETURN',
    date: '2026-10-04',
    fromStation: '成都',
    toStation: '上海'
  },
  estimatedExternalCalls: 2,
  digest: `sha256:${'a'.repeat(64)}`
}
const discoveryId = '11111111-1111-4111-8111-111111111111'
const planId = '22222222-2222-4222-8222-222222222222'
const sourcePlan = {
  sessionId: autoSession.sessionId,
  planId,
  discoveryId,
  expiresAt: '2026-10-01T00:10:00.000Z',
  digest: `sha256:${'b'.repeat(64)}`,
  selectedTrains: { outbound: outboundOption, return: returnOption },
  geocodes: [
    {
      locationId: 'exact-origin',
      label: '出发地点',
      city: '上海',
      kind: 'EXACT_ORIGIN',
      cached: false
    },
    {
      locationId: 'outbound-from-station',
      label: '出发车站（上海）',
      city: '上海',
      kind: 'STATION',
      cached: false
    },
    {
      locationId: 'outbound-to-station',
      label: '到达车站（成都）',
      city: '成都',
      kind: 'STATION',
      cached: false
    },
    {
      locationId: 'stay-area',
      label: '住宿区域（成都）',
      city: '成都',
      kind: 'STAY_AREA',
      cached: false
    }
  ],
  transfers: [
    {
      direction: 'OUTBOUND',
      kind: 'FIRST_MILE',
      from: '出发地点',
      to: '出发车站（上海）',
      travelMode: 'DRIVING',
      timingBasis: 'ARRIVE_BY_RAIL'
    },
    {
      direction: 'OUTBOUND',
      kind: 'LAST_MILE',
      from: '到达车站（成都）',
      to: '住宿区域（成都）',
      travelMode: 'DRIVING',
      timingBasis: 'DEPART_AFTER_RAIL'
    },
    {
      direction: 'RETURN',
      kind: 'FIRST_MILE',
      from: '住宿区域（成都）',
      to: '返程出发车站（成都）',
      travelMode: 'DRIVING',
      timingBasis: 'ARRIVE_BY_RAIL'
    },
    {
      direction: 'RETURN',
      kind: 'LAST_MILE',
      from: '返程到达车站（上海）',
      to: '出发地点',
      travelMode: 'DRIVING',
      timingBasis: 'DEPART_AFTER_RAIL'
    }
  ],
  hotelQuery: {
    place: '成都',
    checkInDate: '2026-10-01',
    stayNights: 3,
    adultCount: 2,
    size: 5
  },
  plannedCalls: [
    ...['出发地点', '出发车站（上海）', '到达车站（成都）', '住宿区域（成都）'].map(
      (label, index) => ({
        sequence: index + 1,
        sourceId: 'SRC_MAP',
        capability: 'GEOCODE',
        label: `地理编码：${label}`
      })
    ),
    ...[0, 1, 2, 3].map((index) => ({
      sequence: index + 5,
      sourceId: 'SRC_MAP',
      capability: 'GROUND_TRANSFER',
      label: `接驳距离 ${index + 1}`
    })),
    {
      sequence: 9,
      sourceId: 'SRC_HOTEL',
      capability: 'HOTEL_SEARCH',
      label: '酒店查询：成都 3 晚'
    }
  ],
  totalExternalCalls: 9
}
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const autoSnapshot = () => ({
  ...snapshot(),
  sessionId: autoSession.sessionId,
  stage: 'STAGE_4',
  transportCandidates: autoExecuted ? snapshot().transportCandidates : [],
  selectedTransportCandidateId: null,
  boundaryAnchors: [],
  daySkeletons: [],
  staySegment: null,
  stayCandidates: [],
  selectedStayCandidateId: null,
  staySourceOutcomes: []
})

ipcMain.handle('sessions:list', () => ok([autoSession, session]))
ipcMain.handle('d4:snapshot', (_, request) =>
  ok({
    sessionId: request.sessionId,
    stage: request.sessionId === autoSession.sessionId ? 'STAGE_4' : 'STAGE_5',
    destinationCandidates: [],
    selectedDestinationCandidateId: null,
    researchEntities: [],
    researchChecklistConfirmed: true,
    conflictResolutions: [],
    sourceResearchFailures: []
  })
)
ipcMain.handle('evidence:list', () => ok([]))
ipcMain.handle('d5:snapshot', (_, request) => {
  assert.ok([autoSession.sessionId, session.sessionId].includes(request.sessionId))
  return ok(request.sessionId === autoSession.sessionId ? autoSnapshot() : snapshot())
})
ipcMain.handle('transport:rail-discovery-preview', (_, request) => {
  assert.deepEqual(request, { sessionId: autoSession.sessionId })
  return ok(railPreview)
})
ipcMain.handle('transport:rail-discover', (_, request) => {
  assert.equal(request.sessionId, autoSession.sessionId)
  assert.equal(request.digest, railPreview.digest)
  railAuthorizationCount += 1
  return ok({
    sessionId: autoSession.sessionId,
    discoveryId,
    expiresAt: '2026-10-01T00:10:00.000Z',
    outboundOptions: [outboundOption],
    returnOptions: [returnOption]
  })
})
ipcMain.handle('transport:rail-select', (_, request) => {
  assert.deepEqual(request, {
    sessionId: autoSession.sessionId,
    discoveryId,
    outboundTrainNo: 'G1974',
    returnTrainNo: 'G1973'
  })
  return ok({
    sessionId: autoSession.sessionId,
    discoveryId,
    expiresAt: '2026-10-01T00:10:00.000Z',
    outbound: outboundOption,
    return: returnOption
  })
})
ipcMain.handle('transport:source-plan-preview', (_, request) => {
  assert.equal(request.sessionId, autoSession.sessionId)
  assert.equal(request.discoveryId, discoveryId)
  assert.equal(request.originLabel, '出发地点')
  receivedExactAddress = request.exactAddress
  return ok(sourcePlan)
})
ipcMain.handle('transport:source-plan-execute', (_, request) => {
  assert.deepEqual(request, {
    sessionId: autoSession.sessionId,
    operationId: request.operationId,
    planId,
    digest: sourcePlan.digest
  })
  assert.equal('exactAddress' in request, false)
  sourcePlanAuthorizationCount += 1
  autoExecuted = true
  return ok({
    snapshot: autoSnapshot(),
    hotelOutcome: {
      sourceId: 'SRC_HOTEL',
      status: 'SUCCEEDED',
      candidateCount: 1,
      errorCode: null,
      capabilityImpact: null,
      manualAlternative: null
    },
    externalCallCount: 0,
    railExternalCallCount: 0
  })
})
ipcMain.handle('skeleton:patch', (_, request) => {
  assert.equal(request.date, '2026-10-02')
  assert.equal(request.entityId, 'wuhou')
  patchCount += 1
  return ok(snapshot())
})
ipcMain.handle('stay:select', (_, request) => {
  selectedStayCandidateId = request.candidateId
  return ok(snapshot())
})

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
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 200))'
      )
      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'SKELETON')?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 150))'
      )
      const autoInitial = await window.webContents.executeJavaScript(
        `({ text: document.body.innerText, strictJson: document.body.innerText.includes('严格 JSON 参数') })`
      )
      assert.match(autoInitial.text, /来源参数自动装配/)
      assert.match(autoInitial.text, /授权查询往返车次/)
      assert.equal(autoInitial.strictJson, false)
      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '授权查询往返车次')?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('确认所选车次'))?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 80))'
      )
      const exactAddress = '上海市烟雾测试路 789 号'
      await window.webContents.executeJavaScript(
        `(() => { const input = document.querySelector('input[placeholder*="街道"]'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify('上海市烟雾测试路 789 号')}); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
      )
      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('生成来源调用清单'))?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      const afterPlan = await window.webContents.executeJavaScript(
        `({ text: document.body.innerText, addressValue: document.querySelector('input[placeholder*="街道"]')?.value ?? null })`
      )
      assert.equal(receivedExactAddress, exactAddress)
      assert.equal(afterPlan.addressValue, '')
      assert.equal(afterPlan.text.includes(exactAddress), false)
      assert.match(afterPlan.text, /预计外部调用 9 次/)
      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '授权并执行此清单')?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      assert.equal(railAuthorizationCount, 1)
      assert.equal(sourcePlanAuthorizationCount, 1)
      assert.equal(autoExecuted, true)
      await window.webContents.executeJavaScript(
        `(() => { const select = document.querySelector('.d5-sidebar select'); if (!select) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, ${JSON.stringify('d5-smoke')}); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 150))'
      )
      const initial = await window.webContents.executeJavaScript(
        `({ text: document.body.innerText, transport: document.querySelectorAll('.candidate-option').length, days: document.querySelectorAll('.day-card').length })`
      )
      assert.equal(initial.transport, 3)
      assert.equal(initial.days, 4)
      assert.match(initial.text, /门到门交通/)
      assert.match(initial.text, /不满足 4 人入住/)
      assert.match(initial.text, /人数信息缺失/)
      assert.match(initial.text, /不可免费取消/)
      assert.match(initial.text, /取消信息缺失/)
      assert.match(initial.text, /SRC_SEARCH: 0 · EMPTY/)
      assert.match(initial.text, /添加手工候选/)
      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('将首个上午项目移到下午'))?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      assert.equal(patchCount, 1)
      await window.webContents.executeJavaScript(
        `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '选择住宿')?.click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      assert.equal(selectedStayCandidateId, 'hotel-1')
      const artifactDir = path.join(process.cwd(), 'test', 'artifacts')
      fs.mkdirSync(artifactDir, { recursive: true })
      const png = (await window.webContents.capturePage()).toPNG()
      fs.writeFileSync(path.join(artifactDir, 'd5-ui-smoke.png'), png)
      fs.writeFileSync(
        path.join(artifactDir, 'd5-ui-smoke.json'),
        `${JSON.stringify({ ok: true, checked: { sourceAuthorization: true, addressCleared: true, transport: true, days: true, lodgingStates: true, sourceCounts: true, localPatch: true, staySelection: true }, externalCalls: 0 }, null, 2)}\n`
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
