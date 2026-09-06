import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { D6SnapshotSchema } from '../../src/shared/schema/d6'
import { D6View } from '../../src/renderer/src/D6View'

test('D6 timeline renders dates, route buffers, evidence state, backups, gate and versions without external calls', () => {
  let evidenceNavigations = 0
  const snapshot = D6SnapshotSchema.parse({
    sessionId: 'session-d6-ui',
    routeId: 'route-yunnan',
    stage: 'STAGE_5',
    currentVersion: 1,
    versions: [
      {
        version: 1,
        createdAt: '2026-08-29T10:00:00.000Z',
        summary: '上海两日分钟级时间轴',
        isCurrent: true,
        routeId: 'route-yunnan'
      }
    ],
    selectedVersion: {
      version: 1,
      createdAt: '2026-08-29T10:00:00.000Z',
      summary: '上海两日分钟级时间轴',
      isCurrent: true,
      routeId: 'route-yunnan',
      decision: {
        decisionId: 'decision-d6-ui',
        category: 'TIMELINE_PUBLISH',
        selected: 'version-1',
        reason: '全部发布门禁通过',
        alternatives: [],
        claimIds: ['claim-rail', 'claim-poi']
      },
      items: [
        {
          itemId: 'arrival',
          date: '2026-09-01',
          startTime: '10:00',
          endTime: '10:30',
          crossesMidnight: false,
          title: '抵达上海站',
          itemClass: 'FIXED',
          anchorClass: 'HARD_LOCKED',
          location: {
            name: '上海站',
            kind: 'STATION',
            address: '静安区',
            coordinates: null
          },
          arrivalTransport: {
            mode: 'RAIL',
            from: '南京南站',
            to: '上海站',
            etaMinutes: 18,
            claimIds: ['claim-rail']
          },
          bufferMinutes: 30,
          costCents: 18000,
          claimIds: ['claim-rail'],
          verificationSummary: {
            status: 'VERIFIED',
            claimCount: 1,
            allClaimsUsable: true
          },
          routeContext: {
            routeId: 'route-yunnan',
            dayType: 'INTERCITY_TRANSFER_DAY',
            role: 'INTERCITY_LEG',
            nodeId: 'node-shanghai',
            segmentId: null,
            routeLegId: 'leg-nanjing-shanghai',
            fromNodeId: null,
            toNodeId: 'node-shanghai'
          }
        },
        {
          itemId: 'backup-1',
          date: '2026-09-01',
          startTime: '18:00',
          endTime: '18:00',
          crossesMidnight: false,
          title: '雨天室内备用展览',
          itemClass: 'BACKUP',
          anchorClass: 'FLEXIBLE',
          location: {
            name: '上海博物馆',
            kind: 'POI',
            address: null,
            coordinates: null
          },
          arrivalTransport: null,
          bufferMinutes: 0,
          costCents: null,
          claimIds: ['claim-poi'],
          verificationSummary: {
            status: 'CORROBORATED',
            claimCount: 1,
            allClaimsUsable: true
          }
        },
        {
          itemId: 'departure',
          date: '2026-09-02',
          startTime: '15:00',
          endTime: '15:30',
          crossesMidnight: false,
          title: '前往返程车站',
          itemClass: 'FIXED',
          anchorClass: 'HARD_LOCKED',
          location: {
            name: '上海虹桥站',
            kind: 'STATION',
            address: null,
            coordinates: null
          },
          arrivalTransport: {
            mode: 'TRANSIT',
            from: '住宿',
            to: '上海虹桥站',
            etaMinutes: 45,
            claimIds: ['claim-rail']
          },
          bufferMinutes: 30,
          costCents: null,
          claimIds: ['claim-rail'],
          verificationSummary: {
            status: 'VERIFIED',
            claimCount: 1,
            allClaimsUsable: true
          }
        },
        {
          itemId: 'backup-2',
          date: '2026-09-02',
          startTime: '11:00',
          endTime: '11:00',
          crossesMidnight: false,
          title: '附近咖啡馆备用',
          itemClass: 'BACKUP',
          anchorClass: 'FLEXIBLE',
          location: {
            name: '候车咖啡馆',
            kind: 'RESTAURANT',
            address: null,
            coordinates: null
          },
          arrivalTransport: null,
          bufferMinutes: 0,
          costCents: null,
          claimIds: ['claim-poi'],
          verificationSummary: {
            status: 'CORROBORATED',
            claimCount: 1,
            allClaimsUsable: true
          }
        }
      ]
    },
    draft: null,
    publishability: { publishable: true, blockingItems: [] },
    sourceOutcomes: [
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
  })

  const markup = renderToStaticMarkup(
    createElement(D6View, {
      initialSessions: [
        {
          sessionId: snapshot.sessionId,
          title: '上海两日行程',
          stage: 'STAGE_5',
          linkedSessionGroup: null,
          splitIndex: null
        }
      ],
      initialSnapshot: snapshot,
      onShowEvidence: () => {
        evidenceNavigations += 1
      }
    })
  )

  assert.match(markup, /2026-09-01/)
  assert.match(markup, /2026-09-02/)
  assert.match(markup, /ETA 18 分钟/)
  assert.match(markup, /缓冲 30 分钟/)
  assert.match(markup, /展开当日备用项（1）/)
  assert.match(markup, /发布门禁通过/)
  assert.match(markup, /v1 · current/)
  assert.match(markup, /定位证据/)
  assert.match(markup, /外部调用 0 次/)
  assert.match(markup, /整程路线：route-yunnan/)
  assert.match(markup, /跨城路段/)
  assert.match(markup, /leg-nanjing-shanghai/)
  assert.doesNotMatch(markup, /sourceRef|toolName|credential|rawContent/)
  assert.equal(evidenceNavigations, 0)
})

test('unified D6/D7 CSS keeps 820px and 320px route scopes readable', () => {
  const css = readFileSync(
    join(process.cwd(), 'src', 'renderer', 'src', 'assets', 'main.css'),
    'utf8'
  )
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*?\.timeline-row/)
  assert.match(css, /@media \(max-width: 320px\)[\s\S]*?grid-template-columns: 1fr/)
  assert.match(css, /\.route-scope-line[\s\S]*?overflow-wrap: anywhere/)
})
