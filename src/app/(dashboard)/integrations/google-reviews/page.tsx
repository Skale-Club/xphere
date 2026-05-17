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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export const dynamic = 'force-dynamic'

const PRODUCTION_ORIGIN = 'https://operator.skale.club'

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
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>Choose an organization before configuring this integration.</CardDescription>
          </CardHeader>
        </Card>
      </div>
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
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/integrations"
            className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            ← Integrations
          </Link>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">Google Reviews</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Scrape your Google Business reviews daily via SerpAPI and serve them through a beautiful embeddable widget.
          </p>
        </div>
        {isConfigured ? (
          <div className="flex items-center gap-2">
            {statusBadge(profile?.last_scrape_status ?? null)}
            <RefreshButton />
          </div>
        ) : null}
      </div>

      {/* Card 1 — SerpAPI key */}
      <Card className="overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-300 via-amber-500 to-orange-500" />
        <CardHeader className="relative">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900/40">
              <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-300" />
            </div>
            <div>
              <CardTitle className="text-base">Step 1 · SerpAPI Key</CardTitle>
              <CardDescription className="mt-0.5">
                Each org connects its own free SerpAPI account — 100 searches/month at no cost.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <SerpApiKeyForm currentHint={keyHint} />
        </CardContent>
      </Card>

      {/* Card 2 — Business search */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-sky-100 p-2 dark:bg-sky-900/40">
              <MapPin className="h-4 w-4 text-sky-600 dark:text-sky-300" />
            </div>
            <div>
              <CardTitle className="text-base">Step 2 · Find your business</CardTitle>
              <CardDescription className="mt-0.5">
                Search Google Maps to lock in the correct Place ID.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <BusinessSearch
            hasApiKey={hasApiKey}
            currentPlaceId={isConfigured ? profile?.place_id ?? null : null}
          />
          {isConfigured ? (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200/60 bg-emerald-50/50 px-3 py-2 text-xs dark:border-emerald-900/40 dark:bg-emerald-900/10">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-emerald-900 dark:text-emerald-200">
                Connected to <strong>{profile?.business_name}</strong>
              </span>
              <span className="font-mono text-[10px] text-emerald-700/70 dark:text-emerald-300/70">
                {profile?.place_id}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {isConfigured ? (
        <>
          {/* Card 3 — Status panel */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900/40">
                  <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                </div>
                <div>
                  <CardTitle className="text-base">Status</CardTitle>
                  <CardDescription className="mt-0.5">Live snapshot of your reviews pipeline.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Average rating</p>
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-3xl font-semibold tabular-nums">
                      {profile?.average_rating?.toFixed(1) ?? '—'}
                    </span>
                    <StarRating rating={profile?.average_rating ?? 0} size="md" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Total reviews</p>
                  <p className="font-serif text-3xl font-semibold tabular-nums">
                    {profile?.total_reviews_count ?? 0}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Last scrape</p>
                  <p className="text-sm font-medium">
                    {profile?.last_scraped_at
                      ? `${formatDistanceToNow(new Date(profile.last_scraped_at))} ago`
                      : 'Never'}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Cadence</p>
                  <p className="text-sm font-medium">
                    Every {profile?.scrape_interval_hours ?? 24} h
                  </p>
                </div>
              </div>
              {profile?.last_scrape_error ? (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">{profile.last_scrape_error}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Card 4 — Recent preview */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-violet-100 p-2 dark:bg-violet-900/40">
                  <Quote className="h-4 w-4 text-violet-600 dark:text-violet-300" />
                </div>
                <div>
                  <CardTitle className="text-base">Recent reviews</CardTitle>
                  <CardDescription className="mt-0.5">Last 5 captured from Google.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {recentReviews.length === 0 ? (
                <div className="rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  No reviews captured yet — click <em>Refresh now</em> above.
                </div>
              ) : (
                <ul className="divide-y">
                  {recentReviews.map((r) => (
                    <li key={r.id} className="grid gap-2 py-3 sm:grid-cols-[160px_1fr]">
                      <div>
                        <p className="text-sm font-medium">{r.reviewer_name ?? 'Anonymous'}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <StarRating rating={r.rating} size="sm" />
                          {r.date_text ? (
                            <span className="text-[11px] text-muted-foreground">{r.date_text}</span>
                          ) : null}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-3">{r.text ?? '—'}</p>
                    </li>
                  ))}
                </ul>
              )}
              <Separator className="my-3" />
              <Link
                href="/reviews"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Open reviews dashboard
                <ExternalLink className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>

          {/* Card 5 — Embed snippet */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-rose-100 p-2 dark:bg-rose-900/40">
                  <Sparkles className="h-4 w-4 text-rose-600 dark:text-rose-300" />
                </div>
                <div>
                  <CardTitle className="text-base">Step 3 · Embed on your site</CardTitle>
                  <CardDescription className="mt-0.5">
                    Drop this <code>&lt;iframe&gt;</code> anywhere — no script tags, no API keys exposed.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {profile?.widget_token ? (
                <EmbedSnippet baseUrl={PRODUCTION_ORIGIN} widgetToken={profile.widget_token} />
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <div className="rounded-full bg-amber-100 p-3 dark:bg-amber-900/40">
              <Star className="h-5 w-5 text-amber-600 dark:text-amber-300" />
            </div>
            <p className="text-sm font-medium">Almost there.</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Save your SerpAPI key and pick your business above to unlock the daily scrape + embeddable widget.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
