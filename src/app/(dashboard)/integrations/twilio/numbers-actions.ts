'use server'
/**
 * Twilio phone numbers | per-org CRUD server actions (v2.3).
 *
 * Each org can register multiple Twilio numbers; one (and only one) is the
 * default for outbound flows. The "exactly one default per org" invariant is
 * enforced at the DB layer via the partial unique index
 * `twilio_phone_numbers_one_default_per_org` (see migration 058).
 *
 * All actions run through the authenticated client and rely on RLS for tenant
 * isolation | never pass `organization_id` from the client.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type TwilioPhoneNumberRow =
  Database['public']['Tables']['twilio_phone_numbers']['Row']

// ── Zod schemas ─────────────────────────────────────────────────────────────

const E164_REGEX = /^\+[1-9]\d{6,14}$/
const PHONE_SID_REGEX = /^PN[a-f0-9]{32}$/i

const RoutingMode = z.enum(['browser', 'sip', 'forward'])

const BaseShape = z.object({
  e164: z.string().regex(E164_REGEX, 'Invalid E.164 format (e.g. +14155551234).'),
  phone_sid: z
    .string()
    .regex(PHONE_SID_REGEX, 'Phone SID must look like PN followed by 32 hex chars.')
    .optional()
    .or(z.literal('')),
  friendly_name: z.string().min(1, 'Friendly name is required.').max(64, 'Max 64 chars.'),
  capability_sms: z.boolean().default(false),
  capability_mms: z.boolean().default(false),
  capability_voice: z.boolean().default(false),
  default_routing_mode: RoutingMode.nullable().optional(),
  forward_to_number: z
    .string()
    .regex(E164_REGEX, 'Forward target must be valid E.164.')
    .optional()
    .or(z.literal('')),
  is_default: z.boolean().default(false),
  notes: z.string().max(500, 'Notes max 500 chars.').optional().or(z.literal('')),
})

function refineCapabilitiesAndForward(data: z.infer<typeof BaseShape>, ctx: z.RefinementCtx) {
  if (!data.capability_sms && !data.capability_mms && !data.capability_voice) {
    ctx.addIssue({
      code: 'custom',
      message: 'Enable at least one capability (SMS, MMS, or Voice).',
      path: ['capability_sms'],
    })
  }
  if (data.default_routing_mode === 'forward' && !data.forward_to_number) {
    ctx.addIssue({
      code: 'custom',
      message: 'Forward target number is required when routing mode is "forward".',
      path: ['forward_to_number'],
    })
  }
}

const CreateNumberSchema = BaseShape.superRefine(refineCapabilitiesAndForward)

const UpdateNumberSchema = BaseShape.partial().superRefine((data, ctx) => {
  // Only apply combined refinements when the relevant fields are present.
  if (
    data.capability_sms !== undefined ||
    data.capability_mms !== undefined ||
    data.capability_voice !== undefined
  ) {
    const sms = data.capability_sms ?? false
    const mms = data.capability_mms ?? false
    const voice = data.capability_voice ?? false
    if (!sms && !mms && !voice) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enable at least one capability (SMS, MMS, or Voice).',
        path: ['capability_sms'],
      })
    }
  }
  if (data.default_routing_mode === 'forward' && !data.forward_to_number) {
    ctx.addIssue({
      code: 'custom',
      message: 'Forward target number is required when routing mode is "forward".',
      path: ['forward_to_number'],
    })
  }
})

export type CreateNumberInput = z.input<typeof CreateNumberSchema>
export type UpdateNumberInput = z.input<typeof UpdateNumberSchema>

// ── Helpers ─────────────────────────────────────────────────────────────────

function nullableString(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function revalidateAll() {
  revalidatePath('/integrations')
  revalidatePath('/integrations/twilio')
  revalidatePath('/settings/calls')
}

// ── Actions ─────────────────────────────────────────────────────────────────

export async function listTwilioNumbers(): Promise<TwilioPhoneNumberRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('twilio_phone_numbers')
    .select('*')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('friendly_name', { ascending: true })

  if (error || !data) return []
  return data
}

export async function createTwilioNumber(
  input: CreateNumberInput,
): Promise<{ data?: TwilioPhoneNumberRow; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const parsed = CreateNumberSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? 'Invalid input.' }
  }
  const body = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  // If marking as default, clear prior defaults first. RLS scopes the update
  // to the current org | no need to filter explicitly.
  if (body.is_default) {
    const { error: clearError } = await supabase
      .from('twilio_phone_numbers')
      .update({ is_default: false })
      .eq('is_default', true)
    if (clearError) return { error: clearError.message }
  }

  const { data, error } = await supabase
    .from('twilio_phone_numbers')
    .insert({
      organization_id: orgId,
      e164: body.e164,
      phone_sid: nullableString(body.phone_sid),
      friendly_name: body.friendly_name,
      capability_sms: body.capability_sms,
      capability_mms: body.capability_mms,
      capability_voice: body.capability_voice,
      default_routing_mode: body.default_routing_mode ?? null,
      forward_to_number: nullableString(body.forward_to_number),
      is_default: body.is_default,
      notes: nullableString(body.notes),
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505' && error.message.includes('e164')) {
      return { error: `A number with E.164 ${body.e164} already exists.` }
    }
    return { error: error.message }
  }

  revalidateAll()
  return { data }
}

export async function updateTwilioNumber(
  id: string,
  input: UpdateNumberInput,
): Promise<{ data?: TwilioPhoneNumberRow; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const parsed = UpdateNumberSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? 'Invalid input.' }
  }
  const body = parsed.data

  const supabase = await createClient()

  if (body.is_default === true) {
    const { error: clearError } = await supabase
      .from('twilio_phone_numbers')
      .update({ is_default: false })
      .eq('is_default', true)
      .neq('id', id)
    if (clearError) return { error: clearError.message }
  }

  const patch: Record<string, unknown> = {}
  if (body.e164 !== undefined) patch.e164 = body.e164
  if (body.phone_sid !== undefined) patch.phone_sid = nullableString(body.phone_sid)
  if (body.friendly_name !== undefined) patch.friendly_name = body.friendly_name
  if (body.capability_sms !== undefined) patch.capability_sms = body.capability_sms
  if (body.capability_mms !== undefined) patch.capability_mms = body.capability_mms
  if (body.capability_voice !== undefined) patch.capability_voice = body.capability_voice
  if (body.default_routing_mode !== undefined) patch.default_routing_mode = body.default_routing_mode ?? null
  if (body.forward_to_number !== undefined) patch.forward_to_number = nullableString(body.forward_to_number)
  if (body.is_default !== undefined) patch.is_default = body.is_default
  if (body.notes !== undefined) patch.notes = nullableString(body.notes)

  const { data, error } = await supabase
    .from('twilio_phone_numbers')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return { error: error.message }

  revalidateAll()
  return { data }
}

export async function softDeleteTwilioNumber(
  id: string,
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Clear the default flag at the same time | soft-deleting the default leaves
  // the org with no default, which is the correct prompt to pick a new one.
  const { error } = await supabase
    .from('twilio_phone_numbers')
    .update({ is_active: false, is_default: false })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidateAll()
  return {}
}

export async function setDefaultTwilioNumber(
  id: string,
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Verify the target row exists and is active | early error beats a confusing
  // partial-state outcome.
  const { data: target, error: lookupError } = await supabase
    .from('twilio_phone_numbers')
    .select('id, is_active')
    .eq('id', id)
    .maybeSingle()
  if (lookupError) return { error: lookupError.message }
  if (!target) return { error: 'Phone number not found.' }
  if (!target.is_active) return { error: 'Cannot set an inactive number as default. Reactivate it first.' }

  // Clear all defaults in this org (RLS scopes the update); then set the target.
  const { error: clearError } = await supabase
    .from('twilio_phone_numbers')
    .update({ is_default: false })
    .eq('is_default', true)
  if (clearError) return { error: clearError.message }

  const { error: setError } = await supabase
    .from('twilio_phone_numbers')
    .update({ is_default: true })
    .eq('id', id)
  if (setError) return { error: setError.message }

  revalidateAll()
  return {}
}
