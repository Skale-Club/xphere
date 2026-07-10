# CRM Mirror — `POST /api/v1/sync`

Status: **Live in production.** Reference tenant: **Xtimator**.

The CRM mirror is the single, generic inbound endpoint that lets a sibling
platform app (Xtimator, XmartMenu, Xkedule, …) project one of its tenants into
the caller-org's Xphere CRM as an **Account** (the business) + **Contact** (the
owner) + **Opportunity** (the subscription/lifecycle deal), plus an optional
timeline **Note**. Each app POSTs the same envelope and only varies by its
`source` discriminator and target pipeline name.

This replaces the per-app receivers (one tentacle per app) with one contract.
The legacy `POST /api/xtimator/webhook` still works as a back-compat alias
(injects `source: 'xtimator'` + pipeline `Xtimator Lifecycle`) and should be
removed once Xtimator is repointed at `/api/v1/sync`.

## Endpoints

| Route | Purpose | Status codes |
| --- | --- | --- |
| `POST /api/v1/sync` | Canonical generic mirror | `200` ok · `401` bad auth · `422` bad payload · `500` server error |
| `POST /api/xtimator/webhook` | Deprecated Xtimator alias | Always `200` (legacy webhook contract) |

Unlike a fire-and-forget webhook, `/api/v1/sync` returns **real** status codes so
callers can drive retry/DLQ logic: `5xx`/`429` → retry, `4xx` → treat as
permanent. CORS is enabled (external apps call cross-origin).

## Auth

Bearer token against the `api_keys` table — the same pattern as the rest of
`/api/v1/`. The org is pinned by the key; callers **never** send an `org_id`.
Any non-revoked key for the org authorizes the mirror (no scope gate — matches
the sibling-integration pattern). Tokens are `xph_<64 hex>`; only the SHA-256
hash is stored.

```
Authorization: Bearer <token>
Content-Type: application/json
```

## Request body

```jsonc
{
  "source": "xtimator",              // required — becomes external_source
  "event": "subscription.updated",   // required — free-form label
  "delivery_id": "evt_abc123",       // optional
  "occurred_at": "2026-07-05T00:26:58Z", // required — ordering key (last-write-wins)
  "company": {                        // required — mirrored to Account + Contact
    "id": "c_9f2e...",                // required — external_id (idempotency key)
    "name": "ABC Plumbing",           // required
    "owner_name": "John Smith",       // optional — Contact name (falls back to company name)
    "email": "john@abcplumbing.com",  // optional
    "phone": "+15551234567",          // optional (E.164 — normalised)
    "industry": null,
    "website": null,
    "address": null,
    "tags": ["pro"],
    "custom_fields": { "plan": "pro" }
  },
  "opportunity": {                    // optional — mirrored to Opportunity
    "stage": "Active — Pro",          // required — must match a stage name in the pipeline
    "status": "won",                  // optional — inferred from stage is_won/is_lost
    "value": 49,                      // optional
    "currency": "USD",                // optional — defaults to USD
    "title": "ABC Plumbing — Subscription", // optional
    "pipeline": "Xtimator Lifecycle"  // optional — defaults to "<Source> Lifecycle"
  },
  "note": {                           // optional — appended to the contact timeline
    "title": "Upgraded to Pro",
    "content": "Customer upgraded on 2026-07-05.",
    "dedup_id": "evt_abc123"          // accepted but NOT yet enforced (see caveats)
  }
}
```

Contact identity requires **phone OR email** (DB invariant, migration 1061).
A company with neither is mirrored as Account-only; the Contact is skipped.

## Response

```json
{ "ok": true, "account_id": "…", "contact_id": "…", "opportunity_id": "…" }
```

- `opportunity_skipped: "no_pipeline" | "no_stage" | "insert_failed"` — the deal
  was not mirrored (the target pipeline/stage does not exist in the org).
- `stale: true` — a newer mirror state already exists for this
  `(org, source, external_id)`; the event was ignored (last-write-wins).

## Idempotency & ordering

- **Dedup key:** `(org_id, external_source, external_id)` — unique partial index
  per table (contacts / accounts / opportunities). Re-delivering the same event
  updates the same rows instead of duplicating.
- **Ordering:** the **Account** is the anchor. If its `external_updated_at` is
  `>=` the incoming `occurred_at`, the whole event is treated as stale and
  skipped. Otherwise all three rows advance to `occurred_at`.
- **Contact adoption:** if no mirror row matches, the engine falls back to
  matching by normalised `phone_e164` / `email_normalized` and *claims* that
  existing contact for the mirror (avoids creating a duplicate person).

## Pipeline resolution

The Opportunity is only mirrored when its target **pipeline** and **stage**
already exist in the org (resolved by name). Each app must have its
lifecycle pipeline provisioned first. For Xtimator this is the
**"Xtimator Lifecycle"** pipeline with stages `Trial`, `Active — Pro`,
`Active — Business`, `Churned` — seeded once via
[`scripts/seed-xtimator-lifecycle-pipeline.sql`](../../scripts/seed-xtimator-lifecycle-pipeline.sql).
Stage names must match exactly, including the em dash (`—`).

## Data model

Migration **1237** (`xtimator_crm_mirror`, renumbered from 1213) adds the
provenance + idempotency columns and indexes, following the Xkedule
booking-mirror pattern (migration 1212):

- `contacts` / `accounts`: `external_source`, `external_updated_at`
  (`external_id` already existed from migrations 051 / 064)
- `opportunities`: `external_source`, `external_id`, `external_updated_at`
- Unique partial index `(org_id, external_source, external_id)` per table
- All columns are nullable and additive — native rows (`external_source IS NULL`)
  are unaffected.

`{contacts,accounts,opportunities}.external_source = 'xtimator'` marks a row
owned by the Xtimator integration; `external_id` is the Xtimator company id.

## Key files

- [`src/app/api/v1/sync/route.ts`](../../src/app/api/v1/sync/route.ts) — canonical endpoint (auth + HTTP envelope)
- [`src/lib/crm-mirror/mirror.ts`](../../src/lib/crm-mirror/mirror.ts) — `runCrmMirror` engine + `mirrorPayloadSchema`
- [`src/app/api/xtimator/webhook/route.ts`](../../src/app/api/xtimator/webhook/route.ts) — deprecated Xtimator alias
- [`supabase/migrations/1237_xtimator_crm_mirror.sql`](../../supabase/migrations/1237_xtimator_crm_mirror.sql) — provenance columns (applied in prod)

## Caveats / known follow-ups

- **Note dedup is not enforced.** `note.dedup_id` is accepted but there is no
  `notes.dedup_id` column + unique index yet, so a redelivered event can append
  a duplicate note. Timeline notes are intentionally one-per-event for now.
- **Types not regenerated.** The migration-1237 mirror columns are not yet in
  `src/types/database.ts`, so `mirror.ts` uses an untyped (`any`) service-role
  client. Regenerate the Supabase types to restore type safety on the engine.
- **Legacy alias.** `POST /api/xtimator/webhook` remains only for back-compat;
  remove it once Xtimator posts to `/api/v1/sync` with `source: 'xtimator'`.
