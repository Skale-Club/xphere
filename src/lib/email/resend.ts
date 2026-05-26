// src/lib/email/resend.ts
// Unified Resend email sending — platform-level and tenant-level
//
// - sendPlatformEmail: uses platform_email_settings (service role, super admin only)
// - sendTenantEmail:   uses tenant_email_integrations (org-scoped credentials)
//
// Fire-and-forget pattern: logs errors, does not throw, never crashes the app.
// Encrypt/decrypt via src/lib/crypto.ts (AES-256-GCM — never modify that file).

import { Resend } from 'resend'
import { decrypt, maskApiKey } from '@/lib/crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// ─── Platform email ────────────────────────────────────────────────────────

/**
 * Send an email using the platform-level Resend settings.
 * Uses the service role key — call only from super-admin-gated server actions or API routes.
 */
export async function sendPlatformEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ id?: string; error?: string }> {
  try {
    const supabase = createServiceRoleClient()
    const { data: settings } = await supabase
      .from('platform_email_settings')
      .select('api_key_encrypted, default_from_name, default_from_email, is_active')
      .eq('is_active', true)
      .single()

    if (!settings?.api_key_encrypted) {
      console.warn('[sendPlatformEmail] No active platform email settings found')
      return { error: 'Platform email not configured' }
    }

    const apiKey = await decrypt(settings.api_key_encrypted)
    const resend = new Resend(apiKey)

    const fromEmail = settings.default_from_email ?? 'notifications@xphere.app'
    const fromName = settings.default_from_name ?? 'Xphere'
    const from = `${fromName} <${fromEmail}>`

    const { data, error } = await resend.emails.send({ from, to, subject, html })

    if (error) {
      console.error('[sendPlatformEmail] Resend error:', error)
      return { error: error.message }
    }

    return { id: data?.id ?? undefined }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[sendPlatformEmail] Unexpected error:', message)
    return { error: message }
  }
}

// ─── Tenant email ─────────────────────────────────────────────────────────

/**
 * Send an email using the tenant's Resend integration credentials.
 * Reads from tenant_email_integrations scoped to the given orgId.
 */
export async function sendTenantEmail(
  orgId: string,
  to: string,
  subject: string,
  html: string,
  replyTo?: string
): Promise<{ id?: string; error?: string }> {
  try {
    const supabase = createServiceRoleClient()
    const { data: integration } = await supabase
      .from('tenant_email_integrations')
      .select('api_key_encrypted, default_from_name, default_from_email, default_reply_to, status')
      .eq('org_id', orgId)
      .eq('status', 'connected')
      .single()

    if (!integration?.api_key_encrypted) {
      console.warn(`[sendTenantEmail] No connected tenant email integration for org ${orgId}`)
      return { error: 'Tenant email integration not configured' }
    }

    const apiKey = await decrypt(integration.api_key_encrypted)
    const resend = new Resend(apiKey)

    const fromEmail = integration.default_from_email ?? 'noreply@xphere.app'
    const fromName = integration.default_from_name ?? 'Xphere'
    const from = `${fromName} <${fromEmail}>`
    const resolvedReplyTo = replyTo ?? integration.default_reply_to ?? undefined

    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      ...(resolvedReplyTo ? { reply_to: resolvedReplyTo } : {}),
    })

    if (error) {
      console.error(`[sendTenantEmail] Resend error for org ${orgId}:`, error)
      return { error: error.message }
    }

    return { id: data?.id ?? undefined }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sendTenantEmail] Unexpected error for org ${orgId}:`, message)
    return { error: message }
  }
}

// ─── Test connection ───────────────────────────────────────────────────────

/**
 * Test a Resend API key by attempting to list domains (lightweight, no email sent).
 * Returns { ok: true } on success or { ok: false, error } on failure.
 */
export async function testResendApiKey(
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resend = new Resend(apiKey)
    // domains.list is a lightweight read-only call that validates the key
    await resend.domains.list()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}

// ─── Key hint helper ──────────────────────────────────────────────────────

export { maskApiKey }
