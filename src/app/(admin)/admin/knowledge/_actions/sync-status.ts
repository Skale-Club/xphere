'use server'

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  hasActiveSyncJob,
  syncJobsSignature,
} from '@/components/admin/global-knowledge/sync-signature'

export interface GlobalKnowledgeSyncStatus {
  signature: string
  active: boolean
}

/**
 * Fingerprint of the latest sync jobs for one Notion connection, polled by the
 * Global Knowledge manager. Platform-admin only (same gate as the page); returns
 * null for anyone else or when the read fails, so the caller just keeps polling.
 */
export async function getGlobalKnowledgeSyncStatus(
  connectionId: string,
): Promise<GlobalKnowledgeSyncStatus | null> {
  const user = await getUser()
  if (!user || !process.env.PLATFORM_ADMIN_EMAIL || user.email !== process.env.PLATFORM_ADMIN_EMAIL) {
    return null
  }
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('global_knowledge_sync_jobs')
    .select('id, status, error_detail')
    .eq('connection_id', connectionId)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) return null
  const jobs = data ?? []
  return { signature: syncJobsSignature(jobs), active: hasActiveSyncJob(jobs) }
}
