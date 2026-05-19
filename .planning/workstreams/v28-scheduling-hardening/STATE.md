---
gsd_state_version: 1.0
milestone: v2.8
milestone_name: milestone
status: completed
last_updated: "2026-05-19T19:48:29.054Z"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 7
  completed_plans: 7
---

# Xphere - State (v2.8 Scheduling Hardening)

## Current Position

Phase: 96 — SCHED-TESTS (last)
Plan: 96-02 complete
Next: operator applies migration 072 via `npx supabase db push`; set `RESEND_API_KEY` on Vercel; (optional) verify Upstash REDIS_URL still configured
Status: 4/4 phases complete

## Milestone Progress

- v2.7 Unified Calls Hub + Pipeline UX: ✅ Shipped 2026-05-19
- v2.8 Scheduling Hardening: ✅ Shipped 2026-05-19

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Partial unique index on bookings (not full constraint) | Cancelled bookings should be allowed to overlap reactivated ones | ✓ Shipped (migration 072) |
| Rate limit per IP, not per email | Email is user-controlled — IP harder to spoof | ✓ Shipped (5/hr per IP+event) |
| Fire-and-forget emails | Booking success must not depend on third-party email delivery | ✓ Shipped (Resend, soft-disabled when key missing) |
| Custom fields fallback over hard failure | Auto-created contacts at risk of breaking on strict org configs | ✓ Shipped (defaults + try/catch + warn log) |

## Phase Summary

| Phase | Name | Plans | Tests | Build | Commits |
|-------|------|-------|-------|-------|---------|
| 93 | SCHED-HARDENING | 2 | n/a | ✓ | 4 |
| 94 | SCHED-EMAILS | 2 | n/a | ✓ | 3 |
| 95 | SCHED-CUSTOM-FIELDS | 1 | n/a | ✓ | 2 |
| 96 | SCHED-TESTS | 2 | 14/14 | ✓ | 3 |

## Blockers / Concerns

- Migration 072 must be applied to remote Supabase: `npx supabase db push`
- `RESEND_API_KEY` must be set on Vercel; helpers no-op (with warning) until then
- `REDIS_URL` should be set on Vercel; rate limiter fails open (allowed=true) if Redis is unreachable
- `RESEND_FROM` default is `bookings@xphere.skale.club` — verify the Resend domain has this address configured
