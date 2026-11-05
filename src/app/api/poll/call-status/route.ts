// GET /api/poll/call-status?sid=<call sid>
// Current status of one call from call_logs (updated by the Twilio status
// webhook). `{ status: null }` while the row does not exist yet.
// Member session, so RLS and the tab's org header apply.

import { createClient, getUser } from '@/lib/supabase/server'
import { pollBadRequest, pollJson, pollUnauthorized } from '@/lib/polling/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return pollUnauthorized()

  const sid = new URL(request.url).searchParams.get('sid')
  if (!sid || sid.length > 64) return pollBadRequest('Invalid sid')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('call_logs')
    .select('status, duration_seconds')
    .eq('call_sid', sid)
    .maybeSingle()
  if (error) return pollJson({ error: 'Query failed' }, 500)
  if (!data) return pollJson({ status: null, durationSeconds: null })
  return pollJson({
    status: data.status ?? null,
    durationSeconds: typeof data.duration_seconds === 'number' ? data.duration_seconds : null,
  })
}
