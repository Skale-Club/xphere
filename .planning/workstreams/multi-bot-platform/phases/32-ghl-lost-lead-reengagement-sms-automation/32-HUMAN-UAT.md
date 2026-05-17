---
status: partial
phase: 32-ghl-lost-lead-reengagement-sms-automation
source: [32-VERIFICATION.md]
started: 2026-05-15T20:30:00Z
updated: 2026-05-15T20:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Vercel env vars + GitHub repo secrets applied per docs handoff
expected: All 4 required env vars (`GHL_REENGAGEMENT_LOCATION_ID`, `GHL_REENGAGEMENT_INTEGRATION_ID`, `GHL_REENGAGEMENT_MESSAGE`, `GHL_REENGAGEMENT_TRIGGER_SECRET`) resolved on Vercel Production; GitHub repo secrets `OPERATOR_BASE_URL=https://operator.skale.club` and `GHL_REENGAGEMENT_TRIGGER_SECRET=<same value>` set
result: [pending]
why_human: Secrets cannot be set programmatically by the verifier — requires operator console access to Vercel + GitHub
how_to: See `docs/automations/ghl-reengagement.md` § Setup checklist

### 2. First production POST via `workflow_dispatch` with `force=true` returns HTTP 200
expected: GH Actions log shows `HTTP Status: 200` and a JSON body matching `{ processed, sent, skipped, failed, errors[] }` OR a deliberate `{ skipped: 'inactive' | 'not_due_yet' }` when paused
result: [pending]
why_human: Live network call against production endpoint + live GHL API — no automated equivalent at verification time
how_to: GitHub → Actions → "GHL Reengagement SMS" → Run workflow → set `force=true` → Run

### 3. GHL date-filter param staging probe (`?force=1` with `BATCH_LIMIT=1`)
expected: `listOpportunities` returns at least one Lost opp older than 180 days when at least one exists in the Skleanings GHL sub-account. If returns zero despite known-good Lost data, change `GHL_DATE_FILTER_PARAM` constant in `src/lib/ghl/list-opportunities.ts:51` from `'date'` to `'endDate'` or `'lastStatusChangeStartDate'` per troubleshooting table
result: [pending]
why_human: GHL API param name was deferred — JS-side date guard provides safety but optimal upstream filtering requires live staging probe
how_to: Run with `BATCH_LIMIT=1` set on Vercel preview env, fire `?force=1`, inspect `processed` count vs known-good GHL Lost opps

### 4. Twilio test SMS arrives at opted-in test contact during first live run
expected: Test contact in the Skleanings GHL sub-account receives the rendered SMS body via the GHL Conversations API (uses sub-account default From number or `GHL_REENGAGEMENT_FROM_NUMBER` if set)
result: [pending]
why_human: Requires a live human-controlled test phone and intentional production send; cannot be automated without sending real SMS
how_to: Create or identify an opted-in Lost-status test contact with `updatedAt > 180 days ago` in Skleanings sub-account, fire `?force=1`, confirm SMS receipt on the test phone

### 5. First scheduled 14:00 UTC cron tick advances `automation_schedules.next_run_at` by 1440 minutes
expected: After the seeded `next_run_at` fires, the row's `last_run_at` updates to now, `last_run_status='success'`, `last_run_result` holds the RunnerResult JSON, and `next_run_at = last_run_at + 1440 minutes`
result: [pending]
why_human: Requires waiting for actual cron tick + Supabase Studio inspection post-fact
how_to: Wait until next 14:00 UTC, then in Supabase Studio query `SELECT * FROM automation_schedules WHERE automation_key = 'ghl_reengagement_sms';`

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
