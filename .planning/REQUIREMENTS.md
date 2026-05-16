# Requirements: Operator

**Defined:** 2026-05-15
**Milestone:** v1.9 GHL Lost-Lead Reengagement (SMS)
**Core Value:** The Action Engine must work reliably for every tenant

---

## v1.9 Requirements

Requirements for the v1.9 milestone — MVP automation that detects GHL `Lost` opportunities older than a threshold and sends SMS reengagement messages via Twilio.

### GHL — Opportunities Query

- [ ] **REENG-01:** System adds `listOpportunities(locationId, { status, updatedBefore, limit })` to `src/lib/ghl/` that calls the GHL Opportunities Search API with cursor pagination
- [ ] **REENG-02:** The list method accepts a `location_id` (sub-account scope) and uses the org's GHL integration credentials (decrypted from `integrations.encrypted_api_key`)
- [ ] **REENG-03:** The list method returns only opportunities with `status=Lost` whose `updatedAt` (or `statusChangeDate`) is older than the supplied threshold
- [ ] **REENG-04:** Each returned opportunity includes `contact.id`, `contact.firstName`, and `contact.phone` (needed for downstream SMS dispatch)

### REENG — Reengagement Runner

- [ ] **REENG-05:** Endpoint `POST /api/automations/ghl-reengagement/run` (Node runtime) executes one full pass: list Lost > N days → dispatch SMS → persist anti-loop → log
- [ ] **REENG-06:** The endpoint authenticates via `Authorization: Bearer <GHL_REENGAGEMENT_TRIGGER_SECRET>`; missing or incorrect secret → HTTP 401
- [ ] **REENG-07:** The endpoint returns JSON `{ processed, sent, skipped, failed, errors[] }` for observability
- [ ] **REENG-08:** SMS message substitutes `{{first_name}}` (and uses fallback "amigo(a)" when missing) into the configured template before sending

### REENG — Anti-Loop Persistence

- [ ] **REENG-09:** New migration creates table `ghl_reengagement_sent` (id uuid PK, org_id uuid FK → organizations, location_id text, ghl_contact_id text, sent_at timestamptz default now(), UNIQUE constraint on (org_id, ghl_contact_id), RLS enabled with org-scoped policy)
- [ ] **REENG-10:** Before dispatching, the runner skips any contact whose `(org_id, ghl_contact_id)` already exists in `ghl_reengagement_sent`
- [ ] **REENG-11:** After a successful SMS dispatch, the runner inserts a row into `ghl_reengagement_sent`

### REENG — Logging

- [ ] **REENG-12:** Each SMS dispatch attempt (success or failure) is logged in `action_logs` with `tool_name='ghl_reengagement_sms'`, response payload, and error detail when applicable

### REENG — Scheduled Trigger

- [ ] **REENG-13:** GitHub Action workflow `.github/workflows/ghl-reengagement.yml` runs on cron schedule `*/15 * * * *` (15-min pulse — actual cadence governed by `automation_schedules` row, see REENG-18) and POSTs to the runner endpoint using `secrets.GHL_REENGAGEMENT_TRIGGER_SECRET` + `secrets.OPERATOR_BASE_URL`
- [ ] **REENG-14:** Workflow also supports `workflow_dispatch` for ad-hoc manual triggering from the GitHub UI (with `force` input mapping to `?force=1` to bypass schedule check)

### REENG — Configuration

- [ ] **REENG-15:** Runner reads required env vars on each invocation: `GHL_REENGAGEMENT_LOCATION_ID`, `GHL_REENGAGEMENT_INTEGRATION_ID`, `GHL_REENGAGEMENT_MESSAGE`, `GHL_REENGAGEMENT_TRIGGER_SECRET` (4 required — SMS dispatched via GHL Conversations API, no separate Twilio integration needed). Missing required vars → HTTP 500 with a clear actionable error
- [ ] **REENG-16:** Optional env vars with defaults: `GHL_REENGAGEMENT_THRESHOLD_DAYS` (default 180), `GHL_REENGAGEMENT_BATCH_LIMIT` (default 20 on Vercel Hobby; raise via env var if on Pro/Enterprise with > 10s function timeout), `GHL_REENGAGEMENT_FROM_NUMBER` (optional override for sub-account default)
- [ ] **REENG-17:** Documentation file `docs/automations/ghl-reengagement.md` explains env var setup for Vercel + GitHub Action secrets, includes the cron schedule, and how to run a manual trigger

### REENG — Schedule Persistence

- [ ] **REENG-18:** DB-backed schedule via `automation_schedules` table (migration 033) — single seeded row `automation_key='ghl_reengagement_sms'` with `interval_minutes=1440`, `next_run_at` advancing per successful run. Route handler checks `is_active` + `next_run_at <= now()` before invoking runner; `?force=1` bypass available; post-run UPDATE writes `last_run_at`, `last_run_status`, `last_run_result` (JSON), and recomputes `next_run_at = now + interval_minutes`

---

## Future Requirements

Deferred to a future milestone (likely a generic "Automations Platform" milestone). Tracked here so we don't lose context.

### Automations Platform

- **AUTO-01:** Generic `automations` table (org_id, name, trigger_type, audience_filter JSONB, action_config JSONB, schedule_cron, is_active)
- **AUTO-02:** Dashboard UI to list, create, edit, pause, run-now automations
- **AUTO-03:** Audience filter engine supporting status, tag, custom field, last activity, multi-criteria AND/OR
- **AUTO-04:** Multi-channel dispatch (email via Resend, WhatsApp via Twilio WA)
- **AUTO-05:** Per-org rules (multiple subaccounts and multiple rules per subaccount)
- **AUTO-06:** Auto-reply handling: STOP unsubscribe → mark in DB and skip future sends; SIM/positive intent → trigger follow-up workflow
- **AUTO-07:** Retry with exponential backoff on Twilio dispatch failures

---

## Out of Scope (v1.9)

Explicitly excluded from v1.9 to keep MVP focused. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Dashboard UI to configure the automation | MVP is hardcoded via env vars; UI belongs to the future Automations Platform milestone |
| Multi-tenant rules / multi-subaccount | Skleanings-only in v1.9; generalization is the AUTO-* future work |
| Email / WhatsApp channels | Twilio SMS only in v1.9 |
| Retry logic on failure | One-shot per cron tick; failures will be visible in `action_logs` |
| Real-time / event-driven triggers | Cron-only in v1.9 |
| Advanced template substitution (custom fields, conditional blocks) | Only `{{first_name}}` substitution in v1.9 |
| In-product opt-out / STOP handling | Out of scope; manual cleanup in v1.9 if needed |

---

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| REENG-01 | Phase 32 | Complete |
| REENG-02 | Phase 32 | Complete |
| REENG-03 | Phase 32 | Complete |
| REENG-04 | Phase 32 | Complete |
| REENG-05 | Phase 32 | Complete |
| REENG-06 | Phase 32 | Complete |
| REENG-07 | Phase 32 | Complete |
| REENG-08 | Phase 32 | Complete |
| REENG-09 | Phase 32 | Complete |
| REENG-10 | Phase 32 | Complete |
| REENG-11 | Phase 32 | Complete |
| REENG-12 | Phase 32 | Complete |
| REENG-13 | Phase 32 | Complete |
| REENG-14 | Phase 32 | Complete |
| REENG-15 | Phase 32 | Complete |
| REENG-16 | Phase 32 | Complete |
| REENG-17 | Phase 32 | Complete |
| REENG-18 | Phase 32 | Complete |

**Coverage:**
- v1.9 requirements: 18 total
- Mapped to phases: 18 ✓
- Unmapped: 0

---

*Requirements defined: 2026-05-15*
*Last updated: 2026-05-15 — added REENG-18 (DB-backed schedule via automation_schedules); reconciled REENG-13 (cron is 15-min pulse, schedule lives in DB) and REENG-15 (4 required env vars, no Twilio integration) with implementation per D-32-06/13/14*
