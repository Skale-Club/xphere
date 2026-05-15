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

- [ ] **REENG-13:** GitHub Action workflow `.github/workflows/ghl-reengagement.yml` runs on cron schedule `0 14 * * *` (≈ 11h BRT) and POSTs to the runner endpoint using `secrets.GHL_REENGAGEMENT_TRIGGER_SECRET` + `secrets.OPERATOR_BASE_URL`
- [ ] **REENG-14:** Workflow also supports `workflow_dispatch` for ad-hoc manual triggering from the GitHub UI

### REENG — Configuration

- [ ] **REENG-15:** Runner reads required env vars on each invocation: `GHL_REENGAGEMENT_LOCATION_ID`, `GHL_REENGAGEMENT_INTEGRATION_ID`, `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID`, `GHL_REENGAGEMENT_MESSAGE`, `GHL_REENGAGEMENT_TRIGGER_SECRET`. Missing required vars → HTTP 500 with a clear actionable error
- [ ] **REENG-16:** Optional env vars with defaults: `GHL_REENGAGEMENT_THRESHOLD_DAYS` (default 180), `GHL_REENGAGEMENT_BATCH_LIMIT` (default 100)
- [ ] **REENG-17:** Documentation file `docs/automations/ghl-reengagement.md` explains env var setup for Vercel + GitHub Action secrets, includes the cron schedule, and how to run a manual trigger

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
| REENG-01 | Phase 32 | Pending |
| REENG-02 | Phase 32 | Pending |
| REENG-03 | Phase 32 | Pending |
| REENG-04 | Phase 32 | Pending |
| REENG-05 | Phase 32 | Pending |
| REENG-06 | Phase 32 | Pending |
| REENG-07 | Phase 32 | Pending |
| REENG-08 | Phase 32 | Pending |
| REENG-09 | Phase 32 | Pending |
| REENG-10 | Phase 32 | Pending |
| REENG-11 | Phase 32 | Pending |
| REENG-12 | Phase 32 | Pending |
| REENG-13 | Phase 32 | Pending |
| REENG-14 | Phase 32 | Pending |
| REENG-15 | Phase 32 | Pending |
| REENG-16 | Phase 32 | Pending |
| REENG-17 | Phase 32 | Pending |

**Coverage:**
- v1.9 requirements: 17 total
- Mapped to phases: 17 ✓
- Unmapped: 0

---

*Requirements defined: 2026-05-15*
*Last updated: 2026-05-15 — initial v1.9 definition + traceability mapped to Phase 32*
