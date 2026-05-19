---
gsd_state_version: 1.0
milestone: v2.7
milestone_name: milestone
status: verifying
last_updated: "2026-05-19T11:53:25.132Z"
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 2
  completed_plans: 2
---

# Xphere - State (v2.7 Unified Calls Hub + Pipeline UX)

## Current Position

Phase: 85 (unified-calls-db) — COMPLETE
Plan: 2 of 2 (all plans done)
Next: Execute phase 86 (unified-timeline-page)
Status: Phase 85 complete — both plans executed and committed
Last session: 2026-05-19 — Completed 85-02-PLAN.md (Vitest test suite for getUnifiedCalls/getUnifiedCall)

## Milestone Progress

- v2.6 Admin Landing SEO: ✅ Shipped 2026-05-19
- v2.7 Unified Calls Hub + Pipeline UX: 🔄 In Progress

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| VIEW-based unification (no materialized table) | DB handles RLS automatically via SECURITY INVOKER | Pending |
| call_type discriminator column ('ai' \| 'human') | Clean filter without JOIN complexity | Pending |
| OpportunityDetailSheet over new route | Consistent with ContactDetailSheet pattern | Pending |
| DnD activationConstraint distance+delay combo | Eliminates accidental drags while preserving responsiveness | Pending |

## Decisions Log

- Seeds SEED-014 and SEED-015 promoted to v2.7 milestone on 2026-05-19
- 85-01: unified_calls VIEW (063), UnifiedCall TypeScript type, and server actions verified fully correct — no changes needed
- 85-01: Stale .next cache caused false build failure from old /tools/ route; cleared and confirmed exit 0
- 85-02: maybeSingle() in fake Supabase client must return Promise directly (not proxy) to match action await pattern — chainable thenable proxy works for getUnifiedCalls, but maybeSingle terminates the chain in getUnifiedCall

## Blockers / Concerns

None

## Accumulated Context

- SEED-014 provides full decomposition: 6 phases (C1–C6) → mapped to phases 85–90
- SEED-015 provides full bug list: B1–B6 → mapped to phases 91–92
- Existing `/phone` and `/voice` routes must remain functional until phase 90 cleanup
- `call_logs` table is for Human/Twilio calls; `calls` table is for AI/Vapi calls
