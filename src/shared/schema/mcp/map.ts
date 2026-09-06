import { z } from 'zod'
import { McpTextToolResultSchema } from './common'

export const MapToolResultSchema = McpTextToolResultSchema
export type MapToolResult = z.infer<typeof MapToolResultSchema>

const MapLocationSchema = z
  .string()
  .trim()
  .regex(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/)

const MapGeocodeResultSchema = z
  .object({
    location: MapLocationSchema
  })
  .passthrough()

// Verified by the 2026-08-24 hosted structure-only diagnostic: results[]/location.
export const MapGeocodeRawSchema = z
  .object({
    results: z.array(MapGeocodeResultSchema).nonempty()
  })
  .passthrough()
export type MapGeocodeRaw = z.infer<typeof MapGeocodeRawSchema>

export const MapGeocodeNormalizedSchema = z.object({
  name: z.string().min(1),
  city: z.string().min(1),
  address: z.string().min(1),
  lng: z.number().finite(),
  lat: z.number().finite()
})
export type MapGeocodeNormalized = z.infer<typeof MapGeocodeNormalizedSchema>

export const TransientMapGeocodeRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    address: z.string().trim().min(1).max(300),
    city: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(200)
  })
  .strict()
export type TransientMapGeocodeRequest = z.infer<typeof TransientMapGeocodeRequestSchema>

export function normalizeMapGeocode(
  raw: unknown,
  input: { address: string; city: string }
): MapGeocodeNormalized {
  const parsed = MapGeocodeRawSchema.parse(raw)
  const [lng, lat] = parsed.results[0].location.split(',').map(Number)
  return MapGeocodeNormalizedSchema.parse({
    name: input.address,
    city: input.city,
    address: input.address,
    lng,
    lat
  })
}

const MapDistanceScalarSchema = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])

const MapDistanceResultSchema = z
  .object({
    origin_id: z.string().min(1),
    dest_id: z.string().min(1),
    distance: MapDistanceScalarSchema,
    duration: MapDistanceScalarSchema
  })
  .passthrough()

// Hosted AMap MCP shape verified on 2026-08-29. Official AMap distance docs define
// distance in metres and duration in seconds.
export const MapDistanceRawSchema = z
  .object({
    results: z.array(MapDistanceResultSchema).nonempty()
  })
  .passthrough()
export type MapDistanceRaw = z.infer<typeof MapDistanceRawSchema>

export const MapGroundTransferSourceRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    candidateId: z.string().trim().min(1).max(200),
    direction: z.enum(['OUTBOUND', 'RETURN']),
    kind: z.enum(['FIRST_MILE', 'LAST_MILE']),
    from: z.string().trim().min(1).max(200),
    to: z.string().trim().min(1).max(200),
    origin: MapLocationSchema,
    destination: MapLocationSchema,
    travelMode: z.enum(['DRIVING', 'WALKING']).default('DRIVING'),
    startAt: z.string().datetime({ offset: true }).nullable().default(null)
  })
  .strict()
export type MapGroundTransferSourceRequest = z.infer<typeof MapGroundTransferSourceRequestSchema>

export const TimedMapGroundTransferSourceRequestSchema = MapGroundTransferSourceRequestSchema.omit({
  startAt: true
})
  .extend({
    timingBasis: z.enum(['ARRIVE_BY_RAIL', 'DEPART_AFTER_RAIL']),
    railAnchorAt: z.string().datetime({ offset: true }).nullable()
  })
  .strict()
export type TimedMapGroundTransferSourceRequest = z.infer<
  typeof TimedMapGroundTransferSourceRequestSchema
>

export const MapGroundTransferClaimValueSchema = z
  .object({
    candidateId: z.string().min(1),
    direction: z.enum(['OUTBOUND', 'RETURN']),
    kind: z.enum(['FIRST_MILE', 'LAST_MILE']),
    label: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    travelMode: z.enum(['DRIVING', 'WALKING']),
    startAt: z.string().datetime({ offset: true }).nullable(),
    endAt: z.string().datetime({ offset: true }).nullable(),
    distanceMeters: z.number().int().nonnegative(),
    durationSeconds: z.number().int().nonnegative(),
    durationMinutes: z.number().int().nonnegative(),
    costCents: z.null()
  })
  .strict()
export type MapGroundTransferClaimValue = z.infer<typeof MapGroundTransferClaimValueSchema>

export function normalizeMapGroundTransfer(
  raw: unknown,
  input: MapGroundTransferSourceRequest
): MapGroundTransferClaimValue {
  const parsed = MapDistanceRawSchema.parse(raw)
  const first = parsed.results[0]
  const distanceMeters = Number(first.distance)
  const durationSeconds = Number(first.duration)
  const endAt = input.startAt
    ? new Date(new Date(input.startAt).getTime() + durationSeconds * 1000).toISOString()
    : null
  return MapGroundTransferClaimValueSchema.parse({
    candidateId: input.candidateId,
    direction: input.direction,
    kind: input.kind,
    label: `${input.from}→${input.to} ${input.travelMode === 'DRIVING' ? '驾车接驳' : '步行接驳'}`,
    from: input.from,
    to: input.to,
    travelMode: input.travelMode,
    startAt: input.startAt,
    endAt,
    distanceMeters,
    durationSeconds,
    durationMinutes: Math.ceil(durationSeconds / 60),
    costCents: null
  })
}
