import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-route-ui-'))
app.setPath('userData', userDataRoot)

const renderMode =
  process.argv.includes('--smoke-no-gpu') || process.env.ROUTE_UI_SMOKE_RENDER_MODE === 'no-gpu'
    ? 'no-gpu'
    : (process.env.ROUTE_UI_SMOKE_RENDER_MODE ?? 'default')
if (renderMode !== 'default' && renderMode !== 'no-gpu') {
  throw new Error(`unsupported ROUTE_UI_SMOKE_RENDER_MODE: ${renderMode}`)
}
app.disableHardwareAcceleration()
if (renderMode === 'no-gpu') {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-software-rasterizer')
}

app.once('quit', () => {
  try {
    fs.rmSync(userDataRoot, { recursive: true, force: true })
  } catch {
    // Electron may keep a platform cache file open until the process exits.
  }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const ok = (data) => ({ ok: true, data })
const routeSession = {
  sessionId: 'session-route-smoke',
  title: '广州到云南 10 天',
  stage: 'STAGE_2',
  linkedSessionGroup: null,
  splitIndex: null
}
const otherSession = {
  sessionId: 'session-route-other',
  title: '对照会话',
  stage: 'STAGE_2',
  linkedSessionGroup: null,
  splitIndex: null
}
const goal = {
  regionGoal: '云南',
  originCity: '广州',
  originPlaceLabel: '广州市区集合点',
  startDate: '2026-09-08',
  endDate: '2026-09-17',
  totalDays: 10,
  totalNights: 9,
  travelers: [
    {
      count: 2,
      ageBand: 'ADULT',
      relationship: '家人',
      stamina: 'MEDIUM',
      careNeeds: [],
      functionalLimits: []
    }
  ],
  budget: {
    currency: 'CNY',
    basis: 'TOTAL',
    targetMinor: 3000000,
    flexibleRangeMinor: null,
    hardCapMinor: null,
    inclusions: ['TRANSPORT', 'ACCOMMODATION']
  },
  intensity: 'RELAXED',
  mandatoryPlaces: [
    { placeId: 'must-erhai', displayName: '洱海', nodeCity: '大理' },
    { placeId: 'must-yulong', displayName: '玉龙雪山', nodeCity: '丽江' },
    { placeId: 'must-banna', displayName: '西双版纳', nodeCity: '西双版纳' }
  ]
}

const mandatoryByCity = {
  大理: ['must-erhai'],
  丽江: ['must-yulong'],
  西双版纳: ['must-banna'],
  昆明: []
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function makeCandidate({ routeId, profile, cities, nights, recommended, kunmingReason }) {
  let cursor = goal.startDate
  const nodes = cities.map((city, index) => {
    const nodeNights = nights[index]
    const arrivalDate = cursor
    const departureDate = addDays(arrivalDate, nodeNights)
    cursor = departureDate
    return {
      routeId,
      nodeId: `${routeId}-node-${index + 1}`,
      city,
      region: '云南',
      sequence: index + 1,
      arrivalDate,
      departureDate,
      nights: nodeNights,
      nodeKind: nodeNights === 0 ? 'TRANSIT' : 'STAY',
      mandatoryPlaceIds: mandatoryByCity[city],
      reason:
        city === '昆明'
          ? '经核验的衔接方案降低夜间到达风险。'
          : `覆盖 ${mandatoryByCity[city].join('、')} 并保留连续停留。`
    }
  })
  const endpoints = [
    { kind: 'ORIGIN', city: goal.originCity },
    ...nodes.map((node) => ({ kind: 'NODE', nodeId: node.nodeId })),
    { kind: 'ORIGIN', city: goal.originCity }
  ]
  const citySequence = [goal.originCity, ...cities, goal.originCity]
  const legs = endpoints.slice(0, -1).map((from, index) => ({
    routeId,
    legId: `${routeId}-leg-${index + 1}`,
    from,
    to: endpoints[index + 1],
    fromCity: citySequence[index],
    toCity: citySequence[index + 1],
    travelDate: index === 0 ? goal.startDate : nodes[index - 1].departureDate,
    mode: 'RAIL',
    label: `${citySequence[index]}→${citySequence[index + 1]}`,
    durationMinutes: 120 + index * 30,
    costCents: null,
    transferCount: 0,
    verificationStatus: 'VERIFIED',
    claimIds: [`${routeId}-claim-${index + 1}`],
    riskFlags: [],
    critical: true
  }))
  const staySegments = nodes
    .filter((node) => node.nodeKind === 'STAY')
    .map((node) => ({
      routeId,
      nodeId: node.nodeId,
      segmentId: `${node.nodeId}-stay`,
      city: node.city,
      checkInDate: node.arrivalDate,
      checkOutDate: node.departureDate,
      nights: node.nights,
      nightDates: Array.from({ length: node.nights }, (_, index) =>
        addDays(node.arrivalDate, index)
      ),
      positionAssessment: {
        status: 'UNKNOWN',
        summary: '住宿位置仍待后续逐段核验。',
        claimIds: []
      }
    }))
  return {
    routeId,
    profile,
    nodes,
    legs,
    staySegments,
    score: {
      hardConstraintPass: true,
      criticalEvidenceComplete: true,
      unverifiedLegCount: 0,
      transferCount: 0,
      overnightArrivalCount: 0,
      transitMinutes: legs.reduce((sum, leg) => sum + leg.durationMinutes, 0),
      backtrackingScore: profile === 'LOW_TRANSIT' ? 5 : 10,
      staminaRisk: profile === 'RELAXED' ? 'LOW' : 'MEDIUM',
      altitudeRisk: 'MEDIUM',
      knownCostCents: null,
      costComplete: false
    },
    isRecommended: recommended,
    materialDifferences: [
      recommended
        ? '综合平衡在途、换乘、体力与必去覆盖。'
        : profile === 'LOW_TRANSIT'
          ? '减少折返，但丽江高海拔节点更早。'
          : '增加连续停留，整体节奏更舒缓。'
    ],
    kunmingDecision: {
      included: cities.includes('昆明'),
      reason: kunmingReason
    },
    blockingReasons: []
  }
}

let candidates = [
  makeCandidate({
    routeId: 'route-balanced',
    profile: 'BALANCED',
    cities: ['大理', '丽江', '西双版纳'],
    nights: [3, 3, 3],
    recommended: true,
    kunmingReason: '直连证据完整，省略昆明可减少一段在途。'
  }),
  makeCandidate({
    routeId: 'route-low-transit',
    profile: 'LOW_TRANSIT',
    cities: ['丽江', '大理', '西双版纳'],
    nights: [3, 3, 3],
    recommended: false,
    kunmingReason: '当前核验结果未显示昆明能降低换乘。'
  }),
  makeCandidate({
    routeId: 'route-relaxed',
    profile: 'RELAXED',
    cities: ['昆明', '大理', '丽江', '西双版纳'],
    nights: [0, 4, 3, 2],
    recommended: false,
    kunmingReason: '经昆明中转可降低夜间到达风险，但增加一段在途。'
  })
].map((candidate) => {
  const blockedLeg = {
    ...candidate.legs[0],
    mode: 'UNKNOWN',
    label: `${candidate.legs[0].fromCity}→${candidate.legs[0].toCity}待补证`,
    durationMinutes: null,
    verificationStatus: 'UNVERIFIED',
    claimIds: []
  }
  return {
    ...candidate,
    legs: [blockedLeg, ...candidate.legs.slice(1)],
    score: {
      ...candidate.score,
      criticalEvidenceComplete: false,
      unverifiedLegCount: 1
    },
    isRecommended: false,
    blockingReasons: [`${blockedLeg.fromCity}→${blockedLeg.toCity} 缺少可用交通证据。`]
  }
})

let routeSnapshot = {
  sessionId: routeSession.sessionId,
  stage: 'STAGE_2',
  goal,
  candidates,
  selectedRouteId: null,
  sourceOutcomes: [
    {
      callId: 'smoke-source-gap',
      sourceId: 'SRC_RAIL',
      toolName: 'rail_journeys',
      status: 'FAILED',
      claimIds: [],
      errorCode: 'SOURCE_UNREACHABLE',
      capabilityImpact: '关键交通腿缺少可用证据',
      manualAlternative: '补充人工航班或客运证据'
    }
  ],
  blockingReasons: ['仍有关键交通腿缺少可用证据。']
}
let routeSelectCalls = 0
let manualEvidenceApplyCalls = 0

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function routeNodeSnapshot(request) {
  const selected = candidates.find((candidate) => candidate.routeId === request.routeId)
  const current = selected?.nodes.find((node) => node.nodeId === request.nodeId)
  if (!selected || !current) throw new Error('route node fixture mismatch')
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const makeScope = (node) => ({
    sessionId: routeSession.sessionId,
    routeId: selected.routeId,
    nodeId: node.nodeId,
    city: node.city,
    nodeKind: node.nodeKind,
    mandatoryPlaceIds: node.mandatoryPlaceIds
  })
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const required = (node) => node.nodeKind === 'STAY' || node.mandatoryPlaceIds.length > 0
  const currentRequired = required(current)
  return {
    sessionId: routeSession.sessionId,
    stage: routeSession.stage,
    selectedRouteId: selected.routeId,
    nodeSummaries: selected.nodes.map((node) => ({
      scope: makeScope(node),
      sequence: node.sequence,
      required: required(node),
      status: required(node) ? 'NOT_STARTED' : 'SKIPPED',
      blockerCount: 0,
      entityCount: 0,
      confirmedAt: null,
      skipReason: required(node) ? null : '只作交通中转，无需景点研究。'
    })),
    currentScope: makeScope(current),
    currentNode: {
      scope: makeScope(current),
      sequence: current.sequence,
      required: currentRequired,
      status: currentRequired ? 'NOT_STARTED' : 'SKIPPED',
      skipReason: currentRequired ? null : '只作交通中转，无需景点研究。',
      researchEntities: [],
      researchChecklistConfirmed: false,
      conflictResolutions: [],
      sourceResearchFailures: [],
      xhsSampleSummary: null,
      manualResearchSummary: null,
      attractionRankings: [],
      blockingReasons: [],
      confirmedAt: null
    },
    routeResearchComplete: false,
    nextRequiredNodeId: selected.nodes.find((node) => required(node))?.nodeId ?? null
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function d4Snapshot(sessionId) {
  return {
    sessionId,
    stage: sessionId === routeSession.sessionId ? routeSession.stage : otherSession.stage,
    fixedDestinationCity: null,
    destinationCandidates: [],
    selectedDestinationCandidateId: null,
    researchEntities: [],
    researchChecklistConfirmed: false,
    conflictResolutions: [],
    sourceResearchFailures: []
  }
}

ipcMain.handle('sessions:list', () => ok([routeSession, otherSession]))
ipcMain.handle('d4:snapshot', (_, request) => ok(d4Snapshot(request.sessionId)))
ipcMain.handle('evidence:list', () => ok([]))
ipcMain.handle('itinerary-route:snapshot', (_, request) => {
  if (request.sessionId === routeSession.sessionId) return ok(routeSnapshot)
  return ok({
    sessionId: otherSession.sessionId,
    stage: otherSession.stage,
    goal: null,
    candidates: [],
    selectedRouteId: null,
    sourceOutcomes: [],
    blockingReasons: []
  })
})
ipcMain.handle('itinerary-route:select', (_, request) => {
  assert.deepEqual(request, {
    sessionId: routeSession.sessionId,
    routeId: 'route-balanced'
  })
  routeSelectCalls += 1
  routeSession.stage = 'STAGE_3'
  routeSnapshot = {
    ...routeSnapshot,
    stage: 'STAGE_3',
    selectedRouteId: request.routeId
  }
  return ok(routeSnapshot)
})
ipcMain.handle('itinerary-route:manual-evidence-apply', (_, request) => {
  assert.equal(request.sessionId, routeSession.sessionId)
  assert.equal(request.routeId, 'route-balanced')
  assert.equal(request.legId, 'route-balanced-leg-1')
  assert.equal(request.mode, 'MANUAL_FLIGHT')
  assert.match(request.startAt, /^2026-09-08T08:00:00[+-]\d{2}:\d{2}$/)
  assert.match(request.endAt, /^2026-09-08T10:00:00[+-]\d{2}:\d{2}$/)
  assert.equal(request.label, 'MU3000')
  assert.equal(request.sourceLabel, '航司官网')
  assert.equal(request.sourceUrl, 'https://example.com/MU3000')
  assert.equal(request.confirmed, true)
  assert.equal('fromCity' in request, false)
  assert.equal('toCity' in request, false)
  assert.equal('travelDate' in request, false)
  manualEvidenceApplyCalls += 1
  candidates = candidates.map((candidate) => {
    if (candidate.routeId !== request.routeId) return candidate
    const legs = candidate.legs.map((leg) =>
      leg.legId === request.legId
        ? {
            ...leg,
            mode: request.mode,
            label: request.label,
            durationMinutes: 120,
            verificationStatus: 'VERIFIED_BY_USER',
            claimIds: ['manual-route-smoke-claim']
          }
        : leg
    )
    return {
      ...candidate,
      legs,
      score: { ...candidate.score, criticalEvidenceComplete: true, unverifiedLegCount: 0 },
      isRecommended: true,
      blockingReasons: []
    }
  })
  routeSnapshot = { ...routeSnapshot, candidates }
  return ok(routeSnapshot)
})
ipcMain.handle('route-research:snapshot', (_, request) => ok(routeNodeSnapshot(request)))

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 1180,
      height: 900,
      show: false,
      webPreferences: {
        preload: path.join(process.cwd(), 'out', 'preload', 'index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('route smoke renderer exited', details)
    })
    window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        console.error('route smoke load failed', {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame
        })
      }
    )
    try {
      await window.loadFile(path.join(process.cwd(), 'out', 'renderer', 'index.html'))
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 300))'
      )
      const initial = await window.webContents.executeJavaScript(`(() => ({
        text: document.body.innerText,
        cardCount: document.querySelectorAll('.route-candidate').length,
        recommendedCount: document.querySelectorAll('.recommended-badge').length,
        advantageCount: document.querySelectorAll('[aria-label="路线优势"]').length,
        tradeoffCount: document.querySelectorAll('[aria-label="路线代价与未知项"]').length,
        manualFormCount: document.querySelectorAll('form[aria-label$="人工交通证据"]').length,
        selectCount: [...document.querySelectorAll('button')]
          .filter((item) => item.textContent?.includes('选择这条路线并进入 STAGE-3')).length
      }))()`)
      assert.equal(initial.cardCount, 3)
      assert.equal(initial.recommendedCount, 0)
      assert.equal(initial.advantageCount, 3)
      assert.equal(initial.tradeoffCount, 3)
      assert.equal(initial.manualFormCount, 3)
      assert.equal(initial.selectCount, 0)
      assert.match(initial.text, /广州 ⇄ 云南/)
      assert.match(initial.text, /具体出发点：广州市区集合点/)
      assert.match(initial.text, /洱海、玉龙雪山、西双版纳/)
      assert.match(initial.text, /人工补证范围（只读）/)
      assert.match(initial.text, /不调用交通来源或模型/)
      assert.match(initial.text, /费用 UNKNOWN/)
      assert.match(initial.text, /硬约束 通过/)
      assert.match(initial.text, /关键证据 不完整/)
      assert.match(initial.text, /未核验腿 1/)
      assert.match(initial.text, /夜间到达 0/)
      assert.match(initial.text, /折返分/)
      assert.match(initial.text, /海拔 MEDIUM/)
      assert.match(initial.text, /费用完整度 不完整/)
      assert.match(initial.text, /优势/)
      assert.match(initial.text, /代价与未知项/)
      assert.match(initial.text, /昆明：/)
      assert.equal(routeSession.stage, 'STAGE_2')

      window.setSize(820, 900)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 120))'
      )
      const tablet = await window.webContents.executeJavaScript(`(() => {
        const grid = document.querySelector('.route-candidate-grid')
        const cards = [...document.querySelectorAll('.route-candidate')]
        if (!(grid instanceof HTMLElement) || cards.length !== 3 ||
            !cards.every((card) => card instanceof HTMLElement)) {
          throw new Error('route tablet-layout target missing')
        }
        return {
          pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          gridColumns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
          cardsFit: cards.every((card) => card.scrollWidth <= card.clientWidth + 1)
        }
      })()`)
      assert.equal(tablet.gridColumns, 1)
      assert.equal(tablet.pageFits, true)
      assert.equal(tablet.cardsFit, true)

      window.setSize(320, 900)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 120))'
      )
      const narrow = await window.webContents.executeJavaScript(`(() => {
        const grid = document.querySelector('.route-candidate-grid')
        const cards = [...document.querySelectorAll('.route-candidate')]
        const comparisonSections = [...document.querySelectorAll('.route-comparison-section')]
        const spines = [...document.querySelectorAll('.route-spine')]
        const form = document.querySelector('form[aria-label$="人工交通证据"]')
        const button = form?.querySelector('button[type="submit"]')
        if (!(grid instanceof HTMLElement) || cards.length !== 3 ||
            comparisonSections.length !== 6 || spines.length !== 3 ||
            !cards.every((card) => card instanceof HTMLElement) ||
            !comparisonSections.every((section) => section instanceof HTMLElement) ||
            !spines.every((spine) => spine instanceof HTMLElement) ||
            !(form instanceof HTMLFormElement) || !(button instanceof HTMLButtonElement)) {
          throw new Error('route narrow-layout target missing')
        }
        button.focus()
        return {
          pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          gridColumns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
          cardsFit: cards.every((card) => card.scrollWidth <= card.clientWidth + 1),
          comparisonFits: comparisonSections.every(
            (section) => section.scrollWidth <= section.clientWidth + 1
          ),
          spinesFit: spines.every((spine) => spine.scrollWidth <= spine.clientWidth + 1),
          spineOverflow: spines.flatMap((spine) => [...spine.querySelectorAll('*')]
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => ({ tag: el.tagName, className: el.className,
              width: el.clientWidth, scrollWidth: el.scrollWidth }))),
          formFits: form.scrollWidth <= form.clientWidth + 1,
          submitFocused: document.activeElement === button
        }
      })()`)
      assert.equal(narrow.gridColumns, 1)
      assert.equal(narrow.pageFits, true)
      assert.equal(narrow.cardsFit, true)
      assert.equal(narrow.comparisonFits, true)
      assert.equal(narrow.spinesFit, true, JSON.stringify(narrow.spineOverflow))
      assert.equal(narrow.formFits, true)
      assert.equal(narrow.submitFocused, true)

      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('form[aria-label$="人工交通证据"] input[name="label"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('manual draft input missing')
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        if (!valueSetter) throw new Error('native input setter missing')
        valueSetter.call(input, '未提交草稿')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        window.__routeConfirmCalls = 0
        window.confirm = () => {
          window.__routeConfirmCalls += 1
          return true
        }
        const button = [...document.querySelectorAll('.session-item')]
          .find((item) => item.textContent?.includes('对照会话'))
        if (!(button instanceof HTMLButtonElement)) throw new Error('other session button missing')
        button.click()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 180))'
      )
      const dirtySwitch = await window.webContents.executeJavaScript(`(() => ({
        confirmCalls: window.__routeConfirmCalls,
        routeCards: document.querySelectorAll('.route-decision-card').length,
        manualForms: document.querySelectorAll('form[aria-label$="人工交通证据"]').length
      }))()`)
      assert.equal(dirtySwitch.confirmCalls, 1)
      assert.equal(dirtySwitch.routeCards, 0)
      assert.equal(dirtySwitch.manualForms, 0)

      await window.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('.session-item')]
          .find((item) => item.textContent?.includes('广州到云南 10 天'))
        if (!(button instanceof HTMLButtonElement)) throw new Error('route session button missing')
        button.click()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 180))'
      )

      await window.webContents.executeJavaScript(`(() => {
        const form = document.querySelector('form[aria-label="广州到大理人工交通证据"]')
        if (!(form instanceof HTMLFormElement)) throw new Error('balanced manual form missing')
        const setValue = (name, value) => {
          const field = form.elements.namedItem(name)
          if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
            throw new Error('manual field missing: ' + name)
          }
          field.value = value
          field.dispatchEvent(new Event('input', { bubbles: true }))
        }
        setValue('label', 'MU3000')
        setValue('sourceLabel', '航司官网')
        setValue('sourceUrl', 'https://example.com/MU3000')
        setValue('summary', '已逐项核对日期、端点与当地时间。')
        const confirmed = form.elements.namedItem('confirmed')
        if (!(confirmed instanceof HTMLInputElement)) throw new Error('confirm checkbox missing')
        confirmed.checked = true
        confirmed.dispatchEvent(new Event('change', { bubbles: true }))
        form.requestSubmit()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 250))'
      )
      const recovered = await window.webContents.executeJavaScript(`(() => ({
        text: document.body.innerText,
        recommendedCount: document.querySelectorAll('.recommended-badge').length,
        selectCount: [...document.querySelectorAll('button')]
          .filter((item) => item.textContent?.includes('选择这条路线并进入 STAGE-3')).length
      }))()`)
      assert.equal(manualEvidenceApplyCalls, 1)
      assert.equal(recovered.recommendedCount, 1)
      assert.equal(recovered.selectCount, 1)
      assert.match(recovered.text, /人工交通证据已写入本地事件/)
      assert.match(recovered.text, /外部调用 0，模型调用 0/)

      const artifactDir = path.join(process.cwd(), 'test', 'artifacts')
      fs.mkdirSync(artifactDir, { recursive: true })
      const screenshot = await window.webContents.capturePage()
      const captureSize = screenshot.getSize()
      const png = screenshot.toPNG()
      assert.ok(captureSize.width > 0 && captureSize.height > 0 && png.byteLength > 0)
      const suffix = renderMode === 'default' ? '' : `.${renderMode}`
      fs.writeFileSync(path.join(artifactDir, `itinerary-route-ui-smoke${suffix}.png`), png)

      await window.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.textContent?.includes('选择这条路线并进入 STAGE-3'))
        if (!(button instanceof HTMLButtonElement)) throw new Error('route select button missing')
        button.click()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 180))'
      )
      assert.equal(routeSelectCalls, 1)
      assert.equal(routeSession.stage, 'STAGE_3')
      const selectedText = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(selectedText, /查看已选路线与交通证据/)
      assert.match(selectedText, /大理 · 研究与选择/)
      assert.match(selectedText, /丽江/)
      assert.match(selectedText, /西双版纳/)
      assert.match(selectedText, /未开始 · 必需/)
      assert.match(selectedText, /查看研究计划/)
      const selectedDetails = await window.webContents.executeJavaScript(`(() => {
        const details = document.querySelector('.selected-route-details')
        return { open: details.open, text: details.textContent }
      })()`)
      assert.equal(selectedDetails.open, false)
      assert.match(selectedDetails.text, /已选择/)
      assert.match(selectedText, /路线与住宿段日期已冻结/)
      const nodeLayout = await window.webContents.executeJavaScript(`(() => {
        const card = document.querySelector('[data-testid="route-node-research-card"]')
        if (!(card instanceof HTMLElement)) throw new Error('route node research card missing')
        return { fits: card.scrollWidth <= card.clientWidth + 1 }
      })()`)
      assert.equal(nodeLayout.fits, true)

      window.setContentSize(1488, 1056)
      // Capture a fresh desktop session; resizing a hidden Windows surface can retain stale pixels.
      await window.loadFile(path.join(process.cwd(), 'out', 'renderer', 'index.html'))
      await window.webContents.executeJavaScript(`new Promise((resolve) => {
        setTimeout(() => {
          document.activeElement?.blur()
          window.scrollTo({ top: 0, behavior: 'instant' })
          resolve()
        }, 350)
      })`)
      const workbenchLayout = await window.webContents.executeJavaScript(`(() => ({
        scrollY,
        headerY: document.querySelector('.trip-workspace-heading').getBoundingClientRect().y,
        heading: [...document.querySelector('.trip-workspace-heading').querySelectorAll('*')]
          .map(el => ({tag: el.tagName, y: el.getBoundingClientRect().y,
            h: el.getBoundingClientRect().height, margin: getComputedStyle(el).margin,
            transform: getComputedStyle(el).transform})),
        headerStyle: {padding: getComputedStyle(document.querySelector('.trip-workspace-heading')).padding,
          height: getComputedStyle(document.querySelector('.trip-workspace-heading')).height},
        scrolling: [...document.querySelectorAll('*')].filter(el => el.scrollTop > 0)
          .map(el => ({tag: el.tagName, className: el.className, scrollTop: el.scrollTop}))
      }))()`)
      fs.writeFileSync(
        path.join(artifactDir, 'route-workbench-layout.json'),
        JSON.stringify(workbenchLayout, null, 2)
      )
      assert.equal(workbenchLayout.scrollY, 0)
      assert.ok(workbenchLayout.headerY >= 0)
      await window.webContents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      const workbenchCapture = await window.webContents.capturePage()
      fs.writeFileSync(
        path.join(artifactDir, 'route-workbench-electron.png'),
        workbenchCapture.toPNG()
      )

      await window.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('.session-item')]
          .find((item) => item.textContent?.includes('对照会话'))
        if (!(button instanceof HTMLButtonElement)) throw new Error('other session button missing')
        button.click()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 180))'
      )
      const switched = await window.webContents.executeJavaScript(`(() => ({
        routeCards: document.querySelectorAll('.route-decision-card').length,
        staleSelects: [...document.querySelectorAll('button')]
          .filter((item) => item.textContent?.includes('选择这条路线并进入 STAGE-3')).length
      }))()`)
      assert.equal(switched.routeCards, 0)
      assert.equal(switched.staleSelects, 0)

      const result = {
        ok: true,
        renderMode,
        checked: {
          threeCandidateComparison: true,
          recommendationReason: true,
          explicitUnknowns: true,
          completeScoreBreakdown: true,
          explicitAdvantagesAndTradeoffs: true,
          tabletLayout: true,
          manualEvidenceRecovery: true,
          kunmingIncludedAndOmitted: true,
          selectionStageGate: true,
          nodeResearchQueue: true,
          keyboardFocus: true,
          sessionSwitchIsolation: true,
          narrowLayout: true,
          manualDraftSessionGuard: true
        },
        capture: { width: captureSize.width, height: captureSize.height, bytes: png.byteLength },
        externalCalls: 0,
        modelCalls: 0,
        irreversibleActions: 0
      }
      fs.writeFileSync(
        path.join(artifactDir, `itinerary-route-ui-smoke${suffix}.json`),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
      )
      console.log(
        JSON.stringify({
          ok: true,
          renderMode,
          externalCalls: 0,
          modelCalls: 0,
          irreversibleActions: 0
        })
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
