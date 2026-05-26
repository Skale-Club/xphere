'use server'

import { revalidatePath } from 'next/cache'
import { getUser, createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto'
import { testResendApiKey, sendTenantEmail } from '@/lib/email/resend'
import type { TenantEmailIntegrationRow } from '@/types/database'

// ─── Getters ──────────────────────────────────────────────────────────────

export async function getTenantEmailIntegration(): Promise<{
  integration: (Omit<TenantEmailIntegrationRow, 'api_key_encrypted'> & { key_hint: string | null }) | null
  error?: string
}> {
  const user = await getUser()
  if (!user) return { integration: null, error: 'Unauthorized' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { integration: null, error: 'No active org' }

  const { data } = await supabase
    .from('tenant_email_integrations')
    .select('id, org_id, key_hint, default_from_name, default_from_email, default_reply_to, provider, status, last_tested_at, last_error, created_at, updated_at')
    .eq('org_id', orgId as string)
    .single()

  return { integration: data ?? null }
}

// ─── Save / Upsert ────────────────────────────────────────────────────────

export async function saveTenantEmailIntegration(input: {
  apiKey?: string
  defaultFromName: string
  defaultFromEmail: string
  defaultReplyTo: string
}): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active org' }

  const serviceSupabase = createServiceRoleClient()

  let apiKeyEncrypted: string | undefined
  let keyHint: string | undefined

  if (input.apiKey?.trim()) {
    apiKeyEncrypted = await encrypt(input.apiKey.trim())
    keyHint = maskApiKey(input.apiKey.trim())
  }

  const { data: existing } = await supabase
    .from('tenant_email_integrations')
    .select('id, api_key_encrypted')
    .eq('org_id', orgId as string)
    .single()

  if (existing) {
    const updatePayload: Record<string, unknown> = {
      default_from_name: input.defaultFromName || null,
      default_from_email: input.defaultFromEmail || null,
      default_reply_to: input.defaultReplyTo || null,
      updated_at: new Date().toISOString(),
    }
    if (apiKeyEncrypted) {
      updatePayload.api_key_encrypted = apiKeyEncrypted
      updatePayload.key_hint = keyHint
      updatePayload.status = 'disconnected' // reset status when key changes
    }

    const { error } = await serviceSupabase
      .from('tenant_email_integrations')
      .update(updatePayload)
      .eq('id', existing.id)

    if (error) return { error: error.message }
  } else {
    const { error } = await serviceSupabase.from('tenant_email_integrations').insert({
      org_id: orgId as string,
      api_key_encrypted: apiKeyEncrypted ?? null,
      key_hint: keyHint ?? null,
      default_from_name: input.defaultFromName || null,
      default_from_email: input.defaultFromEmail || null,
      default_reply_to: input.defaultReplyTo || null,
      provider: 'resend',
      status: 'disconnected',
    })

    if (error) return { error: error.message }
  }

  revalidatePath('/settings/email')
  return {}
}

// ─── Test connection ──────────────────────────────────────────────────────

export async function testTenantEmailConnection(): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active org' }

  const serviceSupabase = createServiceRoleClient()

  const { data: integration } = await serviceSupabase
    .from('tenant_email_integrations')
    .select('id, api_key_encrypted')
    .eq('org_id', orgId as string)
    .single()

  if (!integration?.api_key_encrypted) {
    return { ok: false, error: 'No API key saved. Save your settings first.' }
  }

  let apiKey: string
  try {
    apiKey = await decrypt(integration.api_key_encrypted)
  } catch {
    return { ok: false, error: 'Failed to decrypt API key' }
  }

  const result = await testResendApiKey(apiKey)

  // Update status and last_tested_at
  await serviceSupabase
    .from('tenant_email_integrations')
    .update({
      status: result.ok ? 'connected' : 'error',
      last_tested_at: new Date().toISOString(),
      last_error: result.ok ? null : (result.error ?? 'Unknown error'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', integration.id)

  revalidatePath('/settings/email')
  return result
}

// ─── Send test email ──────────────────────────────────────────────────────

export async function sendTestTenantEmail(to: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Unauthorized' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active org' }

  const result = await sendTenantEmail(
    orgId as string,
    to,
    'Xphere Email Test',
    '<p>This is a test email from Xphere. Your Resend integration is working correctly.</p>'
  )

  return { ok: !result.error, error: result.error }
}
