# Phase 131: Chat Route Hardening - Research

**Researched:** 2026-07-17
**Domain:** Next.js route hardening — rate limiting (Redis + in-memory fallback), input caps, SSRF guard
**Confidence:** HIGH (all findings verified directly against the codebase; maxDuration verified against Next.js 16 official docs; test baseline verified by running vitest)

## Summary

The target route `src/app/api/chat/[token]/route.ts` currently has **zero rate limiting, no message length cap, and `maxDuration = 10`**. The existing limiter `src/lib/rate-limit.ts` is a Redis fixed-window INCR+EXPIRE counter that fails open in exactly two places (a `!redis.isReady` guard and a catch-all around the Redis commands) — both are clean seams for the `failMode` extension. All five existing call sites pass exactly three arguments, so adding an optional fourth `opts` parameter is fully backward compatible.

Two environment facts dominate the test design: (1) vitest loads `.env.local` (which sets `REDIS_URL`), but Redis is **not running locally** (verified: ECONNREFUSED) — so any test importing the real `@/lib/redis` gets `isReady === false` and today's fail-open path; on a machine where Redis *is* running behavior flips, so limiter tests MUST mock `@/lib/redis`. (2) vitest's `include` is `tests/**/*.test.ts(x)` only — colocated `src/**/__tests__` files are silently ignored. Also note one **pre-existing baseline failure**: `tests/widget-config-route.test.ts` (2 failing tests, stale since the route gained greeting fields) — the phase touches that route for the IP-helper extraction, so the plan should repair that stale test or the "full suite green" gate cannot be met.

For the SSRF fix: `assertPublicHttpUrl` is **async** (it does DNS resolution via `node:dns/promises`), throws descriptive `Error`s prefixed `http_request:`, and short-circuits DNS for literal IPs. The tool loop (`run-agent.ts:797`) already catches executor throws and degrades to `'Tool execution failed'`, but the locked decision is to *return* a single-line error string from `executeWebhook` instead — which also gives the LLM actionable feedback and honors the executor's "no newlines" (Vapi) convention.

**Primary recommendation:** Extend `rateLimit` in place with a module-level fixed-window `Map` fallback (bounded by sweep-then-evict), wire R1–R5 into the route in the exact order R1 → R2 → body parse → R3/R4 → org resolve → R5, gate R4 on *every* session-create path (not just "no sessionId" — see Pitfall 4), and put all tests under `tests/` with `@/lib/redis` mocked.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**rate-limit.ts failMode extension**
- `rateLimit(key, limit, windowSeconds, opts?: { failMode?: 'open'|'memory'|'closed' })`, default `'open'` — every existing call site keeps identical behavior (do NOT touch them).
- `'memory'`: when Redis unavailable/errors, fall back to a per-instance in-process fixed-window Map (coarse, but non-zero protection). Reuse/extract logic rather than duplicating; bound the Map size (LRU or periodic sweep) to avoid unbounded growth.
- `'closed'`: when Redis unavailable, DENY (return limited). Reserved for commerce write budgets (Phase 134) — this phase only implements the mechanism + tests.

**Chat route limits (contract §7)**
- R1 `chat:ip:{ip}` 20/60s memory — checked BEFORE the org DB lookup (cheapest rejection path).
- R2 `chat:ip:day:{ip}` 200/24h memory.
- R3 `chat:sess:{sessionId}` 10/60s memory — only when a sessionId is presented.
- R4 `chat:newsess:{ip}` 10/1h memory — only on the session-create branch (no incoming sessionId).
- R5 `chat:org:{orgId}` 300/60s open — after org resolve.
- On breach: HTTP 429 JSON `{error: 'rate_limited'}` with CORS headers (the widget already handles non-200 as error bubble). Do not stream.
- IP extraction: reuse the `x-forwarded-for` first-hop pattern from `src/app/api/widget/[token]/config/route.ts` — extract into a shared helper (e.g. `src/lib/request-ip.ts`) used by both routes.

**Message cap + duration**
- `ChatRequestSchema.message: z.string().min(1).max(4000)` → 400 on violation.
- `export const maxDuration = 10` → `60` (tool round-trips in later phases need it; safe now).

**SSRF bonus fix**
- `src/lib/custom-webhook/execute-webhook.ts`: call `assertPublicHttpUrl(url)` (from `src/lib/flows/url-guard.ts`) before fetch; on rejection return the executor's normal error string (no throw crashing the tool loop).

### Claude's Discretion
- Where the in-memory fallback store lives (module-level in rate-limit.ts is fine).
- Test structure (vitest — repo standard, `npm test`); cover: open/memory/closed behavior with Redis mocked down, R1 rejection before org lookup (mock supabase not called), message cap 400, oversized body.

### Deferred Ideas (OUT OF SCOPE)
- CAPTCHA/PoW escalation for repeat offenders; org-level circuit breaker — v2.
- Commerce write budgets R6–R9 — Phase 134.

### Specific Ideas (from CONTEXT.md)
- Keep limiter checks cheap and sequenced: R1 → R2 → body parse/schema → R3/R4 → org resolve → R5. Do not resolve the org for requests already over IP limits.
- Log breaches with a compact prefix (e.g. `[chat-rl] R1 ip=... org=...`) for future alerting.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHT-01 | `rate-limit.ts` gains `failMode: 'open'\|'memory'\|'closed'`; existing call sites unchanged | Current signature + both fail-open seams mapped (lines 34–37, 58–67); all 5 call sites inventoried, all 3-arg; memory-fallback design + bounding strategy specified. NOTE: REQUIREMENTS.md says "token-bucket" but the locked CONTEXT decision says "fixed-window Map" — CONTEXT wins (see Open Question 1). |
| CHT-02 | Chat route enforces R1–R5 → 429 on breach | Exact route flow with line numbers + insertion map below; session-create branch analysis for R4 (incl. the bogus-sessionId bypass); CORS_HEADERS reuse for the 429. |
| CHT-03 | `message` max 4,000 chars; `maxDuration = 60` | Schema location (route line 31–38); maxDuration semantics on Coolify/Docker verified against Next 16 docs (platform metadata, no self-hosted enforcement — safe, forward-compatible). |
| CHT-04 | `custom_webhook` executor guarded by `assertPublicHttpUrl` | Executor read in full; URL source is org-authored `tool_config.config` JSONB; `assertPublicHttpUrl` is async/throwing with DNS resolution; tool-loop catch behavior at `run-agent.ts:797` confirmed; return-string pattern specified. |
</phase_requirements>

## Project Constraints (from xphere CLAUDE.md)

- Run `npm run build` after changes to catch type errors before finishing (build = widget bundles + `next build --webpack`).
- Public API routes use `export const runtime = 'nodejs'` (already set on the chat route).
- Tests are vitest under `tests/` (`npm test` → `vitest run`).
- Public cross-origin endpoints must include CORS headers on ALL responses (including errors) — the chat route's `CORS_HEADERS` const already exists (route lines 21–25).
- Deployment: self-hosted Coolify (Docker standalone) at `xphere.app` — NOT Vercel. Relevant to the maxDuration finding.
- Sensitive paths not touched by this phase: `src/lib/crypto.ts`, `supabase/migrations/` (no migration needed for this phase).

## Standard Stack

### Core (no new dependencies — locked decision extends existing code)

| Library | Version (package.json) | Purpose | Why |
|---------|------------------------|---------|-----|
| `redis` (node-redis) | ^5.11.0 | Existing fixed-window counters | Already the limiter backend; `isReady`, `incr`, `expire`, `ttl` all in active use |
| `zod` | ^3.25.76 | `ChatRequestSchema` message cap | Already validates the chat body |
| `vitest` | ^4.1.2 | Unit tests | Repo standard; config at `vitest.config.ts` |
| `next` | ^16.2.6 | Route handler, `maxDuration` | Existing |

**Installation:** none. Adding a rate-limit library (e.g. `rate-limiter-flexible`) is explicitly NOT wanted — the locked decision extends `src/lib/rate-limit.ts` in place.

## Architecture Patterns

### Current chat route flow (`src/app/api/chat/[token]/route.ts`, 168 lines) — verified line numbers

| Lines | Step | Notes for insertion |
|-------|------|---------------------|
| 18–19 | `runtime = 'nodejs'`, `maxDuration = 10` | CHT-03: change 19 to `60` |
| 21–25 | `CORS_HEADERS` const | Reuse for 429 responses |
| 31–38 | `ChatRequestSchema` (`message: z.string().min(1)`, `sessionId?`, `pageUrl?`) | CHT-03: add `.max(4000, 'message too long')` |
| 45–46 | traceId + `createLogger({ traceId, route: 'api/chat' })` | Breach logs hang off this logger |
| 49 | `const { token } = await params` | **R1 + R2 go immediately after this** (IP from headers only — no body, no DB) |
| 52–62 | JSON parse → `ChatRequestSchema.safeParse` → 400 | Message cap 400 comes free from the schema |
| 63 | destructure `message`, `incomingSessionId`, `pageUrl` | **R3/R4 go after this** (see session-branch analysis) |
| 66–74 | Org resolve: `organizations.select('id, name, is_active, widget_url_mode, widget_url_rules').eq('widget_token', token).single()` → 401 | **R5 goes after this** (key `chat:org:${org.id}`) |
| 80–91 | URL-rules check (Origin/Referer/pageUrl) → 403 | Unchanged |
| 93–128 | Session resolve/create (see below) | R4 hooks here |
| 130–133 | push message, `setSession` | Unchanged |
| 136–142 | `after()` persist user message | Unchanged |
| 145–163 | `runAgent(...)` → SSE `Response` | Unchanged |
| 164–167 | catch-all → 500 | Unchanged |

### Session-create branch analysis (critical for R4)

Lines 97–128 have **three** paths; **two of them create a session** (`crypto.randomUUID()` + `ensureDbSession` DB insert):

1. **Line 97–102 — resume:** `incomingSessionId` present AND `getSession` hit AND `existing.orgId === org.id`. No creation. → R3 applies.
2. **Line 103–115 — miss/mismatch create:** `incomingSessionId` present but Redis miss OR org mismatch → creates a NEW session. → **R4 must apply here too**, otherwise an attacker bypasses R4 entirely by sending a random `sessionId` on every request (each miss silently creates a session + DB row). See Pitfall 4.
3. **Line 116–127 — fresh create:** no `incomingSessionId` → creates a new session. → R4 applies (the case named in the decision).

**Recommended R3/R4 placement honoring "R3/R4 before org resolve":** call `getSession(incomingSessionId)` early — it only needs the sessionId (Redis read, org-independent, `src/lib/chat/session.ts:27`). Then:
- no `incomingSessionId` → check R4 (`chat:newsess:${ip}`)
- `incomingSessionId` present, `getSession` → null → check R4 (this request WILL create a session)
- `incomingSessionId` present, session found → check R3 (`chat:sess:${incomingSessionId}`)

Keep the fetched session object and reuse it in step 4 (avoids a second `getSession` round trip; the org-mismatch comparison at line 99 still happens after org resolve exactly as today). The org-mismatch sub-case (session found but wrong org — also a create) can additionally consume R4 after org resolve, or be accepted as a negligible gap since R1/R2 still cap it; planner's call.

Note the create-blocks at 104–115 and 117–127 are byte-identical — a natural small refactor into one local helper while touching this code.

### `rateLimit` current implementation (`src/lib/rate-limit.ts`, 68 lines) — the two fail-open seams

```typescript
// Seam 1 — lines 34-37: Redis not connected
if (!redis.isReady) {
  console.warn('[rate-limit] redis not ready, failing open for', key)
  return { allowed: true, remaining: limit, resetAt: 0 }
}
// ... INCR / EXPIRE(count===1) / TTL, key prefix `rl:${key}` ...
// Seam 2 — lines 58-67: any Redis exception
} catch (err) {
  console.warn('[rate-limit] redis error, failing open for', key, ...)
  return { allowed: true, remaining: limit, resetAt: 0 }
}
```

The failMode extension replaces the body of both seams with a switch: `'open'` → current return; `'memory'` → in-process fixed-window check; `'closed'` → `{ allowed: false, remaining: 0, resetAt: 0 }`. `RateLimitResult` shape (`allowed`, `remaining`, `resetAt`) needs no change.

### Every existing `rateLimit` call site (verified — all 3-arg, none breaks)

| File:line | Key | Args |
|-----------|-----|------|
| `src/app/api/widget/[token]/config/route.ts:46` | `widget:config:${ip}` | 30, 60 |
| `src/app/(dashboard)/calendar/_actions/bookings.ts:504` | `booking:${ip}:${eventTypeId}` | 5, 3600 |
| `src/app/api/analytics/ingest/route.ts:24` | `analytics:ingest:${ip}` | 120, 60 |
| `src/lib/copilot/execute-turn.ts:50` | `copilot:${user.id}` | (consts) |
| `src/app/api/playground/[agentId]/route.ts:54` | `playground:${user.id}` | (consts) |

### Redis client behavior when down (`src/lib/redis.ts`, 38 lines)

- Singleton (globalThis-guarded in dev for HMR). `connect()` is fired at module import, **fire-and-forget** — a failed connect logs `[redis] connect failed:` and the client simply never becomes ready; the module never throws at import.
- When down: `redis.isReady === false` → every current caller (`rate-limit.ts:34`, `session.ts:28,43`) short-circuits before issuing commands. Commands are never queued against a dead connection because of these guards.
- Mid-flight failures (connection drops after `isReady`) surface as **thrown errors** from the awaited command → caught by seam 2.
- Consequence for the memory fallback: both entry conditions ("not ready" and "threw") funnel to the same fallback function — one code path, both seams call it.

### IP extraction — three inline copies exist today

- `src/app/api/widget/[token]/config/route.ts:45` — `request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'` (the pattern the decision names)
- `src/app/api/analytics/ingest/route.ts:23` — identical
- `src/app/(dashboard)/calendar/_actions/bookings.ts:116` — server-action variant using `await headers()`, with an `x-real-ip` fallback

The decision requires `src/lib/request-ip.ts` used by the chat route + widget config route (a `(request: Request) => string` helper). Do NOT touch bookings.ts (server-action context, different API — out of scope). Migrating analytics ingest is optional/discretionary.

### SSRF guard integration (`execute-webhook.ts` × `url-guard.ts`)

- **URL source:** `tool_config.config` JSONB (`cfg.url`, parsed at `execute-webhook.ts:24`) — authored by org members, same threat model as the flow `http_request` node that already uses this guard (`src/lib/flows/engine.ts:474`).
- **`assertPublicHttpUrl(rawUrl)`:** `async`, returns `Promise<URL>`, **throws `Error`** on: unparseable URL, non-http(s) scheme, blocked hostname (`localhost`, `metadata.google.internal`, `metadata`), DNS resolution failure, or any resolved address being private/link-local/reserved (IPv4 + IPv6 + IPv4-mapped). Literal-IP hosts skip DNS (`net.isIP` fast path) — useful for deterministic tests. Error messages are prefixed `http_request:` (cosmetic mismatch in webhook context; acceptable or trivially re-wrapped).
- **Executor error-string convention:** success returns single-line `` `Webhook ${res.status}: ${truncatedBody}` ``; strings must contain **no newlines** (Vapi parser, header comment line 8). Config errors and timeout currently `throw`.
- **Tool loop no-throw reality:** both `executeAction` call sites in `src/lib/agent-runtime/run-agent.ts` (lines 770 and 1236) wrap in try/catch → `result = 'Tool execution failed'` (+ `tool_execute_failed` error log at 799). `execute-workflow-tool.ts:120` catches too. So a throw would NOT crash the loop — but returning the descriptive string is the locked decision and gives the LLM a self-correctable message.

**Recommended pattern** (after `parseConfig`, before the fetch):

```typescript
try {
  await assertPublicHttpUrl(cfg.url)
} catch (err) {
  // Same single-line convention as the success path; never throw for SSRF.
  return `Webhook blocked: ${sanitize(err instanceof Error ? err.message : 'invalid url')}`
}
```

### Memory-fallback store design (Claude's discretion — recommendation)

Module-level in `rate-limit.ts`:

```typescript
interface MemoryEntry { count: number; resetAt: number } // resetAt = Date.now() + windowSeconds*1000
const memoryStore = new Map<string, MemoryEntry>()
const MEMORY_STORE_MAX = 10_000

function memoryRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  let entry = memoryStore.get(key)
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowSeconds * 1000 }
  }
  entry.count += 1
  memoryStore.delete(key)      // re-insert → Map insertion order doubles as LRU
  memoryStore.set(key, entry)
  if (memoryStore.size > MEMORY_STORE_MAX) sweepOrEvict(now) // drop expired first, then oldest-inserted
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt }
}
```

Export a test-only reset (e.g. `export function __resetMemoryStoreForTests()`) OR rely on `vi.resetModules()` — an explicit reset export is more robust (module caching bites otherwise; see Pitfall 1).

### Logging breaches (obs conventions)

`createLogger` (`src/lib/obs/logger.ts`) emits one JSON line; **`warn` stays local** (stdout only); **`error` additionally fans out to Sentry + `event_logs`** (lines 68–71). Rate-limit breaches are expected traffic, not faults → use `log.warn('chat_rate_limited', { rule: 'R1', ip, orgId?, sessionId? })`. This is grep-able (satisfies the "[chat-rl]" intent via the structured event name) and avoids Sentry noise from every scraper. The route's existing `log` (line 46) is in scope at all R1–R5 insertion points.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | New library (`rate-limiter-flexible`, upstash SDK, etc.) | Extend `src/lib/rate-limit.ts` | Locked decision; existing INCR+EXPIRE pattern proven at 5 call sites |
| SSRF validation | Custom IP-range checks | `assertPublicHttpUrl` from `src/lib/flows/url-guard.ts` | Already handles IPv6, IPv4-mapped, CGNAT, metadata hostnames, DNS-resolved private IPs |
| IP extraction | Per-route inline parsing (a 4th copy) | New `src/lib/request-ip.ts` shared by chat + widget config | Locked decision; 3 inline copies already drifting (bookings has x-real-ip fallback, others don't) |
| SSE reading in tests | Custom stream reader | `readSseLines` from `tests/helpers/stream.ts` | Handles chunk-boundary buffering already |

**Key insight:** everything this phase needs already exists in the repo — the work is wiring and failure-mode semantics, not new capability.

## Common Pitfalls

### Pitfall 1: Module-level memory store leaks state across tests
**What goes wrong:** `chat-api.test.ts` does `await import(route)` per test but never `vi.resetModules()` — module instances (route → rate-limit → memoryStore Map) persist across every test in a file. Counters accumulate; test order changes results.
**How to avoid:** (a) in route-behavior tests, `vi.mock('@/lib/rate-limit')` returning `{ allowed: true }` by default (same as the file already mocks session/persist/agent-runtime); (b) in the dedicated limiter test file, call the exported test reset (or `vi.resetModules()` + re-import) in `beforeEach`.
**Warning signs:** tests pass alone, fail in file order; failures appear only after adding the Nth test.

### Pitfall 2: Redis is ambient, not controlled
**What goes wrong:** vitest `setupFiles` loads `.env.local`, which SETS `REDIS_URL` (verified). Importing the real `@/lib/redis` fires a real `connect()`. On this machine Redis is down (ECONNREFUSED, verified 2026-07-17) → `isReady` false → fallback path. On a machine/CI where Redis IS up, the same tests take the Redis path — different behavior, nondeterministic.
**How to avoid:** limiter tests MUST `vi.mock('@/lib/redis', ...)` with a controllable `{ isReady, incr, expire, ttl }` default export. Test 'open'/'memory'/'closed' by flipping `isReady` and by making `incr` reject.
**Warning signs:** tests green locally, red in CI (or vice versa); `[redis] connect failed:` noise in test output.

### Pitfall 3: Colocated tests silently never run
**What goes wrong:** `vitest.config.ts` `include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']` — a `src/lib/__tests__/rate-limit.test.ts` file would be ignored with zero warning. (CONTEXT.md's "tests/ + colocated" note is wrong about colocated.)
**How to avoid:** all new test files go under `tests/` (e.g. `tests/rate-limit.test.ts`, extend `tests/chat-api.test.ts`, extend/replace todos in `tests/custom-webhook.test.ts`).

### Pitfall 4: R4 bypass via bogus sessionId
**What goes wrong:** if R4 is gated strictly on "no incoming sessionId" (narrow reading of the decision), an attacker sends a fresh random `sessionId` each request → `getSession` misses → route creates a new session + `chat_sessions` DB row every time, unbounded — the exact flood R4 exists to stop.
**How to avoid:** gate R4 on "this request will create a session" (branches 2 and 3 above). This matches contract §7's wording ("chat route (session-create branch)") and the decision's intent; the parenthetical "(no incoming sessionId)" describes the common case, not an exclusion. Flagged for the planner as the recommended interpretation.
**Warning signs:** `chat_sessions` row count growing while R4 counters stay at 0.

### Pitfall 5: 429 without CORS headers is invisible to the widget
**What goes wrong:** a bare `Response.json({error:'rate_limited'}, {status:429})` lacks `Access-Control-Allow-Origin` → the browser blocks the widget from reading it; the user sees a generic network failure and the widget may retry.
**How to avoid:** every 429 uses `{ status: 429, headers: CORS_HEADERS }` — same as every other error return in this route. Optionally add `Retry-After` (from `rl.resetAt`) — discretionary.

### Pitfall 6: Pre-existing failing test on a file this phase touches
**What goes wrong:** `tests/widget-config-route.test.ts` has 2 baseline failures (verified by running it): the route now returns `greetingEnabled/greetingMessage/greetingDelaySeconds` and selects 11 columns, but the June-7 test still asserts the old 5-field shape. The phase edits this route (IP-helper swap), and the phase gate demands a green suite.
**How to avoid:** plan a small task to update the stale assertions (add greeting fields to the expected JSON; update the `select` string assertion) — legitimate drive-by since the file is being modified anyway. The newer `tests/widget/url-rules.test.ts` (Jul 16) passes and is unaffected.

### Pitfall 7: Newlines in the SSRF rejection string
**What goes wrong:** executor result strings feed Vapi's parser, which breaks on `\n` (executor header comment). `Error.message` from url-guard is single-line today, but defensive sanitation is free.
**How to avoid:** pass the message through the executor's existing `sanitize()` (line 61) before returning.

### Pitfall 8: Memory-mode daily windows reset on deploy
**What goes wrong:** R2 (200/24h) in memory mode survives only as long as the process; every Coolify deploy (or crash) zeroes it. With Redis up this doesn't apply (Redis TTL is authoritative); it's only the degraded mode.
**How to avoid:** nothing to fix — this is the accepted "coarse, but non-zero protection" trade-off from the decision. Document it in a code comment so nobody "fixes" it into a bug report later.

## Code Examples

### Mocking Redis for limiter tests (repo's established vi.mock style)

```typescript
// tests/rate-limit.test.ts — pattern from tests/chat-api.test.ts (vi.hoisted + vi.mock)
const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    isReady: false,
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
  },
}))
vi.mock('@/lib/redis', () => ({ default: mockRedis }))

beforeEach(() => {
  vi.clearAllMocks()
  mockRedis.isReady = false
  __resetMemoryStoreForTests() // or vi.resetModules() + dynamic import
})

it("failMode 'closed' denies when Redis is down", async () => {
  const { rateLimit } = await import('@/lib/rate-limit')
  const rl = await rateLimit('k', 5, 60, { failMode: 'closed' })
  expect(rl.allowed).toBe(false)
})

it("failMode 'memory' counts across calls when Redis is down", async () => {
  const { rateLimit } = await import('@/lib/rate-limit')
  for (let i = 0; i < 3; i++) await rateLimit('k2', 3, 60, { failMode: 'memory' })
  const rl = await rateLimit('k2', 3, 60, { failMode: 'memory' })
  expect(rl.allowed).toBe(false)
})

it("redis error path falls back per failMode (memory)", async () => {
  mockRedis.isReady = true
  mockRedis.incr.mockRejectedValue(new Error('boom'))
  const { rateLimit } = await import('@/lib/rate-limit')
  const rl = await rateLimit('k3', 1, 60, { failMode: 'memory' })
  expect(rl.allowed).toBe(true) // first hit within memory window
})
```

### R1-before-org-lookup test (decision-required assertion)

```typescript
// In tests/chat-api.test.ts style: mock '@/lib/rate-limit' and assert supabase untouched
;(rateLimit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
const res = await POST(makeRequest({ message: 'hi' }), { params: Promise.resolve({ token: 'valid-token' }) })
expect(res.status).toBe(429)
expect(await res.json()).toEqual({ error: 'rate_limited' })
expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
expect(createServiceRoleClient).not.toHaveBeenCalled()  // org lookup never happened
```

### SSRF tests without DNS flakiness (literal-IP fast path in url-guard)

```typescript
// Real url-guard, no mocking needed: literal IPs skip DNS (url-guard.ts:84-85)
// http://127.0.0.1/  http://169.254.169.254/  http://10.0.0.1/  → all rejected
// http://localhost/  → rejected by BLOCKED_HOSTNAMES (no DNS)
// http://8.8.8.8/    → passes the guard (public literal IP); stub global fetch for the success leg
const result = await executeWebhook({}, { url: 'http://169.254.169.254/latest/meta-data' })
expect(result).toMatch(/^Webhook blocked:/)
expect(result).not.toContain('\n')
```

### makeRequest with an IP header (for per-IP limit tests)

```typescript
function makeRequest(body: object, token = 'valid-token', ip = '203.0.113.9') {
  return new Request(`http://localhost/api/chat/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}
```

## State of the Art

| Old Approach | Current Approach | Where | Impact |
|--------------|------------------|-------|--------|
| Fail-open only | `failMode` tri-state (this phase) | rate-limit.ts | Foundation for Phase 134's fail-closed commerce budgets |
| `maxDuration = 10` | `60` | chat route | Metadata-only on Coolify (see below); needed if ever moved to Vercel-class platform |
| Inline IP parsing ×3 | `src/lib/request-ip.ts` | chat + widget config | Single hardened implementation |

**maxDuration on this deploy target (verified, Next.js 16.2 docs, 2026-03-13):** "Deployment platforms can use `maxDuration` from the Next.js build output to add specific execution limits." It is **build-output metadata for platforms — there is no runtime enforcement in a self-hosted Node/Docker server.** On Coolify the effective request ceiling comes from the reverse proxy (Traefik) timeouts, not this export. Supporting evidence from production behavior: LLM SSE streams from this route routinely exceed 10s today without being killed, despite `maxDuration = 10`. The 10→60 change is therefore zero-risk and purely forward-compatible; the plan should note this so nobody expects a behavioral change from it.

## Open Questions

1. **"token-bucket" vs "fixed-window" wording conflict**
   - What we know: contract §7 and REQUIREMENTS CHT-01 say "token-bucket fallback"; the locked CONTEXT decision says "per-instance in-process fixed-window Map".
   - Recommendation: implement **fixed-window** per the CONTEXT decision (most recent, most specific, user-approved). Semantically equivalent for this purpose; no contract payload/header is affected, so no contract edit is required — but the planner may note the wording drift.

2. **R4 gating breadth** — narrow ("no sessionId only") vs wide ("any session-create"). Recommendation: wide (see Pitfall 4). Needs planner confirmation since the CONTEXT parenthetical can be read narrowly.

3. **"Oversized body" test scope** — the discretionary test list mentions "oversized body". The `.max(4000)` cap only bounds `message`; `request.json()` will happily parse a multi-MB body first, and self-hosted Next has no default route-handler body limit. A cheap `Content-Length` pre-check (e.g. reject > 64KB before `request.json()`) would be a genuine hardening step but is NOT in the locked decisions. Recommendation: interpret "oversized body" as "message > 4000 → 400" (locked scope); flag the Content-Length guard as optional discretion.

4. **Full-suite green baseline** — beyond the known widget-config failures, many suites hit a real Supabase DB (RLS/invariant tests, `retry: 1` exists for that reason). Full-suite status on this machine wasn't run end-to-end (long, DB-dependent). The plan's phase gate should run the full suite once early to establish the true baseline before attributing failures to this phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/test | ✓ | ≥20 (`@types/node` ^20) | — |
| vitest | all tests | ✓ | 4.1.2 (ran successfully) | — |
| Redis (localhost:6379) | live limiter behavior | ✗ (ECONNREFUSED, verified) | — | Not needed: limiter tests mock `@/lib/redis`; memory mode is the point |
| Supabase (remote, via .env.local) | DB-backed suites in full run | ✓ (creds present in .env.local) | — | Route tests mock `@/lib/supabase/admin` |
| `npm run dev` server (:4267) | manual curl validation | available on demand | — | vitest route tests cover the same assertions |

**Missing dependencies with no fallback:** none — all phase work is testable with mocks; Redis being down locally actually exercises the exact degraded path the phase is about.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 (`globals: true`, env `node`, `include: tests/**/*.test.ts(x)`, setup `tests/setup/load-env.ts`, timeout 30s, retry 1) |
| Config file | `vitest.config.ts` (repo root); alias `@` → `src`, `server-only` stubbed |
| Quick run command | `npx vitest run tests/rate-limit.test.ts tests/chat-api.test.ts tests/custom-webhook.test.ts` |
| Full suite command | `npm test` (= `vitest run`) — note: includes real-DB suites |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHT-01 | `open` unchanged / `memory` counts with Redis down / `memory` on Redis error / `closed` denies / 3-arg call sites unaffected / Map bound | unit | `npx vitest run tests/rate-limit.test.ts` | ❌ Wave 0 (new file) |
| CHT-02 | R1 429 before org lookup (`createServiceRoleClient` not called); R2/R3/R4/R5 429 with `{error:'rate_limited'}` + CORS; R4 fires on bogus-sessionId create path; happy path still streams | unit (route, mocked deps) | `npx vitest run tests/chat-api.test.ts` | ✅ exists (10 green) — extend with a rate-limit describe block; mock `@/lib/rate-limit` |
| CHT-03 | 4001-char message → 400; 4000-char → passes schema; `maxDuration === 60` export assertion | unit | `npx vitest run tests/chat-api.test.ts` | ✅ extend same file |
| CHT-04 | Private/metadata/localhost URLs → `Webhook blocked: ...` return (no throw, no newline, fetch NOT called); public URL → fetch proceeds | unit | `npx vitest run tests/custom-webhook.test.ts` | ✅ exists but **all `it.todo`** — replace/add real tests |
| — | Pre-existing stale widget-config test repaired (route touched by IP-helper swap) | unit | `npx vitest run tests/widget-config-route.test.ts` | ✅ exists, **2 failing at baseline** — fix assertions |

### Manual/curl validation (optional, against `npm run dev` on :4267)
```bash
# Message cap → 400
curl -s -X POST http://localhost:4267/api/chat/<widget_token> \
  -H 'Content-Type: application/json' \
  -d "{\"message\": \"$(python -c 'print("x"*4001)')\"}" -w '\n%{http_code}\n'

# R1 → 429 on the 21st request within 60s from one IP (Redis down locally → memory fallback engages, proving CHT-01+CHT-02 together)
for i in $(seq 1 21); do curl -s -o /dev/null -w '%{http_code} ' \
  -X POST http://localhost:4267/api/chat/<widget_token> \
  -H 'Content-Type: application/json' -H 'x-forwarded-for: 203.0.113.9' \
  -d '{"message":"hi"}'; done; echo
# Expect: twenty 200s (or 401/403 if token/origin invalid — use a real token) then 429

# SSRF: create a custom_webhook tool pointed at http://169.254.169.254/ and invoke via playground;
# expect the tool result string "Webhook blocked: ..." in the transcript, not a hang or crash.
```

### Sampling Rate
- **Per task commit:** `npx vitest run tests/rate-limit.test.ts tests/chat-api.test.ts tests/custom-webhook.test.ts tests/widget-config-route.test.ts` (< 10s, all mocked, no DB)
- **Per wave merge:** the above + `npm run build` (CLAUDE.md hard requirement — storefront-style type laxness does NOT apply here; build is the type gate)
- **Phase gate:** `npm test` full suite; compare against the baseline established per Open Question 4 before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/rate-limit.test.ts` — covers CHT-01 (failModes, Redis-down/error paths, Map bounding, backward-compat default)
- [ ] Real tests in `tests/custom-webhook.test.ts` — covers CHT-04 (file exists but is 15 `it.todo` stubs and 0 executable assertions)
- [ ] Repair `tests/widget-config-route.test.ts` — 2 pre-existing failures on a file this phase modifies
- Framework install: none — vitest configured and verified working

## Sources

### Primary (HIGH confidence — direct codebase reads + executed commands, 2026-07-17)
- `src/app/api/chat/[token]/route.ts` (full), `src/lib/rate-limit.ts` (full), `src/lib/redis.ts` (full), `src/lib/chat/session.ts` (full), `src/lib/custom-webhook/execute-webhook.ts` (full), `src/lib/flows/url-guard.ts` (full), `src/lib/obs/logger.ts` (full)
- `src/lib/agent-runtime/run-agent.ts:745-814`, `src/lib/agent-runtime/execute-workflow-tool.ts:90-134`, `src/lib/flows/engine.ts:470-478`, `src/app/(dashboard)/calendar/_actions/bookings.ts:110-125,495-510`, `src/app/api/analytics/ingest/route.ts:1-40`, `src/app/api/widget/[token]/config/route.ts` (full)
- `vitest.config.ts`, `package.json`, `tests/setup/load-env.ts`, `tests/helpers/stream.ts`, `tests/chat-api.test.ts` (full), `tests/custom-webhook.test.ts` (full), `tests/widget-config-route.test.ts` (full), `tests/redis.test.ts`
- Executed: `npx vitest run tests/chat-api.test.ts` (10/10 pass), `npx vitest run tests/widget-config-route.test.ts tests/custom-webhook.test.ts` (2 fail / 2 pass / 15 todo), TCP probe of REDIS_URL host (ECONNREFUSED), `.env.local` key-name inventory (REDIS_URL present)
- Next.js official docs: https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/maxDuration (v16.2.10, updated 2026-03-13) — maxDuration is platform build-output metadata
- `.planning/research/INTEGRATION-CONTRACT.md` §7, `131-CONTEXT.md`, workstream REQUIREMENTS.md/STATE.md, xphere `CLAUDE.md`

### Secondary (MEDIUM confidence)
- node-redis v5 command surface (`isReady`/`incr`/`expire`/`ttl`) — inferred HIGH-adjacent from working production usage in this repo rather than re-verified against upstream docs

### Tertiary (LOW confidence)
- None — no unverified WebSearch claims were used

## Metadata

**Confidence breakdown:**
- Route flow / limiter / call sites / Redis behavior: HIGH — every claim is a direct file read with line numbers
- Test infrastructure: HIGH — verified by executing vitest (including the baseline failure discovery)
- maxDuration semantics: HIGH — official Next.js 16 docs + observed production streaming behavior
- R4 gating recommendation: MEDIUM — the security analysis is solid, but it widens a locked decision's parenthetical; planner should confirm

**Research date:** 2026-07-17
**Valid until:** ~2026-08-16 (stable domain; re-verify only if the chat route, rate-limit.ts, or vitest config changes upstream of planning)
