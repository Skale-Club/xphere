// src/lib/action-engine/executors/send-tenant-email.ts
// Action executor: send_tenant_email
// Uses the org's Resend integration credentials to send email.
// Registered in execute-action.ts

import { sendTenantEmail } from '@/lib/email/resend'

export async function executeSendTenantEmail(
  params: Record<string, unknown>,
  orgId: string
): Promise<string> {
  const to = String(params.to ?? '')
  const subject = String(params.subject ?? '')
  const html = String(params.html ?? params.body ?? '')
  const replyTo = params.reply_to ? String(params.reply_to) : undefined

  if (!to) throw new Error('send_tenant_email requires "to"')
  if (!subject) throw new Error('send_tenant_email requires "subject"')
  if (!html) throw new Error('send_tenant_email requires "html" or "body"')

  const result = await sendTenantEmail(orgId, to, subject, html, replyTo)

  if (result.error) throw new Error(`send_tenant_email failed: ${result.error}`)
  return `Email sent. ID: ${result.id ?? 'unknown'}`
}
