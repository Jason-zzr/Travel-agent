import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RouteD5View } from '../../src/renderer/src/RouteD5View'
import type { MultiSegmentD5Snapshot } from '../../src/shared/schema/route-d5'

const SESSION_ID = 'route-d5-render'
const ROUTE_ID = 'route-yunnan-render'

const snapshot = {
  sessionId: SESSION_ID,
  stage: 'STAGE_4',
  selectedRouteId: ROUTE_ID,
  selectedRoute: {
    routeId: ROUTE_ID,
    profile: 'BALANCED',
    nodes: [
      { routeId: ROUTE_ID, nodeId: 'node-dali', city: '大理' },
      { routeId: ROUTE_ID, nodeId: 'node-lijiang', city: '丽江' },
      { routeId: ROUTE_ID, nodeId: 'node-banna', city: '西双版纳' }
    ]
  },
  legStates: [
    {
      scope: { kind: 'LEG', sessionId: SESSION_ID, routeId: ROUTE_ID, legId: 'leg-gz-dali' },
      sequence: 1,
      routeLeg: {
        routeId: ROUTE_ID,
        legId: 'leg-gz-dali',
        from: { kind: 'ORIGIN', city: '广州' },
        to: { kind: 'NODE', nodeId: 'node-dali' },
        fromCity: '广州',
        toCity: '大理',
        travelDate: '2026-09-08',
        mode: 'RAIL',
        label: '广州到大理'
      },
      status: 'OPTIONS_READY',
      railOptions: [
        {
          direction: 'OUTBOUND',
          trainNo: 'D1234',
          serviceDate: '2026-09-08',
          fromStation: '广州',
          toStation: '大理',
          departureTime: '08:00',
          arrivalTime: '14:00',
          startAt: '2026-09-08T08:00:00+08:00',
          endAt: '2026-09-08T14:00:00+08:00',
          title: '广州到大理 D1234'
        }
      ],
      selectedRailOption: null,
      plan: null
    },
    {
      scope: {
        kind: 'LEG',
        sessionId: SESSION_ID,
        routeId: ROUTE_ID,
        legId: 'leg-lijiang-banna'
      },
      sequence: 2,
      routeLeg: {
        routeId: ROUTE_ID,
        legId: 'leg-lijiang-banna',
        from: { kind: 'NODE', nodeId: 'node-lijiang' },
        to: { kind: 'NODE', nodeId: 'node-banna' },
        fromCity: '丽江',
        toCity: '西双版纳',
        travelDate: '2026-09-14',
        mode: 'MANUAL_FLIGHT',
        label: '丽江到西双版纳'
      },
      status: 'BLOCKED',
      railOptions: [],
      selectedRailOption: null,
      plan: null
    }
  ],
  stayStates: ['大理', '丽江', '西双版纳'].map((city, index) => ({
    scope: {
      kind: 'STAY',
      sessionId: SESSION_ID,
      routeId: ROUTE_ID,
      nodeId: `node-${index}`,
      segmentId: `stay-${index}`
    },
    sequence: index + 1,
    segment: {
      city,
      nights: 3,
      checkInDate: `2026-09-${String(8 + index * 3).padStart(2, '0')}`,
      checkOutDate: `2026-09-${String(11 + index * 3).padStart(2, '0')}`
    },
    status: 'NOT_STARTED',
    candidates: [],
    selectedCandidateId: null
  })),
  days: [
    {
      sessionId: SESSION_ID,
      routeId: ROUTE_ID,
      date: '2026-09-09',
      dayType: 'NORMAL_DAY',
      owningNodeId: 'node-dali',
      segmentId: 'stay-0',
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
  blockingReasons: ['路段 丽江到西双版纳 尚未完成：BLOCKED'],
  confirmed: false
} as unknown as MultiSegmentD5Snapshot

test('route-D5 SSR renders ordered rail/manual/stay workflow without side effects', () => {
  let calls = 0
  const html = renderToStaticMarkup(
    createElement(RouteD5View, {
      sessions: [
        {
          sessionId: SESSION_ID,
          title: '广州到云南 10 天',
          stage: 'STAGE_4',
          linkedSessionGroup: null,
          splitIndex: null
        }
      ],
      sessionId: SESSION_ID,
      initialSnapshot: snapshot,
      onSessionChange: () => {
        calls += 1
      }
    })
  )
  assert.match(html, /按路线顺序完成每个路段/)
  assert.match(html, /广州.*大理/)
  assert.match(html, /丽江.*西双版纳/)
  assert.match(html, /不自动查询航班\/大巴/)
  assert.match(html, /每个城市住宿独立查询与选择/)
  assert.match(html, /仅更新当天/)
  assert.match(html, /大理 · 3 晚/)
  assert.match(html, /丽江 · 3 晚/)
  assert.match(html, /西双版纳 · 3 晚/)
  assert.equal(calls, 0)
})

test('route-D5 CSS keeps 820px and 320px layouts vertical without a desktop min-width', () => {
  const css = readFileSync(
    join(process.cwd(), 'src', 'renderer', 'src', 'assets', 'main.css'),
    'utf8'
  )
  assert.match(css, /body\s*\{[\s\S]*?min-width:\s*0/)
  assert.match(css, /@media \(max-width: 820px\)/)
  assert.match(css, /@media \(max-width: 420px\)/)
  assert.match(css, /\.route-d5-paste-form,[\s\S]*?grid-template-columns:\s*1fr/)
})
