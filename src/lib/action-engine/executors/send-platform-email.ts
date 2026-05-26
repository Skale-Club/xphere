// src/lib/action-engine/executors/send-platform-email.ts
// Action executor: send_platform_email
// Uses the platform-level Resend settings to send email.
// Should only be reachable by admin-level workflows.
// Registered in execute-action.ts

import { sendPlatformEmail } from '@/lib/email/resend'

export async function executeSendPlatformEmail(
  params: Record<string, unknown>
): Promise<string> {
  const to = String(params.to ?? '')
  const subject = String(params.subject ?? '')
  const html = String(params.html ?? params.body ?? '')

  if (!to) throw new Error('send_platform_email requires "to"')
  if (!subject) throw new Error('send_platform_email requires "subject"')
  if (!html) throw new Error('send_platform_email requires "html" or "body"')

  const result = await sendPlatformEmail(to, subject, html)

  if (result.error) throw new Error(`send_platform_email failed: ${result.error}`)
  return `Platform email sent. ID: ${result.id ?? 'unknown'}`
}
