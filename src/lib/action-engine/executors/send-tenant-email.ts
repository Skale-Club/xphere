// src/lib/action-engine/executors/send-tenant-email.ts
// Action executor: send_tenant_email
// Uses the org's Resend integration credentials to send email.
// Registered in execute-action.ts

import { sendTenantEmail, type EmailKind } from '@/lib/email/resend'

export async function executeSendTenantEmail(
  params: Record<string, unknown>,
  orgId: string
): Promise<string> {
  const to = String(params.to ?? '')
  const subject = String(params.subject ?? '')
  const html = String(params.html ?? params.body ?? '')
  const replyTo = params.reply_to ? String(params.reply_to) : undefined
  // Default to transactional (CAN-SPAM safe default — matches sendTenantEmail).
  // Marketing/outreach must opt in with kind:'marketing' so it gets the
  // compliance footer + unsubscribe and honours the suppression list. Defaulting
  // to marketing would silently suppress booking confirmations/receipts for
  // anyone who opted out of marketing.
  const kind: EmailKind = params.kind === 'marketing' ? 'marketing' : 'transactional'

  if (!to) return 'send_tenant_email skipped: no recipient email address'
  if (!subject) throw new Error('send_tenant_email requires "subject"')
  if (!html) throw new Error('send_tenant_email requires "html" or "body"')

  const result = await sendTenantEmail(orgId, to, subject, html, replyTo, { kind })

  if (result.error) throw new Error(`send_tenant_email failed: ${result.error}`)
  if (result.skipped) return `Email skipped — ${to} has unsubscribed.`
  return `Email sent. ID: ${result.id ?? 'unknown'}`
}
