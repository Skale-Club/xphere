# Phase 2: Chat API - Research

**Researched:** 2026-04-04
**Domain:** Next.js public API route, token-based org auth, Redis session management, Supabase service-role writes
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-03 | Public-facing chat API route (`/api/chat/[token]`) validates org token and scopes all queries to the org | New migration adds `widget_token` to `organizations`; lookup pattern documented below |
| CHAT-04 | Conversation context is maintained within a session using Redis short-term memory | Redis singleton already live at `src/lib/redis.ts`; session key pattern and TTL documented |
| CHAT-05 | Conversation history is persisted to Supabase long-term memory (per org, per session) | `chat_messages` table exists; `createServiceRoleClient()` is the write path |
| CHAT-06 | Each conversation session is identified by a unique session ID (anonymous visitor) | Session ID generation strategy and client-return contract documented |
</phase_requirements>

---

## Summary

Phase 2 builds the public HTTP endpoint that gates every chat interaction. It is purely infrastructure — no AI response logic yet (Phase 3 wires that in). The route must: (1) look up the org from a URL token, (2) get or create an anonymous session, (3) sync session context with Redis, (4) persist the user message to Supabase, and (5) return a stub response.

The most important finding is that **the `organizations` table has no `widget_token` column**. Phase 1's migration only added `widget_token` as a column on `chat_sessions` (to record which token created each session), not on `organizations` (which is where the authoritative token must live for lookup). A new migration `012_org_widget_token.sql` is required to add `widget_token TEXT UNIQUE` to `organizations` before the route can do token-to-org resolution. This migration must also update `src/types/database.ts`.

The rest of Phase 2 follows patterns already established in this codebase. The service-role client (`src/lib/supabase/admin.ts`) handles all Supabase writes. The Redis singleton (`src/lib/redis.ts`) is already installed and live. The route structure mirrors the existing `src/app/api/vapi/tools/route.ts` pattern — `export const runtime = 'nodejs'`, structured try/catch, explicit error status codes (401 for bad token, 200 for success).

**Primary recommendation:** Wave 0 is a migration that adds `widget_token` to `organizations`. All other work depends on that column existing.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `redis` | 5.11.0 (installed) | Session context cache | Already live at `src/lib/redis.ts` per Phase 1 |
| `@supabase/supabase-js` | installed | Service-role writes to chat tables | `createServiceRoleClient()` already in `src/lib/supabase/admin.ts` |
| `crypto` (Node built-in) | built-in | `randomUUID()` for session IDs | No external dep; already used in the project |
| `zod` | installed | Request body validation | Already used on all other routes |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `next/server` | installed | `Request`/`Response` types + `after()` | Use `after()` for async Supabase writes so response returns before DB write completes |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.randomUUID()` for session IDs | `nanoid` | No benefit; `randomUUID()` is built-in and already used in codebase |
| `after()` for async DB write | Await inline | `after()` returns response faster; acceptable because message persistence is not user-blocking |

**Installation:** No new packages required — all dependencies are already installed.

---

## Architecture Patterns

### Recommended File Structure

```
src/app/api/chat/
└── [token]/
    └── route.ts          # POST handler — token validation, session, persist, respond

src/lib/chat/
├── session.ts            # Redis session get/set helpers
└── persist.ts            # Supabase chat_sessions + chat_messages write helpers
```

The route handler stays thin; session and persistence logic lives in `src/lib/chat/` so Phase 3 can import the same helpers without modifying the route.

### Pattern 1: Token Validation (INFRA-03)

**What:** Look up the org by `widget_token` in the `organizations` table using the service-role client. Return 401 if not found.

**When to use:** First thing in every `POST /api/chat/[token]` handler — before any session work.

```typescript
// Source: pattern mirrors resolve-org.ts in src/lib/action-engine/
import { createServiceRoleClient } from '@/lib/supabase/admin'

async function resolveOrgByToken(token: string) {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, is_active')
    .eq('widget_token', token)
    .single()

  if (error || !data || !data.is_active) return null
  return data
}
```

**Auth failure response:**
```typescript
return Response.json({ error: 'Invalid or inactive token' }, { status: 401 })
```

### Pattern 2: Anonymous Session Management (CHAT-04, CHAT-06)

**What:** The client sends an optional `sessionId` in the request body. If absent or unknown, a new session is created. The session ID is always returned in the response so the client can persist it.

**Session ID generation:** `crypto.randomUUID()` — no external dep, cryptographically random.

**Redis key pattern:**
```
chat:session:{sessionId}
```

**Redis value:** JSON-serialized object:
```typescript
interface ChatSessionContext {
  orgId: string
  sessionId: string        // same as the key suffix, stored for convenience
  dbSessionId: string      // UUID from chat_sessions.id (Supabase row)
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  createdAt: string        // ISO timestamp
  lastActiveAt: string     // ISO timestamp — updated on every message
}
```

**TTL:** 3600 seconds (1 hour of inactivity). Set with `redis.setEx` on every write to slide the window.

**Session helpers (`src/lib/chat/session.ts`):**
```typescript
// Source: redis npm v5 setEx/get API, verified against redis npm docs
import redis from '@/lib/redis'

const SESSION_TTL = 3600 // 1 hour

export async function getSession(sessionId: string): Promise<ChatSessionContext | null> {
  if (!redis.isReady) return null
  const raw = await redis.get(`chat:session:${sessionId}`)
  if (!raw) return null
  return JSON.parse(raw) as ChatSessionContext
}

export async function setSession(sessionId: string, ctx: ChatSessionContext): Promise<void> {
  if (!redis.isReady) return
  await redis.setEx(`chat:session:${sessionId}`, SESSION_TTL, JSON.stringify(ctx))
}
```

**Graceful degradation:** If `redis.isReady` is false, `getSession` returns null (treated as new session) and `setSession` is a no-op. The message still persists to Supabase — Redis failure degrades to stateless mode, not a crash.

### Pattern 3: Supabase Persistence (CHAT-05)

**What:** After validating the token and getting/creating the session, write the user message to `chat_messages`. For new sessions, first insert a `chat_sessions` row.

**Client:** Always `createServiceRoleClient()` — the route has no authenticated Supabase user.

**Write helpers (`src/lib/chat/persist.ts`):**
```typescript
// Source: src/lib/supabase/admin.ts pattern; chat_sessions/chat_messages schema from 011_chat_schema.sql
import { createServiceRoleClient } from '@/lib/supabase/admin'

export async function ensureDbSession(opts: {
  orgId: string
  sessionId: string    // Redis/client session ID (also stored in chat_sessions as... see note below)
  widgetToken: string
}): Promise<string> {
  // Returns the chat_sessions.id UUID
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({ organization_id: opts.orgId, widget_token: opts.widgetToken })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function persistMessage(opts: {
  dbSessionId: string
  orgId: string
  role: 'user' | 'assistant'
  content: string
}): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from('chat_messages').insert({
    session_id: opts.dbSessionId,
    organization_id: opts.orgId,
    role: opts.role,
    content: opts.content,
  })
  if (error) throw error
}
```

**Note on session IDs:** There are two session identifiers in play:
- **Client session ID:** A `randomUUID()` generated server-side on first message, returned to the client, used as the Redis key suffix. The client stores this (e.g., in sessionStorage) and sends it on subsequent messages.
- **DB session ID (`chat_sessions.id`):** The Supabase UUID for the session row. Stored inside the Redis session context as `dbSessionId`. The client never sees this.

The `chat_sessions` table currently has no column to store the client session ID. Phase 2 does not need to query `chat_sessions` by client session ID (it uses Redis for that lookup), so no additional column is needed. The DB session row is created once and its UUID is stored in Redis.

### Pattern 4: Full Request/Response Flow

**Request shape (POST /api/chat/[token]):**
```typescript
interface ChatRequest {
  message: string          // required — the user's message text
  sessionId?: string       // optional — omit on first message; present on follow-ups
}
```

**Response shape (Phase 2 stub — no AI yet):**
```typescript
interface ChatResponse {
  sessionId: string        // always returned — client must store this
  reply: string            // stub: "Message received." — Phase 3 replaces with AI response
  role: 'assistant'
}
```

**Complete flow for a single message:**

1. Parse and validate request body with Zod
2. Look up org by `params.token` — return 401 if invalid
3. Try `getSession(sessionId)` from Redis — null if first message or Redis down
4. If no session: generate `newSessionId = crypto.randomUUID()`, create `chat_sessions` row via Supabase, build initial `ChatSessionContext`
5. Append user message to `ctx.messages`, update `ctx.lastActiveAt`
6. `await setSession(sessionId, ctx)` — persist updated context to Redis
7. Persist user message to `chat_messages` via Supabase (can use `after()` to not block response)
8. Return stub response with `sessionId`

### Pattern 5: Route Handler Structure

Mirrors `src/app/api/vapi/tools/route.ts`:

```typescript
// src/app/api/chat/[token]/route.ts
// Source: src/app/api/vapi/tools/route.ts pattern
export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  try {
    const { token } = await params
    // ... validation, session, persist, respond
    return Response.json({ sessionId, reply: 'Message received.', role: 'assistant' })
  } catch (err) {
    console.error('[chat-api] unhandled error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

**Key difference from Vapi routes:** This route returns 401 for auth failures (not always 200). Vapi routes must return 200 to prevent Vapi retries — that constraint does not apply here.

### Anti-Patterns to Avoid

- **Using `supabase.auth.getUser()` or the authenticated client for chat writes:** These routes have no auth session. Only `createServiceRoleClient()`.
- **Storing the Redis session ID in Supabase as a foreign key:** Unnecessary join complexity. Redis and Supabase sessions are linked only through the `dbSessionId` stored inside the Redis context.
- **Awaiting Supabase writes inline before returning the response:** Use `after()` for fire-and-forget persistence. The user shouldn't wait for DB writes.
- **Returning a non-200 from this route on Redis failure:** Redis is degradable (CHAT-04 context says "maintained within a session" — if Redis is down, session context is lost for that exchange, but the API must still accept the message).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation for session IDs | Custom ID scheme | `crypto.randomUUID()` | Built-in, cryptographically random, already used in project |
| Redis TTL sliding window | Manual expiry tracking | `redis.setEx(key, TTL, value)` | setEx atomically sets value + TTL in one call |
| Org token lookup | Custom hash map / in-memory cache | Supabase `organizations.widget_token` indexed column | DB index is fast enough; no cache layer needed at this scale |
| Service-role Supabase client | New client instantiation inline | `createServiceRoleClient()` from `src/lib/supabase/admin.ts` | Already exists, tested, documented |

**Key insight:** Every primitive needed for Phase 2 is already in the codebase. This phase wires existing pieces together — it adds no new libraries.

---

## Common Pitfalls

### Pitfall 1: `widget_token` Does Not Exist on `organizations` Table

**What goes wrong:** `POST /api/chat/[token]` tries to `.eq('widget_token', token)` on `organizations` but the column doesn't exist. The query returns a Supabase error at runtime; the route 500s on every request.

**Why it happens:** Phase 1's migration `011_chat_schema.sql` added `widget_token` only to `chat_sessions` (to record which token was used to open each session). It was NOT added to `organizations`, which is where the authoritative per-org token must live for lookup.

**How to avoid:** Wave 0 of Phase 2 must include migration `012_org_widget_token.sql` that adds `widget_token TEXT UNIQUE` to `organizations`, plus an update to `src/types/database.ts`. This is a hard blocker — no other work can proceed without it.

**Warning signs:** `column "widget_token" does not exist` error in server logs on first request to the new route.

### Pitfall 2: `params` Must Be Awaited in Next.js 15

**What goes wrong:** Accessing `params.token` synchronously throws a runtime error in Next.js 15 App Router — `params` is now a Promise.

**Why it happens:** Next.js 15 made `params` (and `searchParams`) async in route handlers and pages.

**How to avoid:** Always `const { token } = await params` as shown in the route pattern above.

**Warning signs:** `Error: Route "/api/chat/[token]" used "params.token" without first awaiting...`

### Pitfall 3: Redis `isReady` Check Before Every Operation

**What goes wrong:** Calling `redis.get()` or `redis.setEx()` when the client is not yet connected throws `ClientClosedError`. This crashes the request even though Redis failure should be graceful.

**Why it happens:** The Redis singleton connects asynchronously. Between server start and connection establishment (or after a disconnect), `redis.isReady` is false.

**How to avoid:** Wrap every Redis call in `if (!redis.isReady) return null` (for reads) or `if (!redis.isReady) return` (for writes), as shown in the session helpers above.

**Warning signs:** `ClientClosedError: The client is closed` in logs during startup or Redis reconnect.

### Pitfall 4: Creating a New `chat_sessions` Row on Every Message

**What goes wrong:** If the `getSession` from Redis returns null (e.g., TTL expired, Redis was down), and the code always calls `ensureDbSession()`, a new `chat_sessions` row is created for every message during a Redis outage.

**Why it happens:** No Redis state → code treats every message as a new session.

**How to avoid:** The client always sends back the `sessionId` received in previous responses. If Redis returns null for a known `sessionId`, treat it as a session resumption: create a new Redis context (not a new DB session) and reuse the existing `chat_sessions` row if it can be found by querying Supabase by `sessionId`. Alternatively, accept the DB session duplication as an edge case during Redis outages — this is simpler and acceptable for v1.2 since Redis downtime is rare. Document the chosen approach.

**Recommendation:** For Phase 2 (stub only, no AI continuity), accept duplication during Redis outages. Phase 3 can improve this when message history matters.

### Pitfall 5: Returning `sessionId` in the Response Is Mandatory

**What goes wrong:** If the stub response doesn't include `sessionId`, the client (Phase 4 widget) has no way to send it back on the next message. Every message becomes a new session.

**Why it happens:** Session persistence is client-responsibility — the server is stateless between requests.

**How to avoid:** Always include `sessionId` in the response body, whether it was an existing session or a newly created one.

---

## Migration Required: `012_org_widget_token.sql`

This is the critical finding of this research. The `organizations` table currently has columns: `id, name, slug, is_active, created_at, updated_at`. There is **no `widget_token` column**.

Phase 2 requires token-to-org lookup on `organizations.widget_token`. The migration must:

1. Add `widget_token TEXT UNIQUE` to `organizations`
2. Populate existing orgs with a generated token (or leave NULL and let admin generate via Phase 5 — see note)
3. Update `src/types/database.ts` to reflect the new column

**Migration sketch:**
```sql
-- 012_org_widget_token.sql
ALTER TABLE public.organizations
  ADD COLUMN widget_token TEXT UNIQUE;

-- Generate a default token for all existing orgs so no org is immediately broken.
-- Token format: 32 hex chars (128 bits) — long enough to be unguessable.
UPDATE public.organizations
  SET widget_token = encode(gen_random_bytes(16), 'hex')
  WHERE widget_token IS NULL;

-- After backfill, make it NOT NULL.
ALTER TABLE public.organizations
  ALTER COLUMN widget_token SET NOT NULL;

CREATE INDEX idx_organizations_widget_token ON public.organizations USING btree (widget_token);
```

**Note on `gen_random_bytes`:** This is a pgcrypto function. Check if `pgcrypto` extension is enabled in the project. If not, use `replace(gen_random_uuid()::text, '-', '')` as a fallback (generates a 32-char hex token from a UUID). The v1.0 migrations use `gen_random_uuid()` so that's a safe fallback.

**`src/types/database.ts` update for `organizations`:**
```typescript
Row: {
  id: string
  name: string
  slug: string
  is_active: boolean
  widget_token: string     // ADD THIS
  created_at: string
  updated_at: string
}
Insert: {
  ...
  widget_token?: string    // optional on insert — migration sets default
}
Update: {
  ...
  widget_token?: string    // admin can regenerate via Phase 5
}
```

---

## Environment Availability

Step 2.6: All dependencies are in-process (Node.js builtins, already-installed npm packages). No external tool probe needed.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `redis` npm | `src/lib/redis.ts` session ops | ✓ installed | 5.11.0 | Graceful no-op per D-07 |
| `@supabase/supabase-js` | `createServiceRoleClient()` | ✓ installed | — | None — required |
| `crypto` (Node built-in) | `randomUUID()` | ✓ | Node 15+ | — |
| `zod` | Request body validation | ✓ installed | — | — |
| `SUPABASE_SERVICE_ROLE_KEY` env var | `createServiceRoleClient()` | ✓ (assumed — used by existing routes) | — | None — required |
| `REDIS_URL` env var | Redis singleton | ✓ (added in Phase 1) | — | Singleton degrades gracefully |

**Missing dependencies with no fallback:** None — all runtime dependencies are available.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts present) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-03 | POST with valid token → 200; invalid token → 401 | unit | `npx vitest run tests/chat-api.test.ts` | ❌ Wave 0 |
| CHAT-04 | Session context written to Redis on message; read on follow-up | unit (mock Redis) | `npx vitest run tests/chat-session.test.ts` | ❌ Wave 0 |
| CHAT-05 | `chat_messages` row inserted for each message exchange | unit (mock Supabase) | `npx vitest run tests/chat-persist.test.ts` | ❌ Wave 0 |
| CHAT-06 | New session generates unique `sessionId`; existing `sessionId` in request reuses session | unit | `npx vitest run tests/chat-api.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run build` (catches TypeScript errors immediately)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + `npm run build` clean before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/chat-api.test.ts` — covers INFRA-03 and CHAT-06: token validation (valid/invalid/inactive org), session ID generation and reuse
- [ ] `tests/chat-session.test.ts` — covers CHAT-04: `getSession`/`setSession` helpers with mocked Redis client
- [ ] `tests/chat-persist.test.ts` — covers CHAT-05: `ensureDbSession`/`persistMessage` with mocked `createServiceRoleClient`

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on This Phase |
|-----------|---------------------|
| Always run `npm run build` after changes | Phase gate must include build check |
| TypeScript strict mode | All types explicit; no `any`; use Zod for runtime validation |
| `supabase/migrations/` — never edit old migrations | `012_org_widget_token.sql` is a new file; never touch 011 or earlier |
| Never call `supabase.auth.getUser()` directly; use cached helpers | Not applicable — this route uses service-role client, not auth client |
| API routes: `export const runtime = 'nodejs'` | Required on `/api/chat/[token]/route.ts` |
| `src/lib/crypto.ts` — do not change encryption format | Not touched in this phase |
| All tables must have `organization_id`, `id UUID`, `created_at`, RLS enabled | Already satisfied by Phase 1 migration |
| Never manually filter by `org_id` in queries through the authenticated client | Not applicable — using service-role client with explicit `.eq('widget_token', token)` |
| Canonical production origin: `https://voiceops.skale.club` | Not directly referenced in Phase 2 |
| Redis is short-term session only — Supabase is the system of record | Phase 2 persists all messages to Supabase; Redis is cache only — compliant |
| Widget auth: per-org public token only — no visitor login | Phase 2 enforces this — no auth required, token lookup only |

---

## Open Questions

1. **Should `pgcrypto` or `gen_random_uuid()` be used to generate `widget_token` in migration `012`?**
   - What we know: Existing migrations use `gen_random_uuid()`. `pgcrypto`'s `gen_random_bytes` produces better-looking hex tokens but requires the extension to be enabled.
   - What's unclear: Whether `pgcrypto` is enabled in this Supabase project.
   - Recommendation: Use `replace(gen_random_uuid()::text, '-', '')` for the backfill — zero extension dependency, produces a 32-char unique token. Phase 5 (Admin Config) can add a regenerate function using the same approach.

2. **Should `chat_sessions` store the client session ID (the UUID returned to the widget)?**
   - What we know: Currently `chat_sessions` has no column for it. The client session ID lives only in Redis and in the widget's sessionStorage. The DB session is linked only via `dbSessionId` in Redis.
   - What's unclear: Whether Phase 3 will need to query `chat_messages` by client session ID (e.g., for resuming conversation history after Redis TTL expiry).
   - Recommendation: Add `session_key TEXT` to `chat_sessions` in migration `012` (same migration as `widget_token`). Store the `crypto.randomUUID()` there. Cost: one extra column. Benefit: Phase 3 can reload message history by querying `chat_messages WHERE session_id = (SELECT id FROM chat_sessions WHERE session_key = $1)` when Redis has expired. This avoids a Phase 3 schema migration.

3. **Should the stub response use `after()` for Supabase writes?**
   - What we know: `after()` from `next/server` runs async work after the response is sent. The existing Vapi routes use it for non-blocking logging.
   - What's unclear: Whether Vitest test infrastructure handles `after()` correctly in unit tests.
   - Recommendation: Use `after()` for `persistMessage` (fire-and-forget DB write). `ensureDbSession` must be awaited inline because the `dbSessionId` must be known before calling `setSession`.

---

## Sources

### Primary (HIGH confidence)

- `supabase/migrations/011_chat_schema.sql` — confirmed `chat_sessions`/`chat_messages` column definitions and RLS
- `src/types/database.ts` (lines 20-47) — confirmed `organizations` table has no `widget_token` column
- `src/lib/supabase/admin.ts` — confirmed `createServiceRoleClient()` signature and usage pattern
- `src/lib/redis.ts` — confirmed singleton is live with `isReady` check pattern
- `src/app/api/vapi/tools/route.ts` — confirmed `export const runtime = 'nodejs'` and route handler pattern
- `tests/` directory listing — confirmed existing test files; identified 3 missing test files for Wave 0

### Secondary (MEDIUM confidence)

- Next.js 15 async params behavior — confirmed by CLAUDE.md stack declaration (Next.js 15 App Router) and Next.js 15 migration notes (params are Promises in route handlers)
- `redis` npm v5 `setEx`/`get`/`isReady` API — consistent with redis.ts already in the project

### Tertiary (LOW confidence)

- None — all critical claims verified against live codebase files

---

## Metadata

**Confidence breakdown:**
- Migration gap (no `widget_token` on `organizations`): HIGH — verified by reading `src/types/database.ts` and all migrations
- Route structure and runtime: HIGH — verified against existing `src/app/api/vapi/tools/route.ts`
- Redis session pattern: HIGH — `src/lib/redis.ts` confirms client is live; `setEx`/`get`/`isReady` are standard redis v5 API
- Supabase write path: HIGH — `createServiceRoleClient()` is established and tested in the project
- Request/response shapes: MEDIUM — designed for Phase 2 stub; Phase 3 will extend them

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (stable stack; no fast-moving dependencies)
