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
  // Workflow-driven tenant email is marketing/outreach by default (gets the
  // compliance footer + unsubscribe). Pass kind:'transactional' to opt out for
  // receipts/confirmations.
  const kind: EmailKind = params.kind === 'transactional' ? 'transactional' : 'marketing'

  if (!to) throw new Error('send_tenant_email requires "to"')
  if (!subject) throw new Error('send_tenant_email requires "subject"')
  if (!html) throw new Error('send_tenant_email requires "html" or "body"')

  const result = await sendTenantEmail(orgId, to, subject, html, replyTo, { kind })

  if (result.error) throw new Error(`send_tenant_email failed: ${result.error}`)
  if (result.skipped) return `Email skipped — ${to} has unsubscribed.`
  return `Email sent. ID: ${result.id ?? 'unknown'}`
}
