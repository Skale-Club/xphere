import Link from 'next/link'
import { Star } from 'lucide-react'
import { redirect } from 'next/navigation'

import { resolveOrgBranding } from '@/lib/branding'
import { createClient, getUser } from '@/lib/supabase/server'
import { decrypt, maskApiKey } from '@/lib/crypto'
import { ReviewWidgetBuilder, type ReviewWidgetPreviewReview } from '@/components/reviews/review-widget-builder'
import { RefreshButton } from '@/components/reviews/refresh-button'
import { ReviewProfileSwitcher } from '@/components/reviews/review-profile-switcher'
import { WidgetSettingsDialog } from '@/components/reviews/widget-settings-dialog'
import { ReviewsSetupWizard } from '@/components/reviews/reviews-setup-wizard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/page-header'
import { saveWidgetSettings, type SavedWidgetSettings } from './actions'

export const dynamic = 'force-dynamic'

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>
}) {
  const { profile: requestedProfileId } = await searchParams
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) {
    return (
      <PageContainer>
        <Card>
          <CardHeader>
            <CardTitle>No active organization</CardTitle>
            <CardDescription>Pick an organization to view its reviews.</CardDescription>
          </CardHeader>
        </Card>
      </PageContainer>
    )
  }

  // An org can hold one reviews profile per business (Local SEO links each
  // tracked location to its own). Pick the requested one, else the oldest.
  const { data: profiles } = await supabase
    .from('google_business_profiles')
    .select(
      'id, business_name, address, average_rating, total_reviews_count, last_scraped_at, is_active, place_id, widget_token, widget_settings, serpapi_key_encrypted'
    )
    .order('created_at', { ascending: true })
  const switchable = (profiles ?? []).filter((p) => p.is_active && p.place_id !== '__pending__')
  const profile =
    profiles?.find((p) => p.id === requestedProfileId) ?? switchable[0] ?? profiles?.[0] ?? null

  if (!profile || !profile.is_active || profile.place_id === '__pending__') {
    return (
      <PageContainer>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="rounded-full bg-amber-100 p-3 dark:bg-amber-900/40">
              <Star className="h-6 w-6 text-amber-600 dark:text-amber-300" />
            </div>
            <h2 className="text-xl font-semibold">No reviews yet</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Connect your Google Business via SerpAPI to start capturing reviews automatically.
            </p>
            <ReviewsSetupWizard triggerLabel="Configure integration" />
            <Button asChild size="sm" variant="ghost">
              <Link href="/seo/reviews/review-link">Just need a review link? Generate one</Link>
            </Button>
          </CardContent>
        </Card>
      </PageContainer>
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

  const { data: orgBranding } = await supabase
    .from('organizations')
    .select('accent_color')
    .eq('id', orgId as string)
    .maybeSingle()
  const brandAccent = resolveOrgBranding(orgBranding).accent

  // Settings dialog inputs (same fields as the integration onboarding).
  const hasApiKey = Boolean(profile.serpapi_key_encrypted)
  let keyHint: string | null = null
  if (profile.serpapi_key_encrypted) {
    try {
      keyHint = maskApiKey(await decrypt(profile.serpapi_key_encrypted))
    } catch {
      keyHint = null
    }
  }

  // When this business is connected to Google Business Profile, replies are
  // made from Local SEO → Reviews.
  const { data: localSeoLocation } = await supabase
    .from('local_seo_locations')
    .select('id')
    .eq('google_business_profile_id', profile.id)
    .not('gbp_location_name', 'is', null)
    .limit(1)
    .maybeSingle()

  const { data: widgetPreviewRows } = await supabase
    .from('google_reviews')
    .select(
      'id, reviewer_name, reviewer_photo_url, reviewer_profile_url, rating, text, date_text, is_local_guide, helpful_count, owner_response, owner_response_date, google_review_photos(id, original_url, hetzner_url)'
    )
    .eq('profile_id', profile.id)
    .eq('is_removed', false)
    .order('date_iso', { ascending: false, nullsFirst: false })
    .limit(18)

  const widgetReviews: ReviewWidgetPreviewReview[] = (widgetPreviewRows ?? []).map((review) => ({
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

  return (
    <PageContainer>
      <ReviewWidgetBuilder
        baseUrl="https://xphere.app"
        widgetToken={profile.widget_token}
        profileId={profile.id}
        brandAccent={brandAccent}
        business={{
          name: profile.business_name,
          address: profile.address,
          placeId: profile.place_id !== '__pending__' ? profile.place_id : null,
          averageRating: profile.average_rating,
          totalReviewsCount: profile.total_reviews_count,
        }}
        distribution={distribution}
        reviews={widgetReviews}
        savedSettings={(profile.widget_settings as SavedWidgetSettings | null) ?? undefined}
        onSave={saveWidgetSettings.bind(null, profile.id)}
        settingsSlot={
          <>
            {switchable.length > 1 && (
              <ReviewProfileSwitcher
                currentId={profile.id}
                profiles={switchable.map((p) => ({ id: p.id, label: p.business_name ?? p.place_id }))}
              />
            )}
            {localSeoLocation && (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/seo/local/${localSeoLocation.id}/reviews`}>Reply in Local SEO</Link>
              </Button>
            )}
            <Button asChild size="sm" variant="secondary">
              <Link href="/seo/reviews/review-link">Review link</Link>
            </Button>
            <RefreshButton profileId={profile.id} />
            <WidgetSettingsDialog
              currentHint={keyHint}
              hasApiKey={hasApiKey}
              currentPlaceId={profile.place_id !== '__pending__' ? profile.place_id : null}
            />
          </>
        }
      />
    </PageContainer>
  )
}
