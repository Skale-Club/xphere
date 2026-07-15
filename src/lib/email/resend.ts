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
import { signUnsubscribeToken } from '@/lib/email/unsubscribe-token'

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'https://xphere.app'

/**
 * 'marketing' email gets a compliance footer (physical address + unsubscribe
 * link) and is suppressed for recipients on the org's unsubscribe list.
 * 'transactional' (default) sends as-is — booking confirmations, receipts, etc.
 */
export type EmailKind = 'marketing' | 'transactional'

/** Build the org's compliance footer HTML from the company profile + token. */
function buildFooter(
  org: {
    name: string | null
    legal_name: string | null
    address_line1: string | null
    address_line2: string | null
    address_city: string | null
    address_state: string | null
    address_postal_code: string | null
    address_country: string | null
  } | null,
  unsubscribeUrl: string,
): string {
  const company = org?.legal_name?.trim() || org?.name?.trim() || ''
  const addressParts = [
    org?.address_line1,
    org?.address_line2,
    [org?.address_city, org?.address_state].filter(Boolean).join(', '),
    org?.address_postal_code,
    org?.address_country,
  ]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
  const addressLine = addressParts.join(' · ')

  return `
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
      ${company ? `<div style="font-weight:600;color:#374151;">${escapeHtml(company)}</div>` : ''}
      ${addressLine ? `<div>${escapeHtml(addressLine)}</div>` : ''}
      <div style="margin-top:8px;">
        <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a> from these emails.
      </div>
    </div>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── Platform email ────────────────────────────────────────────────────────

/**
 * Send an email using the platform-level Resend settings.
 * Uses the service role key — call only from super-admin-gated server actions or API routes.
 */
export async function sendPlatformEmail(
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<{ id?: string; error?: string }> {
  try {
    const supabase = createServiceRoleClient()
    const { data: settingsRaw } = await supabase
      .from('platform_email_settings')
      .select('api_key_encrypted, default_from_name, default_from_email, is_active')
      .eq('is_active', true)
      .single()

    const settings = settingsRaw as {
      api_key_encrypted: string | null
      default_from_name: string | null
      default_from_email: string | null
      is_active: boolean
    } | null

    if (!settings?.api_key_encrypted) {
      console.warn('[sendPlatformEmail] No active platform email settings found')
      return { error: 'Platform email not configured' }
    }

    const apiKey = await decrypt(settings.api_key_encrypted)
    const resend = new Resend(apiKey)

    const fromEmail = settings.default_from_email ?? 'notifications@xphere.app'
    const fromName = settings.default_from_name ?? 'Xphere'
    const from = `${fromName} <${fromEmail}>`

    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
    })

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
  replyTo?: string,
  opts?: { kind?: EmailKind; text?: string }
): Promise<{ id?: string; error?: string; skipped?: boolean }> {
  try {
    const kind: EmailKind = opts?.kind ?? 'transactional'
    const supabase = createServiceRoleClient()
    const recipient = to.trim().toLowerCase()

    // Marketing email: honour the suppression list (skip silently if opted out).
    if (kind === 'marketing') {
      const { data: suppressed } = await supabase
        .from('email_unsubscribes')
        .select('id')
        .eq('org_id', orgId)
        .eq('email', recipient)
        .maybeSingle()
      if (suppressed) {
        console.log(`[sendTenantEmail] skipped — ${recipient} unsubscribed (org ${orgId})`)
        return { skipped: true }
      }
    }

    const { data: integrationRaw } = await supabase
      .from('tenant_email_integrations')
      .select('api_key_encrypted, default_from_name, default_from_email, default_reply_to, status')
      .eq('org_id', orgId)
      .eq('status', 'connected')
      .single()

    const integration = integrationRaw as {
      api_key_encrypted: string | null
      default_from_name: string | null
      default_from_email: string | null
      default_reply_to: string | null
      status: string
    } | null

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

    // Marketing email gets the compliance footer + List-Unsubscribe headers.
    let finalHtml = html
    let headers: Record<string, string> | undefined
    if (kind === 'marketing') {
      const { data: org } = await supabase
        .from('organizations')
        .select(
          'name, legal_name, address_line1, address_line2, address_city, address_state, address_postal_code, address_country',
        )
        .eq('id', orgId)
        .maybeSingle()
      const token = await signUnsubscribeToken(orgId, recipient)
      const unsubUrl = `${APP_ORIGIN}/unsubscribe/${token}`
      finalHtml = html + buildFooter(org, unsubUrl)
      headers = {
        'List-Unsubscribe': `<${APP_ORIGIN}/api/unsubscribe/${token}>, <${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      }
    }

    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      html: finalHtml,
      ...(opts?.text ? { text: opts.text } : {}),
      ...(resolvedReplyTo ? { reply_to: resolvedReplyTo } : {}),
      ...(headers ? { headers } : {}),
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
