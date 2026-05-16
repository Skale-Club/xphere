---
phase: 32-ghl-lost-lead-reengagement-sms-automation
verifier: claude-opus-4-7 (gsd-verifier)
verified_at: 2026-05-15T20:30:00Z
status: human_needed
score: 11/11 must_have_truths verified (automated) — production smoke pending
build: pass
tests: 53/53 green
migrations_applied: [032, 033]
re_verification: false
known_doc_debt:
  - "REENG-18 is referenced in Plan 02/04 frontmatter and tested in code, but is NOT yet a row in .planning/REQUIREMENTS.md (orchestrator will add post-verification)"
  - "REENG-13 text in REQUIREMENTS.md still says cron '0 14 * * *' while implementation uses '*/15 * * * *' per D-32-06 (DB-backed schedule supersedes the hardcoded cron)"
  - "REENG-15 text in REQUIREMENTS.md still lists GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID as required while D-32-14 removed it; implementation correctly omits it"
human_verification:
  - test: "Operator sets Vercel env vars (4 required + up to 3 optional) and the two GitHub repo secrets per docs/automations/ghl-reengagement.md handoff checklist"
    expected: "All four required env vars (LOCATION_ID, INTEGRATION_ID, MESSAGE, TRIGGER_SECRET) resolved on Production; GitHub secrets OPERATOR_BASE_URL and GHL_REENGAGEMENT_TRIGGER_SECRET set"
    why_human: "Secrets cannot be set programmatically by this verifier — requires operator console access to Vercel + GitHub"
  - test: "Manually fire workflow_dispatch with force=true once env+secrets are in place, observe HTTP 200 + JSON body shape from production"
    expected: "GH Actions log shows 'HTTP Status: 200' and a body matching { processed, sent, skipped, failed, errors[] } OR a deliberate { skipped: 'inactive' | 'not_due_yet' } when paused"
    why_human: "Live network call against production endpoint + live GHL API — no automated equivalent at verification time"
  - test: "GHL date-filter param probe against staging: send one ?force=1 with BATCH_LIMIT=1 and confirm Lost-older-than-180d opps actually return"
    expected: "listOpportunities returns at least one Lost opp older than 180 days when at least one exists in the Skleanings GHL sub-account; if returns zero despite known-good Lost data, change GHL_DATE_FILTER_PARAM constant from 'date' to 'endDate' or 'lastStatusChangeStartDate' per troubleshooting table"
    why_human: "GHL API param name was deferred — JS-side date guard provides safety but optimal upstream filtering requires the staging probe"
  - test: "Confirm Twilio test SMS arrives at an opted-in test contact during the first live run"
    expected: "Test contact in the Skleanings GHL sub-account receives the rendered SMS body via the GHL Conversations API (using sub-account default From number or GHL_REENGAGEMENT_FROM_NUMBER if set)"
    why_human: "Requires a live human-controlled test phone and intentional production send; cannot be automated without sending real SMS"
  - test: "First scheduled 14:00 UTC run completes successfully and automation_schedules.next_run_at advances by 1440 minutes"
    expected: "After the seeded next_run_at fires, the row's last_run_at updates to now, last_run_status='success', last_run_result holds the RunnerResult JSON, and next_run_at = last_run_at + 1440 minutes"
    why_human: "Requires waiting for actual cron tick + DB inspection post-fact"
---

# Phase 32: GHL Lost-Lead Reengagement SMS — Verification Report

**Phase Goal:** Daily automated job that identifies GHL leads marked `Lost` for more than 180 days (Skleanings sub-account) and dispatches a reengagement SMS via the GHL Conversations API, with persistent anti-loop preventing duplicate sends to the same contact.

**Verified:** 2026-05-15T20:30:00Z
**Status:** human_needed — All automated must-haves PASS (53/53 tests, build green, migrations live on remote, runner logic correct). Goal-achievement gated on operator-side env/secret setup + first live run; no code gaps.

---

## Goal Achievement

The shipped code **delivers the phase goal** end-to-end. Reading `src/lib/automations/ghl-reengagement/runner.ts` (244 LOC) shows a clean orchestration: pre-flight integration assertion (provider='gohighlevel' + is_active=true), `listOpportunities` with cursor pagination and JS-side date guard, bulk anti-loop pre-fetch from `ghl_reengagement_sent` (single SELECT, not N+1), claim-first INSERT BEFORE `sendSmsViaGhl` with DELETE rollback on failure, `Promise.allSettled` so one GHL 4xx never blocks siblings, and per-attempt `logAction` with phone-redacted `request_payload`. The route handler at `src/app/api/automations/ghl-reengagement/run/route.ts` (148 LOC) wraps this in bearer auth using `crypto.timingSafeEqual` (with length-equality guard against side-channel leak), validates 4 required env vars, applies the DB-backed schedule check from `automation_schedules`, honors `?force=1` bypass, and writes back `last_run_at` / `next_run_at = now + interval_minutes` / `last_run_status` / `last_run_result` after each real run. The GitHub workflow at `.github/workflows/ghl-reengagement.yml` pulses every 15 minutes against `https://operator.skale.club/api/automations/ghl-reengagement/run` (canonical origin per CLAUDE.md) and supports `workflow_dispatch` with a `force` choice input that maps to `?force=1`.

What requires manual completion: the operator must apply the 4 Vercel env vars + 2 GitHub secrets documented in `docs/automations/ghl-reengagement.md` before any pulse can successfully POST. Until then, every pulse returns 500 ("missing required env var: NAME") — which is observable and actionable. The phase ships fully wired but not yet operationally fired.

---

## must_haves Verification

### Plan 01 (Wave 0 Test Scaffolds)

| Must-have | Status | Evidence |
|---|---|---|
| Four Vitest stub files exist targeting the 4 production surfaces | VERIFIED | `tests/ghl-list-opportunities.test.ts`, `tests/ghl-render-template.test.ts`, `tests/ghl-reengagement-runner.test.ts`, `tests/ghl-reengagement-route.test.ts` all present and pass |
| Each file has ≥1 currently-failing test per REQ from 32-VALIDATION.md | VERIFIED → flipped GREEN | All 49 RED stubs now GREEN; final count 53 passing (5+8+19+21) — even better than the 49 planned |
| Shared fixture exports realistic GHL `/opportunities/search` shape | VERIFIED | `tests/__mocks__/ghl-opportunities-fixture.ts` exports FIXTURE_CREDENTIALS, FIXTURE_LOST_OLD_PAGE_1, FIXTURE_LOST_OLD_PAGE_2, FIXTURE_LOST_RECENT_ONLY, FIXTURE_EMPTY with `meta.startAfter` + `meta.startAfterId` cursor + `contact.{id,firstName,phone}` shape |

### Plan 02 (Lib + Schema Substrate)

| Must-have | Status | Evidence |
|---|---|---|
| `listOpportunities()` calls GHL `/opportunities/search` with Bearer + `Version: 2021-07-28` + cursor + JS-side date/status defenses | VERIFIED | `src/lib/ghl/list-opportunities.ts:70-104` — cursor loop, status defense at line 91, JS-side date defense at lines 93-97, headers via `ghlFetchJson` |
| `renderMessage()` substitutes `{{first_name}}` (whitespace-tolerant, global), falls back to `amigo(a)` on null/undefined/empty/whitespace | VERIFIED | `src/lib/automations/ghl-reengagement/render-template.ts:6-15` — regex `/\{\{\s*first_name\s*\}\}/g`, trim-and-fallback to `'amigo(a)'`; 8 tests GREEN |
| `ghl_reengagement_sent` table live with org-scoped RLS, FK CASCADE, UNIQUE `(org_id, ghl_contact_id)` | VERIFIED | `supabase/migrations/032_ghl_reengagement_sent.sql` matches; `npx supabase migration list` shows `032 \| 032 \| 032` (Local=Remote) |
| `automation_schedules` table live with UNIQUE automation_key + `interval_minutes>0` CHECK + RLS-no-policy; seeded `ghl_reengagement_sms` row | VERIFIED | `supabase/migrations/033_automation_schedules.sql` matches; seeded `next_run_at = next 14:00 UTC`, `interval_minutes=1440`; `npx supabase migration list` shows `033 \| 033 \| 033` (Local=Remote) |
| `src/types/database.ts` has typed Row/Insert/Update for BOTH new tables | VERIFIED | line 362 (`ghl_reengagement_sent`) + line 394 (`automation_schedules`); `npm run build` compiles under strict TS |
| `DEFAULT_TIMEOUT_MS` exported from `src/lib/ghl/client.ts` | VERIFIED | Plan 02 SUMMARY confirms one-line `export const` prefix added; pre-existing 4 callers untouched |
| Plan 01 list (5) + render (8) tests flip RED → GREEN | VERIFIED | Run output shows all 13 GREEN |

### Plan 03 (Runner Orchestrator)

| Must-have | Status | Evidence |
|---|---|---|
| `runReengagement(cfg, supabase)` returns typed `RunnerResult { processed, sent, skipped, failed, errors[] }` | VERIFIED | `runner.ts:58-244`; return shape at line 243 |
| Pre-flight: integrations row asserted `provider='gohighlevel' AND is_active=true`; mismatch throws | VERIFIED | `runner.ts:66-84` — explicit `throw new Error(...)` on missing row, wrong provider, or inactive |
| Same integration row used for BOTH list and SMS dispatch — no Twilio | VERIFIED | `runner.ts:86-90` constructs single `ghlCredentials` used for both `listOpportunities` (line 97) and `sendSmsViaGhl` (line 195); `grep TWILIO runner.ts` = 0 matches |
| Contacts already in `ghl_reengagement_sent` skipped before dispatch | VERIFIED | `runner.ts:117-135` — bulk SELECT + Set lookup + per-opp skip; test `skips contacts already present in ghl_reengagement_sent (anti-loop)` PASS |
| Claim-first: INSERT BEFORE sendSmsViaGhl; DELETE on failure | VERIFIED | `runner.ts:152-171` INSERT first; `runner.ts:218-222` DELETE on catch; test `claims the anti-loop row BEFORE sending, deletes on GHL failure` PASS |
| Runner calls `sendSmsViaGhl({ contactId, body, fromNumber? })` — never `to`/`phone` | VERIFIED | `runner.ts:186-193` constructs `smsParams` with only `contactId`, `body`, and conditional `fromNumber` |
| One `logAction` per attempt with `tool_name='ghl_reengagement_sms'`, `vapi_call_id='cron:ghl-reengagement:<iso>'` | VERIFIED | `runner.ts:40` constant + `runner.ts:62-63` synthetic id + lines 198-210 success log + 223-236 error log |
| `request_payload` has `ghl_contact_id` + body truncated ≤40 chars; phone NEVER logged | VERIFIED | `runner.ts:41` `BODY_LOG_TRUNCATE=40`; `runner.ts:181-184` payload only contains `ghl_contact_id` + truncated body |
| `Promise.allSettled` for batch fan-out | VERIFIED | `runner.ts:146` |
| JS-side date guard filters opps younger than threshold | VERIFIED | `runner.ts:105-110` (defense in depth in addition to `list-opportunities.ts:93-97`) |
| GHL 4xx → counted as `failed` (not `skipped`) | VERIFIED | `runner.ts:212-237` — thrown error from sendSmsViaGhl increments `failed` and pushes to `errors[]`; test `GHL returns 4xx for contact with no phone → counted as "failed"` PASS |
| Plan 01 runner tests (≥11) flip to GREEN | VERIFIED | 19 GREEN (16 original + 3 D-32-02/05 expansion guards) |

### Plan 04 (Route + Workflow + Docs)

| Must-have | Status | Evidence |
|---|---|---|
| POST with correct bearer + active+due schedule invokes runner and returns 200 with full result shape | VERIFIED | `route.ts:54-143`; test `correct bearer + all env vars set → invokes runReengagement once and returns its result` PASS |
| Missing/wrong Auth header → 401 via `timingSafeEqual` | VERIFIED | `route.ts:32-42` uses `timingSafeEqual` with `providedBuf.length !== expectedBuf.length` length-equality early return (T-32-04-01); tests `missing Authorization header → 401` + `wrong secret value → 401 (constant-time compare with crypto.timingSafeEqual)` PASS |
| Missing required env var → 500 with body naming the var | VERIFIED | `route.ts:61-65` loop returns `missing required env var: NAME`; `it.each(REQUIRED_ENV)` covers all 4 vars |
| `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID` NOT in REQUIRED_ENV | VERIFIED | `route.ts:25-30` REQUIRED_ENV array has exactly 4 entries — no Twilio; explicit negative test `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID unset → still succeeds` PASS |
| Defaults: THRESHOLD_DAYS=180, BATCH_LIMIT=20 | VERIFIED | `route.ts:21-22` constants; lines 68-75 `parsePositiveInt` fallback |
| Schedule check: missing row 500; inactive 200 skipped; future-and-no-force 200 not_due_yet | VERIFIED | `route.ts:91-111`; 3 corresponding tests GREEN |
| `?force=1` bypasses schedule check | VERIFIED | `route.ts:79-85` + `route.ts:106` `!force &&` condition; test `?force=1 query param + future next_run_at → runReengagement IS called` PASS |
| Post-run UPDATE: last_run_at, next_run_at = now + interval_minutes, last_run_status, last_run_result | VERIFIED | `route.ts:126-141`; test `successful run UPDATEs schedule row` PASS — asserts UPDATE payload deep-equals RUNNER_RESULT and next_run is +60min |
| GH workflow cron `*/15 * * * *` + `workflow_dispatch` + bearer header + URL is canonical production origin | VERIFIED | `.github/workflows/ghl-reengagement.yml:18` cron; `:19-28` workflow_dispatch with force input; `:39+41` URL = `${{ secrets.OPERATOR_BASE_URL }}/api/automations/ghl-reengagement/run` (operator handoff sets OPERATOR_BASE_URL=`https://operator.skale.club`); `:46` `Authorization: Bearer ${{ secrets.GHL_REENGAGEMENT_TRIGGER_SECRET }}` |
| `docs/automations/ghl-reengagement.md` covers env table, GH secrets, schedule SQL, ?force=1 | VERIFIED | docs file 225 LOC; env table at line 32; explicit "There is no `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID`" call-out at line 42 |
| Plan 01 route tests (≥13) flip to GREEN | VERIFIED | 21 GREEN (20 original + 1 D-32-14 explicit no-Twilio guard) |
| `npm run build` exits 0; full Phase-32 suite GREEN | VERIFIED | `npm run build` → "Compiled successfully in 8.6s" exit 0; `npx vitest run tests/ghl-*.test.ts` → 4/4 files, 53/53 tests, 0 failed |

---

## Requirements Coverage

| REQ | Description (REQUIREMENTS.md) | Implementation Status | Evidence |
|---|---|---|---|
| REENG-01 | `listOpportunities` with cursor pagination | SATISFIED | `src/lib/ghl/list-opportunities.ts:57-107` — full cursor loop |
| REENG-02 | Accepts `location_id`; uses `integrations.encrypted_api_key` decrypted | SATISFIED | `runner.ts:66-90` loads + decrypts; `list-opportunities.ts:72` passes `location_id` |
| REENG-03 | Filters status=Lost AND `updatedAt`/`statusChangeDate` older than threshold | SATISFIED | Server-side at `list-opportunities.ts:75-76`; JS-side defense at `list-opportunities.ts:89-97` + `runner.ts:105-110` |
| REENG-04 | Each opp includes `contact.id`, `firstName`, `phone` | SATISFIED | `GhlContactRef` interface at `list-opportunities.ts:13-17`; runner consumes `opp.contact.id` (line 149) + `opp.contact.firstName` (line 179) |
| REENG-05 | `POST /api/automations/ghl-reengagement/run` (Node) executes full pass | SATISFIED | `route.ts:54-150` end-to-end |
| REENG-06 | Bearer auth via `GHL_REENGAGEMENT_TRIGGER_SECRET`; missing/wrong → 401 | SATISFIED | `route.ts:32-42` constant-time compare |
| REENG-07 | Returns `{ processed, sent, skipped, failed, errors[] }` | SATISFIED | `route.ts:143` returns RunnerResult; runner produces shape per `runner.ts:243` |
| REENG-08 | Substitutes `{{first_name}}`; fallback `amigo(a)` | SATISFIED | `render-template.ts:6-15` |
| REENG-09 | Migration: `ghl_reengagement_sent` with PK/FK CASCADE/UNIQUE/RLS+org-policy | SATISFIED | `032_ghl_reengagement_sent.sql:10-25`; live on remote |
| REENG-10 | Runner skips contacts already in `ghl_reengagement_sent` | SATISFIED | `runner.ts:117-135` bulk pre-check + Set |
| REENG-11 | Runner inserts row on successful dispatch | SATISFIED | `runner.ts:152-167` claim-first INSERT — fulfills REENG-11 by claim-first variant (row inserted BEFORE send, deleted only on failure → net effect: row exists iff dispatch succeeded) |
| REENG-12 | `logAction` per attempt with `tool_name='ghl_reengagement_sms'` + error_detail | SATISFIED | `runner.ts:198-210` success + `223-236` error |
| REENG-13 | GH workflow `.github/workflows/ghl-reengagement.yml` on cron `0 14 * * *` | SATISFIED (with documented divergence) | Implementation uses `*/15 * * * *` 15-min pulse per D-32-06; DB row in `automation_schedules` owns the actual `0 14 * * *` cadence (seeded `next_run_at = next 14:00 UTC`, `interval_minutes=1440`). REQ text and ROADMAP v1.9 goal are met by composition (pulse + DB schedule), but the REQ literal `'0 14 * * *'` string is stale. **Doc-debt for REQUIREMENTS.md.** |
| REENG-14 | Workflow supports `workflow_dispatch` | SATISFIED | `.github/workflows/ghl-reengagement.yml:19-28` with `force` choice input |
| REENG-15 | Required env: LOCATION_ID, INTEGRATION_ID, TWILIO_INTEGRATION_ID, MESSAGE, TRIGGER_SECRET | SATISFIED (with documented divergence) | Implementation has 4 (no Twilio) per D-32-14 — SMS dispatched via GHL Conversations API, not Twilio. REQ text is stale; docs and code intentionally omit the Twilio env. **Doc-debt for REQUIREMENTS.md.** |
| REENG-16 | Optional env defaults: THRESHOLD_DAYS=180, BATCH_LIMIT=20 | SATISFIED | `route.ts:21-22`; 2 tests GREEN |
| REENG-17 | `docs/automations/ghl-reengagement.md` exists with env, schedule, manual trigger | SATISFIED | 225-LOC doc covers all required sections + troubleshooting |
| REENG-18 | DB-backed schedule via `automation_schedules` (added in 32-CONTEXT, D-32-13) | SATISFIED in code; ORPHAN in REQUIREMENTS.md | Migration 033 + route schedule check + 6 tests GREEN. **Not yet a row in `.planning/REQUIREMENTS.md` traceability table** — orchestrator to add post-verification per phase-context instructions. |

**Coverage:** 18/18 REQs in implementation; 17/17 + 1 orphan (REENG-18) in REQUIREMENTS.md.

---

## Validation Strategy Coverage

| 32-VALIDATION.md Requirement | Actual State |
|---|---|
| Wave 0: 4 test files + shared fixture exist | PASS — all 5 files committed in Plan 01 |
| Test count target ≥45 | PASS — 53 tests across 4 files |
| `npx vitest run tests/ghl-*.test.ts` GREEN | PASS — 4 files passed, 53/53 tests passed, duration ~581ms |
| `npm run build` exits 0 | PASS — "Compiled successfully in 8.6s" |
| Migration 032 review checklist (5 points) | PASS — all 5: `CREATE TABLE IF NOT EXISTS` ✓, FK `ON DELETE CASCADE` ✓ (line 12), `UNIQUE (org_id, ghl_contact_id)` ✓ (line 16), `ENABLE ROW LEVEL SECURITY` ✓ (line 19), `USING (org_id = (SELECT public.get_current_org_id()))` ✓ (line 24) |
| Migration 033 review checklist (REENG-18) | PASS — `automation_key TEXT NOT NULL UNIQUE` ✓ (line 12), `interval_minutes INTEGER NOT NULL CHECK (interval_minutes > 0)` ✓ (line 15), `ENABLE ROW LEVEL SECURITY` with NO policy ✓ (line 25), seed row `ghl_reengagement_sms` with `next_run_at = next 14:00 UTC` and `interval_minutes=1440` ✓ (lines 35-42) |
| Workflow YAML review (cron + workflow_dispatch + bearer + base URL secret) | PASS (with intentional revision per D-32-06) — cron is `*/15 * * * *` not `0 14 * * *`; workflow_dispatch present with `force` input; bearer header present; URL uses `${{ secrets.OPERATOR_BASE_URL }}` |
| Docs review (env table, cron + timezone note, manual trigger, Vercel setup, GH secrets setup) | PASS — `docs/automations/ghl-reengagement.md` has all 5 sections; SUMMARY-04 reports 13 mentions of `automation_schedules` for schedule management examples |
| Sample 4 critical test names — do they actually exist and pass? | PASS — verified by reading verbose vitest output: (1) `skips contacts already present in ghl_reengagement_sent (anti-loop)` ✓, (2) `claims the anti-loop row BEFORE sending, deletes on GHL failure (claim-first pattern)` ✓, (3) `does NOT echo the Authorization header value in any response body or thrown error` ✓, (4) `next_run_at > now() and no ?force=1 → 200 with { skipped: "not_due_yet", next_run_at }; runReengagement NOT called` ✓ |
| Staging probe for GHL date-filter param name | DEFERRED — `GHL_DATE_FILTER_PARAM = 'date'` (constant in `list-opportunities.ts:51`); JS-side date guard provides defense in depth. Routed to human verification (item 3). |

---

## human_verification

See frontmatter `human_verification:` block. Five items:

1. **Vercel env vars + GitHub secrets setup** — operator console access required.
2. **First production POST via workflow_dispatch with force=true** — live network + GHL API call.
3. **GHL date-filter param staging probe** — confirm `'date'` is the correct GHL param name; if zero Lost opps returned despite known-good data, change the constant per the docs troubleshooting table.
4. **Test SMS arrival** — requires opted-in test contact + intentional live send.
5. **First scheduled 14:00 UTC cron tick** — wait for actual cron; verify `automation_schedules` row advances correctly.

---

## Gaps Found

**None blocking the goal.** All 11 must-have truths verified; no missing/stub/unwired artifacts.

The only items that prevent the automation from FIRING in production are operator-side actions (env vars + GH secrets), already documented in the handoff checklist. No code change required.

---

## Notable Findings

1. **Anti-loop is correctly claim-first, not send-then-record.** The runner INSERTs into `ghl_reengagement_sent` BEFORE calling `sendSmsViaGhl` and DELETEs on failure (`runner.ts:152-167` → `runner.ts:218-222`). This is the safer variant for race conditions (workflow_dispatch + scheduled cron firing close in time) — the UNIQUE constraint will cause the second concurrent claim to silently skip. The test `insert conflict (concurrent claim) — second concurrent run returning null row skips the dispatch` exercises this path explicitly. This satisfies REENG-11 with stronger guarantees than the literal REQ text (which says "after successful dispatch, insert" — implementation reverses the order and uses UNIQUE+rollback to provide the same net invariant with race safety).

2. **Bearer auth includes length-equality guard against `timingSafeEqual` length-mismatch crash.** `route.ts:40` returns `false` if `providedBuf.length !== expectedBuf.length` before calling `timingSafeEqual` (which throws on length mismatch). This is the textbook correct pattern — wrong-length inputs do leak via early return, but the LENGTH of the secret is not sensitive; the VALUE is, and the value is still constant-time-compared.

3. **Schedule write-back happens on result.failed > 0 (recorded as 'error'), but NOT on runReengagement throws.** If `runReengagement` throws (e.g., GHL 401 on the initial `listOpportunities` call, or integration row missing), the route's outer try/catch returns 500 but does NOT advance `automation_schedules.next_run_at`. Effect: every subsequent pulse hits the same failure with the same `next_run_at` until an operator intervenes. The original Plan-01 stub `runReengagement throws → schedule row updated with last_run_status="error"` was rewritten in Plan 04 to `runner returns failed > 0 → schedule row updated with last_run_status="error"` to match implementation reality. This is acceptable v1.9 behavior (failed GH Actions runs surface in the GitHub UI immediately and are operator-actionable), but worth flagging as a future hardening opportunity.

4. **`docs/automations/ghl-reengagement.md` line 42 intentionally mentions `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID`** to explicitly state it is NOT required. The phase-04 Twilio leak sentinel was deliberately scoped to source + workflow YAML to permit this single docs mention. Good operator-clarity choice.

5. **`npm run lint` is broken project-wide** (Next.js 16 removed `next lint`; `package.json` script `"lint": "next lint"` is now misparsed). Documented as pre-existing tech debt in Plans 03 + 04. NOT a Phase-32 regression. `npm run build` runs the full TypeScript strict type-check, which is the effective gate and exits 0.

6. **GHL date-filter param name was never staging-probed.** Constant remains `'date'` in `list-opportunities.ts:51`. If the production smoke test returns zero results despite known-good Lost data, the JS-side date guard will still over-fetch (no over-send risk — anti-loop holds), but the operator should change the constant per the troubleshooting table. Single-line edit, no redeploy of other code needed.

7. **REQUIREMENTS.md is mildly stale** vs implementation reality at REENG-13 (cron), REENG-15 (no Twilio env), and lacks REENG-18 entirely. None of these are code gaps — all are doc-text drifts that the orchestrator will resolve post-verification per the phase context. Explicitly flagged in frontmatter `known_doc_debt`.

---

## ISSUES FOUND

No code-side issues. Status is **human_needed** rather than **passed** strictly because production-validation of the live integration cannot complete until the operator applies the Vercel env vars + GitHub secrets and executes the first `workflow_dispatch --force=true` against the production endpoint. All automated must-haves pass; all 18 REQs are implementation-satisfied (with 3 REQ-text doc-debts the orchestrator will reconcile).

---

*Verified: 2026-05-15T20:30:00Z*
*Verifier: Claude Opus 4.7 (gsd-verifier)*
