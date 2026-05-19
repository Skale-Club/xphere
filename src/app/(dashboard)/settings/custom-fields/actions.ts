'use server'

/**
 * Server actions for Custom Field Definition management.
 * Phase 70-01 — CUSTOMFIELDS-SETTINGS-UI
 *
 * Addresses: CF-01 (list), CF-04 (create/update/archive), CF-05 (reorder).
 *
 * Patterns mirror src/app/(dashboard)/accounts/actions.ts:
 *   - Cached getUser() + createClient() from @/lib/supabase/server (CLAUDE.md)
 *   - RLS-scoped client — never filter by org_id manually on SELECT/UPDATE/DELETE
 *   - get_current_org_id() RPC for the org_id NOT NULL column on INSERT
 *
 * Action return shape:
 *   ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; details?: unknown }
 *
 * Archive behavior (CF-04 LOCKED):
 *   archiveDefinition sets archived=true (soft delete). The row and all stored
 *   values in entity custom_fields jsonb are preserved — no data loss.
 *
 * Type-change guard (D-07 spirit from SEED-017):
 *   updateDefinitionSchema intentionally omits the `type` field. Type changes
 *   are blocked at the server-action layer to prevent silent data corruption.
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { z } from 'zod'
import { isReservedKey } from '@/lib/custom-fields'
import { CUSTOM_FIELD_TYPES, CUSTOM_FIELD_ENTITIES } from '@/lib/custom-fields/field-config'
import type { Database } from '@/types/database'

// ─── Helpers ─────────────────────────────────────────────────────────────────

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown }

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}

function err(msg: string, details?: unknown): ActionResult<never> {
  return { ok: false, error: msg, details }
}

const REVALIDATE_PATH = '/settings/custom-fields'

// ─── Shared sub-schemas (internal) ────────────────────────────────────────────

const selectOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
})

const validationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  max_length: z.number().int().positive().optional(),
  pattern: z.string().optional(),
  currency_code: z.string().length(3).optional(),
})

// ─── Zod schemas (internal — not exported; 'use server' only allows async fn exports) ─

const getDefinitionsSchema = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES),
  includeArchived: z.boolean().optional(),
})

const createDefinitionSchema = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES),
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'Key must start with a letter and contain only a-z, 0-9, _'),
  label: z.string().min(1).max(100),
  type: z.enum(CUSTOM_FIELD_TYPES),
  required: z.boolean().default(false),
  unique_per_org: z.boolean().default(false),
  visible_in_list: z.boolean().default(false),
  filterable: z.boolean().default(false),
  position: z.number().int().nonnegative().optional(),
  group_name: z.string().nullable().optional(),
  help_text: z.string().nullable().optional(),
  default_value: z.unknown().nullable().optional(),
  options: z.array(selectOptionSchema).nullable().optional(),
  validation: validationSchema.nullable().optional(),
})

const updateDefinitionSchema = z.object({
  id: z.string().uuid(),
  // type is intentionally excluded — type changes blocked after creation (D-07)
  label: z.string().min(1).max(100).optional(),
  required: z.boolean().optional(),
  unique_per_org: z.boolean().optional(),
  visible_in_list: z.boolean().optional(),
  filterable: z.boolean().optional(),
  position: z.number().int().nonnegative().optional(),
  group_name: z.string().nullable().optional(),
  help_text: z.string().nullable().optional(),
  default_value: z.unknown().nullable().optional(),
  options: z.array(selectOptionSchema).nullable().optional(),
  validation: validationSchema.nullable().optional(),
})

const archiveDefinitionSchema = z.object({
  id: z.string().uuid(),
})

const reorderDefinitionsSchema = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES),
  orderedIds: z.array(z.string().uuid()),
})

// ─── Exported TS types (type exports are safe in 'use server' files) ──────────

export type GetDefinitionsInput = z.infer<typeof getDefinitionsSchema>
export type CreateDefinitionInput = z.infer<typeof createDefinitionSchema>
export type UpdateDefinitionInput = z.infer<typeof updateDefinitionSchema>
export type ArchiveDefinitionInput = z.infer<typeof archiveDefinitionSchema>
export type ReorderDefinitionsInput = z.infer<typeof reorderDefinitionsSchema>

/** Alias for the database Row type — use this in UI components. */
export type CustomFieldDefinitionRow =
  Database['public']['Tables']['custom_field_definitions']['Row']

// ─── getDefinitions ──────────────────────────────────────────────────────────

/**
 * Returns all custom field definitions for the given entity.
 * Active org is resolved by RLS — no manual org_id filter needed.
 * By default returns only non-archived definitions, ordered by position ASC.
 */
export async function getDefinitions(
  input: GetDefinitionsInput,
): Promise<ActionResult<CustomFieldDefinitionRow[]>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const parsed = getDefinitionsSchema.safeParse(input)
  if (!parsed.success) return err('invalid_input', parsed.error.issues)

  const { entity, includeArchived } = parsed.data

  const supabase = await createClient()
  let query = supabase
    .from('custom_field_definitions')
    .select('*')
    .eq('entity', entity)
    .order('position', { ascending: true })

  if (!includeArchived) {
    query = query.eq('archived', false)
  }

  const { data, error: dbErr } = await query
  if (dbErr) return err(dbErr.message, dbErr)

  return ok((data ?? []) as CustomFieldDefinitionRow[])
}

// ─── createDefinition ─────────────────────────────────────────────────────────

/**
 * Creates a new custom field definition.
 * Guards: reserved key check, schema validation.
 * Position is auto-set to max+1 for the entity unless explicitly provided.
 */
export async function createDefinition(
  input: CreateDefinitionInput,
): Promise<ActionResult<CustomFieldDefinitionRow>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const parsed = createDefinitionSchema.safeParse(input)
  if (!parsed.success) return err('invalid_input', parsed.error.issues)

  const data = parsed.data

  // CF-11 reserved key guard
  if (isReservedKey(data.entity, data.key)) {
    return err('reserved_key')
  }

  const supabase = await createClient()

  // org_id is required for INSERT — RLS alone does not fill it
  const { data: orgId, error: orgErr } = await supabase.rpc('get_current_org_id')
  if (orgErr || !orgId) return err('no_organization', orgErr)

  // Auto-compute position = max(position) + 1 for this entity (non-archived rows only)
  let position = data.position
  if (position === undefined) {
    const { data: maxRow, error: maxErr } = await supabase
      .from('custom_field_definitions')
      .select('position')
      .eq('entity', data.entity)
      .eq('archived', false)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (maxErr) return err(maxErr.message, maxErr)
    position = (maxRow?.position ?? 0) + 1
  }

  const { data: inserted, error: insErr } = await supabase
    .from('custom_field_definitions')
    .insert({
      org_id: orgId,
      entity: data.entity,
      key: data.key,
      label: data.label,
      type: data.type,
      required: data.required,
      unique_per_org: data.unique_per_org,
      visible_in_list: data.visible_in_list,
      filterable: data.filterable,
      position,
      group_name: data.group_name ?? null,
      help_text: data.help_text ?? null,
      default_value: data.default_value ?? null,
      options: data.options ?? null,
      validation: data.validation ?? null,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (insErr) return err(insErr.message, insErr)
  if (!inserted) return err('insert_returned_no_row')

  revalidatePath(REVALIDATE_PATH)
  return ok(inserted as CustomFieldDefinitionRow)
}

// ─── updateDefinition ─────────────────────────────────────────────────────────

/**
 * Partially updates an existing custom field definition.
 * The `type` field is intentionally excluded from updates (D-07).
 * RLS scopes the UPDATE to the active org — no manual org_id filter needed.
 */
export async function updateDefinition(
  input: UpdateDefinitionInput,
): Promise<ActionResult<CustomFieldDefinitionRow>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const parsed = updateDefinitionSchema.safeParse(input)
  if (!parsed.success) return err('invalid_input', parsed.error.issues)

  const { id, ...fields } = parsed.data

  // Build update payload from only the fields that were explicitly passed
  const updatePayload: Record<string, unknown> = {}
  if (fields.label !== undefined) updatePayload.label = fields.label
  if (fields.required !== undefined) updatePayload.required = fields.required
  if (fields.unique_per_org !== undefined) updatePayload.unique_per_org = fields.unique_per_org
  if (fields.visible_in_list !== undefined) updatePayload.visible_in_list = fields.visible_in_list
  if (fields.filterable !== undefined) updatePayload.filterable = fields.filterable
  if (fields.position !== undefined) updatePayload.position = fields.position
  if ('group_name' in fields) updatePayload.group_name = fields.group_name ?? null
  if ('help_text' in fields) updatePayload.help_text = fields.help_text ?? null
  if ('default_value' in fields) updatePayload.default_value = fields.default_value ?? null
  if ('options' in fields) updatePayload.options = fields.options ?? null
  if ('validation' in fields) updatePayload.validation = fields.validation ?? null

  const supabase = await createClient()

  const { data: updated, error: upErr } = await supabase
    .from('custom_field_definitions')
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single()

  if (upErr) return err(upErr.message, upErr)
  if (!updated) return err('not_found')

  revalidatePath(REVALIDATE_PATH)
  return ok(updated as CustomFieldDefinitionRow)
}

// ─── archiveDefinition ────────────────────────────────────────────────────────

/**
 * Soft-deletes a custom field definition by setting archived=true.
 * Values stored in entity custom_fields jsonb are NOT touched — no data loss.
 * RLS scopes the UPDATE to the active org.
 */
export async function archiveDefinition(
  input: ArchiveDefinitionInput,
): Promise<ActionResult<{ archived: string }>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const parsed = archiveDefinitionSchema.safeParse(input)
  if (!parsed.success) return err('invalid_input', parsed.error.issues)

  const { id } = parsed.data

  const supabase = await createClient()

  const { error: archErr } = await supabase
    .from('custom_field_definitions')
    .update({ archived: true })
    .eq('id', id)

  if (archErr) return err(archErr.message, archErr)

  revalidatePath(REVALIDATE_PATH)
  return ok({ archived: id })
}

// ─── reorderDefinitions ───────────────────────────────────────────────────────

/**
 * Bulk-updates position values for custom field definitions within a single entity.
 * Each ID in orderedIds is assigned position = index + 1 (1-based, matches schema default).
 *
 * Non-atomic: individual UPDATE calls in sequence. Position conflicts are transient
 * (prior state) and converge to the correct final state. Acceptable for v1 given
 * the low concurrency of settings changes.
 *
 * RLS scopes all UPDATEs to the active org — cross-org rewrites silently no-op.
 */
export async function reorderDefinitions(
  input: ReorderDefinitionsInput,
): Promise<ActionResult<{ reordered: number }>> {
  const user = await getUser()
  if (!user) return err('not_authenticated')

  const parsed = reorderDefinitionsSchema.safeParse(input)
  if (!parsed.success) return err('invalid_input', parsed.error.issues)

  const { orderedIds } = parsed.data

  if (orderedIds.length === 0) return ok({ reordered: 0 })

  const supabase = await createClient()

  let reordered = 0
  for (let i = 0; i < orderedIds.length; i++) {
    const { error: upErr } = await supabase
      .from('custom_field_definitions')
      .update({ position: i + 1 })
      .eq('id', orderedIds[i])

    if (upErr) return err(upErr.message, upErr)
    reordered++
  }

  revalidatePath(REVALIDATE_PATH)
  return ok({ reordered })
}
