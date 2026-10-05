import { ReportManager } from '@/components/local-seo/report-manager'
import { REPORT_SECTIONS, type ReportSection } from '@/lib/local-seo/report-sections'
import { PageContainer } from '@/components/layout/page-header'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocalSeoReportsPage() {
  const supabase = await createClient()
  const [{ data: reports }, { data: shares }, { data: locations }, canManage] = await Promise.all([
    supabase.from('local_seo_reports').select('*').order('created_at', { ascending: true }),
    supabase
      .from('local_seo_report_shares')
      .select('id, report_id, token_hint, expires_at, revoked_at, view_count, last_viewed_at, created_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('local_seo_locations').select('id, name').order('created_at', { ascending: true }),
    can('local_seo.manage'),
  ])
  const now = new Date().toISOString()
  return (
    <PageContainer>
      <ReportManager
        canManage={canManage}
        locations={locations ?? []}
        reports={(reports ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          locationIds: r.location_ids,
          periodDays: r.period_days as 7 | 30 | 90,
          sections: r.sections.filter((x): x is ReportSection => (REPORT_SECTIONS as readonly string[]).includes(x)),
          intro: r.intro,
          schedule: r.schedule,
          sendDay: r.send_day,
          recipients: r.recipients,
          lastSentAt: r.last_sent_at,
          lastError: r.last_error,
          links: (shares ?? [])
            .filter((s) => s.report_id === r.id && (!s.expires_at || s.expires_at > now))
            .map((s) => ({ id: s.id, hint: s.token_hint, expiresAt: s.expires_at, views: s.view_count, lastViewedAt: s.last_viewed_at })),
        }))}
      />
    </PageContainer>
  )
}
