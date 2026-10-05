import 'server-only'

// Daily Local SEO housekeeping.
//
// Retention (mandatory on the Supabase Free plan, SPEC 4.5): the full top-20
// per point is kept for RESULTS_RETENTION_DAYS. After that each point still
// has its rank and top 3, and every scan its competitor snapshot, so maps,
// trends and competitor history keep working — only the per-point drill-down
// into positions 4-20 goes away.
//
// Stuck scans: a scan still open long after creation is reported (not
// retried — same posture as the Ads engine) so obs alerts can surface it.

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

type Admin = SupabaseClient<Database>

export const RESULTS_RETENTION_DAYS = 60
const STUCK_AFTER_MS = 3 * 60 * 60_000

export async function pruneSerpResults(admin: Admin, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RESULTS_RETENTION_DAYS * 86_400_000).toISOString()
  const { count, error } = await admin
    .from('local_seo_serp_results')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)
  if (error) throw new Error(`retention delete failed: ${error.message}`)
  return count ?? 0
}

export async function findStuckScans(admin: Admin, now = new Date()): Promise<{ id: string; org_id: string; created_at: string }[]> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS).toISOString()
  const { data } = await admin
    .from('local_seo_scans')
    .select('id, org_id, created_at')
    .in('status', ['queued', 'running'])
    .lt('created_at', cutoff)
    .limit(50)
  return data ?? []
}
