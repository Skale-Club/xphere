import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  KeyRound,
  MapPin,
  Quote,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
} from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import { decrypt, maskApiKey } from '@/lib/crypto'
import { BusinessSearch } from '@/components/reviews/business-search'
import { EmbedSnippet } from '@/components/reviews/embed-snippet'
import { RefreshButton } from '@/components/reviews/refresh-button'
import { SerpApiKeyForm } from '@/components/reviews/serpapi-key-form'
import { StarRating } from '@/components/reviews/star-rating'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { SectionCard } from '@/components/integrations/section-card'
import { EmptyState } from '@/components/empty-states/empty-state'

export const dynamic = 'force-dynamic'

const PRODUCTION_ORIGIN = 'https://xphere.app'

function statusBadge(status: string | null) {
  if (!status) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock className="h-3 w-3" />
        Never scraped
      </Badge>
    )
  }
  if (status === 'success') {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" />
        Healthy
      </Badge>
    )
  }
  if (status === 'quota_exceeded') {
    return (
      <Badge className="gap-1 bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300">
        <AlertCircle className="h-3 w-3" />
        Quota exceeded
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertCircle className="h-3 w-3" />
      Error
    </Badge>
  )
}

export default async function GoogleReviewsIntegrationPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="Google Reviews"
          eyebrowIcon={Star}
          title="Google Reviews"
          description="Choose an organization before configuring this integration."
          back={{ href: '/integrations', label: 'All integrations' }}
        />
        <EmptyState
          icon={Star}
          title="No active organization selected"
          description="Switch to an organization from the sidebar to continue."
        />
      </PageContainer>
    )
  }

  const { data: profile } = await supabase
    .from('google_business_profiles')
    .select(
      'id, place_id, business_name, address, serpapi_key_encrypted, scrape_interval_hours, last_scraped_at, last_scrape_status, last_scrape_error, total_reviews_count, average_rating, is_active, widget_token'
    )
    .maybeSingle()

  let keyHint: string | null = null
  if (profile?.serpapi_key_encrypted) {
    try {
      keyHint = maskApiKey(await decrypt(profile.serpapi_key_encrypted))
    } catch {
      keyHint = null
    }
  }

  const hasApiKey = Boolean(profile?.serpapi_key_encrypted)
  const isConfigured = Boolean(profile?.is_active && profile?.place_id && profile?.place_id !== '__pending__')

  let recentReviews: {
    id: string
    reviewer_name: string | null
    rating: number
    text: string | null
    date_text: string | null
  }[] = []
  if (profile?.id) {
    const { data } = await supabase
      .from('google_reviews')
      .select('id, reviewer_name, rating, text, date_text')
      .eq('profile_id', profile.id)
      .eq('is_removed', false)
      .order('date_iso', { ascending: false, nullsFirst: false })
      .limit(5)
    recentReviews = data ?? []
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Google Reviews"
        eyebrowIcon={Star}
        title="Google Reviews"
        description="Scrape your Google Business reviews daily via SerpAPI and serve them through an embeddable widget."
        back={{ href: '/integrations', label: 'All integrations' }}
        actions={
          isConfigured ? (
            <div className="flex items-center gap-2">
              {statusBadge(profile?.last_scrape_status ?? null)}
              <RefreshButton />
            </div>
          ) : null
        }
      />

      <SectionCard
        icon={KeyRound}
        title="Step 1 · SerpAPI key"
        description="Each org connects its own free SerpAPI account — 100 searches/month at no cost."
        statusReady={hasApiKey}
        readyLabel="Key saved"
        emptyLabel="Key missing"
        helpLinks={[{ label: 'Get a free SerpAPI key', href: 'https://serpapi.com/manage-api-key' }]}
      >
        <SerpApiKeyForm currentHint={keyHint} />
      </SectionCard>

      <SectionCard
        icon={MapPin}
        title="Step 2 · Find your business"
        description="Search Google Maps to lock in the correct Place ID for review scraping."
        statusReady={isConfigured}
        readyLabel="Business selected"
        emptyLabel="Not selected"
      >
        <BusinessSearch
          hasApiKey={hasApiKey}
          currentPlaceId={isConfigured ? profile?.place_id ?? null : null}
        />
        {isConfigured ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-success/30 bg-success/5 px-3 py-2 text-[12px]">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            <span className="text-text-primary">
              Connected to <strong>{profile?.business_name}</strong>
            </span>
            <span className="font-mono text-[10.5px] text-text-tertiary">
              {profile?.place_id}
            </span>
          </div>
        ) : null}
      </SectionCard>

      {isConfigured ? (
        <>
          <SectionCard
            icon={TrendingUp}
            title="Status"
            description="Live snapshot of your reviews pipeline."
            statusReady={true}
            readyLabel="Pipeline healthy"
            emptyLabel="—"
          >
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <p className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Average rating</p>
                <div className="flex items-baseline gap-2">
                  <span className="font-serif text-3xl font-semibold tabular-nums">
                    {profile?.average_rating?.toFixed(1) ?? '—'}
                  </span>
                  <StarRating rating={profile?.average_rating ?? 0} size="md" />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Total reviews</p>
                <p className="font-serif text-3xl font-semibold tabular-nums">
                  {profile?.total_reviews_count ?? 0}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Last scrape</p>
                <p className="text-[13px] font-medium text-text-primary">
                  {profile?.last_scraped_at
                    ? `${formatDistanceToNow(new Date(profile.last_scraped_at))} ago`
                    : 'Never'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Cadence</p>
                <p className="text-[13px] font-medium text-text-primary">
                  Every {profile?.scrape_interval_hours ?? 24} h
                </p>
              </div>
            </div>
            {profile?.last_scrape_error ? (
              <div className="flex items-start gap-2 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="break-words">{profile.last_scrape_error}</span>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            icon={Quote}
            title="Recent reviews"
            description="Last 5 captured from Google."
            statusReady={recentReviews.length > 0}
            readyLabel={`${recentReviews.length} on file`}
            emptyLabel="Awaiting first scrape"
          >
            {recentReviews.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-border bg-bg-secondary/40 p-6 text-center text-[13px] text-text-secondary">
                No reviews captured yet — click <em>Refresh now</em> above.
              </div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {recentReviews.map((r) => (
                  <li key={r.id} className="grid gap-2 py-3 sm:grid-cols-[160px_1fr]">
                    <div>
                      <p className="text-[13px] font-medium text-text-primary">{r.reviewer_name ?? 'Anonymous'}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <StarRating rating={r.rating} size="sm" />
                        {r.date_text ? (
                          <span className="text-[11px] text-text-tertiary">{r.date_text}</span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-[13px] text-text-secondary line-clamp-3">{r.text ?? '—'}</p>
                  </li>
                ))}
              </ul>
            )}
            <Separator className="my-3" />
            <Link
              href="/reviews"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-accent underline-offset-4 hover:underline"
            >
              Open reviews dashboard
              <ExternalLink className="h-3 w-3" />
            </Link>
          </SectionCard>

          <SectionCard
            icon={Sparkles}
            title="Step 3 · Embed on your site"
            description="Drop this <iframe> anywhere — no script tags, no API keys exposed."
            statusReady={Boolean(profile?.widget_token)}
            readyLabel="Snippet ready"
            emptyLabel="—"
          >
            {profile?.widget_token ? (
              <EmbedSnippet baseUrl={PRODUCTION_ORIGIN} widgetToken={profile.widget_token} />
            ) : null}
          </SectionCard>
        </>
      ) : (
        <EmptyState
          icon={Star}
          title="Almost there"
          description="Save your SerpAPI key and pick your business above to unlock the daily scrape and embeddable widget."
        />
      )}
    </PageContainer>
  )
}
