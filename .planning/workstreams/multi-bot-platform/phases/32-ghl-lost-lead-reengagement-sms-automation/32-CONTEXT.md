# Phase 32: GHL Lost-Lead Reengagement SMS — Context

**Gathered:** 2026-05-15
**Status:** Ready for planning
**Source:** Conversation-locked decisions (revised after initial Twilio plans)

<domain>
## Phase Boundary

Cron-triggered automation that, on each due tick, lists GHL opportunities marked `status=Lost` whose `updatedAt` is older than a configurable threshold (default 180 days = ~6 meses), and sends a templated reengagement SMS to each contact via the **GHL Conversations API** (not Twilio). Anti-loop tracking prevents re-messaging the same contact. The schedule itself lives in a DB table managed by Operator — GitHub Actions only "pulses" the runner every 15 minutes; the runner decides whether it's actually time to dispatch.

v1.9 is single-tenant (Skleanings sub-account); no UI for managing the schedule (SQL updates only).
</domain>

<decisions>
## Implementation Decisions (locked this conversation)

### SMS dispatch
- **D-32-01** SMS is dispatched via `sendSmsViaGhl` (GHL Conversations API), NOT Twilio. The handler exists at `src/lib/ghl/send-sms.ts`.
- **D-32-02** Runner ALWAYS passes `contactId` direct to `sendSmsViaGhl` (skip the find-or-create branch). `contactId` comes from `/opportunities/search` response (`opp.contact.id`). 1 GHL API call per dispatch.
- **D-32-03** No phone format pre-validation. Trust the GHL CRM data. If a contact has no phone or no SMS permission in GHL, the Conversations API returns 4xx and the runner classifies as `failed` (not `skipped`).
- **D-32-04** Same GHL integration row (`provider='gohighlevel'`, identified by env `GHL_REENGAGEMENT_INTEGRATION_ID`) is used for BOTH listing opportunities AND sending SMS. Pre-flight assertion: `provider='gohighlevel'` AND `is_active=true`, else 500.
- **D-32-05** Optional env `GHL_REENGAGEMENT_FROM_NUMBER` overrides the GHL sub-account default SMS number. If unset, GHL picks its default.

### Scheduling (DB-backed)
- **D-32-06** GitHub Actions cron pulses every 15 minutes (`*/15 * * * *`), NOT the hardcoded `0 14 * * *` of the initial Twilio plan.
- **D-32-07** Actual schedule lives in new table `automation_schedules`:
  - One row per `automation_key` (string UNIQUE). Seed row: `'ghl_reengagement_sms'`.
  - Columns: `id`, `automation_key UNIQUE`, `is_active BOOLEAN`, `next_run_at TIMESTAMPTZ`, `interval_minutes INTEGER CHECK > 0`, `last_run_at`, `last_run_status TEXT CHECK IN ('success','error','skipped')`, `last_run_result JSONB`, `created_at`, `updated_at`.
  - No `org_id` (single-tenant for v1.9). Per-org schedules deferred to future Automations Platform.
  - RLS enabled but no policy → only service-role writes.
  - Seed migration sets `next_run_at = next 14:00 UTC` and `interval_minutes = 1440` (daily).
- **D-32-08** Runner reads `automation_schedules` at the top of every request. Decision matrix:
  - Row missing → 500
  - `is_active=false` → return `{ skipped: 'inactive' }`
  - `next_run_at > now()` AND no `?force=1` → return `{ skipped: 'not_due_yet', next_run_at }`
  - Otherwise: run the work, then UPDATE `last_run_at=now()`, `next_run_at=now() + interval_minutes minutes`, `last_run_status`, `last_run_result=result`, `updated_at=now()`.
- **D-32-09** `?force=1` query param on `workflow_dispatch` runs bypasses the schedule check (for manual testing / ad-hoc runs from GitHub UI).

### Anti-loop
- **D-32-10** Claim-first pattern: INSERT into `ghl_reengagement_sent` BEFORE calling GHL SMS, using insert+single semantics. On GHL failure, DELETE the just-inserted claim row. Defends T-32-04 (workflow_dispatch racing with cron).
- **D-32-11** Phone is NOT logged in `action_logs.request_payload` (we never have it in raw form during dispatch — only the opaque `ghl_contact_id`). The opaque contactId IS logged. Body still truncated to 40 chars.

### Migrations
- **D-32-12** Migration `032_ghl_reengagement_sent.sql` (already planned in 32-02 Task 3) — unchanged.
- **D-32-13** **NEW** migration `033_automation_schedules.sql` — adds table + seed row for `ghl_reengagement_sms`. Goes into Plan 02 as a new task (or its own sub-plan).

### Env vars
- **D-32-14** REMOVED: `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID`. The runner no longer touches Twilio.
- **D-32-15** REMAINING required env: `GHL_REENGAGEMENT_LOCATION_ID`, `GHL_REENGAGEMENT_INTEGRATION_ID`, `GHL_REENGAGEMENT_MESSAGE`, `GHL_REENGAGEMENT_TRIGGER_SECRET`.
- **D-32-16** Optional env: `GHL_REENGAGEMENT_THRESHOLD_DAYS` (default 180), `GHL_REENGAGEMENT_BATCH_LIMIT` (default 20 for Hobby safety; STATE.md "100" is the ceiling), `GHL_REENGAGEMENT_FROM_NUMBER` (optional override).

### Operator-facing
- **D-32-17** Schedule changes are made via direct SQL against `automation_schedules` (no UI in v1.9). Doc must include example UPDATE statements.
- **D-32-18** Manual run: trigger `workflow_dispatch` from GitHub UI, optionally with `?force=1` if testing before the scheduled time.

### Claude's Discretion
- Exact GHL date-filter param name (`date` vs `endDate` vs `lastStatusChangeStartDate`) — staging probe required; existing Plan 02 leaves this as `GHL_DATE_FILTER_PARAM` constant.
- Cron-parsing libs are NOT needed; `interval_minutes` is enough for v1.9.
- Whether to seed `next_run_at` to "tomorrow 14:00 UTC" or "5 minutes from now" — planner picks defensive default.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 32 itself
- `.planning/phases/32-ghl-lost-lead-reengagement-sms-automation/32-RESEARCH.md` — Updated 2026-05-15 to reflect GHL SMS + DB schedule (Pattern 9). All Twilio refs swapped.
- `.planning/phases/32-ghl-lost-lead-reengagement-sms-automation/32-VALIDATION.md` — REENG-13/14/18 rows updated for pulse cron + DB schedule.

### GHL handler (already shipped this conversation)
- `src/lib/ghl/send-sms.ts` — `sendSmsViaGhl(params, credentials)` — accepts `contactId` direct (preferred) or `to`+find-or-create. For phase 32 runner, ALWAYS pass `contactId`.
- `src/lib/ghl/client.ts` — `ghlFetch` / `ghlFetchJson` now accept optional `timeoutMs` (default 400ms). Lib code can pass higher (e.g., 10000ms for list, 2500ms for SMS).
- `src/lib/action-engine/execute-action.ts` — already branches `send_sms` on `ctx.integrationProvider`; relevant only if the runner ever goes through the dispatcher (it doesn't — the cron calls `sendSmsViaGhl` directly).

### Project guardrails
- `CLAUDE.md` — webhook return-200 rule does NOT apply to the runner (internal endpoint per REENG-06).
- `supabase/migrations/002_action_engine.sql:97-175` — `action_logs` schema and RLS patterns.
- `supabase/migrations/027_manychat_rules.sql:13-41` — org-scoped table + RLS policy pattern (mirrored by migration 032).
</canonical_refs>

<specifics>
## Specific Notes

- "6 meses sem contato" = `interval_minutes=1440` (daily run) cumulative; opportunity filter uses `updatedBefore = now() - thresholdDays days`. Default `thresholdDays=180`.
- The user invoked Operator's product framing earlier: "tipo n8n, não quero fazer nada pelo ghl, tudo por aqui". The DB schedule is the start of this — Operator owns scheduling end-to-end; GH Actions is just a pulse.
- Phase 32 is single-tenant (Skleanings). Multi-tenant is future Automations Platform phase.
</specifics>

<deferred>
## Deferred Ideas (NOT for v1.9)

- UI for editing `automation_schedules` rows — future Automations Platform
- Multi-tenant scheduling (per-org rows in `automation_schedules` with `org_id`) — future
- Cron-expression parsing (use `cron-parser` lib) — future when UI exists
- WhatsApp / email channels via the same automation — future
- STOP / opt-out auto-handling — future; manual GHL cleanup in v1.9
- Retry-with-backoff on GHL failures — failures visible in `action_logs`, next cron tick retries by virtue of anti-loop rollback
- Dry-run mode (`?dry=1`) — would be useful but not required for v1.9 (single test contact + `?force=1` covers it)
</deferred>

---

*Phase: 32-ghl-lost-lead-reengagement-sms-automation*
*Context locked: 2026-05-15 — captures conversation decisions that diverge from the original Twilio-based research/plans*
