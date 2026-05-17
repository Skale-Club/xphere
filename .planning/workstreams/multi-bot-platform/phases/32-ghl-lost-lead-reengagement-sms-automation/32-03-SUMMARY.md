---
phase: 32-ghl-lost-lead-reengagement-sms-automation
plan: 03
subsystem: automations.ghl-reengagement.runner
tags: [runner, orchestration, claim-first, anti-loop, allSettled, ghl-sms, action-logs]

# Dependency graph
requires:
  - phase: 32-ghl-lost-lead-reengagement-sms-automation/01
    provides: "16 RED runner stubs in tests/ghl-reengagement-runner.test.ts (now GREEN, expanded to 19)"
  - phase: 32-ghl-lost-lead-reengagement-sms-automation/02
    provides: "listOpportunities + renderMessage + ghl_reengagement_sent table + typed Database['public']['Tables']['ghl_reengagement_sent']"
  - phase: 31
    provides: "sendSmsViaGhl GHL Conversations executor (v1.8)"
provides:
  - "runReengagement(cfg, supabase) — single typed entry point for one reengagement pass (REENG-02/04/10/11/12)"
  - "Typed exports: RunnerConfig, RunnerResult, RunnerError"
affects:
  - 32-04 (route + GH Action): imports runReengagement and persists RunnerResult into automation_schedules.last_run_result

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Claim-first INSERT/rollback DELETE around external side-effecting calls (D-32-10)"
    - "Promise.allSettled fan-out — preserves partial success/failure into RunnerResult.errors"
    - "Bulk pre-fetch anti-loop set (one SELECT, not N) — O(1) per-contact lookup via Set"
    - "JS-side date guard as defense-in-depth alongside server-side filter (Pitfall 1)"
    - "Env-agnostic library: route handler owns env parsing → runner takes typed RunnerConfig"
    - "Synthetic vapi_call_id pattern: 'cron:<automation>:<runStartedAtIso>' for cron-originated action_logs"
    - "Sensitive-payload redaction: action_logs.request_payload contains opaque contactId + truncated body only — never phone (D-32-11)"

key-files:
  created:
    - src/lib/automations/ghl-reengagement/runner.ts (244 LOC)
  modified:
    - tests/ghl-reengagement-runner.test.ts (rewritten: 16 RED stubs → 19 GREEN tests)

key-decisions:
  - "Pre-flight on integrations row asserts both provider='gohighlevel' AND is_active=true — wrong row → 500 (D-32-04)"
  - "Bulk SELECT against ghl_reengagement_sent done ONCE per run before fan-out (not per-contact) — O(1) lookup via Set"
  - "Insert conflict (UNIQUE violation from a concurrent run) caught and counted as skipped, not failed — sendSmsViaGhl NOT called"
  - "Body truncated to 40 chars BEFORE writing to action_logs.request_payload — full body still passed to sendSmsViaGhl"
  - "Pre-flight + listOpportunities errors are NOT caught — they propagate so Plan 04 route can 500"

patterns-established:
  - "Cron-originated dispatcher pattern: { processed, sent, skipped, failed, errors[] } typed result shape — reusable for future scheduled automations"
  - "Claim/rollback pair around any external send to prevent double-sends across concurrent runs"

requirements-completed:
  - REENG-02
  - REENG-04
  - REENG-10
  - REENG-11
  - REENG-12

# Metrics
duration: ~30 min
completed: 2026-05-15
---

# Phase 32 Plan 03: GHL Lost-Lead Reengagement Runner Summary

**One-liner:** `runReengagement(cfg, supabase)` — typed env-agnostic orchestrator that loads + validates the GHL integration, lists Lost opportunities older than threshold, claim-first INSERTs against `ghl_reengagement_sent`, dispatches via `sendSmsViaGhl({ contactId, body, fromNumber? })`, logs every attempt to `action_logs`, and returns `{ processed, sent, skipped, failed, errors[] }` — flipped 16 RED runner stubs to GREEN and added 3 new D-32-02/05 guard tests.

## Objective

Wave 3 — implement the runner that orchestrates one reengagement pass:
1. Resolve GHL integration row; decrypt API key; assert provider + is_active
2. List Lost opportunities older than threshold via `listOpportunities`
3. JS-side date guard (defense in depth)
4. Bulk anti-loop pre-check (one SELECT)
5. Per-contact claim-first INSERT → `sendSmsViaGhl({ contactId, body, fromNumber? })` → on success `logAction(success)`; on failure DELETE claim + `logAction(error)`
6. `Promise.allSettled` aggregation into typed RunnerResult
7. Return typed result

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-15 (after Plan 32-02 commit `b6a3587`)
- **Completed:** 2026-05-15
- **Tasks:** 1 / 1
- **Files:** 1 created + 1 rewritten = 2

## Accomplishments

- `runReengagement(cfg, supabase)` implemented as a single 244-LOC module with the contracts the planner specified verbatim
- All 3 typed exports present: `RunnerConfig`, `RunnerResult`, `RunnerError`
- Pre-flight `provider='gohighlevel' AND is_active=true` guard wired (D-32-04); wrong/inactive row throws → Plan 04 route will 500
- Claim-first pattern: INSERT into `ghl_reengagement_sent` BEFORE `sendSmsViaGhl`; rollback DELETE on GHL throw (D-32-10)
- Insert UNIQUE-violation (concurrent claim) caught → counted as skipped, NOT failed — sendSmsViaGhl is NOT called
- ALWAYS passes `contactId` direct into `sendSmsViaGhl`; never `to`/`phone` (D-32-02)
- Optional `cfg.fromNumberOverride` forwarded as `params.fromNumber`; when unset, key omitted entirely (D-32-05)
- `action_logs.request_payload` contains only `{ ghl_contact_id, body: <truncated to 40 chars> }` — phone NEVER logged (D-32-11)
- `Promise.allSettled` fan-out — single GHL failure does not block sibling dispatches
- JS-side date guard filters opps younger than `now() - thresholdDays days` even when GHL returns them (Pitfall 1 defense)
- `cfg.batchLimit` slice caps actual dispatches per run (Vercel Hobby safety)
- Synthetic `vapi_call_id = 'cron:ghl-reengagement:' + runStartedAtIso` on every logAction call
- `tool_config_id: null` on every logAction call (dispatch not bound to a tool_configs row)
- 16 Plan-01 RED stubs flipped to GREEN; test file rewritten with full Vitest mocks for `listOpportunities`, `sendSmsViaGhl`, `logAction`, `decrypt`, and a chainable Supabase mock builder. 3 new tests added covering D-32-05 fromNumber forwarding and D-32-02 contactId-direct paranoia.

## Task Commits

| Task | Commit | Description |
|---|---|---|
| 1 | `5077725` | feat(32-03): implement runReengagement orchestrator (claim-first + allSettled) |

## Files Created/Modified

- `src/lib/automations/ghl-reengagement/runner.ts` (NEW, 244 LOC) — single export `runReengagement` + 3 typed interfaces. Imports `listOpportunities`, `renderMessage`, `sendSmsViaGhl`, `logAction`, `decrypt`. Zero `process.env`, zero Twilio references, zero inlined Supabase client (caller injects).
- `tests/ghl-reengagement-runner.test.ts` (REWRITTEN, 354 LOC) — flips 16 `expect.fail(...)` stubs into real assertions. Adds hoisted `vi.mock` blocks for the four collaborators. Includes a `buildMockSupabase(...)` helper that supports per-contact insert-conflict simulation and an `alreadySentContactIds` seed for anti-loop testing. 19 tests total, all GREEN.

## Decisions Made

- Reused existing `logAction` (no-throw) without a try/catch wrapper — relies on its documented contract that it returns `null` on failure rather than throws
- Type narrowing on Supabase responses uses `as unknown as IntegrationRow` rather than chained generic typing on `.select(...)` — preserves runtime behaviour and avoids hitting Supabase's complex generic surface (the runner does not depend on the strict typed Row shape since the route handler is the only direct caller)
- Documentation header trimmed to 6 lines (was 15) after a follow-up edit pass to satisfy the 130–250 line acceptance budget — implementation logic unchanged
- Test file uses `vi.setSystemTime` only in the JS-date-guard test (other tests rely on fixture timestamps being absolutely old) — avoids leaking faked time into adjacent tests

## Deviations from Plan

None — plan executed exactly as written. The `<action>` block was copied verbatim into the file (with one ~10-line comment-block compaction to stay under the 250-LOC ceiling). All `<acceptance_criteria>` literal-string probes pass:

- `export async function runReengagement` — present
- `export interface RunnerConfig` / `RunnerError` / `RunnerResult` — all present
- `fromNumberOverride?: string` in RunnerConfig — present
- `const TOOL_NAME = 'ghl_reengagement_sms'` — present
- `Promise.allSettled` — present
- `cron:ghl-reengagement:` — present
- `sendSmsViaGhl` — 3 occurrences (import + 1 call + 1 in tests via mock; runner source has 2: import + call)
- `import { sendSmsViaGhl } from '@/lib/ghl/send-sms'` — present
- `import { listOpportunities` from '@/lib/ghl/list-opportunities' — present
- `import { renderMessage } from './render-template'` — present
- `import { logAction } from '@/lib/action-engine/log-action'` — present
- `import { decrypt } from '@/lib/crypto'` — present
- `.from('ghl_reengagement_sent').insert(` — present
- `.from('ghl_reengagement_sent').delete()` — present
- Pre-flight asserts provider == 'gohighlevel' with explicit error message — present
- `'lost'` lowercase — present (`status: 'lost'`)
- `contactId,` in smsParams — present
- `if (cfg.fromNumberOverride)` conditional — present
- `grep "TWILIO" runner.ts` → 0 matches
- `grep "twilioIntegrationId" runner.ts` → 0 matches
- `grep "process.env" runner.ts` → 0 matches
- `grep -E "sendSms\(|TWILIO|twilioIntegrationId" runner.ts` → 0 matches
- `wc -l runner.ts` → 244 (between 130 and 250)

## Issues Encountered

- **`npm run lint` script is broken project-wide** (pre-existing, unrelated). Running `npm run lint` produces: `Invalid project directory provided, no such directory: C:\Users\Vanildo\Dev\operator\lint`. The issue is that `next lint` was removed in Next.js 16 and the npm script in `package.json` (`"lint": "next lint"`) is now mis-parsed by Next as if `lint` were a positional directory argument. This affected NEITHER this plan's commit (no pre-commit lint hook) NOR `npm run build` (which exits 0 and includes the full strict TypeScript type-check). Filed as a deferred item — should be addressed by either (a) wiring `eslint.config.js` and switching the script to `eslint .` or (b) removing the script entirely. Not in scope for Plan 32-03.

## Verification

### `npm run build`

```
✓ Compiled successfully
✓ Linting and checking validity of types
```

Build exits 0. Full Next.js production build green; TypeScript strict accepts the new module and the rewritten test file.

### `npx vitest run tests/ghl-reengagement-runner.test.ts`

```
Test Files  1 passed (1)
     Tests  19 passed (19)
  Duration  ~430ms
```

All 19 tests pass (16 Plan-01 contract stubs flipped GREEN + 3 D-32-02/05 expansion guards added).

### `npx vitest run tests/ghl-list-opportunities.test.ts tests/ghl-render-template.test.ts tests/ghl-reengagement-runner.test.ts`

```
Test Files  3 passed (3)
     Tests  32 passed (32)
```

Phase 32 GREEN tests: 5 list + 8 render + 19 runner = 32. (Route file `tests/ghl-reengagement-route.test.ts` remains RED with 20 stubs — owned by Plan 32-04.)

### Acceptance probes

| Probe | Result |
|---|---|
| Runner file exists | ✓ |
| `wc -l` between 130-250 | 244 ✓ |
| `grep -c "process.env"` | 0 ✓ |
| `grep -cE "sendSms\(\|TWILIO\|twilioIntegrationId"` | 0 ✓ |
| `grep "Promise.allSettled"` | present ✓ |
| `grep "cron:ghl-reengagement:"` | present ✓ |
| `grep "ghl_reengagement_sent"` (insert + delete) | both present ✓ |
| `grep "if (cfg.fromNumberOverride)"` (D-32-05) | present ✓ |
| `grep "contactId,"` in smsParams (D-32-02) | present ✓ |

### REQ Coverage Trace

| REQ ID | Test that covers it |
|---|---|
| REENG-02 (credentials via integrations row) | `rejects when integration row is inactive` + `lists Lost opportunities older than threshold and dispatches SMS` |
| REENG-04 (contact extraction) | `passes contact.id and rendered body into sendSmsViaGhl params` |
| REENG-10 (anti-loop skip) | `skips contacts already present in ghl_reengagement_sent (anti-loop)` |
| REENG-11 (claim-first + rollback) | `claims the anti-loop row BEFORE sending, deletes on GHL failure (claim-first pattern)` |
| REENG-12 (logAction per dispatch) | `calls logAction once per dispatch attempt with tool_name="ghl_reengagement_sms"` + `logAction payload includes ghl_contact_id...` + `logAction on GHL failure: status="error"...` |

## fromNumberOverride End-to-End Confirmation (Run-8 GREEN)

Two tests cover D-32-05 explicitly:

- `cfg.fromNumberOverride set → forwards params.fromNumber on every sendSmsViaGhl call` — passes `'+5511AAA'` and asserts every `sendSmsViaGhl` call gets `params.fromNumber === '+5511AAA'`. ✓ GREEN.
- `cfg.fromNumberOverride unset → params.fromNumber undefined on every call` — confirms the key is omitted entirely when not provided. ✓ GREEN.

Both also confirm `params.to` and `params.phone` are undefined on every call (D-32-02 belt-and-suspenders).

## No-Twilio Confirmation

`grep -E "sendSms\(|TWILIO|twilioIntegrationId|twilio" src/lib/automations/ghl-reengagement/runner.ts` returns **zero matches**. The runner uses ONLY `sendSmsViaGhl` from `@/lib/ghl/send-sms`. No imports from `@/lib/twilio/*`, no env references to `*_TWILIO_*`, no field in RunnerConfig for a Twilio integration id. The dispatch path is end-to-end GHL Conversations API.

## Known Stubs

None introduced by this plan. The Plan-01 stubs for `tests/ghl-reengagement-runner.test.ts` (16 of them) are all flipped to real GREEN tests. Remaining Plan-01 stubs in `tests/ghl-reengagement-route.test.ts` (20 of them) are still RED — owned by Plan 32-04 per the Wave-0 contract.

## Open Questions Surfaced During Implementation

1. **GHL response shape for `/opportunities/search` not validated against staging in this plan.** The fixtures match the OPTIMISTIC embedded contact shape (`{ id, firstName, phone }`). If staging reveals a different shape (e.g. nested `opportunity.contact_id` separate from a `contacts[]` array), `listOpportunities` already has the normalization seam — but the runner's `opp.contact.id`/`opp.contact.firstName` access pattern assumes the optimistic shape. Plan 04 should either run the probe or accept that the runner will be brittle until the first live call surfaces the discrepancy.
2. **No live-DB integration test for the claim/rollback race.** The UNIQUE constraint from migration 032 is exercised at the type/mock level only. A future smoke test could insert a row from one process, then run the runner in a second process with the same contactId in fixture data, and confirm the claim is gracefully skipped. Deferred — out of scope for v1.9 unit test budget.
3. **`logAction` failures are silent.** If both `logAction` calls in the catch branch fail (extremely unlikely — they're swallowed by their own try/catch), the dispatch still reports `failed=1` and `errors[]` populated. This is the intentional contract of `logAction` (never throws). No action needed; documented here for the verifier's eye-line.

## Next Phase Readiness

- **Plan 32-04 (route + GH Action) ready to start.** Substrate available:
  - `runReengagement(cfg, supabase)` from `@/lib/automations/ghl-reengagement/runner`
  - `RunnerConfig` / `RunnerResult` / `RunnerError` typed exports
  - `automation_schedules` live in remote DB with seeded `ghl_reengagement_sms` row
  - Both Plan-01 route stubs (20 of them) still RED — ready to flip
- **No blockers.** Build green, runner tests green, no Twilio references anywhere in Phase 32 source code, runner stays env-agnostic.

## Self-Check: PASSED

- FOUND: src/lib/automations/ghl-reengagement/runner.ts (244 LOC, exports `runReengagement`, `RunnerConfig`, `RunnerResult`, `RunnerError`)
- FOUND: tests/ghl-reengagement-runner.test.ts (rewritten, 19 GREEN tests)
- FOUND commit: 5077725 (feat(32-03): implement runReengagement orchestrator (claim-first + allSettled))
- VERIFIED: `npx vitest run tests/ghl-reengagement-runner.test.ts` → 19 passed, 0 failed
- VERIFIED: `npx vitest run tests/ghl-list-opportunities.test.ts tests/ghl-render-template.test.ts tests/ghl-reengagement-runner.test.ts` → 32 passed (5 + 8 + 19)
- VERIFIED: `npm run build` exits 0
- VERIFIED: `grep -c "process.env" runner.ts` → 0 (env-agnostic)
- VERIFIED: `grep -cE "sendSms\(|TWILIO|twilioIntegrationId" runner.ts` → 0 (no Twilio anywhere)
- VERIFIED: `wc -l runner.ts` → 244 (within 130-250)

---
*Phase: 32-ghl-lost-lead-reengagement-sms-automation*
*Completed: 2026-05-15*
