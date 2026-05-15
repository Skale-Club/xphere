---
phase: 32
slug: ghl-lost-lead-reengagement-sms-automation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-15
---

# Phase 32 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Mirrors and refines the `## Validation Architecture` section of `32-RESEARCH.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (already in devDependencies) |
| **Config file** | none — defaults via `vitest run` |
| **Quick run command** | `npx vitest run tests/ghl-*.test.ts` |
| **Full suite command** | `npm test && npm run build` |
| **Estimated runtime** | ~15s (focused) · ~45s (full) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run tests/ghl-*.test.ts`
- **After every plan wave:** `npm test` + `npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green AND manual checks on migration SQL + workflow YAML + docs passed
- **Max feedback latency:** ~15 seconds for the focused subset

---

## Per-Task Verification Map

> Task IDs will be finalized by the planner. Below is the requirement → test mapping the planner MUST honor.

| Requirement | Behavior | Test Type | Automated Command | File (Wave 0) |
|-------------|----------|-----------|-------------------|---------------|
| REENG-01 | `listOpportunities()` issues GET to `/opportunities/search` with Bearer + `Version: 2021-07-28` + `location_id` + `status` + `limit` query | unit | `npx vitest run tests/ghl-list-opportunities.test.ts` | ❌ W0 |
| REENG-01 | Cursor pagination loops, stops when `meta.startAfter`/`startAfterId` absent | unit | same file | ❌ W0 |
| REENG-01 | Hard `maxPages` cap is enforced | unit | same file | ❌ W0 |
| REENG-02 | `location_id` passed; credentials come from decrypted `integrations.encrypted_api_key` | integration | `npx vitest run tests/ghl-reengagement-runner.test.ts` | ❌ W0 |
| REENG-03 | Status filter sent as `status=lost`; date-cutoff filter sent (param name locked by staging probe) | unit | tests/ghl-list-opportunities.test.ts | ❌ W0 |
| REENG-03 | JS-side defense: items younger than threshold filtered post-fetch | unit | tests/ghl-reengagement-runner.test.ts | ❌ W0 |
| REENG-04 | Runner extracts `contact.id`, `contact.firstName`, `contact.phone` from response items (normalizes either embedded shape OR N+1 fetch fallback) | unit | tests/ghl-reengagement-runner.test.ts | ❌ W0 |
| REENG-05 | `POST /api/automations/ghl-reengagement/run` executes full pass (list → skip → render → send → record → log) | integration | `npx vitest run tests/ghl-reengagement-route.test.ts` | ❌ W0 |
| REENG-06 | Missing `Authorization` header → HTTP 401 | unit | tests/ghl-reengagement-route.test.ts | ❌ W0 |
| REENG-06 | Wrong secret → 401 (constant-time compare via `crypto.timingSafeEqual`) | unit | same file | ❌ W0 |
| REENG-06 | Correct secret → does not 401 | unit | same file | ❌ W0 |
| REENG-07 | Response body matches `{ processed, sent, skipped, failed, errors[] }` shape | unit | same file | ❌ W0 |
| REENG-08 | `{{first_name}}` replaced with `contact.firstName` | unit | `npx vitest run tests/ghl-render-template.test.ts` | ❌ W0 |
| REENG-08 | Missing/empty/whitespace `firstName` → `amigo(a)` fallback | unit | same file | ❌ W0 |
| REENG-09 | Migration `032_ghl_reengagement_sent.sql` creates table with PK, FK (`org_id → organizations(id) ON DELETE CASCADE`), `UNIQUE (org_id, ghl_contact_id)`, RLS enabled, org-scoped policy using `(SELECT public.get_current_org_id())` | manual | review checklist against `supabase/migrations/032_*.sql` | ❌ W0 |
| REENG-10 | Existing `(org_id, ghl_contact_id)` rows are skipped before dispatch (or: claim-first INSERT … ON CONFLICT DO NOTHING returns nothing) | integration | tests/ghl-reengagement-runner.test.ts (seeded fake row) | ❌ W0 |
| REENG-11 | Successful dispatch inserts a `ghl_reengagement_sent` row | integration | same file (spy on insert) | ❌ W0 |
| REENG-11 | Failed dispatch does NOT leave a phantom row (claim-first → rollback OR send-then-record → simply no insert) | integration | same file | ❌ W0 |
| REENG-12 | `logAction` called per dispatch with `tool_name='ghl_reengagement_sms'`, `vapi_call_id='cron:ghl-reengagement:<iso>'`, masked phone, truncated body | unit | tests/ghl-reengagement-runner.test.ts (spy) | ❌ W0 |
| REENG-12 | Error case: log entry has `status='error'` and populated `error_detail` | unit | same file | ❌ W0 |
| REENG-13 | `.github/workflows/ghl-reengagement.yml` has `schedule: cron: '0 14 * * *'` | manual | YAML inspection | ❌ W0 |
| REENG-14 | Same file includes `workflow_dispatch:` trigger | manual | same | ❌ W0 |
| REENG-15 | Each missing required env var → HTTP 500 with clear actionable error string naming the missing var | unit | tests/ghl-reengagement-route.test.ts | ❌ W0 |
| REENG-16 | `THRESHOLD_DAYS` defaults to 180; `BATCH_LIMIT` defaults to its safe value when env absent | unit | same | ❌ W0 |
| REENG-17 | `docs/automations/ghl-reengagement.md` exists with env-var table + cron schedule + manual-trigger instructions | manual | doc review checklist | ❌ W0 |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

The planner MUST create plans whose first wave produces these test scaffolds BEFORE implementation, so feedback sampling exists from task 1 onward:

- [ ] `tests/ghl-list-opportunities.test.ts` — stubs for REENG-01, REENG-03
- [ ] `tests/ghl-render-template.test.ts` — stubs for REENG-08
- [ ] `tests/ghl-reengagement-runner.test.ts` — stubs for REENG-02, REENG-04, REENG-10, REENG-11, REENG-12
- [ ] `tests/ghl-reengagement-route.test.ts` — stubs for REENG-05, REENG-06, REENG-07, REENG-15, REENG-16
- [ ] `tests/__mocks__/` shared fixtures: fake GHL opportunities-search response, fake `integrations` row, fake decrypted creds (if Wave 0 needs them)
- [ ] No framework install — Vitest already in `devDependencies` `[VERIFIED: package.json]`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration SQL shape (RLS policy clause, FK CASCADE, UNIQUE constraint, BTREE on UNIQUE backing index) | REENG-09 | SQL DDL is best reviewed by reading; no programmatic linter for "uses the right RLS pattern" | `cat supabase/migrations/032_ghl_reengagement_sent.sql` and check 5-point checklist: (1) `CREATE TABLE IF NOT EXISTS`, (2) FK `ON DELETE CASCADE`, (3) `UNIQUE (org_id, ghl_contact_id)`, (4) `ENABLE ROW LEVEL SECURITY`, (5) `USING (org_id = (SELECT public.get_current_org_id()))` |
| Workflow YAML — cron schedule + workflow_dispatch trigger + bearer header + base URL secret | REENG-13, REENG-14 | YAML semantics are not typed; mistakes are silent | `cat .github/workflows/ghl-reengagement.yml` and check 4-point checklist: (1) `cron: '0 14 * * *'`, (2) `workflow_dispatch:` present, (3) `Authorization: Bearer ${{ secrets.GHL_REENGAGEMENT_TRIGGER_SECRET }}`, (4) URL uses `${{ secrets.OPERATOR_BASE_URL }}` |
| Docs completeness — env-var setup for Vercel + GitHub secrets, cron schedule explanation, manual trigger steps | REENG-17 | Documentation correctness is judgment-based | `cat docs/automations/ghl-reengagement.md` and check sections present: env vars table (required + optional), cron schedule + timezone note, manual trigger via GitHub UI, Vercel env var setup, GitHub repo secrets setup |
| Staging probe of GHL `/opportunities/search` response shape | REENG-01, REENG-04 | One-time observability check against live GHL — no automated equivalent | Run runner against staging with `BATCH_LIMIT=2` and `?dry=1` (if planner adds dry-run); inspect logs for actual response keys; confirm date-filter param name BEFORE locking lib code |

---

## Edge Cases Requiring Explicit Coverage

The runner test (`tests/ghl-reengagement-runner.test.ts`) MUST include cases for:

- **Empty Lost list:** returns `{ processed: 0, sent: 0, skipped: 0, failed: 0, errors: [] }`
- **All in anti-loop:** `processed = N`, `sent = 0`, `skipped = N`
- **Mixed success/failure:** `Promise.allSettled` style — one Twilio failure does not block other dispatches; failed entry appears in `errors[]`
- **Missing `firstName`:** SMS body contains `amigo(a)`; dispatch still succeeds
- **Missing or non-E.164 phone:** counted as `skipped` (not `failed`); reason logged
- **Twilio 500 / 21211:** counted as `failed`; `error_detail` logged; anti-loop NOT recorded
- **GHL 401 on first call:** entire run aborts with HTTP 500 + clear message
- **Page 2 errors (cursor mid-stream):** page 1 contacts still processed; pagination error logged

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING test files referenced above
- [ ] No watch-mode flags (`vitest run`, never `vitest`)
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter once plans land

**Approval:** pending
