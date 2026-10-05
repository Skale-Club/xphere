import { VisibilityPanel } from '@/components/local-seo/visibility-panel'
import { guessArea } from '@/lib/local-seo/citations'
import { can } from '@/lib/rbac/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocationVisibilityPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const supabase = await createClient()
  const [{ data: location }, { data: citations }, { data: ai }, canManage] = await Promise.all([
    supabase.from('local_seo_locations').select('address').eq('id', locationId).maybeSingle(),
    supabase
      .from('local_seo_citation_checks')
      .select('run_id, directory, domain, found, url, listed_name, name_match, phone_match, address_match, error, checked_at')
      .eq('location_id', locationId)
      .order('checked_at', { ascending: false })
      .limit(80),
    supabase
      .from('local_seo_ai_checks')
      .select('run_id, prompt, model, mentioned, position, competitors, excerpt, error, checked_at')
      .eq('location_id', locationId)
      .order('checked_at', { ascending: false })
      .limit(120),
    can('local_seo.manage'),
  ])
  const latestCitationRun = citations?.[0]?.run_id
  const latestAiRun = ai?.[0]?.run_id
  // Mention rate per AI run, oldest first, for the trend line.
  const runs = new Map<string, { at: string; mentioned: number; total: number }>()
  for (const r of ai ?? []) {
    const cur = runs.get(r.run_id) ?? { at: r.checked_at, mentioned: 0, total: 0 }
    cur.total++
    if (r.mentioned) cur.mentioned++
    runs.set(r.run_id, cur)
  }
  return (
    <div className="px-4 py-6 sm:px-6">
      <VisibilityPanel
        locationId={locationId}
        canManage={canManage}
        defaultArea={guessArea(location?.address ?? null)}
        citations={(citations ?? []).filter((c) => c.run_id === latestCitationRun)}
        ai={(ai ?? []).filter((a) => a.run_id === latestAiRun)}
        aiHistory={[...runs.values()].reverse()}
      />
    </div>
  )
}
