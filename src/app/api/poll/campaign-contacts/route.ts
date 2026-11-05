// GET /api/poll/campaign-contacts?campaignId=<uuid>[&after=<updated_at>&afterId=<uuid>]
// Campaign contacts changed after a keyset cursor on (updated_at, id), oldest
// first. A bulk update gives thousands of rows one timestamp, so a bare
// `updated_at > x` cursor would skip everything past the page limit; the
// (updated_at, id) pair is a total order, so paging never skips or repeats.
// The route reads up to MAX_PAGES pages per call; `hasMore` tells the client to
// follow `cursor` right away. Member session, so RLS and the tab's org apply.

import { createClient, getUser } from '@/lib/supabase/server'
import { keysetAfterFilter, type ContactCursor } from '@/lib/campaigns/contact-cursor'
import { isSafeTimestamp, isUuid, pollBadRequest, pollJson, pollUnauthorized } from '@/lib/polling/route'
import type { Database } from '@/types/database'

type CampaignContactRow = Database['public']['Tables']['campaign_contacts']['Row']

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 500
const MAX_PAGES = 4

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return pollUnauthorized()

  const params = new URL(request.url).searchParams
  const campaignId = params.get('campaignId')
  if (!isUuid(campaignId)) return pollBadRequest('Invalid campaignId')
  const after = params.get('after')
  const afterId = params.get('afterId')
  let cursor: ContactCursor | null = null
  if (after !== null || afterId !== null) {
    if (!isSafeTimestamp(after) || !isUuid(afterId)) return pollBadRequest('Invalid cursor')
    cursor = { updatedAt: after, id: afterId }
  }

  const supabase = await createClient()
  const rows: CampaignContactRow[] = []
  let hasMore = false
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let query = supabase
      .from('campaign_contacts')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)
    if (cursor) query = query.or(keysetAfterFilter(cursor))
    const { data, error } = await query
    if (error) return pollJson({ error: 'Query failed' }, 500)
    const batch = data ?? []
    rows.push(...batch)
    const last = batch[batch.length - 1]
    if (last) cursor = { updatedAt: last.updated_at, id: last.id }
    hasMore = batch.length === PAGE_SIZE
    if (!hasMore) break
  }
  return pollJson({ rows, cursor: rows.length > 0 ? cursor : null, hasMore })
}
