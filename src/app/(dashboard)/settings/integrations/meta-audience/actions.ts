'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

export interface MetaAudienceConfigRow {
  id: string
  org_id: string
  meta_business_id: string | null
  meta_ad_account_id: string
  custom_audience_id: string | null
  audience_name: string | null
  sync_enabled: boolean
  terms_accepted_at: string | null
  consent_basis: string
  last_synced_at: string | null
  last_sync_stats: { sent?: number; removed?: number; error_count?: number } | null
}

export interface ActionResult {
  ok: boolean
  error?: string
}

export async function getMetaAudienceConfig(): Promise<MetaAudienceConfigRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('meta_audience_config')
    .select('*')
    .limit(1)
    .maybeSingle()
  return data as MetaAudienceConfigRow | null
}

const saveSchema = z.object({
  meta_ad_account_id: z
    .string()
    .trim()
    .min(1, 'Ad Account ID is required')
    .regex(/^act_\d+$/, 'Must be in the format act_XXXXXXXXX'),
  meta_business_id: z.string().trim().optional().nullable().or(z.literal('')),
  audience_name: z
    .string()
    .trim()
    .max(200, 'Audience name is too long')
    .optional()
    .nullable()
    .or(z.literal('')),
  terms_accepted: z.boolean(),
})

export type SaveMetaAudienceConfigInput = z.infer<typeof saveSchema>

export async function saveMetaAudienceConfig(
  input: SaveMetaAudienceConfigInput,
): Promise<ActionResult> {
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  if (!parsed.data.terms_accepted) {
    return { ok: false, error: 'You must accept the Meta Customer List terms to save' }
  }

  const supabase = await createClient()
  const { data: orgId, error: orgErr } = await supabase.rpc('get_current_org_id')
  if (orgErr || !orgId) return { ok: false, error: 'No active organization' }

  const now = new Date().toISOString()
  const existing = await getMetaAudienceConfig()

  if (existing) {
    const patch: Record<string, unknown> = {
      meta_ad_account_id: parsed.data.meta_ad_account_id,
      meta_business_id: parsed.data.meta_business_id || null,
      audience_name: parsed.data.audience_name || null,
      terms_accepted_at: existing.terms_accepted_at ?? now,
    }
    // Reset audience id if ad account changed (new account = new audience)
    if (existing.meta_ad_account_id !== parsed.data.meta_ad_account_id) {
      patch.custom_audience_id = null
      patch.last_synced_at = null
      patch.last_sync_stats = null
    }
    const { error } = await supabase
      .from('meta_audience_config')
      .update(patch)
      .eq('id', existing.id)
    if (error) return { ok: false, error: error.message }
  } else {
    const { error } = await supabase.from('meta_audience_config').insert({
      org_id: orgId as string,
      meta_ad_account_id: parsed.data.meta_ad_account_id,
      meta_business_id: parsed.data.meta_business_id || null,
      audience_name: parsed.data.audience_name || null,
      terms_accepted_at: now,
      sync_enabled: false,
    })
    if (error) return { ok: false, error: error.message }
  }

  revalidatePath('/settings/integrations/meta-audience')
  return { ok: true }
}

export async function toggleMetaAudienceSync(enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()

  const existing = await getMetaAudienceConfig()
  if (!existing) return { ok: false, error: 'No configuration saved yet' }
  if (!existing.terms_accepted_at) {
    return { ok: false, error: 'Accept the Meta Customer List terms before enabling sync' }
  }

  const { error } = await supabase
    .from('meta_audience_config')
    .update({ sync_enabled: enabled })
    .eq('id', existing.id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings/integrations/meta-audience')
  return { ok: true }
}
