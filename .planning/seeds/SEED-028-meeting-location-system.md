---
id: SEED-028
status: active
planted: 2026-05-20
planted_during: post-SEED-024; planted alongside SEED-025/026/027 to unify calendar + workflow surfaces
trigger_when: explicit user request OR before SEED-027 Phase E (which needs {{meeting.link}} variable resolved) OR before any tenant onboards with physical service locations
scope: Medium
priority: high
depends_on: []
unblocks: [SEED-027 Phase E (calendar variable scope)]
phases_shipped: [A, B, C, D, E, F]
phases_pending: []
last_commit: a177783
---

# SEED-028: Meeting Location System — Rich Location Model + Dynamic Links

The current scheduling system models meeting location as a flat `location_type ∈ ('video', 'phone', 'in_person')` plus a `location_value` string. This is too thin for real-world service businesses:

- A barbershop has multiple store locations the booking should pin to
- A field-service company meets at the customer's address pulled from CRM
- A consultancy uses Google Meet links that should be **generated dynamically per booking** (not the same static room reused)
- A clinic offers phone consultations where the customer's number is the location

SEED-028 introduces a structured location model with **typed kinds**, **tenant-managed store locations**, and **dynamic link resolution** that exposes `{{meeting.link}}` and `{{meeting.location}}` as composable variables for the workflow engine (SEED-027 consumes these).

## Why this is its own seed

This stands alone: even without the unified workflow system or calendar-as-trigger surface, a richer location model improves the booking UX immediately (better booking page, better calendar invites, better emails). But its dynamic-link variable is exactly what SEED-027 needs to make "send SMS with the meeting link 5 min before" possible. Sequencing 028 before 027 Phase E unblocks the entire calendar-workflow story.

## Location kinds

| Kind             | Description                                                              | `{{meeting.link}}` resolves to                              |
|------------------|--------------------------------------------------------------------------|-------------------------------------------------------------|
| `google_meet`    | Google Calendar generates a Meet URL per booking                         | The generated Meet URL                                       |
| `zoom`           | (Future) Zoom integration generates a meeting URL per booking            | Generated Zoom URL                                           |
| `whereby`        | (Future) Static or dynamic Whereby room                                  | Whereby URL                                                  |
| `store_location` | Pinned to one of the tenant's stores (configured globally)               | `https://maps.google.com/?q=<lat>,<lng>` deep link           |
| `client_address` | Uses the contact's address from CRM                                      | Google Maps deep link to contact address                     |
| `custom_address` | Free-form address typed at booking time                                  | Google Maps deep link to that address                        |
| `phone_call`     | Organizer calls the contact at their CRM phone number                    | `tel:+15551234567`                                           |
| `custom_phone`   | Organizer calls a specific number provided at booking time               | `tel:<number>`                                               |
| `custom_link`    | Free-form URL (e.g. Microsoft Teams, Discord, Slack huddle)              | The URL                                                      |

Each `event_type` declares its allowed location kinds (one or many). For multi-kind, the booker picks during checkout. For single-kind, no UI prompt — the kind is fixed.

## Tenant store locations

New entity: a tenant can manage one or more physical locations (stores, offices, clinics). Each location has:

- `name` — "Downtown Branch", "Main Office"
- `address_line_1`, `address_line_2`, `city`, `state`, `postal_code`, `country`
- `latitude`, `longitude` (auto-geocoded from address on save)
- `phone` (optional)
- `business_hours` (optional JSONB by weekday)
- `notes` — internal text shown to organizer
- `is_default` — used when only one store is referenced

Configurable at `/settings/locations` (new page). Used by the `store_location` kind on event types and by future fulfillment features.

## Dynamic link resolution

When a booking is created, the engine computes `meeting.link` and `meeting.location` based on the location kind:

```ts
// lib/scheduling/location-resolver.ts
type ResolvedMeetingLocation = {
  kind: LocationKind
  label: string          // human-readable: "Google Meet", "Downtown Branch", "John's address"
  address: string | null // formatted street address if applicable
  coordinates: { lat: number; lng: number } | null
  phone: string | null
  link: string           // tel:, https://maps.., https://meet.google.com.., etc.
  raw: Record<string, unknown>  // kind-specific extras (meet_room_id, store_id, etc.)
}
```

Resolution is **lazy + cached**:

- For `google_meet`: link is created at booking confirmation via Google Calendar API (`conferenceData.createRequest`). Stored on the booking row.
- For address-based kinds: the Maps URL is deterministic from coordinates; computed on read.
- For phone kinds: `tel:` URL is computed from the phone field on read.
- For `custom_link`: stored verbatim.

The resolver is pure and synchronous after the booking's source data exists. The Google Meet creation is async at booking time but blocks confirmation completion (must succeed before status becomes `confirmed`).

## Surfaces that use the resolved location

- **Booking confirmation page** (`/book/[slug]/[eventType]` thank-you state): shows the formatted location with appropriate UI (Maps preview, click-to-call, "Join Meet" button)
- **Calendar invite** (ICS export): `LOCATION` field uses the formatted address; description includes the link
- **Email confirmation**: location block with clickable link
- **Workflows** (SEED-027): `{{meeting.link}}` and `{{meeting.location.*}}` available as variables
- **Public booking widget**: shows what to expect ("This is a video call", "Visit us at [address]")

## Phases

### Phase A — Tenant locations
- Migration 088: `tenant_locations` table with full address + coordinates + business hours
- Migration 089: `event_types` gains `allowed_location_kinds text[]` (default `['video']` for back-compat) and `default_store_location_id uuid` (nullable)
- Server actions: CRUD on tenant_locations (with geocoding via Google Geocoding API on insert/update)
- New page `/settings/locations` with map-preview UI, CRUD interface
- Validation: addresses geocode successfully before save; provide manual lat/lng override

### Phase B — Location kinds model
- Migration 090: `bookings` gains structured location fields
  - `location_kind text` (one of the 9 kinds above)
  - `location_data jsonb` — kind-specific payload (store_id, custom_address, custom_phone, etc.)
  - `meeting_url text` — resolved persistent URL (Google Meet, custom_link)
  - `meeting_phone text` — resolved phone number
- Migration 091: backfill existing bookings from `location_type` + `location_value` into the new fields (best-effort mapping)
- Drop reads from old fields (kept in column for one release as safety net)

### Phase C — Google Meet integration
- `lib/scheduling/providers/google-meet.ts` — creates Meet via Google Calendar API at booking confirmation
- Requires `google_calendar` integration to be `connected` for the org (gated by SEED-025 health check)
- On creation failure: surface error to booker, do not confirm booking; offer retry or fallback to `custom_link`
- Stores `meeting_url` on booking row; also stores raw event metadata in `location_data.google_event_id` for cancellation cleanup

### Phase D — Resolver + variables
- `lib/scheduling/location-resolver.ts` — pure resolver
- `lib/scheduling/location-formatter.ts` — formats `ResolvedMeetingLocation` for ICS, email, UI
- Hook into SEED-027 Phase E scope builder (`lib/scheduling/scope.ts`) so `meeting.link` and `meeting.location.*` are present
- Variables registered in unified spec (`lib/workflows/spec.ts` — SEED-025 dependency)

### Phase E — Booking UI updates
- Booking page (`/book/[slug]/[eventType]`):
  - If `allowed_location_kinds.length > 1`: location picker step before confirm
  - If kind is `client_address`: pre-fill from contact, allow override
  - If kind is `store_location` with multiple stores: picker
  - If kind is `custom_*`: input field
- Confirmation page: location block with proper UI per kind
- Reschedule page: location may change (especially if address-based and contact moved)

### Phase F — Email + ICS export updates
- ICS `LOCATION` field uses formatted location
- ICS `DESCRIPTION` includes `link` if present
- Confirmation email template uses `location-formatter` output (location card with map embed for address kinds, "Join Meet" button for video kinds, click-to-call for phone kinds)
- All three remain non-AI templates (handlebars) — Copilot can author replacement workflows but defaults stay deterministic

## Backwards compatibility

- Existing bookings with `location_type ∈ ('video', 'phone', 'in_person')` are mapped:
  - `video` + a Google Meet URL in `location_value` → `kind: 'custom_link'` with the URL preserved
  - `video` without URL → `kind: 'google_meet'`, URL re-generated on next confirmation (or marked `legacy`)
  - `phone` → `kind: 'custom_phone'` if value is a phone, else `kind: 'phone_call'`
  - `in_person` → `kind: 'custom_address'` with `location_value` as the address (no geocoding back-fill required)
- The old `location_type` and `location_value` columns stay on `bookings` for one release as a fallback read path
- Public booking page falls back to legacy rendering if a booking has no `location_kind` set

## Risks + mitigations

| Risk                                                              | Mitigation                                                                  |
|-------------------------------------------------------------------|------------------------------------------------------------------------------|
| Google Meet creation fails at booking time → broken confirmation  | Fallback to `custom_link` with a placeholder + organizer notification        |
| Geocoding API rate limits / cost                                  | Cache per address; only geocode on save (not on read); admin-set quota       |
| Privacy: contact home address shown in calendar invite to attendees | `client_address` kind shows full address only to organizer; attendees see "Visit us at <city, state>" unless contact opts in |
| Stale Meet links after reschedule                                  | On reschedule, update the existing Google Calendar event in place (no new URL); URL stable across reschedule |
| Free-form `custom_link` security: phishing URLs                    | Allow-list domains optionally configurable per org; default warns on uncommon domains |

## Success criteria

1. ✅ Tenants can manage stores in `/settings/locations` with geocoded addresses
2. ✅ Event types can declare allowed location kinds; bookers pick when multiple are allowed
3. ✅ Google Meet links generate per-booking via Google Calendar API; fail loudly when integration is disconnected (gated by SEED-025 health)
4. ✅ `{{meeting.link}}` resolves correctly for every kind in test scenarios
5. ✅ ICS exports + emails reflect the new location model
6. ✅ All existing bookings render correctly post-migration (backwards-compat fallback)
7. ✅ `npm run build` + integration tests pass

## Open questions

- Should `client_address` allow visibility control per-booking (organizer toggle: "show full address to attendees")?
- Multiple location kinds *per single booking* (hybrid: optional in-person OR Meet)? Out of scope for v1.
- Buffer time per store-location (e.g. drive time between sequential bookings at different stores)? Possibly a SEED-029.
- Auto-suggest store based on contact's address proximity? Possibly a SEED-029.
- Allow attendees to switch location post-booking (e.g. "I can't make it in person, can we move to Meet")? UI affordance; same resolver, but requires reschedule flow update.

## Files

```
supabase/
  migrations/088_tenant_locations.sql                       NEW   Phase A
  migrations/089_event_types_location_kinds.sql             NEW   Phase A
  migrations/090_bookings_location_kind.sql                 NEW   Phase B
  migrations/091_backfill_legacy_bookings_location.sql      NEW   Phase B

src/
  lib/
    scheduling/
      location-resolver.ts                                  NEW   Phase D  pure resolver per kind
      location-formatter.ts                                 NEW   Phase D  ICS/email/UI formatters
      providers/google-meet.ts                              NEW   Phase C  creates Meet via Google Calendar API
      providers/maps.ts                                     NEW   Phase D  geocoding + maps URL helpers
      scope.ts                                              EDIT  Phase D  inject meeting.location + meeting.link (SEED-027 dep)
  app/
    (dashboard)/settings/locations/page.tsx                 NEW   Phase A  store CRUD
    (dashboard)/settings/locations/_actions/                NEW   Phase A
    book/[slug]/[eventType]/page.tsx                        EDIT  Phase E  location picker + confirmation block
    scheduling/_actions/                                    EDIT  Phase E  pass location_kind through booking flow
    api/scheduling/bookings/[id]/route.ts                   EDIT  Phase C  create Meet on confirm
  components/
    scheduling/
      location-picker.tsx                                   NEW   Phase E  multi-kind picker UI
      store-location-form.tsx                               NEW   Phase A  store CRUD form
      location-card.tsx                                     NEW   Phase E  per-kind rendering on confirmation
    booking-confirmation/location-block.tsx                 NEW   Phase E  per-kind email/page block
  lib/email/
    templates/booking-confirmation.ts                       EDIT  Phase F  use location-formatter
  lib/scheduling/ics.ts                                     EDIT  Phase F  use location-formatter for LOCATION + DESCRIPTION

.planning/workflows/examples/
  meeting-link-sms.yaml                                     NEW   Phase D  uses {{meeting.link}} (SEED-026 dep)
```

## Coordination

- **SEED-027 Phase E** consumes SEED-028 Phase D output (`meeting.location`, `meeting.link` variables in the trigger scope). Sequencing: ship 028 D before 027 E.
- **SEED-025** integration health gating means Google Meet provider is hidden when `google_calendar` integration is `disconnected` — both the manual UI and SEED-026 AI authoring see the filtered spec.
- **SEED-026** Phase D loader picks up the `meeting-link-sms.yaml` example workflow.
