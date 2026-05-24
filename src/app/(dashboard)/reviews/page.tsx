import { formatDistanceToNow } from 'date-fns'
import { ArrowRight, Sparkles, Star } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import { RatingDistribution } from '@/components/reviews/rating-distribution'
import { ReviewCard } from '@/components/reviews/review-card'
import { ReviewsFilters } from '@/components/reviews/reviews-filters'
import { StarRating } from '@/components/reviews/star-rating'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ min?: string; photos?: string; response?: string }>
}

export default async function ReviewsPage({ searchParams }: PageProps) {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>No active organization</CardTitle>
            <CardDescription>Pick an organization to view its reviews.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const sp = await searchParams
  const minRating = Math.max(1, Math.min(5, Number.parseInt(sp.min ?? '1', 10) || 1))
  const withPhotos = sp.photos === '1'
  const withResponse = sp.response === '1'

  const { data: profile } = await supabase
    .from('google_business_profiles')
    .select(
      'id, business_name, address, average_rating, total_reviews_count, last_scraped_at, is_active, place_id'
    )
    .maybeSingle()

  if (!profile || !profile.is_active || profile.place_id === '__pending__') {
    return (
      <div className="p-6">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="rounded-full bg-amber-100 p-3 dark:bg-amber-900/40">
              <Star className="h-6 w-6 text-amber-600 dark:text-amber-300" />
            </div>
            <h2 className="text-xl font-semibold">No reviews yet</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Connect your Google Business via SerpAPI to start capturing reviews automatically.
            </p>
            <Button asChild>
              <Link href="/integrations/google-reviews">
                Configure integration
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Distribution from full active set
  const { data: distRows } = await supabase
    .from('google_reviews')
    .select('rating')
    .eq('profile_id', profile.id)
    .eq('is_removed', false)
  const distMap = new Map<number, number>([[5, 0], [4, 0], [3, 0], [2, 0], [1, 0]])
  for (const r of distRows ?? []) distMap.set(r.rating, (distMap.get(r.rating) ?? 0) + 1)
  const distribution = [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: distMap.get(r) ?? 0 }))
  const totalActive = distRows?.length ?? 0

  // Filtered reviews
  let q = supabase
    .from('google_reviews')
    .select(
      'id, reviewer_name, reviewer_photo_url, reviewer_profile_url, rating, text, date_text, date_iso, is_local_guide, local_guide_reviews_count, helpful_count, owner_response, owner_response_date, google_review_photos(id, original_url, hetzner_url)'
    )
    .eq('profile_id', profile.id)
    .eq('is_removed', false)
    .gte('rating', minRating)
    .order('date_iso', { ascending: false, nullsFirst: false })
    .limit(60)
  if (withResponse) q = q.not('owner_response', 'is', null)

  const { data: reviewsRaw } = await q

  type ReviewWithPhotos = NonNullable<typeof reviewsRaw>[number]
  let reviews: ReviewWithPhotos[] = reviewsRaw ?? []
  if (withPhotos) {
    reviews = reviews.filter((r) => (r.google_review_photos?.length ?? 0) > 0)
  }

  return (
    <div className="space-y-8 p-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-amber-50 via-background to-background p-8 dark:from-amber-950/30 dark:via-background dark:to-background">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-amber-300/30 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-orange-300/20 blur-3xl" />

        <div className="relative grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shadow-sm backdrop-blur">
              <Sparkles className="h-3 w-3 text-amber-500" />
              Live from Google
            </div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">
              {profile.business_name ?? 'Your business'}
            </h1>
            {profile.address ? (
              <p className="text-sm text-muted-foreground">{profile.address}</p>
            ) : null}

            <div className="flex items-baseline gap-4 pt-2">
              <div>
                <p className="font-serif text-6xl font-semibold tabular-nums leading-none">
                  {profile.average_rating?.toFixed(1) ?? '|'}
                </p>
                <div className="mt-1.5">
                  <StarRating rating={profile.average_rating ?? 0} size="lg" />
                </div>
              </div>
              <div className="pb-1">
                <p className="text-sm font-medium">{profile.total_reviews_count ?? totalActive} reviews</p>
                {profile.last_scraped_at ? (
                  <p className="text-xs text-muted-foreground">
                    Updated {formatDistanceToNow(new Date(profile.last_scraped_at))} ago
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-background/70 p-5 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rating distribution
            </p>
            <RatingDistribution distribution={distribution} className="mt-3" />
          </div>
        </div>
      </section>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ReviewsFilters />
        <p className="text-xs text-muted-foreground">
          Showing <strong className="text-foreground">{reviews.length}</strong> of {totalActive}
        </p>
      </div>

      {/* Reviews list */}
      {reviews.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <p className="text-sm font-medium">No reviews match these filters.</p>
            <p className="text-xs text-muted-foreground">Try lowering the minimum rating or clearing filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {reviews.map((r) => (
            <ReviewCard
              key={r.id}
              review={{
                id: r.id,
                reviewer_name: r.reviewer_name,
                reviewer_photo_url: r.reviewer_photo_url,
                reviewer_profile_url: r.reviewer_profile_url,
                rating: r.rating,
                text: r.text,
                date_text: r.date_text,
                is_local_guide: r.is_local_guide,
                local_guide_reviews_count: r.local_guide_reviews_count,
                helpful_count: r.helpful_count,
                owner_response: r.owner_response,
                owner_response_date: r.owner_response_date,
                photos: (r.google_review_photos ?? []).map((p) => ({
                  id: p.id,
                  original_url: p.original_url,
                  hetzner_url: p.hetzner_url,
                })),
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
