import { z } from 'zod'

/**
 * Zod schemas for the sales pipeline (SEED-008 / v2.1).
 *
 * Source of truth for input validation in server actions + client forms. Keep
 * narrow: server actions normalise/coerce after parsing.
 */

const HEX_COLOR = /^#([0-9A-Fa-f]{3}){1,2}$/

export const pipelineSchema = z.object({
  name: z.string().min(1, 'Name is required').max(80, 'Max 80 characters'),
  is_default: z.boolean().optional(),
})
export type PipelineFormInput = z.infer<typeof pipelineSchema>

export const stageSchema = z.object({
  name: z.string().min(1, 'Stage name is required').max(60),
  color: z
    .string()
    .regex(HEX_COLOR, 'Use a hex colour like #6366F1')
    .default('#6366F1'),
  is_won: z.boolean().optional().default(false),
  is_lost: z.boolean().optional().default(false),
})
export type StageFormInput = z.infer<typeof stageSchema>

export const opportunitySchema = z.object({
  title: z.string().min(1, 'Title is required').max(160),
  value: z
    .union([z.number(), z.string()])
    .transform((v) => {
      if (typeof v !== 'string') return v
      // Strip currency symbols and spaces. Heuristic for pt-BR strings like
      // "R$ 1.500,00": when both `.` and `,` are present, the `.` is the
      // thousands separator and `,` is the decimal — drop dots, swap comma.
      let s = v.replace(/[^0-9.,-]/g, '')
      const hasDot = s.includes('.')
      const hasComma = s.includes(',')
      if (hasDot && hasComma) {
        s = s.replace(/\./g, '').replace(',', '.')
      } else if (hasComma) {
        s = s.replace(',', '.')
      }
      return Number(s)
    })
    .pipe(z.number().min(0, 'Value must be ≥ 0').max(1_000_000_000)),
  currency: z.string().length(3).default('BRL'),
  pipeline_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  contact_id: z.string().uuid().optional().nullable(),
  expected_close_date: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  status: z.enum(['open', 'won', 'lost']).optional().default('open'),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
})
export type OpportunityFormInput = z.infer<typeof opportunitySchema>

export const noteSchema = z.object({
  content: z.string().min(1, 'Note cannot be empty').max(4000),
})
export type NoteFormInput = z.infer<typeof noteSchema>

export const opportunityFilterSchema = z.object({
  pipeline_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  status: z.enum(['open', 'won', 'lost']).optional(),
  q: z.string().optional(),
  min_value: z.number().optional(),
  max_value: z.number().optional(),
})
export type OpportunityFilters = z.infer<typeof opportunityFilterSchema>
