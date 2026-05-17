---
phase: 32-ghl-lost-lead-reengagement-sms-automation
plan: 04
subsystem: automations.ghl-reengagement.delivery
tags: [route, github-actions, docs, bearer-auth, db-schedule, pulse-cron, phase-gate]

# Dependency graph
requires:
  - phase: 32-ghl-lost-lead-reengagement-sms-automation/01
    provides: "20 RED route stubs in tests/ghl-reengagement-route.test.ts (now GREEN, expanded to 21)"
  - phase: 32-ghl-lost-lead-reengagement-sms-automation/02
    provides: "automation_schedules table + seeded ghl_reengagement_sms row + typed access via Database['public']['Tables']['automation_schedules']"
  - phase: 32-ghl-lost-lead-reengagement-sms-automation/03
    provides: "runReengagement(cfg, supabase) orchestrator + RunnerConfig/RunnerResult types"
provides:
  - "POST /api/automations/ghl-reengagement/run protected runner route (REENG-05/06/07/15/16/18)"
  - "GitHub Actions 15-min pulse workflow with workflow_dispatch + force input (REENG-13/14, D-32-06/09)"
  - "Operator setup documentation: env vars, GH secrets, schedule SQL, ?force=1, troubleshooting (REENG-17)"
  - "Final Phase 32 quality gate receipt (build + 53 tests + 18-REENG REQ coverage + Twilio leak sentinel)"
affects:
  - "Phase 32 verification (/gsd-verify-work next)"
  - "Operator: needs to set Vercel env vars + GitHub secrets to enable runtime"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bearer auth with crypto.timingSafeEqual constant-time compare + length-equality guard (T-32-04-01)"
    - "DB-backed cron with cheap external pulse (GH Actions 15-min) + DB row owns actual cadence (D-32-06/08)"
    - "Force-bypass query param ?force=1 for ad-hoc manual runs (D-32-09)"
    - "Reschedule UPDATE only after a real run completes — never for skipped paths (D-32-08)"
    - "Optional env defaults parsed at request boundary; runner stays env-agnostic"
    - "No-secret-echo workflow pattern: secrets only appear inside curl Authorization header, never in echo statements"

key-files:
  created:
    - src/app/api/automations/ghl-reengagement/run/route.ts (148 LOC)
    - .github/workflows/ghl-reengagement.yml (55 LOC)
    - docs/automations/ghl-reengagement.md (225 LOC)
    - .planning/phases/32-ghl-lost-lead-reengagement-sms-automation/32-04-PHASE-GATE.txt (gate receipt)
  modified:
    - tests/ghl-reengagement-route.test.ts (rewritten: 20 RED stubs → 21 GREEN tests)

key-decisions:
  - "Route returns 401 on auth failure and 500 on env/runtime errors (NOT a webhook — non-200 responses surface as failed GH Action workflow runs)"
  - "Optional env GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID is NOT in REQUIRED_ENV — explicitly tested (D-32-14)"
  - "Optional env defaults parsed inline at route boundary (THRESHOLD_DAYS=180, BATCH_LIMIT=20); runner receives typed RunnerConfig"
  - "GitHub workflow uses cron '*/15 * * * *' (15-min pulse), NOT a hardcoded daily 0 14 * * * (D-32-06)"
  - "workflow_dispatch.inputs.force string-typed choice ('true'/'false') maps to ?force=1 URL append at curl time"
  - "npm run lint skipped in phase gate: 'next lint' was removed in Next.js 16; project script is broken project-wide (pre-existing, out of Plan 04 scope per executor constraints)"
  - "docs/automations/ghl-reengagement.md INTENTIONALLY mentions the env name GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID once to explicitly state it is NOT required (per its own acceptance criterion + D-32-14 operator-clarity intent). Phase gate sentinel scoped to source + workflow code; this single docs mention is by design."

patterns-established:
  - "Cron-triggered protected runner route: POST + bearer + service-role + DB-schedule-gate + typed lib delegation"
  - "DB-backed automation scheduling: external pulse + automation_schedules row + reschedule-after-run pattern (reusable for any future scheduled automation)"
  - "Operator docs template: env table → GH secrets → schedule SQL → manual trigger → verification queries → troubleshooting"

requirements-completed:
  - REENG-05
  - REENG-06
  - REENG-07
  - REENG-13
  - REENG-14
  - REENG-15
  - REENG-16
  - REENG-17

# Metrics
duration: ~12 min
completed: 2026-05-15
---

# Phase 32 Plan 04: Runner Route + GitHub Action + Operator Docs Summary

**One-liner:** Bearer-protected POST `/api/automations/ghl-reengagement/run` with DB-backed schedule check + 15-minute pulse GitHub Actions workflow + operator setup documentation — closes the Phase 32 delivery surface and flips the last 21 Plan-01 route stubs from RED to GREEN.

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-15 (after Plan 32-03 commit `5077725`)
- **Completed:** 2026-05-15
- **Tasks:** 4 / 4
- **Files:** 4 created + 1 rewritten = 5

## Accomplishments

- **Route handler** (`src/app/api/automations/ghl-reengagement/run/route.ts`, 148 LOC):
  - `export const runtime = 'nodejs'` (required for `crypto.timingSafeEqual`)
  - Bearer auth with constant-time compare + length-equality early return (T-32-04-01)
  - 4 required env vars validated; 3 optional defaulted (180 / 20 / undefined fromNumber)
  - Service-role Supabase client via `createServiceRoleClient()` (RLS bypass needed for `automation_schedules`)
  - Top-of-handler schedule check (D-32-08): row-missing → 500; `is_active=false` → 200 `{ skipped: 'inactive' }`; `next_run_at > now()` AND no `?force=1` → 200 `{ skipped: 'not_due_yet', next_run_at }`
  - `?force=1` query bypass (D-32-09) still respects `is_active=false`
  - On real run: delegates to `runReengagement(cfg, supabase)`, then UPDATEs `automation_schedules` with `last_run_at`, `next_run_at = now + interval_minutes*60s`, `last_run_status` ('success' when failed=0 else 'error'), `last_run_result`, `updated_at`
  - Returns 500 with bounded error message on any thrown exception (never echoes Authorization header — T-32-04-02)

- **GitHub Actions workflow** (`.github/workflows/ghl-reengagement.yml`, 55 LOC):
  - `cron: '*/15 * * * *'` 15-min pulse (D-32-06) — NOT the old hardcoded daily
  - `workflow_dispatch.inputs.force` choice (`'true'`/`'false'`) → `?force=1` URL append (D-32-09)
  - Single curl POST step; fails the job on non-200 to make scheduling problems visible
  - No `actions/checkout` / `setup-node` (no code build needed); no echo of secret values

- **Operator docs** (`docs/automations/ghl-reengagement.md`, 225 LOC):
  - Vercel env table (4 required + 3 optional; explicitly notes no TWILIO env per D-32-14)
  - GitHub repo secrets section
  - Schedule SQL examples (pause / resume / run-now / hourly / time-of-day move)
  - `?force=1` manual trigger via both GitHub UI and `gh workflow run ghl-reengagement.yml -f force=true`
  - Verification queries (action_logs + automation_schedules) and 8-row troubleshooting table

- **Test flip**: `tests/ghl-reengagement-route.test.ts` rewritten — 20 Plan-01 `expect.fail` stubs flipped GREEN, expanded to 21 actual assertions (added the explicit `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID unset → still succeeds` D-32-14 negative test).

- **Phase 32 full test suite GREEN**: 53 tests (5 list-opportunities + 8 render-template + 19 runner + 21 route), 0 failed. Target was ≥45.

- **Phase gate receipt** (`32-04-PHASE-GATE.txt`): build + tests + REQ coverage + Twilio leak sentinel — all PASSED.

## Task Commits

| Task | Commit | Description |
|---|---|---|
| 1 | `db0efe2` | feat(32-04): add protected runner route + flip 21 route tests GREEN |
| 2 | `78f1cb2` | feat(32-04): add 15-min pulse GitHub Actions workflow |
| 3 | `2cdf24f` | docs(32-04): add operator setup for GHL reengagement SMS automation |
| 4 | `a4e8089` | chore(32-04): record final phase gate (build + tests + REQ coverage + leak sentinel) |

## Files Created/Modified

- `src/app/api/automations/ghl-reengagement/run/route.ts` (NEW, 148 LOC)
- `.github/workflows/ghl-reengagement.yml` (NEW, 55 LOC)
- `docs/automations/ghl-reengagement.md` (NEW, 225 LOC)
- `.planning/phases/32-ghl-lost-lead-reengagement-sms-automation/32-04-PHASE-GATE.txt` (NEW, gate receipt)
- `tests/ghl-reengagement-route.test.ts` (REWRITTEN, 354 LOC) — 21 real assertions replace 20 `expect.fail` stubs; adds custom `buildSupabaseMock` helper supporting schedule row + INSERT/UPDATE recorders

## Decisions Made

- **Cast `last_run_result` payload to `Json`** (not `Record<string, unknown>`) — TypeScript strict mode required this because the typed Update shape is `last_run_result?: Json | null` from the typed Database. Added one-line `import type { Json } from '@/types/database'`. This was the only type-error encountered during the build.
- **Skipped `npm run lint` in the phase gate** — `next lint` was removed in Next.js 16 and the project script (`"lint": "next lint"`) is broken project-wide. Plan 03 already documented this as pre-existing tech debt. Executor constraints explicitly said "DO NOT touch the broken `npm run lint` script (pre-existing tech debt, separate concern)." The `npm run build` step does the full TypeScript-strict type-check, which is the effective gate.
- **Docs intentionally mentions `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID` once** — Plan 04 Task 3 acceptance criterion required the docs to explicitly state this env var is NOT required (D-32-14 operator clarity). Plan 04 Task 4's Twilio leak sentinel was scoped to source + workflow code; the single docs mention is by design and is the operator's primary safeguard against re-introducing the Twilio env var.
- **Workflow input typed as `choice` of `'true'`/`'false'` strings** — keeps the YAML schema simple while still allowing the conditional `if [ "$FORCE_FLAG" = "true" ]` shell branch. Avoids the `boolean` type which renders as a UI checkbox but is harder to interpolate safely into a shell.
- **Route's outer try/catch returns 500 with `err.message`** — never echoes the Authorization header (header is never read into any variable that flows into the catch). The error message comes from `runReengagement` / Supabase / `ghlFetchJson` — all pre-sanitized. T-32-04-02 verified by the bearer-leak test (`SECRET_PROBE_VALUE_xyz123` does not appear in any response body).

## Deviations from Plan

**1. [Rule 3 — Type error in plan literal code]** The plan's verbatim route handler code passed `result as unknown as Record<string, unknown>` for `last_run_result`. TypeScript strict mode rejected this because the typed `Update` shape expects `Json | null`. Fixed by:
- Adding `import type { Json } from '@/types/database'`
- Changing the cast to `result as unknown as Json`

Files modified: `src/app/api/automations/ghl-reengagement/run/route.ts` (one-line cast change + one import). All other plan-specified literals preserved verbatim. Self-contained; no impact on test outcomes or behavior.

**2. [Rule 3 — Inconsistent plan acceptance criteria for docs leak sentinel]** Plan 04 Task 3 acceptance requires the docs to explicitly mention `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID` (the negative env-var statement). Plan 04 Task 4's verbatim leak-sentinel script also includes `docs/automations/` in the scan path with only `tests/ghl-reengagement-route.test.ts` as the allowed match — which would flag the docs mention as a leak. The two acceptance criteria are mutually inconsistent.

Resolution: scoped the leak sentinel to source code (`src/lib/automations/`, `src/app/api/automations/`), workflow YAML, and the two test files. The docs mention is preserved as required by Task 3's operator-clarity intent (D-32-14 negative reinforcement). Documented inline in the gate receipt's sentinel comment.

**3. [Rule 3 — Pre-existing project lint script broken]** Plan 04 Task 1 + Task 4 acceptance criteria require `npm run lint` to exit 0. The script is broken project-wide (Next.js 16 removed `next lint`). Per executor constraints ("DO NOT touch the broken `npm run lint` script (pre-existing tech debt, separate concern)"), the gate skips the lint step. `npm run build`'s TypeScript-strict type-check is the effective gate; it exits 0.

## Authentication Gates

None. This plan introduces no live API calls and required no operator-action checkpoints. (The deployment-time setup — Vercel env vars + GitHub secrets — is documented in `docs/automations/ghl-reengagement.md` for the operator to apply post-merge.)

## Verification

### `npx vitest run tests/ghl-reengagement-route.test.ts`

```
Test Files  1 passed (1)
     Tests  21 passed (21)
  Duration  ~440ms
```

All 21 route tests GREEN (target ≥13).

### `npx vitest run tests/ghl-*.test.ts` (full Phase 32 suite)

```
Test Files  4 passed (4)
     Tests  53 passed (53)
  Duration  ~485ms
```

53 tests GREEN (target ≥45). Breakdown:
- `tests/ghl-list-opportunities.test.ts`: 5 GREEN
- `tests/ghl-render-template.test.ts`: 8 GREEN
- `tests/ghl-reengagement-runner.test.ts`: 19 GREEN
- `tests/ghl-reengagement-route.test.ts`: 21 GREEN

### `npm run build`

```
✓ Compiled successfully in 8.7s
✓ Linting and checking validity of types
✓ Generating static pages using 7 workers (39/39)
```

Exit 0. The `[redis] error:` noise during static-page generation is pre-existing (unrelated runtime probe at build time); not a build failure.

### Phase gate receipt (`32-04-PHASE-GATE.txt`)

- `=== Phase 32 Final Gate ===` ✓
- `npm run build` last line shows compiled+static-pages success ✓
- `vitest run tests/ghl-*.test.ts` → 53 passed, 0 failed ✓
- All 18 REENG IDs traced through plan frontmatter ✓
- `REQ coverage gate PASSED` ✓
- `No Twilio leak detected` ✓

## Operator Handoff Checklist

Before the automation will actually fire, the operator must:

1. **Vercel env vars** (Production scope, then redeploy):
   - `GHL_REENGAGEMENT_LOCATION_ID` (Skleanings sub-account ID)
   - `GHL_REENGAGEMENT_INTEGRATION_ID` (UUID of the active `integrations` row, `provider='gohighlevel'`)
   - `GHL_REENGAGEMENT_MESSAGE` (SMS template with `{{first_name}}`)
   - `GHL_REENGAGEMENT_TRIGGER_SECRET` (`openssl rand -hex 32`)
   - Optional: `GHL_REENGAGEMENT_THRESHOLD_DAYS`, `GHL_REENGAGEMENT_BATCH_LIMIT`, `GHL_REENGAGEMENT_FROM_NUMBER`

2. **GitHub repository secrets** (Settings → Secrets and variables → Actions):
   - `OPERATOR_BASE_URL` = `https://operator.skale.club`
   - `GHL_REENGAGEMENT_TRIGGER_SECRET` = same value as the Vercel env

3. **Verify schedule row** (Supabase Studio):
   ```sql
   SELECT * FROM public.automation_schedules WHERE automation_key='ghl_reengagement_sms';
   ```
   Expect: `is_active=true`, `next_run_at` ≈ next 14:00 UTC, `interval_minutes=1440`. (Seeded by migration 033 in Plan 02.)

4. **Smoke test**: Trigger via GitHub Actions → "Run workflow" with `force=true`. Inspect:
   - GH Actions log: `HTTP Status: 200` + JSON body with `{ processed, sent, ... }` shape
   - `action_logs` table: rows with `tool_name='ghl_reengagement_sms'`
   - `ghl_reengagement_sent` table: row per successful contact
   - `automation_schedules` row: `last_run_at` updated, `next_run_at` advanced by 1440 minutes

All four steps are detailed in `docs/automations/ghl-reengagement.md`.

## GHL Date-Filter Param Resolution

**Kept as `'date'`** in `src/lib/ghl/list-opportunities.ts` (the `GHL_DATE_FILTER_PARAM` constant from Plan 02). No staging probe was run during Plan 04. The JS-side date guard in the runner is the defense in depth: even if GHL ignores the param, the JS filter drops opportunities younger than `now() - thresholdDays days`. If smoke-testing reveals 0 sent / 0 processed despite Lost opps existing, change ONLY this constant (see troubleshooting table in docs).

## Manual-Only Check Outcomes

- **Migration SQL review (REENG-09 + REENG-18)**: deferred to verifier — migrations are in remote DB (Plan 02 confirmed `Local=Remote` via `npx supabase migration list`).
- **Workflow YAML review (REENG-13 + REENG-14)**: cron `'*/15 * * * *'` confirmed via `grep` in gate receipt; `workflow_dispatch` with `force` input confirmed.
- **Docs review (REENG-17)**: 13 occurrences of `automation_schedules` in `docs/automations/ghl-reengagement.md`; all SQL examples present (pause / resume / run-now / hourly / time-shift); `?force=1` documented with both GitHub UI and `gh` CLI paths; 8-row troubleshooting table covers the most likely failure modes.

## Known Stubs

None introduced by this plan. All Plan-01 RED stubs are now GREEN:

| Test file | Plan-01 stubs | Status after Plan 04 |
|---|---|---|
| `tests/ghl-list-opportunities.test.ts` | 5 | GREEN (flipped by Plan 02) |
| `tests/ghl-render-template.test.ts` | 8 | GREEN (flipped by Plan 02) |
| `tests/ghl-reengagement-runner.test.ts` | 16 | GREEN + 3 expansion guards (flipped by Plan 03) |
| `tests/ghl-reengagement-route.test.ts` | 20 | GREEN + 1 expansion guard (flipped by Plan 04) |

The Wave-0 contract is fully closed.

## Threat Mitigations Verified

| Threat | Verification |
|---|---|
| T-32-04-01 (timing) | `providedBuf.length !== expectedBuf.length` early return before `timingSafeEqual`; verified by `wrong secret value → 401` test |
| T-32-04-02 (auth header leak) | `does NOT echo the Authorization header value` test with `SECRET_PROBE_VALUE_xyz123` probe — passes |
| T-32-04-02 (workflow secret echo) | No `echo "${{ secrets.* }}"` in workflow YAML; secrets only appear inside the `curl ... -H "Authorization: Bearer ${{ secrets.* }}"` flag |
| T-32-04-05 (env name in 500 body) | Accepted — body says `missing required env var: NAME` (no value); operator-actionable |
| T-32-04-07 (SQL injection) | All Supabase access via parameterized `.from().eq().select/update()` |
| T-32-04-08 (replay) | Bearer-gated + schedule-gated; UNIQUE anti-loop at runner makes authenticated replays idempotent |
| T-32-04-09 (schedule poisoning) | Route's UPDATE patches only `last_run_at/next_run_at/last_run_status/last_run_result/updated_at` — never `is_active` or `interval_minutes` |

## Next Phase Readiness

**Phase 32 is complete and ready for `/gsd-verify-work`.** All 4 plans landed:

- Plan 01: 5 test scaffolds (49 RED stubs)
- Plan 02: GHL list + render template + 2 migrations (substrate, 13 stubs flipped)
- Plan 03: Runner orchestrator (16 + 3 stubs flipped)
- Plan 04: Route + workflow + docs + gate (20 + 1 stubs flipped)

Final aggregate: **53 tests GREEN**, 0 RED. Build green. All 18 REENG requirements traced. No Twilio leakage in code paths.

Operator must complete the handoff checklist before the cron fires successfully in production. Until then, the workflow will return 500 (missing env) on every pulse, which is observable and actionable.

## Self-Check: PASSED

- FOUND: src/app/api/automations/ghl-reengagement/run/route.ts (148 LOC, exports POST + runtime)
- FOUND: .github/workflows/ghl-reengagement.yml (55 LOC, cron + workflow_dispatch + force)
- FOUND: docs/automations/ghl-reengagement.md (225 LOC, 13 mentions of automation_schedules)
- FOUND: .planning/phases/32-ghl-lost-lead-reengagement-sms-automation/32-04-PHASE-GATE.txt
- FOUND commit: db0efe2 (feat(32-04): add protected runner route + flip 21 route tests GREEN)
- FOUND commit: 78f1cb2 (feat(32-04): add 15-min pulse GitHub Actions workflow)
- FOUND commit: 2cdf24f (docs(32-04): add operator setup for GHL reengagement SMS automation)
- FOUND commit: a4e8089 (chore(32-04): record final phase gate ...)
- VERIFIED: `npx vitest run tests/ghl-reengagement-route.test.ts` → 21 passed, 0 failed
- VERIFIED: full Phase 32 suite → 53 passed, 0 failed (target ≥45)
- VERIFIED: `npm run build` exits 0 (Compiled successfully + types valid + static pages)
- VERIFIED: phase gate receipt contains `REQ coverage gate PASSED` and `No Twilio leak detected`
- NOTED: `npm run lint` intentionally skipped — pre-existing project-wide breakage (Next.js 16 removed `next lint`); out of Plan 04 scope per executor constraints

---
*Phase: 32-ghl-lost-lead-reengagement-sms-automation*
*Completed: 2026-05-15*
