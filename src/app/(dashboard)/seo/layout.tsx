import { redirect } from 'next/navigation'

import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { SeoNoAccess } from '@/components/seo/section-gate'
import { SeoSubNav, SeoSubNavCollapsed, type SeoNavLocation, type SeoNavSite } from '@/components/seo/seo-sub-nav'
import { can } from '@/lib/rbac/server'
import { getSeoSections } from '@/lib/seo/sections.server'
import { createClient, getUser } from '@/lib/supabase/server'

// Website audits, Local SEO, Reviews and their reports live under one sidebar
// item. Each area keeps its own permission + billing feature (see
// src/lib/seo/sections.ts): this layout only lists the reachable ones in the
// sub-sidebar, and each area's own layout gates its routes.
export default async function SeoLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  const sections = await getSeoSections()
  if (sections.length === 0) {
    return <SeoNoAccess title="No access to SEO" detail="Ask an admin of this organization to grant you access to SEO, Local SEO or Reviews." />
  }
  const keys = sections.map((s) => s.key)
  const supabase = await createClient()

  const [sites, locations, canManageSites, canManageLocations] = await Promise.all([
    keys.includes('website') ? loadSites(supabase) : Promise.resolve([]),
    keys.includes('local') ? loadLocations(supabase) : Promise.resolve([]),
    keys.includes('website') ? can('seo.manage') : Promise.resolve(false),
    keys.includes('local') ? can('local_seo.manage') : Promise.resolve(false),
  ])

  return (
    // No `autoCollapseBasePath`: the list stays visible inside a site or a
    // location so the user can switch between them.
    <SubSidebarLayout
      storageKey="sub-sidebar:seo"
      title="SEO"
      nav={
        <SeoSubNav
          sections={keys}
          sites={sites}
          locations={locations}
          canManageSites={canManageSites}
          canManageLocations={canManageLocations}
        />
      }
      collapsedActions={<SeoSubNavCollapsed sections={keys} />}
    >
      {children}
    </SubSidebarLayout>
  )
}

type Supabase = Awaited<ReturnType<typeof createClient>>

async function loadSites(supabase: Supabase): Promise<SeoNavSite[]> {
  const { data: sites } = await supabase.from('seo_sites').select('id, name').order('created_at', { ascending: true })
  if (!sites?.length) return []
  // Newest completed audit per site carries the score shown next to it.
  const { data: audits } = await supabase
    .from('seo_audits')
    .select('site_id, health_score')
    .in('site_id', sites.map((s) => s.id))
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(sites.length * 6)
  const score = new Map<string, number | null>()
  for (const a of audits ?? []) if (!score.has(a.site_id)) score.set(a.site_id, a.health_score)
  return sites.map((s) => ({ id: s.id, name: s.name, score: score.get(s.id) ?? null }))
}

async function loadLocations(supabase: Supabase): Promise<SeoNavLocation[]> {
  const [{ data: locations }, { data: alerts }] = await Promise.all([
    supabase.from('local_seo_locations').select('id, name, is_active').order('created_at', { ascending: true }),
    supabase.from('local_seo_alerts').select('location_id').is('acknowledged_at', null).limit(1000),
  ])
  return (locations ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    isActive: l.is_active,
    openAlerts: (alerts ?? []).filter((a) => a.location_id === l.id).length,
  }))
}
