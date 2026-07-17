---
workstream: medusa-commerce
created: 2026-07-17
gsd_state_version: 1.0
milestone: medusa-commerce
milestone_name: Medusa Commerce Agent Integration
status: ready
last_updated: "2026-07-17T14:09:05.000Z"
last_activity: 2026-07-17 -- Completed 131-03 (chat route R1-R5 matrix + message cap + maxDuration 60 + shared IP helper; CHT-02, CHT-03)
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 3
  completed_plans: 2
  percent: 67
---

# Project State — workstream medusa-commerce

## Project Reference

See: .planning/PROJECT.md (org-wide) and this workstream's ROADMAP.md / REQUIREMENTS.md.

**Core value:** Commerce tools act with visitor-level authority only — pinned identity, hard caps, no id parameters in tool schemas.
**Current focus:** Phase 131 — Chat Route Hardening

## Current Position

Phase: 131 of 137 (Chat Route Hardening)
Plan: 2 of 3 complete in current phase (131-01, 131-03) — 131-02 (CHT-04 SSRF guard) executing in a separate worktree
Status: In progress
Last activity: 2026-07-17 — Completed 131-03-PLAN.md (chat route R1-R5 matrix + message cap + maxDuration 60 + shared getClientIp helper; CHT-02, CHT-03 satisfied)

Progress: [▓▓▓▓▓▓▓░░░] 67%

## Performance Metrics

**Velocity:**
- Total plans completed: 2

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 131 | 2 | 24min | 12min |

## Accumulated Context

### Decisions

- 131-01: rateLimit's memory-fallback failMode is a per-instance **fixed-window Map** (CONTEXT.md's locked decision), not the "token-bucket" wording used elsewhere in REQUIREMENTS.md/contract — semantically equivalent for this purpose, documented in a code comment in `src/lib/rate-limit.ts` to prevent future confusion.
- 131-03: R4 (`chat:newsess:{ip}`) gates ANY session-create path — fresh (no sessionId), bogus/expired sessionId (Redis miss), and org-mismatched sessionId — not just the narrow "no sessionId" reading; the org-mismatch branch double-charges R3 then R4, accepted as a negligible edge-case cost. This matches the phase research's Pitfall 4 analysis and closes what would otherwise be an unbounded session-creation bypass.
- 131-03: `getSession` is called exactly once per request (org-independent, before org resolve) and reused for both the R3/R4 gate and the later session resolve/create decision — avoids a second Redis round trip; the two former byte-identical session-create blocks were deduplicated into `createNewSession(orgId)`.
- 131-03: Shared `getClientIp(request)` now lives in `src/lib/request-ip.ts`, used by both the chat route and the widget config route — no inline `x-forwarded-for` parsing remains in either.
- FROZEN contract: `.planning/research/INTEGRATION-CONTRACT.md` (canonical copy lives in the stuscle repo at `docs/INTEGRATION-XPHERE.md`). Payloads/headers/endpoints must match it exactly; changes require editing the contract first in BOTH repos.
- The Stuscle half (widget mount + mint route, wishlist module, `/agent/*` HMAC surface, event subscribers) is built in `C:\Users\Vanildo\Dev\stuscle` (its own GSD project, phases 1–5). Xphere phases must stay testable standalone (curl/mocks) — E2E lands when both sides ship.
- Model policy: gsd-executor on sonnet; plan-checker/verifier/integration-checker/nyquist-auditor on opus (`.planning/config.json` model_overrides).
- Anti-IDOR core rule (applies to EVERY commerce tool): tool input schemas contain NO cart_id/customer_id/email/order_id parameters — executors inject pinned ids from `conversations.memory.commerce` exclusively.
- Commerce write limits are fail-CLOSED (R7/R8/R9); read/chat limits fail to in-process memory fallback. Existing rate-limit call sites keep fail-open.
- Phase numbering 131–137 continues the global sequence (calendar-reliability workstream owns 126–130). Migration numbering: check latest `supabase/migrations/` at execution time (1258+ when planned).

### Blockers

(None)

### Notes

- `conversations.memory` JSONB already exists (migration 015) — commerce context lives at `memory.commerce`, no schema change needed for pinning.
- `ActionContext` already has `conversationId?` (added for DND in 1085) — run-agent call sites just need to pass it.
- Chat route: rate limits R1-R5 + message cap + maxDuration 60 landed in 131-03 (CHT-02, CHT-03 satisfied) — before any commerce tool ships.
- Xkedule integration (`src/lib/xkedule/*`, migration 1200) is the template for the Medusa provider.

## Session Continuity
**Stopped At:** Completed 131-03-PLAN.md
**Resume File:** .planning/workstreams/medusa-commerce/phases/131-chat-route-hardening/131-02-PLAN.md (CHT-04 SSRF guard — verify completion status; once landed, Phase 131 is fully complete and Phase 132 can begin)
