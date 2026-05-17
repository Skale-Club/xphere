---
phase: 22-foundation
verified: 2026-05-06T19:37:05Z
status: human_needed
score: 5/5 must-haves verified
human_verification:
  - test: "Apply migration 026 to a real Supabase database (npx supabase db push) and confirm manychat_channels + manychat_events tables, RLS policies, and integration_provider enum value all exist as written"
    expected: "Tables created, ALTER TYPE adds 'manychat' enum value, org_isolation policies in place, append-only RLS on manychat_events (SELECT+INSERT only)"
    why_human: "SUPABASE_DB_PASSWORD is unavailable — migration is written but cannot be pushed in this environment. Schema correctness on the live DB cannot be verified programmatically here."
  - test: "After migration is applied, call createManychatChannel via a UI surface (Phase 24) or a server action invocation, then SELECT from manychat_channels"
    expected: "Row exists with encrypted_api_key matching `iv-base64:ciphertext-base64` format, key_hint = '••••••••<last4>', webhook_secret is a UUID, org_id auto-populated by RLS"
    why_human: "End-to-end DB write requires live Supabase + authenticated session; cannot be exercised in static analysis. Phase 24 will add the UI surface."
  - test: "Send a real POST request to https://operator.skale.club/api/manychat/webhook with X-Operator-Secret matching a created channel"
    expected: "HTTP 200 with body {ok:true} for valid secret + event row in manychat_events with status='unmatched'; HTTP 403 for missing/invalid secret + no event written"
    why_human: "Production HTTP behavior + ManyChat retry semantics (always-200 contract) is best validated against the deployed endpoint, not via unit-test mocks."
---

# Phase 22: Foundation Verification Report

**Phase Goal:** Operator can receive and log inbound ManyChat webhook events, and admins can register a ManyChat channel (with encrypted API key and webhook secret) via server actions.

**Verified:** 2026-05-06T19:37:05Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP.md)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Admin can create a ManyChat channel — API key stored encrypted (AES-256-GCM), only masked hint returned to UI | ✓ VERIFIED | `actions.ts:26-37` calls `encrypt(data.apiKey)` (AES-256-GCM via `crypto.ts:5,42`) and `maskApiKey(data.apiKey)`; insert payload uses `encrypted_api_key` + `key_hint` only — raw key never inserted (test asserts `JSON.stringify(insertArg).not.toContain('real-api-key-value')` passes). `createManychatChannel` returns `void` on success — never returns the raw or encrypted key to the caller. |
| 2 | Admin can delete a ManyChat channel | ✓ VERIFIED | `actions.ts:57-60` runs `supabase.from('manychat_channels').delete().eq('id', id)`; auth-gated by `getUser()`; RLS scopes deletion to active org. Test `CHANNEL-05: deleteManychatChannel > calls delete().eq("id", channelId)` passes. |
| 3 | POST /api/manychat/webhook with valid X-Operator-Secret → HTTP 200 + event logged to manychat_events | ✓ VERIFIED | `route.ts:20-25` looks up channel by `webhook_secret + is_active=true`; if found, `route.ts:52-58` inserts event with org_id from channel row + `status:'unmatched'`, then returns `Response.json({ok:true})` (HTTP 200). Tests `WEBHOOK-04: returns 200 when X-Operator-Secret is valid` and `WEBHOOK-03: logs event to manychat_events with status unmatched` both pass. |
| 4 | POST /api/manychat/webhook with invalid/missing secret → HTTP 403, no event logged | ✓ VERIFIED | `route.ts:23` uses `secret ?? ''` so missing header lookups against `webhook_secret = ''`, yielding no row. `route.ts:27-33` returns HTTP 403 BEFORE the event-insert try-block is reached, so no event is logged. Tests `WEBHOOK-02: returns 403 when X-Operator-Secret header is missing` and `returns 403 when X-Operator-Secret does not match any channel` both pass. |
| 5 | Every accepted event logged with status 'unmatched' (routing wired in Phase 23) | ✓ VERIFIED | `route.ts:57` hardcodes `status: 'unmatched'`. `manychat_events.Update` is typed `Record<string, never>` (database.ts:973) — append-only at the TS layer mirrors the SQL append-only RLS (no UPDATE/DELETE policies). Phase 23 will widen this to enable `'matched'` transitions. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `supabase/migrations/026_manychat_foundation.sql` | DB schema for both tables + enum extension | ✓ VERIFIED | Contains `ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'manychat'` (L17), `CREATE TABLE ... manychat_channels` (L25-37) with UNIQUE(org_id), `CREATE TABLE ... manychat_events` (L59-69), `org_isolation` policy on channels (L41-45), `org_isolation_select` + `org_isolation_insert` (L73-81) on events with no UPDATE/DELETE policies, `update_updated_at` trigger (L47-49). |
| `src/types/database.ts` | TS row/insert/update types for both tables + extended enum | ✓ VERIFIED | `manychat_channels` table def at L906-949 with `Update` allowing partial mutation. `manychat_events` table def at L950-990 with `Update: Record<string, never>` (append-only). `integration_provider` enum union includes `'manychat'` at L1014. Cross-cut: `integrations.provider` Row/Insert at L166, L179 also include `'manychat'`. |
| `tests/manychat/webhook.test.ts` | Test stubs for webhook handler | ✓ VERIFIED (now GREEN) | 5 tests covering WEBHOOK-02/03/04 — all pass. |
| `tests/manychat/channel-actions.test.ts` | Test stubs for server actions | ✓ VERIFIED (now GREEN) | 6 tests covering CHANNEL-01/05 — all pass. |
| `src/app/(dashboard)/integrations/manychat/actions.ts` | createManychatChannel + deleteManychatChannel | ✓ VERIFIED | Both exports present; uses encrypt + maskApiKey + crypto.randomUUID + RLS-scoped insert/delete. Auth gate on getUser(). |
| `src/app/api/manychat/webhook/route.ts` | POST handler with secret gate | ✓ VERIFIED | `export const runtime = 'nodejs'` (L12), `export async function POST` (L14). 403/200 gate logic intact. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `migration 026` | `database.ts` | manual type sync — Tables block | ✓ WIRED | `manychat_channels` and `manychat_events` definitions match SQL columns 1:1 (Row shapes), enum union extended. |
| `database.ts` | `route.ts` | TypeScript Database type via createServiceRoleClient<Database> | ✓ WIRED | Pattern `manychat_channels`/`manychat_events` referenced in route.ts via `.from('manychat_channels')` and `.from('manychat_events')`. |
| `actions.ts` | `crypto.ts` | encrypt() + maskApiKey() imports | ✓ WIRED | `actions.ts:5` imports both; `actions.ts:26-27` calls `encrypt(data.apiKey)` and `maskApiKey(data.apiKey)`. |
| `route.ts` | `admin.ts` | createServiceRoleClient for both lookup + insert | ✓ WIRED | `route.ts:9` imports; `route.ts:15` instantiates; used for `from('manychat_channels').select()` AND `from('manychat_events').insert()`. |
| `route.ts` | `manychat_channels` table | select id, org_id by webhook_secret | ✓ WIRED | `route.ts:20-25` runs `.from('manychat_channels').select('id, org_id').eq('webhook_secret', secret??'').eq('is_active', true).maybeSingle()`. |
| `route.ts` | `manychat_events` table | insert row with status='unmatched' | ✓ WIRED | `route.ts:52-58` runs `.from('manychat_events').insert({ org_id: channel.org_id, channel_id: channel.id, event_type, event_payload, status: 'unmatched' })`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `actions.ts > createManychatChannel` | `encryptedApiKey` | `await encrypt(data.apiKey)` — Web Crypto AES-256-GCM via `src/lib/crypto.ts` | Yes — real ciphertext from real subtle.encrypt | ✓ FLOWING |
| `actions.ts > createManychatChannel` | `keyHint` | `maskApiKey(data.apiKey)` — pure function, returns `••••••••<last4>` | Yes — derived from input apiKey | ✓ FLOWING |
| `actions.ts > createManychatChannel` | `webhookSecret` | `crypto.randomUUID()` (Web Crypto global) | Yes — fresh UUID v4 per call | ✓ FLOWING |
| `route.ts > POST` | `channel` | `supabase.from('manychat_channels').select('id, org_id').eq('webhook_secret',…).maybeSingle()` against live DB | Yes — real DB query (no static fallback). Lookup result is the secret-gate decision. | ✓ FLOWING |
| `route.ts > POST` | `body` | `await request.json()` with try/catch fallback to `{}` | Yes — real request body, fallback only on malformed JSON (intended behavior per WEBHOOK-04) | ✓ FLOWING |
| `route.ts > POST` | `eventType` | `body.event_type` with `'unknown'` fallback | Yes — derived from body, sensible default | ✓ FLOWING |
| `route.ts > POST` | event insert payload | `{ org_id: channel.org_id, channel_id: channel.id, event_type, event_payload: body, status: 'unmatched' }` | Yes — `org_id` derives from channel lookup (NOT from body — security-critical), `channel_id` from lookup, payload from request | ✓ FLOWING |

Note: `status: 'unmatched'` is intentionally hardcoded for Phase 22 — Phase 23 will introduce dynamic routing that updates this. This is a documented seam, not a stub.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| All 11 manychat tests pass (RED stubs from Plan 01 turned GREEN by Plan 02) | `npx vitest run tests/manychat` | 11/11 passed in 1.95s | ✓ PASS |
| TypeScript build succeeds | `npm run build` | Exit 0; `/api/manychat/webhook` registered as dynamic route in build output | ✓ PASS |
| Webhook route exported with required signature | `grep -E "^export (const runtime|async function POST)"` `route.ts` | Both present (`runtime = 'nodejs'`, `async function POST(request: Request)`) | ✓ PASS |
| Server actions exported with required names | `grep -E "^export async function (createManychatChannel|deleteManychatChannel)"` `actions.ts` | Both exports present | ✓ PASS |
| Live DB schema correctness (migration applied) | `npx supabase db push` against remote | SKIPPED — SUPABASE_DB_PASSWORD not available; routed to human verification | ? SKIP |
| End-to-end webhook POST against deployed endpoint | curl with valid/invalid X-Operator-Secret | SKIPPED — requires live Supabase + deployed endpoint; routed to human verification | ? SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| CHANNEL-01 | 22-01, 22-02 | Admin can connect ManyChat account by entering API key (stored encrypted via AES-256-GCM) | ✓ SATISFIED | `actions.ts:26` calls `encrypt(data.apiKey)`. `crypto.ts:5,42` confirms AES-GCM via Web Crypto. Test asserts raw key never appears in insert payload. |
| CHANNEL-05 | 22-01, 22-02 | Admin can disconnect (delete) a ManyChat channel | ✓ SATISFIED | `actions.ts:57-60` calls `.delete().eq('id', id)`. Test `CHANNEL-05 > calls delete().eq("id", channelId)` passes. |
| WEBHOOK-01 | 22-01, 22-02 | POST /api/manychat/webhook receives External Request events from ManyChat flows | ✓ SATISFIED | `route.ts` exists at `src/app/api/manychat/webhook/route.ts`; build registers it as dynamic route; POST handler accepts JSON body. |
| WEBHOOK-02 | 22-01, 22-02 | Requests with invalid or missing X-Operator-Secret rejected with HTTP 403 | ✓ SATISFIED | `route.ts:23-33` uses `secret ?? ''` then maybeSingle lookup; null channel → 403. Both test cases (missing header, invalid secret) pass. |
| WEBHOOK-03 | 22-01, 22-02 | All inbound events logged to manychat_events with status: matched/unmatched/error | ✓ SATISFIED (foundation slice) | Phase 22 hardcodes `'unmatched'`; Phase 23 will introduce 'matched'/'error'. CHECK constraint on `status` (migration L66) enforces enum. Test `WEBHOOK-03: logs event to manychat_events with status unmatched` passes. |
| WEBHOOK-04 | 22-01, 22-02 | Webhook always returns HTTP 200 after secret validation (prevents retry storms) | ✓ SATISFIED | `route.ts:36-61` outer try/catch + final `Response.json({ok:true})` ensures 200 even on malformed JSON or DB insert errors. Test `WEBHOOK-04: returns 200 even when event payload is malformed JSON` passes. |

No orphaned requirements — every requirement listed for Phase 22 in REQUIREMENTS.md (lines 64-72) appears in both plan frontmatter blocks.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | — | — | grep for TODO/FIXME/XXX/HACK/PLACEHOLDER/coming soon/not yet implemented across `src/app/api/manychat/`, `src/app/(dashboard)/integrations/manychat/`, and migration 026 returned 0 hits. |

Notes on intentional seams (NOT anti-patterns):
- `status: 'unmatched'` hardcoded in `route.ts:57` — Phase 23 will introduce routing logic that produces `'matched'`/`'error'`. Documented in Plan 02 success criteria #5 and migration 026 comment.
- `matched_rule_id` and `action_log_id` columns on `manychat_events` are nullable with no FK — comment at migration L65/67 documents that Phase 23 will add the FKs once `manychat_rules` and `action_logs` exist.
- Webhook `try/catch` swallowing errors after secret validation — this is the WEBHOOK-04 contract (always-200 to prevent retry storms), not error suppression.

### Human Verification Required

#### 1. Apply migration 026 to Supabase (DB push)

**Test:** `npx supabase db push` once `SUPABASE_DB_PASSWORD` is available, then:
```sql
\d public.manychat_channels
\d public.manychat_events
SELECT enum_range(NULL::public.integration_provider);
SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.manychat_events'::regclass;
```
**Expected:**
- `manychat_channels` exists with `UNIQUE(org_id)`, RLS enabled, `org_isolation` policy.
- `manychat_events` exists with RLS enabled, only `org_isolation_select` + `org_isolation_insert` policies (no UPDATE/DELETE).
- `integration_provider` enum includes `'manychat'`.
- `update_updated_at` trigger fires on `manychat_channels` UPDATE.

**Why human:** SUPABASE_DB_PASSWORD is not present in this environment. Migration is written and SQL-correct on inspection but cannot be applied programmatically here.

#### 2. End-to-end channel creation against live DB

**Test:** Once migration applied AND a UI exists (Phase 24) OR via direct server-action invocation, call `createManychatChannel({ channelName: 'Test', apiKey: 'mc_test_key_LAST4' })` then:
```sql
SELECT channel_name, encrypted_api_key, key_hint, webhook_secret, is_active FROM public.manychat_channels;
```
**Expected:**
- One row with `channel_name = 'Test'`.
- `encrypted_api_key` matches `^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$` (iv:ciphertext base64 format).
- `key_hint = '••••••••AST4'` (last 4 of input).
- `webhook_secret` is a UUID v4.
- `is_active = true`.
- `org_id` populated by RLS from active session — never set in code.

**Why human:** Requires authenticated Supabase session + applied migration; cannot be exercised in unit-test mocks.

#### 3. Live webhook POST behavior

**Test:** With a real channel row, run:
```bash
# Valid secret
curl -i -X POST https://operator.skale.club/api/manychat/webhook \
  -H "Content-Type: application/json" \
  -H "X-Operator-Secret: <webhook_secret_from_db>" \
  -d '{"event_type":"flow_completed","subscriber_id":"abc"}'
# Invalid secret
curl -i -X POST https://operator.skale.club/api/manychat/webhook \
  -H "Content-Type: application/json" \
  -H "X-Operator-Secret: bogus" \
  -d '{}'
# Missing secret
curl -i -X POST https://operator.skale.club/api/manychat/webhook \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Expected:**
- Valid: HTTP 200, body `{"ok":true}`. Subsequent SELECT on `manychat_events` shows new row with `status='unmatched'`, `event_type='flow_completed'`, payload preserved.
- Invalid: HTTP 403, body `{"error":"Forbidden"}`. No new row in `manychat_events`.
- Missing: HTTP 403, body `{"error":"Forbidden"}`. No new row in `manychat_events`.

**Why human:** Production HTTP semantics + ManyChat retry behavior best validated against deployed endpoint. Unit tests cover the route handler logic in isolation; live behavior depends on Vercel deploy + applied migration.

### Gaps Summary

No code-level gaps. All 5 success criteria are fully implemented in the codebase:

- Migration SQL is syntactically correct and matches the plan exactly (encryption columns, append-only RLS pattern, enum extension as standalone statement to satisfy PostgreSQL's no-transaction constraint for ALTER TYPE).
- Server actions correctly encrypt before insert, generate per-channel webhook_secret, and never expose the raw API key to the caller.
- Webhook handler correctly gates on X-Operator-Secret via DB lookup, resolves `org_id` from the channel row (not the request body — anti-spoofing), and follows the always-200-after-validation contract.
- TypeScript Database types match the migration schema exactly, with `manychat_events.Update` typed as `Record<string, never>` to mirror the SQL append-only RLS at the type layer.
- All 11 RED test stubs from Plan 01 (Wave 0) are now GREEN under Plan 02 (Wave 2). `npm run build` exits 0. No regressions in the broader 156-test vitest suite (per Plan 02 SUMMARY).

The only outstanding items are deployment-time concerns: applying migration 026 to the live database and exercising the live webhook endpoint. Both require credentials/infrastructure not available to this verifier and are routed to human verification (Step 8).

---

_Verified: 2026-05-06T19:37:05Z_
_Verifier: Claude (gsd-verifier)_
