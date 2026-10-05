// Workflow action: queue a technical SEO audit for a site in the SEO module.
//
// Asynchronous by design — the crawl runs in the seo-tick cron and can take
// minutes — so this only queues it and returns the audit id. Chain work on the
// result with an event:seo.audit_completed workflow. An audit already running
// for the site is returned instead of failing, so re-running is safe.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { queueAudit, SeoServiceError } from '@/lib/seo/service'

export async function executeSeoRunAudit(
  params: Record<string, unknown>,
  ctx: { organizationId: string; supabase: SupabaseClient<Database> },
): Promise<string> {
  const site = typeof params.site === 'string' ? params.site.trim() : ''
  if (!site) throw new Error('seo_run_audit: "site" is required (site id, host or URL of a site added in SEO)')
  try {
    const result = await queueAudit(ctx.supabase, ctx.organizationId, site, 'workflow')
    return JSON.stringify({ ok: true, ...result })
  } catch (err) {
    if (err instanceof SeoServiceError) throw new Error(`seo_run_audit: ${err.message}`)
    throw err
  }
}
