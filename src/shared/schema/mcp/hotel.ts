import { z } from 'zod'
import { McpTextToolResultSchema } from './common'

export const HotelToolResultSchema = McpTextToolResultSchema
export type HotelToolResult = z.infer<typeof HotelToolResultSchema>
export const HotelSearchNormalizedSchema = z.object({
  message: z.string().min(1),
  hotelInformationList: z.array(
    z.object({
      hotelId: z.union([z.string(), z.number()]),
      name: z.string().min(1),
      address: z.string().nullable().optional(),
      starRating: z.number().nullable().optional(),
      price: z
        .object({
          hasPrice: z.boolean(),
          currency: z.string().nullable().optional(),
          lowestPrice: z.number().nonnegative().nullable().optional()
        })
        .nullable()
        .optional()
    })
  )
})
export type HotelSearchNormalized = z.infer<typeof HotelSearchNormalizedSchema>

export const HotelLodgingSourceRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    place: z.string().trim().min(1).max(120),
    checkInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    stayNights: z.number().int().min(1).max(28),
    adultCount: z.number().int().min(1).max(6),
    size: z.number().int().min(1).max(20).default(5)
  })
  .strict()
export type HotelLodgingSourceRequest = z.infer<typeof HotelLodgingSourceRequestSchema>

export const HotelLodgingClaimValueSchema = z
  .object({
    name: z.string().min(1),
    hotelId: z.union([z.string(), z.number()]),
    address: z.string().nullable(),
    starRating: z.number().nullable(),
    totalCostCents: z.null(),
    totalCostComplete: z.literal(false),
    roomType: z.null(),
    bedType: z.null(),
    capacity: z.null(),
    roomFitsParty: z.null(),
    cancellationStatus: z.literal('UNKNOWN'),
    freeCancelUntil: z.null(),
    positionAdvantage: z.null(),
    observedLowestPrice: z
      .object({
        amount: z.number().nonnegative(),
        currency: z.string().nullable()
      })
      .nullable()
  })
  .strict()
export type HotelLodgingClaimValue = z.infer<typeof HotelLodgingClaimValueSchema>

export function normalizeHotelLodgingCandidate(
  hotel: HotelSearchNormalized['hotelInformationList'][number]
): HotelLodgingClaimValue {
  const observedLowestPrice =
    hotel.price?.hasPrice && typeof hotel.price.lowestPrice === 'number'
      ? {
          amount: hotel.price.lowestPrice,
          currency: hotel.price.currency?.trim() || null
        }
      : null
  return HotelLodgingClaimValueSchema.parse({
    name: hotel.name,
    hotelId: hotel.hotelId,
    address: hotel.address ?? null,
    starRating: hotel.starRating ?? null,
    totalCostCents: null,
    totalCostComplete: false,
    roomType: null,
    bedType: null,
    capacity: null,
    roomFitsParty: null,
    cancellationStatus: 'UNKNOWN',
    freeCancelUntil: null,
    positionAdvantage: null,
    observedLowestPrice
  })
}
