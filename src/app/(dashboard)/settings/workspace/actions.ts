'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt, encrypt } from '@/lib/crypto'
import type { WhatsAppProvider, WhatsAppProviderStatus } from '@/lib/whatsapp/types'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const updateSchema = z.object({
  logo_url: z
    .string()
    .trim()
    .max(2048, 'Logo URL is too long')
    .url('Logo URL must be a valid URL')
    .optional()
    .nullable()
    .or(z.literal('')),
  accent_color: z
    .string()
    .trim()
    .regex(HEX_RE, 'Accent must be a 6-digit hex like #6366F1')
    .optional()
    .nullable()
    .or(z.literal('')),
  brand_name: z
    .string()
    .trim()
    .max(64, 'Brand name is too long')
    .optional()
    .nullable()
    .or(z.literal('')),
})

const costCapSchema = z.object({
  daily_cost_cap_usd: z
    .number({ invalid_type_error: 'Must be a number' })
    .min(0, 'Cap must be ≥ $0')
    .max(10000, 'Cap must be ≤ $10,000')
    .nullable(),
})

export type UpdateWorkspaceBrandingInput = z.infer<typeof updateSchema>

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * Update branding fields (logo_url, accent_color, brand_name) on the current
 * org. Empty strings are normalized to null. RLS enforces org membership.
 */
export async function updateWorkspaceBranding(input: UpdateWorkspaceBrandingInput): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: orgId, error: orgErr } = await supabase.rpc('get_current_org_id')
  if (orgErr || !orgId) {
    return { ok: false, error: 'No active organization' }
  }

  const patch: Record<string, string | null> = {}
  if (parsed.data.logo_url !== undefined) {
    patch.logo_url = parsed.data.logo_url && parsed.data.logo_url.length > 0 ? parsed.data.logo_url : null
  }
  if (parsed.data.accent_color !== undefined) {
    patch.accent_color = parsed.data.accent_color && parsed.data.accent_color.length > 0 ? parsed.data.accent_color : null
  }
  if (parsed.data.brand_name !== undefined) {
    patch.brand_name = parsed.data.brand_name && parsed.data.brand_name.length > 0 ? parsed.data.brand_name : null
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true }
  }

  const { error: updateErr } = await supabase
    .from('organizations')
    .update(patch)
    .eq('id', orgId as string)

  if (updateErr) {
    return { ok: false, error: updateErr.message }
  }

  // Branding feeds into the dashboard layout | revalidate all dashboard routes.
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Update the per-org daily AI cost cap.
 * Pass null to remove the override and fall back to the platform default.
 */
export async function updateDailyCostCap(input: { daily_cost_cap_usd: number | null }): Promise<ActionResult> {
  const parsed = costCapSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: orgId, error: orgErr } = await supabase.rpc('get_current_org_id')
  if (orgErr || !orgId) return { ok: false, error: 'No active organization' }

  const { error } = await supabase
    .from('organizations')
    .update({ daily_cost_cap_usd_override: parsed.data.daily_cost_cap_usd })
    .eq('id', orgId as string)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings/workspace')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// SEED-031 | WhatsApp provider settings
// ---------------------------------------------------------------------------

const whatsappProviderSchema = z.object({
  provider: z.enum(['evolution', 'zapi', 'wapi']),
  displayName: z.string().trim().max(64).optional().default(''),
  config: z.record(z.string(), z.string()),
})

export interface SaveWhatsAppProviderInput {
  provider: WhatsAppProvider
  displayName?: string
  config: Record<string, string>
}

export interface ActiveWhatsAppProvider {
  id: string
  provider: WhatsAppProvider
  displayName: string
  config: Record<string, string>
  status: WhatsAppProviderStatus
  phoneNumber: string | null
}

function validateConfigForProvider(
  provider: WhatsAppProvider,
  config: Record<string, string>,
): string | null {
  const need = (keys: string[]) =>
    keys.find((k) => !config[k] || config[k].trim().length === 0)

  if (provider === 'evolution') {
    const missing = need(['base_url', 'token', 'instance_name'])
    if (missing) return `Evolution: ${missing} is required`
  } else if (provider === 'zapi') {
    const missing = need(['instance_id', 'token'])
    if (missing) return `Z-API: ${missing} is required`
  } else if (provider === 'wapi') {
    const missing = need(['instance_key', 'token', 'base_url'])
    if (missing) return `W-API: ${missing} is required`
  }
  return null
}

/**
 * Activate (or insert) a WhatsApp provider for the current org. Atomically
 * deactivates any previously active provider so the partial unique index
 * (org_id where is_active=true) is satisfied. Uses the service-role client to
 * bypass RLS for the multi-row mutation; org_id is resolved via the
 * authenticated client before the privileged write.
 */
export async function saveWhatsAppProvider(
  input: SaveWhatsAppProviderInput,
): Promise<ActionResult> {
  const parsed = whatsappProviderSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { data: orgId, error: orgErr } = await supabase.rpc('get_current_org_id')
  if (orgErr || !orgId) return { ok: false, error: 'No active organization' }

  const configErr = validateConfigForProvider(parsed.data.provider, parsed.data.config)
  if (configErr) return { ok: false, error: configErr }

  const admin = createServiceRoleClient()
  const orgIdStr = orgId as string

  // 1. Deactivate any current active provider for the org
  const { error: deactErr } = await admin
    .from('whatsapp_providers')
    .update({ is_active: false })
    .eq('org_id', orgIdStr)
    .eq('is_active', true)
  if (deactErr) {
    return { ok: false, error: `Failed to deactivate previous provider: ${deactErr.message}` }
  }

  // 2. Encrypt config + look for existing row to update; otherwise insert
  const configEncrypted = await encrypt(JSON.stringify(parsed.data.config))

  const { data: existing } = await admin
    .from('whatsapp_providers')
    .select('id')
    .eq('org_id', orgIdStr)
    .eq('provider', parsed.data.provider)
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    const { error: upErr } = await admin
      .from('whatsapp_providers')
      .update({
        display_name: parsed.data.displayName ?? '',
        config_encrypted: configEncrypted,
        is_active: true,
      })
      .eq('id', existing.id)
    if (upErr) return { ok: false, error: upErr.message }
  } else {
    const { error: insErr } = await admin.from('whatsapp_providers').insert({
      org_id: orgIdStr,
      provider: parsed.data.provider,
      display_name: parsed.data.displayName ?? '',
      config_encrypted: configEncrypted,
      is_active: true,
    })
    if (insErr) return { ok: false, error: insErr.message }
  }

  // 3. Deactivate legacy evolution_instances rows when the new provider is
  //    non-Evolution. When evolution is selected we keep the legacy row in sync
  //    so older code that still queries evolution_instances keeps working.
  if (parsed.data.provider !== 'evolution') {
    await admin
      .from('evolution_instances')
      .update({ is_active: false })
      .eq('org_id', orgIdStr)
      .eq('is_active', true)
  }

  revalidatePath('/settings/workspace')
  return { ok: true }
}

export async function getActiveWhatsAppProvider(): Promise<ActiveWhatsAppProvider | null> {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  const { data, error } = await supabase
    .from('whatsapp_providers')
    .select('id, provider, display_name, config_encrypted, status, phone_number')
    .eq('org_id', orgId as string)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  try {
    const configJson = await decrypt(data.config_encrypted)
    const config = JSON.parse(configJson) as Record<string, string>
    return {
      id: data.id,
      provider: data.provider,
      displayName: data.display_name,
      config,
      status: data.status,
      phoneNumber: data.phone_number,
    }
  } catch (err) {
    console.error('[settings/whatsapp] decrypt failed:', err)
    return null
  }
}
