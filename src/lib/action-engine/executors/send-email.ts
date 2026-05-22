import { Resend } from 'resend'

export async function executeSendEmail(
  params: Record<string, unknown>,
): Promise<string> {
  const to = String(params.to ?? '')
  const subject = String(params.subject ?? '')
  const body = String(params.body ?? '')
  const fromName = params.from_name ? String(params.from_name) : undefined

  if (!to) throw new Error('send_email requires "to"')
  if (!subject) throw new Error('send_email requires "subject"')
  if (!body) throw new Error('send_email requires "body"')

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[send_email] RESEND_API_KEY not set; email not sent')
    return 'Email not sent: RESEND_API_KEY not configured'
  }

  const resend = new Resend(apiKey)
  const from = fromName
    ? `${fromName} <${process.env.RESEND_FROM_EMAIL ?? 'notifications@xphere.app'}>`
    : process.env.RESEND_FROM ?? 'Xphere <notifications@xphere.app>'

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html: body,
  })

  if (error) throw new Error(`send_email failed: ${error.message}`)
  return `Email sent. ID: ${data?.id ?? 'unknown'}`
}
