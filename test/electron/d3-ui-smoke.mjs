import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'travel-harness-d3-ui-'))
app.setPath('userData', root)

// Render-mode fallback. On some Windows automation hosts an outer OS sandbox
// can prevent Electron's sandboxed Chromium child processes from starting with
// 0xC0000135 / STATUS_DLL_NOT_FOUND (decimal -1073741515). That does not prove
// an application DLL is missing: the same build must also be checked outside
// the outer automation sandbox while keeping Electron's own sandbox enabled.
//
// `--smoke-no-gpu` (or D3_UI_SMOKE_RENDER_MODE=no-gpu) disables acceleration
// and the software rasterizer for a deterministic fallback; Chromium may still
// create a GPU helper process. The custom flag name is deliberate: Chromium
// ignores switches it does not know, so this cannot be confused with its own
// --disable-gpu. The mode is recorded in the artifact below — a fallback pass
// must never be read as a full-path pass.
// This does NOT relax Electron's Chromium sandbox.
const renderMode =
  process.argv.includes('--smoke-no-gpu') || process.env.D3_UI_SMOKE_RENDER_MODE === 'no-gpu'
    ? 'no-gpu'
    : (process.env.D3_UI_SMOKE_RENDER_MODE ?? 'default')
if (renderMode !== 'default' && renderMode !== 'no-gpu') {
  throw new Error(`unsupported D3_UI_SMOKE_RENDER_MODE: ${renderMode}`)
}
app.disableHardwareAcceleration()
if (renderMode === 'no-gpu') {
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  // Prevents the SwiftShader fallback, whose vk_swiftshader.dll is itself a
  // reported source of this same DLL-load failure.
  app.commandLine.appendSwitch('disable-software-rasterizer')
}

app.once('quit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    // Electron may hold a platform cache file until the process exits.
  }
})

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const ok = (data) => ({ ok: true, data })
const health = ['SRC_RAIL', 'SRC_MAP', 'SRC_HOTEL', 'SRC_SEARCH'].map((sourceId) => ({
  sourceId,
  status: sourceId === 'SRC_HOTEL' ? 'DEGRADED' : 'OK',
  lastOkAt: '2026-08-22T08:00:00.000Z',
  lastErrorCode: sourceId === 'SRC_HOTEL' ? 'SOURCE_UNREACHABLE' : null,
  failStreak: sourceId === 'SRC_HOTEL' ? 2 : 0,
  updatedAt: '2026-08-22T08:00:00.000Z',
  capabilityImpact: '酒店库存、房型与取消政策无法自动核验',
  manualAlternative: '请从常用平台粘贴酒店候选。'
}))

const handlers = {
  'credentials:list': ok(
    [
      'AMAP',
      'ROLLINGGO',
      'OPENAI',
      'DEEPSEEK',
      'GEMINI',
      'SHUAI_API',
      'BRAVE_SEARCH',
      'SERPER_SEARCH'
    ].map((id) => ({
      id,
      status: 'UNCONFIGURED'
    }))
  ),
  'provider:get': ok({
    configured: false,
    version: null,
    provider: null,
    baseUrl: null,
    models: null,
    routes: null
  }),
  'sessions:list': ok([
    {
      sessionId: 'session-smoke',
      title: '成都夹具',
      stage: 'STAGE_1',
      linkedSessionGroup: null,
      splitIndex: null,
      lastSeq: 2
    }
  ]),
  'd4:snapshot': ok({
    sessionId: 'session-smoke',
    stage: 'STAGE_1',
    fixedDestinationCity: null,
    destinationCandidates: [],
    selectedDestinationCandidateId: null,
    researchEntities: [],
    researchChecklistConfirmed: false,
    conflictResolutions: [],
    sourceResearchFailures: []
  }),
  'itinerary-route:snapshot': ok({
    sessionId: 'session-smoke',
    stage: 'STAGE_1',
    goal: null,
    candidates: [],
    selectedRouteId: null,
    sourceOutcomes: [],
    blockingReasons: []
  }),
  'source-health:list': ok(health),
  'evidence:list': ok([
    {
      claimId: 'claim-smoke',
      sessionId: 'session-smoke',
      subject: '天府广场',
      predicate: 'coordinates',
      value: { city: '成都', lng: 104.06, lat: 30.67 },
      sourceId: 'SRC_MAP',
      sourceRef: 'SRC_MAP:maps_geo:v1-fixture',
      contentIdentity: 'OFFICIAL',
      verificationStatus: 'VERIFIED',
      observedAt: '2026-08-22T08:00:00.000Z',
      validUntil: '2036-08-22T08:00:00.000Z',
      confidence: null,
      conflictsWith: [],
      notes: null
    }
  ]),
  'inspector:tool-calls': ok([
    {
      callId: 'call-smoke',
      sessionId: 'session-smoke',
      toolName: 'maps_geo',
      sourceId: 'SRC_MAP',
      argsDigest: 'v1|tool=maps_geo|keys=address,city|values=redacted',
      durationMs: 42,
      ok: true,
      errorCode: null,
      createdAt: '2026-08-22T08:00:00.000Z'
    }
  ]),
  'inspector:blocked-tools': ok([
    {
      id: 1,
      sourceId: 'evil-fixture',
      toolName: 'confirmBooking',
      reason: 'WRITE_KEYWORD_HIT',
      createdAt: '2026-08-22T08:00:00.000Z'
    }
  ])
}

let savedProviderConfig = null
let xhsLoginQrRequests = 0
let xhsLoginStatusRequests = 0
let xhsCancelRequests = 0
const rendererConsoleErrors = []

for (const [channel, response] of Object.entries(handlers)) {
  ipcMain.handle(channel, () => {
    if (channel === 'source-health:list') throw new Error('fixture source health rejection')
    return response
  })
}
ipcMain.handle('inspector:snapshot', (_, query) =>
  ok({
    query,
    events: [],
    toolCalls: handlers['inspector:tool-calls'].data,
    modelCalls: [],
    blockedTools: handlers['inspector:blocked-tools'].data,
    sourceHealth: health
  })
)
ipcMain.handle('credentials:save', () => {
  throw new Error('fixture credential save rejection')
})
ipcMain.handle('source:xiaohongshu-login-qr', (_, request) => {
  assert.match(request.operationId, /^[0-9a-f-]{36}$/)
  xhsLoginQrRequests += 1
  return ok({
    status: 'QR_REQUIRED',
    imageDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    hint: '请使用小红书 App 扫码登录。',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  })
})
ipcMain.handle('source:xiaohongshu-status', (_, request) => {
  assert.match(request.operationId, /^[0-9a-f-]{36}$/)
  xhsLoginStatusRequests += 1
  return ok({ connected: true, loggedIn: true, authTokenConfigured: true })
})
ipcMain.handle('source:cancel', (_, request) => {
  assert.match(request.operationId, /^[0-9a-f-]{36}$/)
  xhsCancelRequests += 1
  return ok(true)
})
ipcMain.handle('source:query', (event, request) => {
  assert.equal(request.query.sourceId, 'SRC_SEARCH')
  assert.equal(request.query.input.query, '成都官方旅游公告')
  const sources = [
    {
      title: '成都官方旅游公告',
      url: 'https://example.gov.cn/chengdu',
      snippet: '公开搜索结果摘要。'
    }
  ]
  event.sender.send('source:progress', {
    operationId: request.operationId,
    sourceId: 'SRC_SEARCH',
    payload: { kind: 'SEARCH_RESULTS', sources }
  })
  event.sender.send('source:progress', {
    operationId: request.operationId,
    sourceId: 'SRC_SEARCH',
    payload: { kind: 'ANSWER_DELTA', delta: '流式夹具答案。' }
  })
  return ok({
    sourceId: 'SRC_SEARCH',
    toolName: 'deepseek_web_search',
    claims: [],
    fromCache: false,
    search: {
      answer: '流式夹具答案。',
      model: 'deepseek-v4-flash',
      searchProvider: 'serper-search',
      sources,
      usage: {
        inputTokens: 120,
        outputTokens: 20,
        cachedInputTokens: 0,
        reasoningTokens: 5,
        totalTokens: 140
      },
      audit: {
        searchApiCalls: 1,
        searchResultCount: 1,
        groundingCharacters: 300,
        nativeWebSearchCalls: 0,
        nativeOpenPageCalls: 0,
        openPageTokens: 0
      }
    }
  })
})
ipcMain.handle('provider:save', (_, config) => {
  assert.equal(config.version, 2)
  assert.deepEqual(config.channels, {
    DEEPSEEK_OFFICIAL: { baseUrl: 'https://api.deepseek.com' },
    SHUAI_API: { baseUrl: 'https://api.shuaiapi.com' }
  })
  assert.equal(config.roles.EXTRACTION.channel, 'SHUAI_API')
  assert.equal(config.roles.PLANNING.channel, 'DEEPSEEK_OFFICIAL')
  savedProviderConfig = config
  const models = Object.fromEntries(
    Object.entries(config.roles).map(([role, route]) => [role, route.model])
  )
  const routes = Object.fromEntries(
    Object.entries(config.roles).map(([role, route]) => [
      role,
      { ...route, baseUrl: config.channels[route.channel].baseUrl }
    ])
  )
  return ok({
    configured: true,
    version: 2,
    provider: null,
    baseUrl: null,
    models,
    routes
  })
})
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 1180,
      height: 820,
      show: false,
      webPreferences: {
        preload: path.join(process.cwd(), 'out', 'preload', 'index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') {
        rendererConsoleErrors.push(details.message)
        console.error('d3 smoke renderer console error', details.message)
      }
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('d3 smoke renderer exited', details)
    })
    window.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        console.error('d3 smoke load failed', {
          errorCode,
          errorDescription,
          validatedURL,
          isMainFrame
        })
      }
    )
    try {
      const webPreferences = window.webContents.getLastWebPreferences()
      assert.equal(webPreferences.sandbox, true)
      assert.equal(webPreferences.contextIsolation, true)
      assert.equal(webPreferences.nodeIntegration, false)
      await window.loadFile(path.join(process.cwd(), 'out', 'renderer', 'index.html'))
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 150))'
      )
      const apiType = await window.webContents.executeJavaScript('typeof window.api')
      assert.equal(apiType, 'object')
      const tabs = await window.webContents.executeJavaScript(
        "[...document.querySelectorAll('.view-switch button')].map((button) => button.textContent)"
      )
      assert.deepEqual(tabs, [
        'CHAT',
        'SKELETON',
        'TIMELINE',
        'TASKS',
        'EVIDENCE',
        'INSPECTOR',
        'SETTINGS'
      ])
      for (const tab of ['EVIDENCE', 'INSPECTOR', 'SETTINGS']) {
        await window.webContents.executeJavaScript(
          `([...document.querySelectorAll('.view-switch button')].find((button) => button.textContent === '${tab}')).click()`
        )
        await window.webContents.executeJavaScript(
          'new Promise((resolve) => setTimeout(resolve, 100))'
        )
        // `innerText` is layout-dependent and can be empty for a hidden,
        // software-rasterizer-disabled BrowserWindow. The smoke asserts DOM
        // content, so `textContent` is the deterministic contract here.
        const body = await window.webContents.executeJavaScript('document.body.textContent')
        assert.match(
          body,
          new RegExp(
            tab === 'EVIDENCE' ? 'EvidenceClaim' : tab === 'INSPECTOR' ? '被拦截工具' : '只读数据源'
          )
        )
      }
      const settingsMessage = await window.webContents.executeJavaScript(
        "document.querySelector('.system-message')?.textContent"
      )
      assert.equal(settingsMessage, '以下本机配置读取失败：数据源状态。其他设置仍可录入。')
      const credentialInputState = await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('input[name="credential"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('credential input missing')
        return { disabled: input.disabled, readOnly: input.readOnly }
      })()`)
      assert.deepEqual(credentialInputState, { disabled: false, readOnly: false })
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('input[name="credential"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('credential input missing')
        input.value = 'sk-ACCEPT-AMAP-7f3a9c'
        input.form?.requestSubmit()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      const credentialAfterRejectedSave = await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('input[name="credential"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('credential input missing')
        return { disabled: input.disabled, value: input.value }
      })()`)
      assert.deepEqual(credentialAfterRejectedSave, { disabled: false, value: '' })
      await window.webContents.executeJavaScript(`(() => {
        const form = document.querySelector('.provider-form')
        if (!(form instanceof HTMLFormElement)) throw new Error('provider form missing')
        const extractionChannel = form.elements.namedItem('EXTRACTION-channel')
        if (!(extractionChannel instanceof HTMLSelectElement)) {
          throw new Error('EXTRACTION channel missing')
        }
        extractionChannel.value = 'SHUAI_API'
        for (const role of ['EXTRACTION', 'PLANNING', 'REVIEW', 'VISION']) {
          const model = form.elements.namedItem(role + '-model')
          if (!(model instanceof HTMLInputElement)) throw new Error(role + ' model missing')
          model.value = 'fixture-' + role.toLowerCase()
        }
        form.requestSubmit()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      assert.equal(savedProviderConfig?.version, 2)
      const providerAfterSave = await window.webContents.executeJavaScript(`(() => ({
        status: document.querySelector('[aria-labelledby="provider-heading"] .status')?.textContent,
        message: document.querySelector('.system-message')?.textContent
      }))()`)
      assert.deepEqual(providerAfterSave, {
        status: '按角色已配置',
        message: '模型角色路由已保存；调用时不自动切换渠道或重试。'
      })
      const searchSettings = await window.webContents.executeJavaScript(`(() => ({
        hasLegacyOpenAiCredential: [...document.querySelectorAll('.credential-meta h3')]
          .some((heading) => heading.textContent === 'OpenAI'),
        hasLegacyBraveSearchCredential: [...document.querySelectorAll('.credential-meta h3')]
          .some((heading) => heading.textContent?.includes('Brave Search')),
        hasSerperSearchCredential: [...document.querySelectorAll('.credential-meta h3')]
          .some((heading) => heading.textContent === 'Serper Search（独立搜索）'),
        hasSearchModelInput: Boolean(document.querySelector('input[name="searchModel"]')),
        hasStreamingSearchCard: [...document.querySelectorAll('.source-card h3')]
          .some((heading) => heading.textContent === 'Serper Search + DeepSeek 流式生成')
      }))()`)
      assert.deepEqual(searchSettings, {
        hasLegacyOpenAiCredential: false,
        hasLegacyBraveSearchCredential: false,
        hasSerperSearchCredential: true,
        hasSearchModelInput: false,
        hasStreamingSearchCard: true
      })
      await window.webContents.executeJavaScript(`(() => {
        const card = [...document.querySelectorAll('.source-card')]
          .find((item) => item.querySelector('h3')?.textContent?.includes('小红书'))
        if (!(card instanceof HTMLElement)) throw new Error('XHS source card missing')
        const button = [...card.querySelectorAll('button')]
          .find((item) => item.textContent === '准备并登录小红书')
        if (!(button instanceof HTMLButtonElement)) throw new Error('XHS login button missing')
        button.click()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 150))'
      )
      const xhsQrDialog = await window.webContents.executeJavaScript(`(() => ({
        title: document.querySelector('[role="dialog"] h2')?.textContent,
        imageAlt: document.querySelector('[role="dialog"] img')?.getAttribute('alt'),
        imageSrc: document.querySelector('[role="dialog"] img')?.getAttribute('src') ?? '',
        status: document.querySelector('#xhs-login-status')?.textContent
      }))()`)
      assert.equal(xhsQrDialog.title, '登录小红书')
      assert.equal(xhsQrDialog.imageAlt, '小红书登录二维码')
      assert.match(xhsQrDialog.imageSrc, /^data:image\/png;base64,/)
      assert.match(xhsQrDialog.status, /自动检查登录结果/)
      assert.equal(xhsLoginQrRequests, 1)
      assert.equal(xhsLoginStatusRequests, 0)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 3200))'
      )
      const xhsLoginResult = await window.webContents.executeJavaScript(`(() => ({
        status: document.querySelector('#xhs-login-status')?.textContent,
        imagePresent: Boolean(document.querySelector('[role="dialog"] img'))
      }))()`)
      assert.deepEqual(xhsLoginResult, {
        status: '登录成功。现在可以关闭此窗口。',
        imagePresent: false
      })
      assert.equal(xhsLoginQrRequests, 1)
      assert.equal(xhsLoginStatusRequests, 1)
      await window.webContents.executeJavaScript(`(() => {
        const close = document.querySelector('[aria-label="关闭小红书登录窗口"]')
        if (!(close instanceof HTMLButtonElement)) throw new Error('XHS login close missing')
        close.click()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 50))'
      )
      assert.equal(xhsCancelRequests, 1)
      await window.webContents.executeJavaScript(
        `([...document.querySelectorAll('.view-switch button')].find((button) => button.textContent === 'EVIDENCE')).click()`
      )
      await window.webContents.executeJavaScript(`(() => {
        const selects = document.querySelectorAll('.query-form select')
        const source = selects.item(1)
        if (!(source instanceof HTMLSelectElement)) throw new Error('source selector missing')
        source.value = 'SRC_SEARCH'
        source.dispatchEvent(new Event('change', { bubbles: true }))
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 50))'
      )
      await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('input[name="query"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('search query input missing')
        input.value = '成都官方旅游公告'
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, '成都官方旅游公告')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.form?.requestSubmit()
      })()`)
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      const searchOutput = await window.webContents.executeJavaScript(`(() => ({
        text: document.querySelector('.search-output')?.textContent ?? '',
        sourceLinks: [...document.querySelectorAll('.search-source-list code')]
          .map((item) => item.textContent)
      }))()`)
      assert.match(searchOutput.text, /流式夹具答案。/)
      assert.match(searchOutput.text, /成都官方旅游公告/)
      assert.match(searchOutput.text, /总计 140/)
      assert.match(searchOutput.text, /open_page/)
      assert.match(searchOutput.text, /0 次 \/ 0 token/)
      assert.deepEqual(searchOutput.sourceLinks, ['https://example.gov.cn/chengdu'])
      await window.webContents.executeJavaScript(
        `([...document.querySelectorAll('.view-switch button')].find((button) => button.textContent === 'SETTINGS')).click()`
      )
      await window.webContents.executeJavaScript(
        'new Promise((resolve) => setTimeout(resolve, 100))'
      )
      const captureView = await window.webContents.executeJavaScript(
        "document.querySelector('.view-switch button.active')?.textContent"
      )
      assert.equal(captureView, 'SETTINGS')
      assert.deepEqual(rendererConsoleErrors, [])
      const artifactDir = path.join(process.cwd(), 'test', 'artifacts')
      fs.mkdirSync(artifactDir, { recursive: true })
      const screenshot = await window.webContents.capturePage()
      const captureSize = screenshot.getSize()
      // A software-composited or GPU-less capture can come back empty. Fail loudly
      // instead of writing a green artifact backed by a blank screenshot.
      assert.ok(
        captureSize.width > 0 && captureSize.height > 0,
        `capturePage returned an empty image in renderMode=${renderMode}`
      )
      const png = screenshot.toPNG()
      assert.ok(png.byteLength > 0, `capturePage produced no PNG bytes in renderMode=${renderMode}`)
      // Full-path runs keep the canonical artifact name; a fallback run writes a
      // mode-suffixed pair so it can never clobber stronger default-path evidence.
      const suffix = renderMode === 'default' ? '' : `.${renderMode}`
      fs.writeFileSync(path.join(artifactDir, `d3-ui-smoke${suffix}.png`), png)
      const result = {
        ok: true,
        renderMode,
        electronSandbox: true,
        capture: { width: captureSize.width, height: captureSize.height, bytes: png.byteLength },
        tabs,
        captureView,
        checkedViews: ['EVIDENCE', 'INSPECTOR', 'SETTINGS'],
        checkedSettings: {
          credentialInput: true,
          providerRouteSave: true,
          deepSeekSearchReplacement: true,
          serperSearchStreaming: true,
          searchTokenAudit: true,
          xhsLoginQrFlow: true,
          xhsLifecycleCancel: xhsCancelRequests === 1
        },
        rendererConsoleErrors: rendererConsoleErrors.length,
        externalCalls: 0
      }
      fs.writeFileSync(
        path.join(artifactDir, `d3-ui-smoke${suffix}.json`),
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
      )
      console.log(JSON.stringify({ ok: true, renderMode, tabs, externalCalls: 0 }))
    } finally {
      window.destroy()
      app.quit()
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
