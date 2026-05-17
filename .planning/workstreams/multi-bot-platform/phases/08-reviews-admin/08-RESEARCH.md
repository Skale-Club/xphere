# Phase 8: Reviews Admin - Research

**Researched:** 2026-05-04
**Domain:** Google Places API (New) v1, Next.js server actions, Supabase RLS
**Confidence:** HIGH

---

## Summary

Phase 8 builds the admin side of the Google Reviews feature: location registration, Places API fetching, 24h cooldown enforcement, and a dashboard showing sync status. The DB schema is already live in production (migration 018 applied in Phase 7). TypeScript types for `google_locations` and `google_reviews` are already in `src/types/database.ts`. The `@googlemaps/places` package is not yet installed.

All work is server-side. The Google API key must never appear in client-side requests — all Places API calls must go through Next.js server actions. The `fetched_at` column on `google_locations` is the authoritative timestamp for both the cooldown check (GREV-05) and ToS compliance (30-day cache boundary). The existing server action pattern (`'use server'` file + `createClient`/`getUser` + `revalidatePath`) is the correct approach throughout.

**Primary recommendation:** Follow the existing widget/integrations page structure exactly. One `page.tsx` (server component), one `actions.ts` (`'use server'`), one `loading.tsx`, plus client components for the form and location card. Use raw `fetch` to call the Places API REST endpoint directly rather than the `@googlemaps/places` SDK — the SDK adds gRPC transport complexity with no benefit for a simple server-side GET call.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GREV-01 | Admin can register a Google location (name, address, Place ID, Maps link, category, client name) | `google_locations` table already has all these columns; `addLocation` server action inserts a row |
| GREV-02 | System fetches up to 5 reviews from Google Places API (New) and stores them in Supabase with `fetched_at` | Places API v1 REST endpoint with `X-Goog-FieldMask: id,displayName,formattedAddress,reviews`; upsert into `google_reviews`; update `fetched_at` + `review_count` on `google_locations` |
| GREV-03 | Admin can manually trigger a review refresh from the location dashboard | `syncReviews` server action, called by a client button; blocked if cooldown not yet expired |
| GREV-04 | Dashboard shows last sync date, review count, and last error per location | All three are columns on `google_locations` (`fetched_at`, `review_count`, `last_fetch_error`); served by the server component query |
| GREV-05 | System enforces minimum 24h between API fetches per location | Cooldown check: compare `now()` against `fetched_at`; reject if diff < 24h; return descriptive error to UI |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- **Auth pattern:** Always use `createClient()` and `getUser()` from `@/lib/supabase/server`. Never call `supabase.auth.getUser()` directly.
- **Server actions:** `'use server'` directive at top of actions file; use `revalidatePath()` after mutations.
- **Components:** Server components by default; client components get `'use client'`. Forms use `react-hook-form` + `zod` + `zodResolver`. Toasts use `sonner`.
- **Build gate:** Run `npm run build` after every change to catch type errors.
- **Security:** Google API key must be server-side only — no `NEXT_PUBLIC_` prefix, never returned to browser.
- **No middleware auth:** Auth gating happens in layouts/pages, not middleware.
- **Stack:** Next.js 15 App Router, TypeScript 5 strict, Supabase, Tailwind 4, shadcn/ui.

---

## Standard Stack

### Core (already installed — no new installs needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.101.1 | DB access, RLS-aware queries | Project standard; `createClient()` from `@/lib/supabase/server` |
| `react-hook-form` | ^7.72.0 | Location registration form | Project standard for all forms |
| `zod` | ^3.25.76 | Form validation schema | Project standard; pairs with `@hookform/resolvers` |
| `sonner` | ^2.0.7 | Toast notifications on sync success/error | Project standard |
| `lucide-react` | ^1.7.0 | Icons (RefreshCw, MapPin, Star, AlertCircle) | Project standard |

### New Install Required
| Package | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@googlemaps/places` | `^2.4.1` | TypeScript types for Places API v1 response objects | Use ONLY for TypeScript type definitions; call the REST API directly via `fetch` (see Architecture Patterns below) |

**Installation:**
```bash
npm install @googlemaps/places
```

**Version verification:** `npm view @googlemaps/places version` returns `2.4.1` as of 2026-05-04.

### Why Raw Fetch Instead of PlacesClient for HTTP calls
The `@googlemaps/places` PlacesClient uses gRPC transport under the hood (not plain REST HTTP) when running server-side. For a simple GET that runs only when an admin triggers a sync — not a hot path — the REST endpoint is simpler, more transparent, and requires zero special transport setup. Use the SDK's TypeScript type exports (e.g., `Place`, `Review`) without using its HTTP client.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
  app/(dashboard)/reviews/
    page.tsx          # server component — queries google_locations + google_reviews
    actions.ts        # 'use server' — addLocation, syncReviews, deleteLocation
    loading.tsx       # skeleton while page.tsx awaits
  components/reviews/
    location-card.tsx       # 'use client' — shows location info, sync status, reviews preview
    add-location-form.tsx   # 'use client' — react-hook-form + zod for registration
    sync-button.tsx         # 'use client' — triggers syncReviews, shows loading + cooldown state
```

### Pattern 1: Dashboard Page (Server Component)
**What:** Same structure as `/integrations/page.tsx` and `/widget/page.tsx`
**When to use:** Always — pages are server components that fetch data and pass to client components

```typescript
// src/app/(dashboard)/reviews/page.tsx
import { redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { LocationList } from '@/components/reviews/location-list'
import { AddLocationForm } from '@/components/reviews/add-location-form'

export default async function ReviewsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: activeOrgId } = await supabase.rpc('get_current_org_id')

  if (!activeOrgId) {
    // same "no active org" guard pattern as widget/page.tsx
    return <NoOrgCard />
  }

  const { data: locations } = await supabase
    .from('google_locations')
    .select('*, google_reviews(*)')
    .order('created_at', { ascending: false })

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Reviews</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Register Google locations to capture and display up to 5 reviews.
        </p>
      </div>
      <AddLocationForm />
      <LocationList locations={locations ?? []} />
    </div>
  )
}
```

### Pattern 2: Server Actions File
**What:** `'use server'` module with typed action functions; mirrors `widget/actions.ts` and `integrations/actions.ts`

```typescript
// src/app/(dashboard)/reviews/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'

const COOLDOWN_HOURS = 24

export async function addLocation(input: {
  placeId: string
  name: string
  address?: string
  mapsUrl?: string
  category?: string
  clientName?: string
}): Promise<{ error?: string; locationId?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  const { data, error } = await supabase
    .from('google_locations')
    .insert({
      org_id: orgId,
      place_id: input.placeId,
      name: input.name,
      address: input.address ?? null,
      maps_url: input.mapsUrl ?? null,
      category: input.category ?? null,
      client_name: input.clientName ?? null,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/reviews')
  return { locationId: data.id }
}

export async function syncReviews(
  locationId: string
): Promise<{ error?: string; reviewCount?: number }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  // Fetch location — RLS ensures it belongs to current org
  const { data: location, error: fetchErr } = await supabase
    .from('google_locations')
    .select('id, place_id, fetched_at')
    .eq('id', locationId)
    .single()

  if (fetchErr || !location) return { error: 'Location not found.' }

  // GREV-05: 24h cooldown check
  if (location.fetched_at) {
    const hoursSinceSync =
      (Date.now() - new Date(location.fetched_at).getTime()) / (1000 * 60 * 60)
    if (hoursSinceSync < COOLDOWN_HOURS) {
      const hoursRemaining = (COOLDOWN_HOURS - hoursSinceSync).toFixed(1)
      return { error: `Sync available in ${hoursRemaining} hours (24h minimum between syncs).` }
    }
  }

  // Call Google Places API (New) — server-side, key never leaves server
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return { error: 'Google Places API key not configured.' }

  let placesResponse: Response
  try {
    placesResponse = await fetch(
      `https://places.googleapis.com/v1/places/${location.place_id}`,
      {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,reviews',
        },
      }
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Network error'
    await supabase
      .from('google_locations')
      .update({ last_fetch_error: errMsg, updated_at: new Date().toISOString() })
      .eq('id', locationId)
    return { error: errMsg }
  }

  if (!placesResponse.ok) {
    const errMsg = `Google Places API returned ${placesResponse.status}`
    await supabase
      .from('google_locations')
      .update({ last_fetch_error: errMsg, updated_at: new Date().toISOString() })
      .eq('id', locationId)
    return { error: errMsg }
  }

  const place = await placesResponse.json()
  const reviews: Array<Record<string, unknown>> = place.reviews ?? []

  // Upsert reviews — UNIQUE(location_id, google_review_id) handles deduplication
  const reviewRows = reviews.map((r, idx) => ({
    location_id: locationId,
    org_id: orgId,
    google_review_id: String(r.name ?? `${location.place_id}-${idx}`),
    author_name: (r.authorAttribution as Record<string,unknown>)?.displayName as string ?? 'Anonymous',
    author_photo_url: (r.authorAttribution as Record<string,unknown>)?.photoUri as string ?? null,
    author_uri: (r.authorAttribution as Record<string,unknown>)?.uri as string ?? null,
    rating: Math.round(Number(r.rating ?? 0)),
    review_text: (r.text as Record<string,unknown>)?.text as string ?? null,
    original_text: (r.originalText as Record<string,unknown>)?.text as string ?? null,
    relative_time: r.relativePublishTimeDescription as string ?? null,
    published_at: r.publishTime as string ?? null,
    google_maps_url: r.googleMapsUri as string ?? null,
    display_order: idx,
  }))

  if (reviewRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from('google_reviews')
      .upsert(reviewRows, { onConflict: 'location_id,google_review_id' })
    if (upsertErr) {
      await supabase
        .from('google_locations')
        .update({ last_fetch_error: upsertErr.message })
        .eq('id', locationId)
      return { error: upsertErr.message }
    }
  }

  // Update sync metadata on location
  await supabase
    .from('google_locations')
    .update({
      fetched_at: new Date().toISOString(),
      last_fetch_error: null,
      review_count: reviewRows.length,
      updated_at: new Date().toISOString(),
    })
    .eq('id', locationId)

  revalidatePath('/reviews')
  return { reviewCount: reviewRows.length }
}

export async function deleteLocation(
  locationId: string
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('google_locations')
    .delete()
    .eq('id', locationId)

  if (error) return { error: error.message }
  revalidatePath('/reviews')
}
```

### Pattern 3: Places API REST Call (Field Mask)
**What:** The exact HTTP call pattern for the Google Places API (New)
**When to use:** In `syncReviews` server action

```typescript
// Endpoint: GET https://places.googleapis.com/v1/places/{PLACE_ID}
// Auth header: X-Goog-Api-Key (not Authorization: Bearer)
// Field mask header: X-Goog-FieldMask (comma-separated, no spaces)
// Source: https://developers.google.com/maps/documentation/places/web-service/place-details

const response = await fetch(
  `https://places.googleapis.com/v1/places/${placeId}`,
  {
    headers: {
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY!,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,reviews',
    },
  }
)
// Reviews are in response.reviews[] — up to 5, no pagination
// response.displayName.text = place name
// response.formattedAddress = address string
```

### Pattern 4: Sidebar Nav Addition
**What:** Add "Reviews" nav item to `src/components/layout/app-sidebar.tsx`
**When to use:** As part of this phase

```typescript
// In app-sidebar.tsx, add to navItems array:
// Import: import { Star } from 'lucide-react'
{ icon: Star, label: 'Reviews', href: '/reviews', active: true },
```

The sidebar checks `pathname.startsWith(item.href + '/')` for sub-route matching — `/reviews` will correctly highlight when on `/reviews` or `/reviews/*`.

### Pattern 5: Loading Skeleton
**What:** Mirrors existing loading.tsx files exactly
```typescript
// src/app/(dashboard)/reviews/loading.tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function ReviewsLoading() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-80 mt-1.5" />
      </div>
      <Skeleton className="h-40 w-full rounded-md" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-md" />
        ))}
      </div>
    </div>
  )
}
```

### Anti-Patterns to Avoid
- **Calling Places API from client components:** The API key would be exposed in browser network requests. All Places API calls must be in server actions.
- **Storing `GOOGLE_PLACES_API_KEY` with `NEXT_PUBLIC_` prefix:** Sends the key to the browser.
- **Calling `request.json()` style on the Places response before checking status:** Check `response.ok` before parsing.
- **Using the `PlacesClient` gRPC client instead of raw fetch:** Adds transport complexity with no benefit for admin-only, low-frequency calls.
- **Not checking cooldown before API call:** The cooldown check must happen in the server action before any outbound HTTP request.
- **Returning raw review objects to client:** Map to typed display objects in the server action or server component.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form validation for location registration | Custom validation logic | `zod` + `react-hook-form` + `zodResolver` | Already installed; project standard |
| Toast notifications | Custom alert components | `sonner` | Project standard — already used everywhere |
| Auth check | Manual JWT parsing | `getUser()` from `@/lib/supabase/server` | Cached across render tree; project requirement from CLAUDE.md |
| Org scoping | Manual `org_id` filter in every query | RLS via `createClient()` + `get_current_org_id()` | RLS handles isolation automatically |
| Review deduplication | Custom dedup logic | `upsert` with `onConflict: 'location_id,google_review_id'` | The DB unique constraint does the work |
| Cooldown timer display | Custom date math | `date-fns` (already installed) for `formatDistanceToNow` | Installed; avoids manual date arithmetic |
| Loading states | Custom spinner components | `Skeleton` from `@/components/ui/skeleton` | shadcn/ui component; project standard |

**Key insight:** Every form, toast, auth check, and DB interaction has an established project pattern. Phase 8 introduces no new infrastructure problems — it assembles existing primitives around the new Places API fetch logic.

---

## Common Pitfalls

### Pitfall 1: Wrong API Endpoint URL
**What goes wrong:** Using the legacy Places API URL (`maps.googleapis.com/maps/api/place/details/json`) instead of the v1 endpoint. The legacy endpoint is deprecated and may not work for new API keys.
**Why it happens:** Most tutorials and StackOverflow answers pre-2023 use the legacy URL.
**How to avoid:** Use `https://places.googleapis.com/v1/places/{PLACE_ID}` with `X-Goog-Api-Key` and `X-Goog-FieldMask` headers — not query parameters.
**Warning signs:** Response contains `"status": "NOT_FOUND"` or `"INVALID_REQUEST"` when Place ID is known good.

### Pitfall 2: Missing Field Mask Causes Empty Response
**What goes wrong:** Places API (New) requires a `X-Goog-FieldMask` header. Without it, the API returns an error or empty response, not a helpful error message.
**Why it happens:** The v1 API differs from legacy — field masking is mandatory, not optional.
**How to avoid:** Always include `X-Goog-FieldMask: id,displayName,formattedAddress,rating,userRatingCount,reviews` in every Places API request.
**Warning signs:** `response.reviews` is undefined even though the Place ID is correct.

### Pitfall 3: `google_review_id` Extraction from API Response
**What goes wrong:** The `name` field in a review object from the Places API (New) contains a resource path like `places/ChIJ.../reviews/ChdCI...`, not a simple ID. If you try to use `r.id` it will be undefined — reviews don't have a top-level `id` field.
**Why it happens:** Places API (New) uses resource name patterns consistently, and `name` on a review is the full resource path.
**How to avoid:** Use `r.name` (the resource path) as the `google_review_id` dedup key — it is stable and unique per review per place.
**Warning signs:** All upserts fail with unique constraint violations because the fallback ID generation produces collisions.

### Pitfall 4: Cooldown Check Not Enforced — Double API Calls
**What goes wrong:** Admin clicks "Sync" twice quickly before the first revalidation completes. Two concurrent `syncReviews` server actions both pass the cooldown check and both call the Google API.
**Why it happens:** React's transition state may not be visible to a second server action call in-flight.
**How to avoid:** The cooldown check reads `fetched_at` from the DB at action start. For MVP (low frequency admin use), the race window is small and acceptable. The UI sync button should use a loading state that disables it during the action (use `useTransition`).
**Warning signs:** API billing showing 2x expected calls per sync event.

### Pitfall 5: Attribution Fields Not Stored — ToS Violation
**What goes wrong:** Storing only `rating` and `review_text` and discarding `author_name`, `author_photo_url`, `author_uri`. The Google Places API ToS requires author attribution to be displayed adjacent to each review.
**Why it happens:** Developers minimize stored columns; attribution fields feel like "display only" data.
**How to avoid:** The migration already stores `author_name`, `author_photo_url`, `author_uri`, `google_maps_url`. The server action must map all of these from the API response. The UI must display them.
**Warning signs:** Review cards showing rating and text but no author name or photo.

### Pitfall 6: `fetched_at` Column Name (Migration vs Architecture Docs)
**What goes wrong:** Some architecture docs referenced `last_synced_at` but the actual migration 018 uses `fetched_at`. Using `last_synced_at` in code causes a Supabase column-not-found error.
**Why it happens:** Column name changed during schema design; docs not all updated simultaneously.
**How to avoid:** The authoritative column names are in `src/types/database.ts` (already updated to match migration 018). Always reference the TypeScript types, not the architecture docs.
**Confirmed columns on `google_locations`:** `fetched_at`, `last_fetch_error`, `review_count` (verified in database.ts).

### Pitfall 7: `GOOGLE_PLACES_API_KEY` Not Set in Vercel
**What goes wrong:** Sync action runs, `process.env.GOOGLE_PLACES_API_KEY` is `undefined`, fetch call fails with a 401, the error is stored in `last_fetch_error`, and the admin sees a confusing error message.
**Why it happens:** Env var documented but not yet set in Vercel production environment.
**How to avoid:** The `syncReviews` action should check `if (!apiKey) return { error: 'Google Places API key not configured.' }` before making the fetch call. STATE.md lists this as a known blocker.
**Warning signs:** `last_fetch_error` column showing "Google Places API returned 401".

---

## Code Examples

### Places API Response Shape (reviews array)
```typescript
// Source: https://developers.google.com/maps/documentation/places/web-service/place-details
// Verified against official REST reference 2026-05-04
interface PlaceReview {
  name: string                          // resource path: "places/PLACE_ID/reviews/REVIEW_ID"
  relativePublishTimeDescription: string // e.g. "3 months ago"
  rating: number                        // 1.0–5.0
  text: { text: string; languageCode: string }
  originalText?: { text: string; languageCode: string }
  authorAttribution: {
    displayName: string                 // MUST display per ToS
    uri: string                         // Google profile link — recommended to display
    photoUri: string                    // profile photo URL — recommended to display
  }
  publishTime: string                   // ISO 8601 timestamp
  googleMapsUri: string                 // deep link to this review
  flagContentUri: string                // link to report review
}
```

### 24h Cooldown Check
```typescript
// Source: derived from project requirements GREV-05 + migration 018 schema
const COOLDOWN_MS = 24 * 60 * 60 * 1000  // 24 hours in milliseconds

function isCooldownActive(fetchedAt: string | null): boolean {
  if (!fetchedAt) return false
  return Date.now() - new Date(fetchedAt).getTime() < COOLDOWN_MS
}

function hoursUntilNextSync(fetchedAt: string): string {
  const msSinceSync = Date.now() - new Date(fetchedAt).getTime()
  const msRemaining = COOLDOWN_MS - msSinceSync
  const hours = Math.ceil(msRemaining / (1000 * 60 * 60))
  return `${hours}h`
}
```

### Sidebar Nav Addition
```typescript
// Source: src/components/layout/app-sidebar.tsx (read 2026-05-04)
// Add to navItems array (after existing items):
import { Star } from 'lucide-react'

// In navItems:
{ icon: Star, label: 'Reviews', href: '/reviews', active: true },
```

### org_id Resolution in Server Actions
```typescript
// Source: widget/actions.ts pattern (project codebase, read 2026-05-04)
const supabase = await createClient()
const { data: orgId, error } = await supabase.rpc('get_current_org_id')
if (error || !orgId) return { error: 'No active organization.' }
// RLS on google_locations already scopes all queries to this org automatically
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Legacy Places API (`maps.googleapis.com/maps/api/place/details/json`) | Places API (New) v1 (`places.googleapis.com/v1/places/{id}`) | 2022–2023 (New API GA) | Different endpoint, field masking required, different response field names |
| `@googlemaps/google-maps-services-js` | `@googlemaps/places` (or raw fetch for New API) | 2023 | Old package wraps Legacy API only; New API requires new package |
| `author_name`, `profile_photo_url` (Legacy) | `authorAttribution.displayName`, `authorAttribution.photoUri` (New) | Places API v1 | Field name change — code written against legacy docs will produce undefined values |

**Deprecated/outdated:**
- Legacy Places API endpoint: scheduled for retirement; new projects should not enable it.
- `@googlemaps/google-maps-services-js` for Places: the README explicitly states it only covers Legacy Services.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `GOOGLE_PLACES_API_KEY` env var | `syncReviews` action | ✗ (not yet set in Vercel) | — | Action returns explicit error if missing; set before testing sync |
| `npm run build` (TypeScript) | CI / pre-ship | ✓ | Next.js 16.2.2 | — |
| `@googlemaps/places` npm package | TypeScript types only | ✗ (not installed) | 2.4.1 | Install in Wave 0; or use inline type definitions |
| Supabase `google_locations` table | All actions | ✓ (migration 018 applied) | — | — |
| Supabase `google_reviews` table | `syncReviews` action | ✓ (migration 018 applied) | — | — |

**Missing dependencies with no fallback:**
- `GOOGLE_PLACES_API_KEY` must be set in Vercel env before sync testing. The action should fail gracefully with a human-readable error when it is missing.

**Missing dependencies with fallback:**
- `@googlemaps/places` package: if only using for TypeScript types, inline type definitions can substitute. Install the package for correctness.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/reviews-admin.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GREV-01 | `addLocation` inserts row with correct columns; rejects duplicate place_id per org | unit | `npx vitest run tests/reviews-admin.test.ts -t "addLocation"` | ❌ Wave 0 |
| GREV-02 | `syncReviews` calls Places API, maps response fields, upserts reviews, updates `fetched_at` + `review_count` | unit (mocked fetch) | `npx vitest run tests/reviews-admin.test.ts -t "syncReviews"` | ❌ Wave 0 |
| GREV-03 | Sync button triggers `syncReviews` and surfaces success count or error message | manual smoke | — | manual-only |
| GREV-04 | Dashboard page renders `fetched_at`, `review_count`, `last_fetch_error` from DB | manual smoke | — | manual-only |
| GREV-05 | `syncReviews` returns cooldown error when `fetched_at` is less than 24h ago | unit | `npx vitest run tests/reviews-admin.test.ts -t "cooldown"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/reviews-admin.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/reviews-admin.test.ts` — covers GREV-01 (`addLocation` column mapping), GREV-02 (Places API response field mapping + upsert), GREV-05 (cooldown check logic)
- [ ] Framework install: already installed (Vitest 4.1.2 in devDependencies)

---

## Open Questions

1. **`@googlemaps/places` SDK vs raw fetch for TypeScript types only**
   - What we know: The PlacesClient uses gRPC transport; we want REST. The TypeScript types in the package are useful.
   - What's unclear: Whether the package's type exports can be imported without pulling in gRPC dependencies at build time.
   - Recommendation: Install the package; import only the type interfaces (`import type { Place } from '@googlemaps/places/build/src/v1'`). If tree-shaking doesn't eliminate the gRPC dep, define inline types instead.

2. **Stale reviews cleanup on sync**
   - What we know: Google returns up to 5 reviews. On re-sync, Google may return different reviews (relevance-ranked, not caller-controlled).
   - What's unclear: Should stale reviews (previously fetched, not in new response) be deleted or kept?
   - Recommendation: Delete all existing reviews for the location before upserting new ones, or delete those whose `google_review_id` is not in the new set. The simpler approach is DELETE + INSERT rather than upsert, since the set is small (max 5).

3. **Place ID validation before save**
   - What we know: If an admin enters an invalid Place ID, the Places API call will fail with a 404 or 400.
   - What's unclear: Should `addLocation` immediately validate the Place ID by calling the Places API, or save first and show an error on first sync?
   - Recommendation: Validate on registration — call the Places API with `X-Goog-FieldMask: id,displayName,formattedAddress` before inserting the row. This costs one API call but gives immediate feedback. Update GREV-01 plan to include this validation step.

---

## Sources

### Primary (HIGH confidence)
- Google Places API (New) Place Details — `https://developers.google.com/maps/documentation/places/web-service/place-details` — endpoint URL, field mask header, reviews field
- Google Places API field mask documentation — `https://developers.google.com/maps/documentation/places/web-service/choose-fields`
- `src/types/database.ts` — authoritative column names for `google_locations` and `google_reviews` (read directly from codebase)
- `supabase/migrations/018_google_reviews.sql` — schema source of truth (read directly)
- `src/components/layout/app-sidebar.tsx` — sidebar navItems pattern (read directly)
- `src/app/(dashboard)/widget/actions.ts` — server action pattern (read directly)
- `src/app/(dashboard)/widget/page.tsx` — server component + no-org guard pattern (read directly)

### Secondary (MEDIUM confidence)
- `npm view @googlemaps/places version` → `2.4.1` (verified live, 2026-05-04)
- `npm view @googlemaps/places dist-tags` → `latest: 2.4.1` (verified live, 2026-05-04)
- `.planning/research/STACK.md` — milestone-level stack decisions (read directly)
- `.planning/research/PITFALLS.md` — Google Reviews pitfalls G1–G5 (read directly)
- `.planning/research/FEATURES.md` — feature landscape and API constraints (read directly)

### Tertiary (LOW confidence)
- Community reports on `google_review_id` field being the `name` resource path — not officially documented in the REST reference prose, but consistent with Places API (New) naming conventions.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — packages verified live; codebase patterns read directly
- Architecture: HIGH — derived from direct codebase inspection of analogous pages
- Pitfalls: HIGH — migration read directly; column names verified in TypeScript types
- Places API response shape: MEDIUM — official docs consulted; `name` as dedup key is an inference from naming conventions

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (stable APIs; Supabase schema already migrated)
