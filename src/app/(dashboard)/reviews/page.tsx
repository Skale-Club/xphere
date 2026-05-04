import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AddLocationForm } from '@/components/reviews/add-location-form'
import { LocationCard } from '@/components/reviews/location-card'
import { ReviewWidgetConfigurator } from '@/components/reviews/review-widget-configurator'
import type { Database } from '@/types/database'

type GoogleLocation = Database['public']['Tables']['google_locations']['Row'] & {
  google_reviews: Database['public']['Tables']['google_reviews']['Row'][]
}

export default async function ReviewsPage() {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const supabase = await createClient()
  const { data: activeOrgId } = await supabase.rpc('get_current_org_id')

  if (!activeOrgId) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>
              Choose an organization before managing review locations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/organizations" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Go to organizations
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { data: locations, error } = await supabase
    .from('google_locations')
    .select('*, google_reviews(*)')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const reviewLocations = (locations ?? []) as GoogleLocation[]

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register Google locations to capture and display up to 5 reviews per location.
        </p>
      </div>

      <AddLocationForm />

      {reviewLocations.length > 0 ? (
        <div className="space-y-3">
          {reviewLocations.map((location) => (
            <div key={location.id} className="space-y-3">
              <LocationCard location={location} />

              {location.google_reviews.length > 0 ? (
                <ReviewWidgetConfigurator
                  locationId={location.id}
                  locationName={location.name}
                  reviewToken={location.review_token}
                  mapsUrl={location.maps_url}
                  reviews={location.google_reviews}
                />
              ) : (
                <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
                  Sync reviews before generating an embed snippet.
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border p-8 text-center">
          <p className="text-sm font-medium">No locations registered</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a Google location above to start capturing reviews.
          </p>
        </div>
      )}
    </div>
  )
}
