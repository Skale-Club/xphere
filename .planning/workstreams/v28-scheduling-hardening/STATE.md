---
gsd_state_version: 1.0
milestone: v2.8
milestone_name: Scheduling Hardening
status: in_progress
last_updated: "2026-05-19T00:00:00.000Z"
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 7
  completed_plans: 0
---

# Xphere - State (v2.8 Scheduling Hardening)

## Current Position

Phase: 93 — SCHED-HARDENING
Plan: not started
Next: Plan and execute phase 93
Status: 0/4 phases complete

## Milestone Progress

- v2.7 Unified Calls Hub + Pipeline UX: ✅ Shipped 2026-05-19
- v2.8 Scheduling Hardening: 🔄 In Progress

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Partial unique index on bookings (not full constraint) | Cancelled bookings should be allowed to overlap reactivated ones | Pending |
| Rate limit per IP, not per email | Email is user-controlled — IP harder to spoof | Pending |
| Fire-and-forget emails | Booking success must not depend on third-party email delivery | Pending |
| Custom fields fallback over hard failure | Auto-created contacts at risk of breaking on strict org configs | Pending |

## Blockers / Concerns

- Upstash Redis must be configured (REDIS_URL in env) for rate limiting to work in production
- Resend API key may need to be set up (not confirmed in env)
