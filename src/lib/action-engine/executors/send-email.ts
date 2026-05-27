import { sendPlatformEmail } from '@/lib/email/resend'

export async function executeSendEmail(
  params: Record<string, unknown>,
): Promise<string> {
  const to = String(params.to ?? '')
  const subject = String(params.subject ?? '')
  const body = String(params.body ?? '')

  if (!to) throw new Error('send_email requires "to"')
  if (!subject) throw new Error('send_email requires "subject"')
  if (!body) throw new Error('send_email requires "body"')

  const result = await sendPlatformEmail(to, subject, body)
  if (result.error) throw new Error(`send_email failed: ${result.error}`)
  return `Email sent. ID: ${result.id ?? 'unknown'}`
}
