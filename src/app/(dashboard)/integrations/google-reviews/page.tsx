import { formatDistanceToNow } from 'date-fns'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Quote,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
} from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { resolveOrgBranding } from '@/lib/branding'
import { createClient, getUser } from '@/lib/supabase/server'
import { decrypt, maskApiKey } from '@/lib/crypto'
import { BusinessSearch } from '@/components/reviews/business-search'
import { RefreshButton } from '@/components/reviews/refresh-button'
import { ReviewWidgetBuilder, type ReviewWidgetPreviewReview } from '@/components/reviews/review-widget-builder'
import { ReviewsSetupWizard } from '@/components/reviews/reviews-setup-wizard'
import { SerpApiKeyForm } from '@/components/reviews/serpapi-key-form'
import { StarRating } from '@/components/reviews/star-rating'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { SectionCard } from '@/components/integrations/section-card'
import { EmptyState } from '@/components/empty-states/empty-state'

export const dynamic = 'force-dynamic'

const PRODUCTION_ORIGIN = 'https://xphere.app'

function nextScrapeText(): string {
  const now = new Date()
  const next = new Date()
  next.setUTCHours(6, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  const diffMs = next.getTime() - now.getTime()
  const hours = Math.floor(diffMs / 3_600_000)
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

function StatusBadge({ status }: { status: string | null }) {
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
  if (!user) redirect('/')

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
  const { data: orgBranding } = await supabase
    .from('organizations')
    .select('accent_color')
    .eq('id', orgId as string)
    .maybeSingle()
  const brandAccent = resolveOrgBranding(orgBranding).accent

  // ── Setup wizard (not yet configured) ───────────────────────────────────
  if (!isConfigured) {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="Google Reviews"
          eyebrowIcon={Star}
          title="Google Reviews"
          description="Scrape your Google Business reviews daily via SerpAPI and serve them through an embeddable widget."
          back={{ href: '/integrations', label: 'All integrations' }}
        />

        <div className="flex w-full flex-col items-center justify-center gap-4 rounded-[12px] border border-dashed border-border bg-bg-secondary/40 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-tertiary ring-1 ring-border-subtle">
            <Star className="h-6 w-6 text-text-secondary" />
          </div>
          <div className="flex max-w-md flex-col gap-1.5">
            <h3 className="text-[15px] font-semibold text-text-primary">Set up Google Reviews</h3>
            <p className="text-[13px] text-text-secondary leading-relaxed">
              A quick 2-step setup: connect your SerpAPI key and pick your Google business. We&rsquo;ll
              handle the daily scrape and give you an embeddable widget.
            </p>
          </div>
          <ReviewsSetupWizard startStep={hasApiKey ? 2 : 1} currentHint={keyHint} />
        </div>
      </PageContainer>
    )
  }

  // ── Operational dashboard (configured) ──────────────────────────────────
  let recentReviews: {
    id: string
    reviewer_name: string | null
    rating: number
    text: string | null
    date_text: string | null
  }[] = []
  let widgetReviews: ReviewWidgetPreviewReview[] = []
  let distribution: { rating: number; count: number }[] = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    count: 0,
  }))
  if (profile?.id) {
    const [{ data }, { data: distRows }] = await Promise.all([
      supabase
        .from('google_reviews')
        .select('id, reviewer_name, reviewer_photo_url, reviewer_profile_url, rating, text, date_text, is_local_guide, helpful_count, owner_response, owner_response_date, google_review_photos(id, original_url, hetzner_url)')
        .eq('profile_id', profile.id)
        .eq('is_removed', false)
        .order('date_iso', { ascending: false, nullsFirst: false })
        .limit(18),
      supabase
        .from('google_reviews')
        .select('rating')
        .eq('profile_id', profile.id)
        .eq('is_removed', false),
    ])
    widgetReviews = (data ?? []).map((review) => ({
      id: review.id,
      reviewerName: review.reviewer_name,
      reviewerPhotoUrl: review.reviewer_photo_url,
      reviewerProfileUrl: review.reviewer_profile_url,
      rating: review.rating,
      text: review.text,
      dateText: review.date_text,
      isLocalGuide: review.is_local_guide,
      helpfulCount: review.helpful_count,
      ownerResponse: review.owner_response,
      ownerResponseDate: review.owner_response_date,
      photos: (review.google_review_photos ?? []).map((photo) => ({
        url: photo.hetzner_url ?? photo.original_url,
      })),
    }))
    recentReviews = widgetReviews.slice(0, 5).map((review) => ({
      id: review.id,
      reviewer_name: review.reviewerName,
      rating: review.rating,
      text: review.text,
      date_text: review.dateText,
    }))

    const distMap = new Map<number, number>([[5, 0], [4, 0], [3, 0], [2, 0], [1, 0]])
    for (const row of distRows ?? []) {
      distMap.set(row.rating, (distMap.get(row.rating) ?? 0) + 1)
    }
    distribution = [5, 4, 3, 2, 1].map((rating) => ({ rating, count: distMap.get(rating) ?? 0 }))
  }

  const nextIn = nextScrapeText()

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Google Reviews"
        eyebrowIcon={Star}
        title={profile?.business_name ?? 'Google Reviews'}
        description={profile?.address ?? 'Connected via SerpAPI'}
        back={{ href: '/integrations', label: 'All integrations' }}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={profile?.last_scrape_status ?? null} />
            <RefreshButton />
          </div>
        }
      />

      {/* ── Business stats ── */}
      <SectionCard
        icon={Star}
        title="Reviews overview"
        description="Live metrics from your Google Business profile."
        statusReady={true}
        readyLabel="Pipeline active"
        emptyLabel="-"
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Average rating</p>
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-3xl font-semibold tabular-nums">
                {profile?.average_rating?.toFixed(1) ?? '-'}
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
            <p className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Next scrape</p>
            <p className="text-[13px] font-medium text-text-primary">
              Daily · 06:00 UTC
            </p>
            <p className="text-[11.5px] text-text-tertiary">in {nextIn}</p>
          </div>
        </div>

        {profile?.last_scrape_error ? (
          <div className="flex items-start gap-2 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">{profile.last_scrape_error}</span>
          </div>
        ) : null}

        <div className="flex items-center gap-2 rounded-[10px] border border-border-subtle bg-bg-tertiary/50 px-3 py-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />
          <span className="text-[11.5px] text-text-secondary">
            Place ID:{' '}
            <span className="font-mono text-[10.5px] text-text-tertiary">{profile?.place_id}</span>
          </span>
        </div>
      </SectionCard>

      {/* ── Widget templates ── */}
      <SectionCard
        icon={Sparkles}
        title="Widget embed"
        description="Pick a layout, set the minimum rating and theme, then paste the snippet on your site."
        statusReady={Boolean(profile?.widget_token)}
        readyLabel="Snippet ready"
        emptyLabel="-"
      >
        {profile?.widget_token ? (
          <ReviewWidgetBuilder
            baseUrl={PRODUCTION_ORIGIN}
            widgetToken={profile.widget_token}
            embedded
            brandAccent={brandAccent}
            business={{
              name: profile.business_name,
              address: profile.address,
              averageRating: profile.average_rating,
              totalReviewsCount: profile.total_reviews_count,
            }}
            distribution={distribution}
            reviews={widgetReviews}
          />
        ) : null}
      </SectionCard>

      {/* ── Settings (collapsible) ── */}
      <Collapsible>
        <section className="rounded-[14px] border border-border bg-bg-secondary overflow-hidden">
          <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-6 text-left hover:bg-bg-tertiary/30 transition-colors">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary text-text-secondary">
                <Settings2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-[15px] font-medium text-text-primary">Settings</h2>
                <p className="mt-0.5 text-[12.5px] text-text-secondary">
                  API key · connected business · disconnect
                </p>
              </div>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="space-y-6 px-6 pb-6">
              <Separator />

              <div className="space-y-3">
                <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
                  SerpAPI key
                </p>
                <SerpApiKeyForm currentHint={keyHint} />
              </div>

              <Separator />

              <div className="space-y-3">
                <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
                  Connected business
                </p>
                <BusinessSearch
                  hasApiKey={hasApiKey}
                  currentPlaceId={profile?.place_id ?? null}
                />
              </div>
            </div>
          </CollapsibleContent>
        </section>
      </Collapsible>

      {/* ── Recent reviews ── */}
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
            No reviews captured yet — click <em>Refresh now</em> above to trigger a manual scrape.
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
                <p className="text-[13px] text-text-secondary line-clamp-3">{r.text ?? '-'}</p>
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
    </PageContainer>
  )
}
