import { reconcileTwilioInboundSms } from '@/lib/twilio/reconcile-sms'
import { captureApiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CRON_SECRET = process.env.CRON_SECRET ?? process.env.OPERATOR_AUTOMATION_SECRET

function unauthorized() {
  return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

function parsePositiveInt(value: string | null, fallback: number, max: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

export async function GET(request: Request) {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${CRON_SECRET}`) return unauthorized()
  }

  const url = new URL(request.url)
  const lookbackMinutes = parsePositiveInt(url.searchParams.get('lookbackMinutes'), 120, 24 * 60)
  const maxPagesPerNumber = parsePositiveInt(url.searchParams.get('maxPagesPerNumber'), 3, 20)
  const orgId = url.searchParams.get('orgId') ?? undefined
  const phoneNumberId = url.searchParams.get('phoneNumberId') ?? undefined
  const autoReply = url.searchParams.get('autoReply') !== 'false'

  try {
    const result = await reconcileTwilioInboundSms({
      orgId,
      phoneNumberId,
      lookbackMinutes,
      maxPagesPerNumber,
      autoReply,
    })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[twilio-sms-reconcile] failed:', err)
    captureApiError(err)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
