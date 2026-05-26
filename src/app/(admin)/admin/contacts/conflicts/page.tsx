import { createServiceRoleClient } from '@/lib/supabase/admin'
import { ClusterCard } from './_components/cluster-card'
import { refreshAudit } from './_actions/conflicts'
import { Button } from '@/components/ui/button'
import { RefreshCw, GitMerge } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface ContactSummary {
  id: string
  org_id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  phone_e164: string | null
  email: string | null
  email_normalized: string | null
  source: string | null
  created_at: string
}

export interface ClusterRow {
  cluster_id: string
  org_id: string
  match_type: 'phone' | 'email'
  normalized_value: string
  contact_ids: string[]
  cluster_size: number
  detected_at: string
  contacts: ContactSummary[]
}

async function loadClusters(): Promise<{ clusters: ClusterRow[]; lastRefreshIso: string | null }> {
  const svc = createServiceRoleClient()

  const { data: rawClusters, error: cErr } = await svc
    .from('contact_duplicate_audit')
    .select('cluster_id, org_id, match_type, normalized_value, contact_ids, cluster_size, detected_at')
    .order('cluster_size', { ascending: false })
    .order('detected_at', { ascending: true })
  if (cErr) throw new Error(`Load clusters: ${cErr.message}`)
  const clusters = (rawClusters ?? []) as Array<{
    cluster_id: string
    org_id: string
    match_type: 'phone' | 'email'
    normalized_value: string
    contact_ids: string[]
    cluster_size: number
    detected_at: string
  }>

  let lastRefreshIso: string | null = null
  if (clusters.length > 0) {
    lastRefreshIso = clusters
      .map((c) => c.detected_at)
      .sort()
      .reverse()[0] ?? null
  }

  if (clusters.length === 0) {
    return { clusters: [], lastRefreshIso }
  }

  const allIds = Array.from(new Set(clusters.flatMap((c) => c.contact_ids)))
  const { data: contactsRaw, error: csErr } = await svc
    .from('contacts')
    .select('id, org_id, name, first_name, last_name, phone, phone_e164, email, email_normalized, source, created_at')
    .in('id', allIds)
  if (csErr) throw new Error(`Load contacts: ${csErr.message}`)

  const byId = new Map<string, ContactSummary>(
    (contactsRaw ?? []).map((c) => [c.id, c as ContactSummary]),
  )
  const enriched: ClusterRow[] = clusters.map((c) => ({
    ...c,
    contacts: c.contact_ids
      .map((id) => byId.get(id))
      .filter((x): x is ContactSummary => Boolean(x)),
  }))

  return { clusters: enriched, lastRefreshIso }
}

export default async function ConflictsPage() {
  const { clusters, lastRefreshIso } = await loadClusters()

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Duplicate Conflicts</h1>
          <p className="text-sm text-text-secondary mt-1">
            {clusters.length} cluster{clusters.length === 1 ? '' : 's'} detected
          </p>
        </div>
        <form action={refreshAudit}>
          <Button type="submit" variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh audit
          </Button>
        </form>
      </div>

      {clusters.length === 0 ? (
        <EmptyState lastRefreshIso={lastRefreshIso} />
      ) : (
        <div className="space-y-4">
          {clusters.map((c) => (
            <ClusterCard key={c.cluster_id} cluster={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ lastRefreshIso }: { lastRefreshIso: string | null }) {
  const refreshLabel = lastRefreshIso
    ? `Last refreshed ${new Date(lastRefreshIso).toLocaleString()}`
    : 'Audit has not been refreshed yet'
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-border-subtle bg-bg-secondary px-6 py-16 text-center">
      <GitMerge className="h-10 w-10 text-text-tertiary mb-3" />
      <h2 className="text-base font-medium text-text-primary">No duplicate contacts detected</h2>
      <p className="text-sm text-text-secondary mt-1">
        Click <span className="font-medium">Refresh audit</span> to scan for clusters.
      </p>
      <p className="text-xs text-text-tertiary mt-3">{refreshLabel}</p>
    </div>
  )
}
