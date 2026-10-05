import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MapPin } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { AddLocationDialog } from '@/components/local-seo/add-location-dialog'
import { LocationCard, type LocationCardData } from '@/components/local-seo/location-card'
import { QuotaMeter } from '@/components/local-seo/quota-meter'
import { Card, CardContent } from '@/components/ui/card'
import { getQuotaSnapshot } from '@/lib/local-seo/quota'
import { orgRedirect } from '@/lib/org/redirect'
import { can } from '@/lib/rbac/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient, getUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function LocalSeoPage() {
  const user = await getUser()
  if (!user) redirect('/')
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return orgRedirect('/dashboard')

  const [{ data: locations }, { data: keywords }, { data: scans }, { data: alerts }, canManage, quota] = await Promise.all([
    supabase
      .from('local_seo_locations')
      .select('id, name, business_name, address, rating, reviews_count, is_active, primary_category')
      .order('created_at', { ascending: true }),
    supabase.from('local_seo_keywords').select('location_id').eq('is_active', true),
    supabase
      .from('local_seo_scans')
      .select('location_id, keyword, status, solv, arp, finished_at, created_at')
      .in('status', ['completed', 'partial'])
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('local_seo_alerts').select('location_id').is('acknowledged_at', null).limit(1000),
    can('local_seo.manage'),
    getQuotaSnapshot(createServiceRoleClient(), orgId as string),
  ])

  const keywordCount = new Map<string, number>()
  for (const k of keywords ?? []) keywordCount.set(k.location_id, (keywordCount.get(k.location_id) ?? 0) + 1)

  const cards: LocationCardData[] = (locations ?? []).map((l) => {
    const own = (scans ?? []).filter((s) => s.location_id === l.id)
    // Latest finished scan per keyword, then averaged — one number per location.
    const latestByKeyword = new Map<string, (typeof own)[number]>()
    for (const s of own) if (!latestByKeyword.has(s.keyword)) latestByKeyword.set(s.keyword, s)
    const latest = [...latestByKeyword.values()]
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null).map(Number)
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null
    }
    // SoLV trend for the sparkline: oldest -> newest, all keywords mixed.
    const trend = own
      .slice(0, 20)
      .reverse()
      .map((s) => Number(s.solv ?? 0))
    return {
      id: l.id,
      name: l.name,
      businessName: l.business_name,
      address: l.address,
      category: l.primary_category,
      rating: l.rating,
      reviews: l.reviews_count,
      isActive: l.is_active,
      keywords: keywordCount.get(l.id) ?? 0,
      solv: avg(latest.map((s) => s.solv)),
      arp: avg(latest.map((s) => s.arp)),
      lastScanAt: own[0]?.finished_at ?? own[0]?.created_at ?? null,
      trend,
      openAlerts: (alerts ?? []).filter((a) => a.location_id === l.id).length,
    }
  })

  return (
    <PageContainer>
      <PageHeader
        title="Local SEO"
        actions={
          <>
            <QuotaMeter used={quota.used} limit={quota.limit} />
            {canManage && <AddLocationDialog />}
          </>
        }
      />

      {cards.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="rounded-full bg-accent/10 p-3">
              <MapPin className="h-6 w-6 text-accent" />
            </div>
            <h2 className="text-xl font-semibold">Track how you rank on Google Maps</h2>
            <p className="max-w-md text-sm text-text-secondary">
              Add a business, pick the keywords customers search for, and see its position from every corner of
              the neighbourhood on a geogrid map.
            </p>
            {canManage && <AddLocationDialog triggerLabel="Add your first location" />}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <Link key={c.id} href={`/local-seo/${c.id}`} className="block">
              <LocationCard data={c} />
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
