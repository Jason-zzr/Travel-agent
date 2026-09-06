import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-d4-ui-'))
app.setPath('userData', root)

const renderMode =
  process.argv.includes('--smoke-no-gpu') || process.env.D4_UI_SMOKE_RENDER_MODE === 'no-gpu'
    ? 'no-gpu'
    : (process.env.D4_UI_SMOKE_RENDER_MODE ?? 'default')
if (renderMode !== 'default' && renderMode !== 'no-gpu') {
  throw new Error(`unsupported D4_UI_SMOKE_RENDER_MODE: ${renderMode}`)
}
app.disableHardwareAcceleration()
if (renderMode === 'no-gpu') {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-software-rasterizer')
}

app.once('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    // Electron may keep a platform cache file open until the process exits.
  }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const ok = (data) => ({ ok: true, data })
const session = {
  sessionId: 'session-d4-smoke',
  title: '成都 D4 夹具',
  stage: 'STAGE_2',
  linkedSessionGroup: null,
  splitIndex: null
}
const claims = [
  {
    claimId: 'hours-a',
    sessionId: session.sessionId,
    subject: '武侯祠',
    predicate: 'openingHours',
    value: '09:00-18:00',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://official.example/hours',
    contentIdentity: 'OFFICIAL',
    verificationStatus: 'CONFLICTED',
    observedAt: '2026-08-26T04:00:00.000Z',
    validUntil: '2026-09-02T04:00:00.000Z',
    confidence: 0.9,
    conflictsWith: ['hours-b'],
    notes: null
  },
  {
    claimId: 'hours-b',
    sessionId: session.sessionId,
    subject: '成都武侯祠博物馆',
    predicate: 'openingHours',
    value: '08:30-17:00',
    sourceId: 'SRC_MAP',
    sourceRef: 'SRC_MAP:maps_geo:hours-fixture',
    contentIdentity: 'OFFICIAL',
    verificationStatus: 'CONFLICTED',
    observedAt: '2026-08-26T04:00:00.000Z',
    validUntil: '2026-09-02T04:00:00.000Z',
    confidence: 0.8,
    conflictsWith: ['hours-a'],
    notes: null
  },
  {
    claimId: 'stairs',
    sessionId: session.sessionId,
    subject: '武侯祠·锦里',
    predicate: 'physicalDemand',
    value: '长时间爬坡并包含大量台阶',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://ugc.example/walk',
    contentIdentity: 'INDEPENDENT_UGC',
    verificationStatus: 'VERIFIED',
    observedAt: '2026-08-26T04:00:00.000Z',
    validUntil: '2027-02-26T04:00:00.000Z',
    confidence: 0.7,
    conflictsWith: [],
    notes: null
  },
  {
    claimId: 'promotion',
    sessionId: session.sessionId,
    subject: '锦里优惠体验',
    predicate: 'experience',
    value: '专属优惠码，下单立减',
    sourceId: 'SRC_SEARCH',
    sourceRef: 'https://promo.example/item',
    contentIdentity: 'SUSPECTED_PROMOTION',
    verificationStatus: 'UNVERIFIED',
    observedAt: '2026-08-26T04:00:00.000Z',
    validUntil: '2027-02-26T04:00:00.000Z',
    confidence: 0.4,
    conflictsWith: [],
    notes: null
  }
]

let snapshot = {
  sessionId: session.sessionId,
  stage: 'STAGE_2',
  fixedDestinationCity: '成都',
  destinationCandidates: [],
  selectedDestinationCandidateId: null,
  researchEntities: [
    {
      entityId: 'wuhou-shrine',
      destinationCity: '成都',
      canonicalSubject: '武侯祠',
      aliases: ['武侯祠', '成都武侯祠博物馆', '武侯祠·锦里'],
      kind: 'ATTRACTION',
      claimIds: ['hours-a', 'hours-b', 'stairs'],
      identityStatus: 'DETERMINISTIC',
      verificationStatus: 'CONFLICTED',
      contentIdentities: ['OFFICIAL', 'INDEPENDENT_UGC'],
      validUntil: '2026-09-02T04:00:00.000Z',
      promotionOnlySupport: false,
      fitness: {
        status: 'RISK',
        reasons: ['同行含老人和儿童，长时间爬坡与大量台阶会增加体力风险']
      },
      disposition: 'MUST_GO',
      blockingReasons: ['开放时间存在未裁决冲突'],
      unresolvedConflictClaimIds: ['hours-a', 'hours-b']
    },
    {
      entityId: 'promo-only',
      destinationCity: '成都',
      canonicalSubject: '锦里优惠体验',
      aliases: [],
      kind: 'EXPERIENCE',
      claimIds: ['promotion'],
      identityStatus: 'PROPOSED',
      verificationStatus: 'UNVERIFIED',
      contentIdentities: ['SUSPECTED_PROMOTION'],
      validUntil: '2027-02-26T04:00:00.000Z',
      promotionOnlySupport: true,
      fitness: { status: 'UNKNOWN', reasons: ['缺少成员适配证据'] },
      disposition: 'NEUTRAL',
      blockingReasons: ['推广内容不能单独支撑推荐'],
      unresolvedConflictClaimIds: []
    }
  ],
  researchChecklistConfirmed: false,
  conflictResolutions: [],
  sourceResearchFailures: [
    {
      sourceId: 'SRC_MAP',
      status: 'FAILED',
      errorCode: 'SOURCE_UNREACHABLE',
      capabilityImpact: '地点坐标无法自动补充',
      manualAlternative: '在 EVIDENCE 中粘贴官方地点链接'
    }
  ]
}
let fixedDestinationConfirmCalls = 0
let manualResearchCalls = 0

ipcMain.handle('sessions:list', () => ok([session]))
ipcMain.handle('itinerary-route:snapshot', () =>
  ok({
    sessionId: session.sessionId,
    stage: session.stage,
    goal: null,
    candidates: [],
    selectedRouteId: null,
    sourceOutcomes: [],
    blockingReasons: []
  })
)
ipcMain.handle('d4:snapshot', (_, request) => {
  assert.deepEqual(request, { sessionId: session.sessionId })
  return ok(snapshot)
})
ipcMain.handle('evidence:list', (_, request) => {
  assert.equal(request.sessionId, session.sessionId)
  return ok(claims)
})
ipcMain.handle('destination:confirm-fixed', (_, request) => {
  assert.deepEqual(request, { sessionId: session.sessionId, city: '成都' })
  fixedDestinationConfirmCalls += 1
  session.stage = 'STAGE_3'
  snapshot = { ...snapshot, stage: 'STAGE_3', fixedDestinationCity: null }
  return ok(snapshot)
})
ipcMain.handle('research:disposition', (_, request) => {
  assert.equal(request.sessionId, session.sessionId)
  assert.equal(request.entityId, 'wuhou-shrine')
  assert.equal(request.disposition, 'WANT')
  snapshot = {
    ...snapshot,
    researchEntities: snapshot.researchEntities.map((entity) =>
      entity.entityId === request.entityId
        ? { ...entity, disposition: request.disposition }
        : entity
    )
  }
  return ok(snapshot)
})
ipcMain.handle('research:conflict-resolve', (_, request) => {
  assert.deepEqual(request, {
    sessionId: session.sessionId,
    subject: '武侯祠',
    predicate: 'openingHours',
    resolution: 'CLAIM_SELECTED',
    selectedClaimId: 'hours-a'
  })
  snapshot = {
    ...snapshot,
    conflictResolutions: [
      {
        subject: '武侯祠',
        predicate: 'openingHours',
        resolution: 'CLAIM_SELECTED',
        selectedClaimId: 'hours-a',
        resolvedAt: '2026-08-26T05:00:00.000Z'
      }
    ]
  }
  return ok(snapshot)
})
ipcMain.handle('research:confirm', (_, request) => {
  assert.deepEqual(request, { sessionId: session.sessionId })
  return {
    ok: false,
    error: {
      code: 'GATE_BLOCKED',
      klass: 'GATE',
      userHint: '锦里优惠体验只有推广内容支撑，请补充独立来源或排除。'
    }
  }
})
ipcMain.handle('research:manual-checklist-prepare', (_, request) => {
  assert.equal(request.sessionId, session.sessionId)
  assert.equal(request.items.length, 1)
  assert.deepEqual(
    {
      subject: request.items[0].subject,
      kind: request.items[0].kind,
      aliases: request.items[0].aliases,
      disposition: request.items[0].disposition,
      sourceLabel: request.items[0].sourceLabel,
      sourceUrl: request.items[0].sourceUrl,
      sourceClaimId: request.items[0].sourceClaimId,
      contentIdentity: request.items[0].contentIdentity,
      summary: request.items[0].summary,
      fitness: request.items[0].fitness,
      hardAnchors: request.items[0].hardAnchors,
      confirmed: request.items[0].confirmed
    },
    {
      subject: '杜甫草堂',
      kind: 'ATTRACTION',
      aliases: [],
      disposition: 'NEUTRAL',
      sourceLabel: '杜甫草堂官方公众号',
      sourceUrl: null,
      sourceClaimId: null,
      contentIdentity: 'OFFICIAL',
      summary: '适合家庭慢游，成员适配仍待现场确认。',
      fitness: { status: 'UNKNOWN', reasons: [] },
      hardAnchors: [],
      confirmed: true
    }
  )
  manualResearchCalls += 1
  const claim = {
    claimId: 'manual-summary',
    sessionId: session.sessionId,
    subject: '杜甫草堂',
    predicate: 'manualResearchSummary',
    value: {
      summary: '适合家庭慢游，成员适配仍待现场确认。',
      sourceLabel: '杜甫草堂官方公众号',
      sourceUrl: null,
      sourceClaimId: null
    },
    sourceId: 'USER_RESEARCH',
    sourceRef: 'USER_RESEARCH:smoke-digest',
    contentIdentity: 'OFFICIAL',
    verificationStatus: 'VERIFIED_BY_USER',
    observedAt: '2026-08-30T04:00:00.000Z',
    validUntil: '2026-09-06T04:00:00.000Z',
    confidence: null,
    conflictsWith: [],
    notes: '用户逐项确认。'
  }
  claims.splice(0, claims.length, claim)
  snapshot = {
    ...snapshot,
    manualResearchSummary: {
      mode: 'USER_CONFIRMED',
      itemCount: 1,
      linkedPasteCount: 0,
      confirmedAt: '2026-08-30T04:00:00.000Z'
    },
    sourceResearchFailures: [],
    conflictResolutions: [],
    researchEntities: [
      {
        entityId: 'manual-dufu',
        destinationCity: '成都',
        canonicalSubject: '杜甫草堂',
        aliases: [],
        kind: 'ATTRACTION',
        claimIds: ['manual-summary'],
        identityStatus: 'DETERMINISTIC',
        verificationStatus: 'VERIFIED_BY_USER',
        contentIdentities: ['OFFICIAL'],
        validUntil: '2026-09-06T04:00:00.000Z',
        promotionOnlySupport: false,
        fitness: { status: 'UNKNOWN', reasons: [] },
        disposition: 'NEUTRAL',
        blockingReasons: [],
        unresolvedConflictClaimIds: []
      }
    ]
  }
  return ok(snapshot)
})

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
    try {
      await window.loadFile(path.join(process.cwd(), 'out', 'renderer', 'index.html'))
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 250))'
      )
      const fixedDestinationText =
        await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(fixedDestinationText, /目的地已明确：成都/)
      assert.match(fixedDestinationText, /确认 成都，进入研究/)
      assert.doesNotMatch(fixedDestinationText, /生成候选/)
      assert.equal(session.stage, 'STAGE_2')

      await window.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.textContent?.includes('确认 成都，进入研究'))
        if (!(button instanceof HTMLButtonElement)) throw new Error('fixed destination button missing')
        button.click()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      assert.equal(fixedDestinationConfirmCalls, 1)
      assert.equal(session.stage, 'STAGE_3')

      const initial = await window.webContents.executeJavaScript(`(() => ({
        text: document.body.innerText,
        entityCount: document.querySelectorAll('.research-entity').length,
        conflictCount: document.querySelectorAll('.conflict-claim').length
      }))()`)
      assert.equal(initial.entityCount, 3)
      assert.equal(initial.conflictCount, 2)
      assert.match(initial.text, /STAGE-3 · 研究与证据确认/)
      assert.match(initial.text, /小红书 30 帖景点排序/)
      assert.match(initial.text, /固定 4 次搜索/)
      assert.match(initial.text, /预览 30 帖研究计划（零外部调用）/)
      assert.match(initial.text, /成都武侯祠博物馆/)
      assert.match(initial.text, /成员适配：RISK/)
      assert.match(initial.text, /老人和儿童/)
      assert.match(initial.text, /锦里优惠体验/)
      assert.match(initial.text, /推广内容不能单独支撑推荐/)
      assert.match(initial.text, /09:00-18:00/)
      assert.match(initial.text, /08:30-17:00/)
      assert.match(initial.text, /地点坐标无法自动补充/)

      await window.webContents.executeJavaScript(`(() => {
        const select = document.querySelector('.research-entity select')
        if (!(select instanceof HTMLSelectElement)) throw new Error('disposition select missing')
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
        setter?.call(select, 'WANT')
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      assert.equal(snapshot.researchEntities[0].disposition, 'WANT')

      await window.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('.conflict-claim button')]
          .find((item) => item.textContent?.includes('采用此 Claim'))
        if (!(button instanceof HTMLButtonElement)) throw new Error('conflict button missing')
        button.click()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      const resolvedText = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(resolvedText, /已裁决 CLAIM_SELECTED/)

      await window.webContents.executeJavaScript(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find((item) => item.textContent?.includes('明确确认整份清单'))
        if (!(button instanceof HTMLButtonElement)) throw new Error('confirm button missing')
        button.click()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      const blockedText = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(blockedText, /只有推广内容支撑/)

      await window.webContents.executeJavaScript(`(() => {
        const editor = document.querySelector('.manual-research-editor')
        if (!(editor instanceof HTMLElement)) throw new Error('manual editor missing')
        const setValue = (labelText, value) => {
          const label = [...editor.querySelectorAll('label')]
            .find((item) => item.textContent?.includes(labelText))
          const control = label?.querySelector('input, textarea, select')
          if (!(control instanceof HTMLInputElement) &&
              !(control instanceof HTMLTextAreaElement) &&
              !(control instanceof HTMLSelectElement)) {
            throw new Error('manual control missing: ' + labelText)
          }
          const prototype = control instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : control instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype
          Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
          control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', {
            bubbles: true
          }))
        }
        setValue('名称', '杜甫草堂')
        setValue('来源身份', 'OFFICIAL')
        setValue('来源名称', '杜甫草堂官方公众号')
        setValue('研究摘要', '适合家庭慢游，成员适配仍待现场确认。')
        const checkbox = editor.querySelector('.manual-confirmation input[type="checkbox"]')
        if (!(checkbox instanceof HTMLInputElement)) throw new Error('manual confirmation missing')
        checkbox.click()
        const form = editor.querySelector('form')
        if (!(form instanceof HTMLFormElement)) throw new Error('manual form missing')
        form.requestSubmit()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 180))'
      )
      assert.equal(manualResearchCalls, 1)
      const manualText = await window.webContents.executeJavaScript('document.body.innerText')
      assert.match(manualText, /人工清单：1 项/)
      assert.match(manualText, /USER_RESEARCH · VERIFIED_BY_USER/)
      assert.match(manualText, /杜甫草堂官方公众号/)
      assert.match(manualText, /external\/model calls=0/)

      window.setSize(820, 900)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      const narrowLayout = await window.webContents.executeJavaScript(`(() => {
        const editor = document.querySelector('.manual-research-editor')
        const grid = editor?.querySelector('.manual-research-grid')
        if (!(editor instanceof HTMLElement) || !(grid instanceof HTMLElement)) {
          throw new Error('manual narrow-layout target missing')
        }
        return {
          viewportWidth: window.innerWidth,
          gridColumns: getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length,
          editorFits: editor.scrollWidth <= editor.clientWidth + 1
        }
      })()`)
      assert.ok(narrowLayout.viewportWidth <= 980)
      assert.equal(narrowLayout.gridColumns, 1)
      assert.equal(narrowLayout.editorFits, true)

      const artifactDir = path.join(process.cwd(), 'test', 'artifacts')
      fs.mkdirSync(artifactDir, { recursive: true })
      const screenshot = await window.webContents.capturePage()
      const captureSize = screenshot.getSize()
      assert.ok(captureSize.width > 0 && captureSize.height > 0)
      const png = screenshot.toPNG()
      assert.ok(png.byteLength > 0)
      const suffix = renderMode === 'default' ? '' : `.${renderMode}`
      fs.writeFileSync(path.join(artifactDir, `d4-ui-smoke${suffix}.png`), png)
      const result = {
        ok: true,
        renderMode,
        checked: {
          entityGrouping: true,
          promotionBlock: true,
          memberFitness: true,
          bilateralConflict: true,
          userDisposition: true,
          userConflictResolution: true,
          gateBlockedReason: true,
          fixedDestinationConfirmation: true,
          xhsRankingPlan: true,
          manualResearch: true,
          manualResearchNarrowLayout: true
        },
        capture: { width: captureSize.width, height: captureSize.height, bytes: png.byteLength },
        externalCalls: 0,
        modelCalls: 0
      }
      fs.writeFileSync(
        path.join(artifactDir, `d4-ui-smoke${suffix}.json`),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
      )
      console.log(JSON.stringify({ ok: true, renderMode, externalCalls: 0, modelCalls: 0 }))
    } finally {
      window.destroy()
      app.quit()
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
