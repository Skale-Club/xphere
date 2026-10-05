// Workflow action: start Local SEO geogrid scans. Goes through createScan, so
// the points quota, the kill switch and the daily platform cap apply exactly
// as in the dashboard. Results arrive asynchronously (event:local_seo.*).

import { createScan } from '@/lib/local-seo/scans'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export async function executeLocalSeoRunScan(
  params: Record<string, unknown>,
  ctx: { organizationId: string },
): Promise<string> {
  const locationId = typeof params.location_id === 'string' ? params.location_id : ''
  if (!locationId) throw new Error('local_seo_run_scan: location_id is required')
  const admin = createServiceRoleClient()

  let keywordIds: string[]
  if (typeof params.keyword_id === 'string' && params.keyword_id) {
    keywordIds = [params.keyword_id]
  } else {
    const { data } = await admin
      .from('local_seo_keywords')
      .select('id')
      .eq('org_id', ctx.organizationId)
      .eq('location_id', locationId)
      .eq('is_active', true)
    keywordIds = (data ?? []).map((k) => k.id)
    if (!keywordIds.length) throw new Error('local_seo_run_scan: the location has no active keywords')
  }

  const gridSize = typeof params.grid_size === 'number' ? params.grid_size : undefined
  const scanIds: string[] = []
  for (const keywordId of keywordIds) {
    const res = await createScan(admin, {
      orgId: ctx.organizationId,
      locationId,
      keywordId,
      gridSize,
      triggeredBy: 'workflow',
    })
    if (!res.ok) {
      if (scanIds.length) return JSON.stringify({ ok: true, scan_ids: scanIds, stopped: res.error })
      throw new Error(`local_seo_run_scan: ${res.error}`)
    }
    scanIds.push(res.scanId)
  }
  return JSON.stringify({ ok: true, scan_ids: scanIds })
}
