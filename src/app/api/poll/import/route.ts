// GET /api/poll/import?id=<uuid>
// Progress row of one contact import. Member session, so RLS and the tab's org
// header apply.

import { createClient, getUser } from '@/lib/supabase/server'
import { isUuid, pollBadRequest, pollJson, pollUnauthorized } from '@/lib/polling/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return pollUnauthorized()

  const id = new URL(request.url).searchParams.get('id')
  if (!isUuid(id)) return pollBadRequest('Invalid id')

  const supabase = await createClient()
  const { data, error } = await supabase.from('contact_imports').select('*').eq('id', id).maybeSingle()
  if (error) return pollJson({ error: 'Query failed' }, 500)
  if (!data) return pollJson({ error: 'Not found' }, 404)
  return pollJson({ import: data })
}
