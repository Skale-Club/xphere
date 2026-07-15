/**
 * Zod validation for the email template builder's `EmailDocument` jsonb.
 *
 * Server actions accept the document straight from the client (or from the
 * AI generator) and previously wrote it into Postgres with no shape checks
 * at all — any JSON blob would fit into the `document` jsonb column. This
 * schema mirrors the `EmailDocument` type in `render-template.ts` and adds
 * hard limits so a malformed or hostile payload (megabytes of `content`,
 * thousands of sections) can't be persisted.
 *
 * Unknown extra keys are passed through rather than rejected — the editor
 * and the AI generator both evolve independently of this schema, and a
 * strict shape here would turn "add an optional field" into a breaking
 * change. The limits below are what actually matter for integrity/DoS.
 */

import { z } from 'zod'
import type { EmailBlock, EmailDocument, EmailSection } from './render-template'

// ─── Limits ─────────────────────────────────────────────────────────────────

const MAX_SECTIONS = 50
const MAX_BLOCKS_PER_COLUMN = 100
const MAX_CONTENT_BYTES = 100 * 1024 // 100 KB per block content string
const MAX_DOC_BYTES = 1024 * 1024 // 1 MB for the whole document, PLAN.md's cap

// ─── Shared primitives ──────────────────────────────────────────────────────

const paddingSchema = z
  .object({
    top: z.number().optional(),
    right: z.number().optional(),
    bottom: z.number().optional(),
    left: z.number().optional(),
  })
  .partial()
  .passthrough()

const alignSchema = z.enum(['left', 'center', 'right'])
const contentSchema = z.string().max(MAX_CONTENT_BYTES, `Block content exceeds ${MAX_CONTENT_BYTES} byte limit`)

const baseBlockSchema = z
  .object({
    id: z.string().optional(),
    padding: paddingSchema.optional(),
  })
  .passthrough()

// ─── Per-block-type schemas ─────────────────────────────────────────────────

const textBlockSchema = baseBlockSchema.extend({
  blockType: z.literal('text'),
  content: contentSchema,
  fontSize: z.number().optional(),
  lineHeight: z.number().optional(),
  color: z.string().optional(),
  align: alignSchema.optional(),
})

const headingBlockSchema = baseBlockSchema.extend({
  blockType: z.literal('heading'),
  content: contentSchema,
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  fontSize: z.number().optional(),
  color: z.string().optional(),
  align: alignSchema.optional(),
})

const imageBlockSchema = baseBlockSchema.extend({
  blockType: z.literal('image'),
  src: z.string().max(MAX_CONTENT_BYTES),
  alt: z.string().optional(),
  width: z.union([z.number(), z.string()]).optional(),
  align: alignSchema.optional(),
  borderRadius: z.number().optional(),
  link: z.string().max(MAX_CONTENT_BYTES).optional(),
})

const buttonBlockSchema = baseBlockSchema.extend({
  blockType: z.literal('button'),
  label: z.string().max(MAX_CONTENT_BYTES),
  href: z.string().max(MAX_CONTENT_BYTES),
  backgroundColor: z.string().optional(),
  textColor: z.string().optional(),
  borderRadius: z.number().optional(),
  align: alignSchema.optional(),
  fullWidth: z.boolean().optional(),
  fontSize: z.number().optional(),
  paddingY: z.number().optional(),
  paddingX: z.number().optional(),
})

const dividerBlockSchema = baseBlockSchema.extend({
  blockType: z.literal('divider'),
  color: z.string().optional(),
  thickness: z.number().optional(),
  width: z.number().optional(),
  style: z.enum(['solid', 'dashed', 'dotted']).optional(),
  align: alignSchema.optional(),
})

const spacerBlockSchema = baseBlockSchema.extend({
  blockType: z.literal('spacer'),
  height: z.number().optional(),
})

const htmlBlockSchema = baseBlockSchema.extend({
  blockType: z.literal('html'),
  content: contentSchema,
})

const blockSchema = z.discriminatedUnion('blockType', [
  textBlockSchema,
  headingBlockSchema,
  imageBlockSchema,
  buttonBlockSchema,
  dividerBlockSchema,
  spacerBlockSchema,
  htmlBlockSchema,
])

// ─── Section + document schemas ─────────────────────────────────────────────

export const sectionSchema = z
  .object({
    id: z.string(),
    // Optional for legacy tolerance: sections saved before the layout field
    // existed have none, and the renderer defaults absent layout to 1. When
    // present it must be exactly 1, 2, or 3.
    layout: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    backgroundColor: z.string().optional(),
    backgroundImage: z.string().max(MAX_CONTENT_BYTES).optional(),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
    borderRadius: z.number().optional(),
    padding: paddingSchema.optional(),
    columnsGap: z.number().optional(),
    columns: z
      .array(z.array(blockSchema).max(MAX_BLOCKS_PER_COLUMN, `Column exceeds ${MAX_BLOCKS_PER_COLUMN} blocks`))
      .max(3, 'Section cannot have more than 3 columns'),
  })
  .passthrough()

export const emailDocumentSchema = z
  .object({
    backgroundColor: z.string().optional(),
    contentWidth: z.number().optional(),
    fontFamily: z.string().optional(),
    sections: z.array(sectionSchema).max(MAX_SECTIONS, `Document cannot have more than ${MAX_SECTIONS} sections`),
  })
  .passthrough()

// ─── Section-fragment schema (`{ blocks }`, used by section templates) ─────

const MAX_SECTION_FRAGMENT_BLOCKS = MAX_BLOCKS_PER_COLUMN * 3

export const sectionFragmentSchema = z
  .object({
    blocks: z
      .array(blockSchema)
      .max(MAX_SECTION_FRAGMENT_BLOCKS, `Section cannot have more than ${MAX_SECTION_FRAGMENT_BLOCKS} blocks`),
  })
  .passthrough()

// ─── Public API ──────────────────────────────────────────────────────────────

export type ValidateEmailDocumentResult =
  | { ok: true; doc: EmailDocument }
  | { ok: false; error: string }

function formatZodError(error: z.ZodError): string {
  const first = error.issues[0]
  if (!first) return 'Invalid document'
  const path = first.path.join('.')
  return path ? `${path}: ${first.message}` : first.message
}

/** Validates a raw value against the `EmailDocument` shape + hard limits.
 *  Does NOT sanitize HTML content — pair with `sanitizeEmailDocument` from
 *  `./sanitize` before rendering or persisting. */
export function validateEmailDocument(raw: unknown): ValidateEmailDocumentResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Document must be an object' }
  }

  const result = emailDocumentSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, error: formatZodError(result.error) }
  }

  const size = Buffer.byteLength(JSON.stringify(result.data), 'utf8')
  if (size > MAX_DOC_BYTES) {
    return { ok: false, error: `Document exceeds maximum size of ${MAX_DOC_BYTES} bytes (got ${size})` }
  }

  return { ok: true, doc: result.data as unknown as EmailDocument }
}

export type ValidateSectionFragmentResult =
  | { ok: true; doc: { blocks: EmailBlock[] } }
  | { ok: false; error: string }

/** Validates the flat `{ blocks: EmailBlock[] }` shape used by
 *  `email_section_templates.document` (a fragment, not a full document —
 *  section templates have no `sections` tree, just a bag of blocks that gets
 *  spliced into a column on insert). */
export function validateSectionFragment(raw: unknown): ValidateSectionFragmentResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Document must be an object' }
  }

  const result = sectionFragmentSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, error: formatZodError(result.error) }
  }

  return { ok: true, doc: result.data as unknown as { blocks: EmailBlock[] } }
}

// ─── Section-template doc schema (`{ section }`, the modern shape) ─────────
//
// Phase 3 (email-builder-hardening): section templates now store the FULL
// section (layout/background/padding/columns), not just a flat block bag.
// Pair with `normalizeSectionTemplateDoc` from `./render-template` — call
// that FIRST so legacy `{ blocks }` rows upgrade into this shape before
// validation, exactly like `normalizeDocument` + `validateEmailDocument`.

export const sectionTemplateDocSchema = z.object({ section: sectionSchema }).passthrough()

export type ValidateSectionTemplateDocResult =
  | { ok: true; doc: { section: EmailSection } }
  | { ok: false; error: string }

export function validateSectionTemplateDoc(raw: unknown): ValidateSectionTemplateDocResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Document must be an object' }
  }

  const result = sectionTemplateDocSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, error: formatZodError(result.error) }
  }

  return { ok: true, doc: result.data as unknown as { section: EmailSection } }
}
