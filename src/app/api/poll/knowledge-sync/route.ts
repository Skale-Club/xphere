// GET /api/poll/knowledge-sync?connectionId=<uuid>
// Fingerprint of the latest Notion sync jobs for one connection, polled by the
// Global Knowledge manager. Platform-admin only (same gate as the page).

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { hasActiveSyncJob, syncJobsSignature } from '@/components/admin/global-knowledge/sync-signature'
import { isUuid, pollBadRequest, pollJson, pollUnauthorized } from '@/lib/polling/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return pollUnauthorized()
  if (!process.env.PLATFORM_ADMIN_EMAIL || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    return pollJson({ error: 'Forbidden' }, 403)
  }

  const connectionId = new URL(request.url).searchParams.get('connectionId')
  if (!isUuid(connectionId)) return pollBadRequest('Invalid connectionId')

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('global_knowledge_sync_jobs')
    .select('id, status, error_detail')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) return pollJson({ error: 'Query failed' }, 500)
  const jobs = data ?? []
  return pollJson({ signature: syncJobsSignature(jobs), active: hasActiveSyncJob(jobs) })
}
