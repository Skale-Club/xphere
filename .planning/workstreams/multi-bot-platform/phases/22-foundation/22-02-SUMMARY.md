---
phase: 22-foundation
plan: 02
subsystem: webhook + server-actions
tags: [supabase, server-actions, webhook, manychat, encryption, vitest, nodejs-runtime]

requires:
  - phase: 22-foundation/22-01
    provides: manychat_channels and manychat_events tables, Database TS types, Wave 0 RED test stubs
  - phase: 07-db-foundation (v1.3)
    provides: meta webhook handler template (runtime='nodejs', 200/403 gate)
  - phase: 06-api-key-admin (v1.0)
    provides: encrypt() and maskApiKey() AES-256-GCM utilities; createServiceRoleClient pattern
provides:
  - createManychatChannel server action (encrypts API key, generates webhook_secret, inserts row)
  - deleteManychatChannel server action (RLS-scoped delete by id)
  - POST /api/manychat/webhook handler (X-Operator-Secret gate, always-200 after validation)
  - GREEN state for 11 Wave 0 RED test stubs in tests/manychat/
affects: [phase-23-inbound-routing, phase-24-dashboard-config-ui, phase-26-event-log]

tech-stack:
  added: []
  patterns:
    - "Webhook-resolved org_id: server-side service-role lookup via webhook_secret, never from request body"
    - "Always-200-after-validation: 403 only on the secret gate; outer try/catch swallows post-gate failures"
    - "Per-channel webhook_secret via crypto.randomUUID() (Web Crypto global, no import)"
    - "RLS-driven org scoping in server actions: org_id auto-set by WITH CHECK(get_current_org_id())"

key-files:
  created:
    - src/app/(dashboard)/integrations/manychat/actions.ts
    - src/app/api/manychat/webhook/route.ts
  modified: []

key-decisions:
  - "Webhook returns 403 via new Response(JSON, {status:403}) only on missing/invalid secret; everything else returns Response.json({ok:true})"
  - "Service-role client used for BOTH channel lookup AND event insert in webhook (no user session exists)"
  - "webhookSecret is generated and persisted but NOT returned from createManychatChannel — Phase 24 UI fetches via separate getter to avoid leaking it through revalidation paths"
  - "createManychatChannel does not manually set org_id; relies on RLS WITH CHECK to populate via get_current_org_id() (consistent with integrations/actions.ts)"

patterns-established:
  - "ManyChat External Request webhook: secret-keyed lookup → channel resolves org_id → service-role insert into append-only event log"
  - "Channel CRUD server actions: encrypt + maskApiKey + crypto.randomUUID + RLS-scoped insert; matches integrations/actions.ts modulo the org_id-from-RLS shortcut"

requirements-completed: [CHANNEL-01, CHANNEL-05, WEBHOOK-01, WEBHOOK-02, WEBHOOK-03, WEBHOOK-04]

duration: 5min
completed: 2026-05-06
---

# Phase 22 Plan 02: Foundation (Wave 2 — actions + webhook) Summary

**Implemented createManychatChannel/deleteManychatChannel server actions and the POST /api/manychat/webhook handler — turning Wave 0's 11 RED test stubs GREEN with zero deviations or regressions.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-06T19:17:38Z
- **Completed:** 2026-05-06T19:22:51Z
- **Tasks:** 2
- **Files modified:** 2 (2 created, 0 modified)

## Accomplishments

- `createManychatChannel` written: encrypts the raw API key via `encrypt()` (AES-256-GCM), produces a `••••••••last4` hint via `maskApiKey()`, generates a per-channel `webhook_secret` via `crypto.randomUUID()`, and inserts a row to `manychat_channels` without manually setting `org_id` (RLS handles it).
- `deleteManychatChannel` written: simple `delete().eq('id', id)` against `manychat_channels`, RLS-scoped to the active org.
- Both actions gate on `getUser()` and return `{ error: 'Not authenticated.' }` for unauthenticated callers.
- `/api/manychat/webhook` POST handler written: looks up channel by `webhook_secret + is_active=true` via `createServiceRoleClient`, returns HTTP 403 with `{ error: 'Forbidden' }` body if no match, otherwise inserts to `manychat_events` with `status: 'unmatched'` and returns HTTP 200.
- All 5 webhook tests + 6 channel-action tests transition RED → GREEN.
- Full vitest run: 156 passed / 6 skipped / 244 todo — no regressions.
- `npm run build` exits 0; `/api/manychat/webhook` is registered as a dynamic route in the build output.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement createManychatChannel and deleteManychatChannel server actions** — `5df4fee` (feat)
2. **Task 2: Implement /api/manychat/webhook POST handler** — `92af93a` (feat)

## Files Created/Modified

**Created:**
- `src/app/(dashboard)/integrations/manychat/actions.ts` — server actions module exporting `createManychatChannel` and `deleteManychatChannel`. Uses `getUser()`/`createClient()` from `@/lib/supabase/server`, `encrypt`/`maskApiKey` from `@/lib/crypto`, and `revalidatePath('/integrations/manychat')` after each mutation.
- `src/app/api/manychat/webhook/route.ts` — Node.js runtime POST handler. Uses `createServiceRoleClient()` from `@/lib/supabase/admin`. 403 returned only on missing/invalid X-Operator-Secret; all other paths return `{ok:true}` with HTTP 200, including malformed JSON and DB insert failures.

**Modified:** none.

## Decisions Made

- **Service role for both lookup AND insert in the webhook.** A webhook has no user session — both queries run as service role. This is identical to `vapi/calls/route.ts`. Using the authenticated client here would silently fail (no session → RLS rejects).
- **org_id resolved from `channel.org_id`, never from request body.** Matches the v1.6 PLANNING.md security model and prevents tenant spoofing via crafted webhook payloads. Documented inline as a comment.
- **`webhook_secret` not returned from `createManychatChannel`.** The webhook secret is plaintext in the DB row but not surfaced through the create action. Phase 24 UI will fetch the channel row separately. This avoids leaking the secret through cache-revalidation flows.
- **`org_id` not manually set in the insert.** The authenticated client's RLS `WITH CHECK (org_id = get_current_org_id())` handles tenant scoping automatically. This matches `integrations/actions.ts` (which also relies on RLS for `org_id`).
- **403 body uses `new Response(JSON, {status})` instead of `Response.json(...,{status})`.** Either works, but explicit `Content-Type: application/json` keeps it consistent across edge cases.

## Deviations from Plan

None — plan executed exactly as written. Both tasks compiled cleanly, every assertion in the Wave 0 RED test stubs was satisfied by the planned implementations, and the full vitest suite plus `npm run build` were both clean on first attempt.

## Issues Encountered

- None during planned work.

## User Setup Required

- None for this plan. Migration 026 still needs `npx supabase db push` once `SUPABASE_DB_PASSWORD` is supplied (tracked in STATE.md pending todos and inherited from Plan 01) — without it, the channel insert and webhook lookup will fail at runtime against any deployed environment, but the build and unit tests do not require live DB access.

## Known Stubs

- None. The two RED test stubs from Plan 01 (`tests/manychat/webhook.test.ts`, `tests/manychat/channel-actions.test.ts`) are now fully GREEN. There are no placeholder UIs, hardcoded empty data flows, or "coming soon" strings introduced by this plan. Phase 24 will add the dashboard UI surface for these actions; until then, the actions module has no consumer in the rendered tree, which is expected and documented in the v1.6 phase split.

## Next Phase Readiness

- **Phase 23 (Inbound Routing)** can now consume the always-200 webhook contract: events are persisted with `status: 'unmatched'` and a stable `(org_id, channel_id, event_type, event_payload)` shape, ready for rule-based dispatch to update `status` to `'matched'` (or `'error'`).
- **Phase 24 (Dashboard Config UI)** can now wire forms to `createManychatChannel`/`deleteManychatChannel`. A separate `getManychatChannel()` reader (not in scope here) will be needed to surface `key_hint` + `webhook_secret` to the UI.
- **Manual verification** (curl tests in `<verification>` section of the plan) requires `SUPABASE_DB_PASSWORD` for the migration push and an inserted channel row with a known `webhook_secret`. Skipped here; see STATE.md pending todos.

## Self-Check: PASSED

- FOUND: `src/app/(dashboard)/integrations/manychat/actions.ts`
- FOUND: `src/app/api/manychat/webhook/route.ts`
- FOUND commit: `5df4fee` (Task 1 — createManychatChannel + deleteManychatChannel)
- FOUND commit: `92af93a` (Task 2 — /api/manychat/webhook POST handler)
- VERIFIED: `npx vitest run tests/manychat/channel-actions.test.ts` — 6/6 passed
- VERIFIED: `npx vitest run tests/manychat/webhook.test.ts` — 5/5 passed
- VERIFIED: `npx vitest run` — 156 passed / 6 skipped / 244 todo (no regressions)
- VERIFIED: `npm run build` — exits 0; `/api/manychat/webhook` registered as dynamic route
- VERIFIED: `createManychatChannel`, `deleteManychatChannel`, `export const runtime = 'nodejs'`, `export async function POST` all present in their respective files (grep-confirmed)

---
*Phase: 22-foundation*
*Completed: 2026-05-06*
