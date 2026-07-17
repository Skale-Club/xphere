# Phase 131: Chat Route Hardening - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Mode:** Derived from user-approved integration plan + security design (plan-mode session 2026-07-17); discuss not needed

<domain>
## Phase Boundary

Harden the public, unauthenticated `POST /api/chat/{token}` endpoint (`src/app/api/chat/[token]/route.ts`) against cost abuse and flooding, and extend the rate limiter with failure modes. Pre-existing gap — ships standalone before any commerce tool. Contract: `.planning/research/INTEGRATION-CONTRACT.md` §7 (rate-limit matrix R1–R5).

</domain>

<decisions>
## Implementation Decisions

### rate-limit.ts failMode extension
- `rateLimit(key, limit, windowSeconds, opts?: { failMode?: 'open'|'memory'|'closed' })`, default `'open'` — every existing call site keeps identical behavior (do NOT touch them).
- `'memory'`: when Redis unavailable/errors, fall back to a per-instance in-process fixed-window Map (coarse, but non-zero protection). Reuse/extract logic rather than duplicating; bound the Map size (LRU or periodic sweep) to avoid unbounded growth.
- `'closed'`: when Redis unavailable, DENY (return limited). Reserved for commerce write budgets (Phase 134) — this phase only implements the mechanism + tests.

### Chat route limits (contract §7)
- R1 `chat:ip:{ip}` 20/60s memory — checked BEFORE the org DB lookup (cheapest rejection path).
- R2 `chat:ip:day:{ip}` 200/24h memory.
- R3 `chat:sess:{sessionId}` 10/60s memory — only when a sessionId is presented.
- R4 `chat:newsess:{ip}` 10/1h memory — only on the session-create branch (no incoming sessionId).
- R5 `chat:org:{orgId}` 300/60s open — after org resolve.
- On breach: HTTP 429 JSON `{error: 'rate_limited'}` with CORS headers (the widget already handles non-200 as error bubble). Do not stream.
- IP extraction: reuse the `x-forwarded-for` first-hop pattern from `src/app/api/widget/[token]/config/route.ts` — extract into a shared helper (e.g. `src/lib/request-ip.ts`) used by both routes.

### Message cap + duration
- `ChatRequestSchema.message: z.string().min(1).max(4000)` → 400 on violation.
- `export const maxDuration = 10` → `60` (tool round-trips in later phases need it; safe now).

### SSRF bonus fix
- `src/lib/custom-webhook/execute-webhook.ts`: call `assertPublicHttpUrl(url)` (from `src/lib/flows/url-guard.ts`) before fetch; on rejection return the executor's normal error string (no throw crashing the tool loop).

### Claude's Discretion
- Where the in-memory fallback store lives (module-level in rate-limit.ts is fine).
- Test structure (vitest — repo standard, `npm test`); cover: open/memory/closed behavior with Redis mocked down, R1 rejection before org lookup (mock supabase not called), message cap 400, oversized body.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/rate-limit.ts` — existing Redis fixed-window INCR+EXPIRE, fail-open.
- `src/lib/redis.ts` — Redis client.
- `src/app/api/widget/[token]/config/route.ts` — IP extraction + existing 30/min limiter usage pattern.
- `src/app/api/chat/[token]/route.ts` — the target; `ChatRequestSchema` at ~line 31, `maxDuration` line 19, CORS_HEADERS block.

### Established Patterns
- Routes return `Response.json({error}, {status, headers: CORS_HEADERS})`; vitest for unit tests (`tests/` + colocated).

### Integration Points
- Sessions: incoming `sessionId` from body; org resolve via `organizations.widget_token`.

</code_context>

<specifics>
## Specific Ideas

- Keep limiter checks cheap and sequenced: R1 → R2 → body parse/schema → R3/R4 → org resolve → R5. Do not resolve the org for requests already over IP limits.
- Log breaches with a compact prefix (e.g. `[chat-rl] R1 ip=... org=...`) for future alerting.

</specifics>

<deferred>
## Deferred Ideas

- CAPTCHA/PoW escalation for repeat offenders; org-level circuit breaker — v2.
- Commerce write budgets R6–R9 — Phase 134.

</deferred>
