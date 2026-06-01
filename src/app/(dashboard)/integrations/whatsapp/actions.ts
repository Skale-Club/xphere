'use server'

/**
 * Server actions for the WhatsApp Cloud (Meta Official) integration.
 *
 * Used by the integrations panel UI to test/save/sync/disconnect a Meta
 * Cloud account, and by the templates page to refresh the template list.
 */

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { encrypt, decrypt } from '@/lib/crypto'
import { verifyCredentials } from '@/lib/whatsapp/cloud/verify-credentials'
import { subscribeApp, unsubscribeApp } from '@/lib/whatsapp/cloud/subscribe-webhook'
import { syncTemplates, createCloudTemplate, type CreateTemplateInput } from '@/lib/whatsapp/cloud/templates'
import { getActiveCloudAccount } from '@/lib/whatsapp/cloud/resolve-account'

export interface CloudAccountSummary {
  id: string
  displayName: string
  wabaId: string
  phoneNumberId: string
  phoneNumberE164: string | null
  status: 'connected' | 'disconnected' | 'error'
  lastSyncedAt: string | null
  lastError: string | null
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function getActiveCloudAccountSummary(): Promise<CloudAccountSummary | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null
  const { data } = await supabase
    .from('whatsapp_cloud_accounts')
    .select('id, display_name, waba_id, phone_number_id, phone_number_e164, status, last_synced_at, last_error')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    displayName: data.display_name,
    wabaId: data.waba_id,
    phoneNumberId: data.phone_number_id,
    phoneNumberE164: data.phone_number_e164,
    status: data.status,
    lastSyncedAt: data.last_synced_at,
    lastError: data.last_error,
  }
}

// ── Test connection ─────────────────────────────────────────────────────────

export async function testCloudCredentials(input: {
  wabaId: string
  phoneNumberId: string
  accessToken: string
}): Promise<
  | { ok: true; displayPhoneNumber: string | null; verifiedName: string | null; qualityRating: string | null }
  | { ok: false; error: string }
> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const result = await verifyCredentials(input)
  if (!result.ok) return { ok: false, error: result.error }
  return {
    ok: true,
    displayPhoneNumber: result.displayPhoneNumber,
    verifiedName: result.verifiedName,
    qualityRating: result.qualityRating,
  }
}

// ── Connect (save + subscribe) ──────────────────────────────────────────────

export async function connectCloudAccount(input: {
  displayName: string
  wabaId: string
  phoneNumberId: string
  accessToken: string
  appSecret: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  // App Secret is required — without it we cannot validate webhook HMAC
  // signatures, and the webhook handler refuses to process events from
  // accounts without an app_secret.
  if (!input.appSecret || input.appSecret.trim().length < 8) {
    return {
      ok: false,
      error:
        'App Secret is required. Find it in Meta Business Manager → App Settings → Basic → App Secret.',
    }
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization' }

  const verify = await verifyCredentials({
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    accessToken: input.accessToken,
  })
  if (!verify.ok) return { ok: false, error: verify.error }

  const accessTokenEnc = await encrypt(input.accessToken)
  const appSecretEnc = await encrypt(input.appSecret)

  // Auto-generate a per-tenant webhook verify token (32 hex chars = 128 bits).
  // The user will copy this from the panel into their Meta Business Manager.
  const verifyToken = randomBytes(16).toString('hex')
  const verifyTokenEnc = await encrypt(verifyToken)

  // Use service-role for the write so we don't depend on the RLS context
  // matching this user — the org check above is enough.
  const svc = createServiceRoleClient()

  // Deactivate any prior account for this org (we only support one active).
  await svc
    .from('whatsapp_cloud_accounts')
    .update({ is_active: false, status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('is_active', true)

  const { error: insertErr } = await svc.from('whatsapp_cloud_accounts').insert({
    org_id: orgId,
    display_name: input.displayName.trim() || 'WhatsApp Official',
    waba_id: input.wabaId.trim(),
    phone_number_id: input.phoneNumberId.trim(),
    phone_number_e164: verify.displayPhoneNumber,
    access_token_encrypted: accessTokenEnc,
    app_secret_encrypted: appSecretEnc,
    webhook_verify_token_encrypted: verifyTokenEnc,
    status: 'connected',
    is_active: true,
    created_by: user.id,
  })
  if (insertErr) return { ok: false, error: insertErr.message }

  // Subscribe the App to webhook events for this WABA.
  const sub = await subscribeApp({ accessToken: input.accessToken, wabaId: input.wabaId })
  if (!sub.ok) {
    // Persist the warning but don't fail — user may have already subscribed via UI.
    await svc
      .from('whatsapp_cloud_accounts')
      .update({ last_error: `Webhook subscribe warning: ${sub.error}` })
      .eq('org_id', orgId)
      .eq('is_active', true)
  }

  revalidatePath('/integrations')
  return { ok: true }
}

// ── Webhook config (per-tenant URL + verify token) ─────────────────────────

export interface WebhookConfig {
  url: string
  verifyToken: string
}

export async function getWebhookConfig(): Promise<WebhookConfig | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  const { data } = await supabase
    .from('whatsapp_cloud_accounts')
    .select('id, webhook_verify_token_encrypted')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (!data || !data.webhook_verify_token_encrypted) return null

  let verifyToken: string
  try {
    verifyToken = await decrypt(data.webhook_verify_token_encrypted)
  } catch {
    return null
  }

  // Build absolute URL using the canonical xphere host. Fallback to the
  // request-derived host would require a Request object we don't have here,
  // so we rely on the env var convention used elsewhere in the app.
  const host = process.env.NEXT_PUBLIC_APP_URL ?? 'https://xphere.app'
  const url = `${host.replace(/\/$/, '')}/api/whatsapp/cloud/webhook/${data.id}`

  return { url, verifyToken }
}

// ── Sync templates ──────────────────────────────────────────────────────────

export async function syncCloudTemplates(): Promise<
  | { ok: true; inserted: number; updated: number; deleted: number }
  | { ok: false; error: string }
> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization' }
  const result = await syncTemplates(orgId)
  if (!result.ok) return { ok: false, error: result.error }
  revalidatePath('/integrations/whatsapp/templates')
  return { ok: true, inserted: result.inserted, updated: result.updated, deleted: result.deleted }
}

// ── Create template (submit to Meta for approval) ──────────────────────────

export async function createCloudTemplateAction(
  input: CreateTemplateInput,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization' }

  const name = input.name?.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
  if (!name) return { ok: false, error: 'Template name is required.' }
  if (!input.bodyText?.trim()) return { ok: false, error: 'Body text is required.' }

  const result = await createCloudTemplate(orgId, { ...input, name })
  if (!result.ok) return { ok: false, error: result.error }
  revalidatePath('/integrations/whatsapp/templates')
  return { ok: true, status: result.status }
}

// ── List approved templates (for campaign wizard) ──────────────────────────

export interface ApprovedTemplate {
  id: string
  name: string
  language: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  bodyVariableCount: number
  headerVariableCount: number
  bodyText: string | null
}

export async function listApprovedTemplates(): Promise<ApprovedTemplate[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return []
  const { data } = await supabase
    .from('whatsapp_templates')
    .select('id, name, language, category, body_variable_count, header_variable_count, components')
    .eq('org_id', orgId)
    .eq('status', 'APPROVED')
    .order('name', { ascending: true })
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category,
    bodyVariableCount: row.body_variable_count,
    headerVariableCount: row.header_variable_count,
    bodyText: extractBody(row.components),
  }))
}

function extractBody(components: unknown): string | null {
  if (!Array.isArray(components)) return null
  const block = (components as Array<{ type?: string; text?: string }>).find(
    (c) => c.type === 'BODY',
  )
  return block?.text ?? null
}

// ── Disconnect ──────────────────────────────────────────────────────────────

export async function disconnectCloudAccount(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'No active organization' }

  const account = await getActiveCloudAccount(orgId)
  if (account) {
    // Best-effort: unsubscribe from Meta side (errors don't block disconnect)
    await unsubscribeApp({ accessToken: account.accessToken, wabaId: account.wabaId })
  }

  const svc = createServiceRoleClient()
  await svc
    .from('whatsapp_cloud_accounts')
    .update({ is_active: false, status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('is_active', true)

  revalidatePath('/integrations')
  return { ok: true }
}
