---
phase: 128-reliable-calendar-scheduling
plan: 06
status: complete
completed: 2026-07-16
requirements: [SCH-01, SCH-02, SCH-03]
---

# Plan 128-06 Summary: Apply Watermark Migration to Production

## What Happened

Operator checkpoint executed by the orchestrator via Supabase MCP `apply_migration` against project `mwklvkmggmsintqcqfvu`.

1. **Applied `1252_calendar_tick_watermark`** (renumbered from the plan's working example 1251 — taken by phase 127): `calendar_tick_watermark` table, `update_updated_at` trigger, RLS enabled with zero policies (service-role only, matching `automation_schedules`), both event types (`meeting.starts_in`, `meeting.ended`) baselined at `now()`, and the SCH-02 semantic `COMMENT` on `scheduled_workflow_ticks.fired_minute`.
2. **Post-apply verification (SQL):** both rows seeded, `relrowsecurity = true`, `policy_count = 0`.
3. **CRON_SECRET:** `.github/workflows/calendar-tick.yml` line 38 sends `Authorization: Bearer ${{ secrets.CRON_SECRET }}`; the secret is provisioned in production Coolify env (research-confirmed). The currently-deployed (old) route code ignores the table, so applying ahead of code deploy is harmless.

## ⚠ Deploy-time follow-up (REQUIRED at merge)

The new route code derives its scan window from the watermark. Between this apply and the branch's merge/deploy, the OLD code keeps dispatching under old wall-clock dedup keys, which the new offset-derived keys do not collide with. **Immediately after the merge deploys, re-seed the watermark to prevent a catch-up burst re-dispatching that gap:**

```sql
UPDATE public.calendar_tick_watermark SET scanned_to = now();
```

Also verify post-deploy: `curl -s -o /dev/null -w "%{http_code}" https://xphere.app/api/cron/calendar-tick` → expect 401 (secret required).

## Self-Check: PASSED
