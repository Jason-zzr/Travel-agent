import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FLYAI_FLIGHT_LOCAL_RESULT_CONTRACT_VERSION,
  FlyaiFlightSearchRawSchema,
  normalizeFlyaiFlightSearchStructure,
  parseFlyaiFlightSearchInput,
  toFlyaiFlightCliArgs
} from './flyai-flight'

test('FlyAI flight input accepts one exact future Chinese-city query', () => {
  const input = parseFlyaiFlightSearchInput(
    {
      origin: '西双版纳',
      destination: '广州',
      depDate: '2026-09-17'
    },
    '2026-09-02'
  )

  assert.deepEqual(input, {
    origin: '西双版纳',
    destination: '广州',
    depDate: '2026-09-17'
  })
  assert.deepEqual(toFlyaiFlightCliArgs(input), [
    'search-flight',
    '--origin',
    '西双版纳',
    '--destination',
    '广州',
    '--dep-date',
    '2026-09-17'
  ])
})

test('FlyAI flight input rejects normalization, extra fields, and non-future dates', () => {
  const invalidInputs: unknown[] = [
    { origin: 'Xishuangbanna', destination: '广州', depDate: '2026-09-17' },
    { origin: ' 西双版纳', destination: '广州', depDate: '2026-09-17' },
    { origin: '西双版纳', destination: '广州 ', depDate: '2026-09-17' },
    { origin: '西双版纳', destination: '广州', depDate: '2026-02-30' },
    { origin: '西双版纳', destination: '广州', depDate: '2026-09-02' },
    { origin: '西双版纳', destination: '广州', depDate: '2026-09-01' },
    { origin: '西双版纳', depDate: '2026-09-17' },
    { origin: '西双版纳', destination: '广州', depDate: '2026-09-17', cabin: 'ECONOMY' }
  ]

  for (const input of invalidInputs) {
    assert.throws(() => parseFlyaiFlightSearchInput(input, '2026-09-02'))
  }
})

const syntheticFlyaiResult = {
  data: {
    itemList: [
      {
        journeys: [
          {
            journeyType: 'SYNTHETIC_DIRECT',
            segments: [
              {
                arrCityAbroad: false,
                arrCityCode: 'ARR',
                arrCityName: '乙城',
                arrDateTime: 'opaque-arrival',
                arrStationCode: 'ARR-STATION',
                arrStationName: '乙站',
                arrTerminal: '乙航站',
                arrWeek: '乙周',
                depCityAbroad: null,
                depCityCode: 'DEP',
                depCityName: '甲城',
                depDateTime: 'opaque-departure',
                depStationCode: 'DEP-STATION',
                depStationName: '甲站',
                depTerminal: '甲航站',
                depWeek: '甲周',
                duration: 'opaque-duration',
                marketingTransportName: '合成承运方',
                marketingTransportNo: 'SYNTHETIC-001',
                miles: null,
                quantity: null,
                seatClassName: '合成舱等',
                stopInfos: null,
                transportType: 'SYNTHETIC_TRANSPORT'
              }
            ],
            totalDuration: 'opaque-total-duration',
            transferDuration: 'opaque-transfer-duration'
          }
        ],
        jumpUrl: 'https://invalid.example/synthetic-only',
        tags: null,
        ticketPrice: 'opaque-ticket-price',
        totalDuration: 'opaque-item-duration'
      },
      {
        journeys: [
          {
            segments: [{ transportType: 'SYNTHETIC_FIRST' }, { transportType: 'SYNTHETIC_SECOND' }]
          }
        ]
      }
    ]
  },
  message: 'synthetic-message',
  status: 0,
  systemMessage: null
}

test('FlyAI LOCAL result contract accepts only the observed structure and primitive types', () => {
  const raw = FlyaiFlightSearchRawSchema.parse(syntheticFlyaiResult)

  assert.equal(raw.data.itemList.length, 2)
  assert.equal(raw.data.itemList[0]?.journeys?.[0]?.segments?.length, 1)
  assert.equal(raw.data.itemList[1]?.journeys?.[0]?.segments?.length, 2)
})

test('FlyAI LOCAL normalization preserves raw fields without inferring business semantics', () => {
  const normalized = normalizeFlyaiFlightSearchStructure(syntheticFlyaiResult)

  assert.equal(normalized.contractVersion, FLYAI_FLIGHT_LOCAL_RESULT_CONTRACT_VERSION)
  assert.equal(normalized.mappingStatus, 'LOCAL_STRUCTURE_ONLY')
  assert.equal(normalized.items[0]?.ticketPriceRaw, 'opaque-ticket-price')
  assert.equal(
    normalized.items[0]?.journeys?.[0]?.segments?.[0]?.marketingTransportNumberRaw,
    'SYNTHETIC-001'
  )
  assert.equal(normalized.items[0]?.costCents, null)
  assert.equal(normalized.items[0]?.currency, null)
  assert.equal(normalized.items[0]?.durationMinutes, null)
  assert.equal(normalized.items[0]?.journeys?.[0]?.transferCount, null)
  assert.equal(normalized.items[0]?.journeys?.[0]?.segments?.[0]?.startAt, null)
  assert.equal(normalized.items[0]?.journeys?.[0]?.segments?.[0]?.endAt, null)
})

test('FlyAI LOCAL result contract rejects unknown keys, empty members, and type drift', () => {
  const invalidResults: unknown[] = [
    { ...syntheticFlyaiResult, unexpected: true },
    {
      ...syntheticFlyaiResult,
      data: { ...syntheticFlyaiResult.data, unexpected: true }
    },
    {
      ...syntheticFlyaiResult,
      data: { itemList: [{ unexpected: true }] }
    },
    {
      ...syntheticFlyaiResult,
      data: { itemList: [{ journeys: [{}] }] }
    },
    {
      ...syntheticFlyaiResult,
      data: { itemList: [{ journeys: [{ segments: [{}] }] }] }
    },
    {
      ...syntheticFlyaiResult,
      data: { itemList: [{ journeys: [{ segments: [{ arrCityAbroad: 'false' }] }] }] }
    },
    { ...syntheticFlyaiResult, systemMessage: 'not-observed' },
    {
      ...syntheticFlyaiResult,
      data: { itemList: [{ tags: [] }] }
    }
  ]

  for (const result of invalidResults) {
    assert.throws(() => FlyaiFlightSearchRawSchema.parse(result))
  }
})
