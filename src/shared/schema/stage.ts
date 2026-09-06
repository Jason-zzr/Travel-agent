import { z } from 'zod'

export const TravelStageSchema = z.enum([
  'STAGE_1',
  'STAGE_2',
  'STAGE_3',
  'STAGE_4',
  'STAGE_5',
  'DONE'
])
export type TravelStage = z.infer<typeof TravelStageSchema>
