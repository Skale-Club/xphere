import { AuditPanel } from '@/components/local-seo/audit-panel'
import type { AuditCheck, Pillar } from '@/lib/local-seo/audit-checks'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocationAuditPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const supabase = await createClient()
  const [{ data: audits }, canManage] = await Promise.all([
    supabase
      .from('local_seo_audits')
      .select('id, score, pillar_scores, checks, created_at, tasks_created_at')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(12),
    can('local_seo.manage'),
  ])
  const latest = audits?.[0] ?? null
  return (
    <div className="px-4 py-6 sm:px-6">
      <AuditPanel
        key={latest?.id ?? 'none'}
        locationId={locationId}
        canManage={canManage}
        audit={
          latest
            ? {
                id: latest.id,
                score: latest.score,
                pillars: latest.pillar_scores as unknown as Record<Pillar, number | null>,
                checks: latest.checks as unknown as AuditCheck[],
                createdAt: latest.created_at,
                tasksCreatedAt: latest.tasks_created_at,
              }
            : null
        }
        history={(audits ?? []).map((a) => ({ id: a.id, score: a.score, createdAt: a.created_at }))}
      />
    </div>
  )
}
