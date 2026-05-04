# Phase 1: Foundation - Research

**Researched:** 2026-04-04
**Domain:** Redis singleton, Supabase RLS for public writes, brand rename, static asset serving
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Replace all occurrences of `"VoiceOps"` in UI labels, metadata, and user-facing strings with `"Leaidear"`.
- **D-02:** The login page subtitle and `layout.tsx` metadata description should read `"AI Operations Platform"` (replaces `"Voice AI Operations Platform"`).
- **D-03:** Non-UI strings (e.g., User-Agent header in `extract-text.ts`, DB type comment in `types/database.ts`) should also be updated to `"Leaidear"` for consistency.
- **D-04:** Use the `redis` npm package (standard Node.js Redis client) — NOT `@upstash/redis`.
- **D-05:** Add `REDIS_URL` as the single environment variable for the Redis connection.
- **D-06:** Create `src/lib/redis.ts` as a singleton module that lazy-connects on first use and exports the client. Pattern mirrors the Supabase client in `src/lib/supabase/`.
- **D-07:** Redis connection errors must be handled gracefully — if Redis is unavailable, log the error but do not crash the app (chat will degrade, not break the whole platform).
- **D-08:** Create `public/widget.js` as a minimal static JS placeholder (a `// Leaidear widget` comment stub is sufficient).
- **D-09:** Phase 4 will replace `public/widget.js` with the real implementation. The URL `https://voiceops.skale.club/widget.js` must resolve in Phase 1.
- **D-10:** Create `chat_sessions` and `chat_messages` in migration `011_chat_schema.sql`. Follow the existing RLS pattern: `organization_id` FK, `get_current_org_id()` policy.
- **D-11:** The migration should consider a service-role bypass policy or a `SECURITY DEFINER` RPC for the write path — planner should research the best approach.

### Claude's Discretion

- Exact column names and types for `chat_sessions` / `chat_messages` (beyond `id`, `organization_id`, `created_at` which are required by convention)
- Whether to add `updated_at` to sessions
- Exact error message or fallback behavior when Redis is unavailable

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BRAND-01 | Platform UI displays "Leaidear" name instead of "VoiceOps" across all pages, navigation, and branding elements | Grep audit confirms exactly 10 occurrences across 10 files in `src/`; full replacement list documented below |
| BRAND-02 | Page titles, sidebar, login page, and any hardcoded references updated to Leaidear | `layout.tsx`, `app-sidebar.tsx`, `login/page.tsx` confirmed; `description` field must change to "AI Operations Platform" |
| INFRA-01 | Redis connection configured and available for chat session storage | `redis` npm v5.11.0 not yet installed; singleton pattern with `globalThis` guard documented below |
| INFRA-02 | Supabase schema includes `chat_sessions` and `chat_messages` tables with RLS | Column design and RLS strategy documented; service-role bypass is correct pattern for public chat API |
| INFRA-04 | Widget asset served from the platform's own domain (no external CDN dependency required) | `public/widget.js` in Next.js `public/` folder is served statically at `/widget.js`; no extra config needed |
</phase_requirements>

---

## Summary

Phase 1 is a pure infrastructure and housekeeping phase with four independent work streams: brand rename, Redis client module, Supabase chat schema migration, and a widget placeholder file. None of the streams are technically novel — each follows an established pattern already present in the codebase.

The brand rename is a mechanical text substitution. A grep audit of the live `src/` tree confirms exactly 10 occurrences of `"VoiceOps"` or `"Voice AI"` across 10 files, matching the 9 files listed in CONTEXT.md plus the `types/database.ts` comment. The files `CLAUDE.md`, `AGENTS.md`, `README.md`, and `.paul/` docs also contain `"VoiceOps"` — those are documentation files and are in scope per D-03 (consistency across non-UI strings). The planner must decide whether doc files are included in this phase's scope or deferred; the CONTEXT.md decisions cover `src/` explicitly.

The Redis singleton follows a well-established Next.js pattern: assign the connected client to `globalThis` in development to survive HMR module re-evaluations without spawning extra connections. In production the module is evaluated once and the singleton lives in the module cache for the process lifetime. The `redis` npm package v5.11.0 is current (verified via npm registry). It is not yet installed in this project.

The chat schema design requires care around the public write path. Phase 2 will write to `chat_sessions` and `chat_messages` without an authenticated Supabase session (the chat API is public, authenticated only by an org widget token). The correct pattern — already used in this codebase for campaigns and knowledge base edge functions — is the service-role client (`createServiceRoleClient()` in `src/lib/supabase/admin.ts`). This bypasses RLS entirely on the server side. The tables should still have RLS enabled with an `authenticated` policy for the admin dashboard reads; the public write path uses the service-role client, never the anon key.

**Primary recommendation:** Wire the four deliverables in sequence: (1) install `redis` package, (2) write `src/lib/redis.ts`, (3) create `011_chat_schema.sql`, (4) rename brand strings, (5) add `public/widget.js`. Each is independent; order is for review clarity only.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `redis` | 5.11.0 | Node.js Redis client | Chosen in D-04; provider-agnostic via URL; already used in reference chatbot |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` | already installed | Service-role client for public write path | Phase 2 chat API writes to `chat_sessions`/`chat_messages` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `redis` npm | `ioredis` | ioredis has a slightly different API; redis v5 is async/await native and simpler |
| `redis` npm | `@upstash/redis` | Upstash is HTTP-based; locked decision against it (D-04) |
| service-role bypass | anon-role RLS policy | anon policy works but requires `TO anon` policy and no org scoping — too permissive for multi-tenant data |

**Installation:**
```bash
npm install redis
```

**Version verification:** `npm view redis version` returns `5.11.0` as of 2026-04-04.

---

## Architecture Patterns

### Redis Singleton Module

**What:** A module-level singleton that uses `globalThis` to survive Next.js HMR re-evaluations in development without spawning extra connections.

**When to use:** Any server-side module that holds a stateful external connection (DB connection, Redis client) in a Next.js dev environment with Turbopack HMR.

**Example:**
```typescript
// src/lib/redis.ts
// Source: pattern from C:\Users\Vanildo\Dev\chatbot\lib\ratelimit.ts + globalThis HMR guard
import { createClient, type RedisClientType } from 'redis'

declare global {
  // eslint-disable-next-line no-var
  var _redisClient: RedisClientType | undefined
}

function createRedisClient(): RedisClientType {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL environment variable is not set')
  }
  const client = createClient({ url: process.env.REDIS_URL }) as RedisClientType
  client.on('error', (err: Error) => {
    console.error('[redis] connection error:', err.message)
  })
  client.connect().catch((err: Error) => {
    console.error('[redis] connect() failed:', err.message)
  })
  return client
}

// In development, attach to globalThis so HMR module re-evaluations reuse the same
// connection instead of opening a new one on every file save.
if (process.env.NODE_ENV !== 'production') {
  if (!global._redisClient) {
    global._redisClient = createRedisClient()
  }
}

// In production the module is evaluated once per process; no globalThis guard needed.
const redis: RedisClientType =
  process.env.NODE_ENV === 'production'
    ? createRedisClient()
    : (global._redisClient as RedisClientType)

export default redis
```

**Graceful degradation (D-07):** Callers in Phase 2 must check `redis.isReady` before using the client. If not ready, log and continue without Redis (session context lost, but no crash). This check belongs in the Phase 2 chat API, not in this module.

### Supabase RLS for Public Write Path

**What:** Chat sessions and messages are written by an unauthenticated API route. The server uses `createServiceRoleClient()` which bypasses RLS entirely. Tables still have RLS enabled with standard `authenticated` policies so the dashboard can read them through the normal client.

**When to use:** Any server-side route handler that performs writes on behalf of anonymous visitors. Never expose the service-role key to the browser.

**Pattern (already established in this codebase):**
```typescript
// src/lib/supabase/admin.ts — already exists, used by campaigns + knowledge base
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
```

The Phase 2 chat route handler will use `createServiceRoleClient()` for all `chat_sessions` and `chat_messages` writes. The migration for Phase 1 does NOT need a special anon-role policy — standard RLS with `authenticated` policies is sufficient because the write path never runs as anon.

### Chat Schema Design

**Columns required by Phase 2 (chat API with session management):**

`chat_sessions`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `organization_id UUID NOT NULL REFERENCES organizations(id)`
- `widget_token TEXT NOT NULL` — the public org token used to start the session (links session back to org without requiring org_id lookup at message time)
- `started_at TIMESTAMPTZ NOT NULL DEFAULT now()` — alias for `created_at` to match domain language
- `last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()` — updated when new messages arrive; used for session expiry queries
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

**Columns required by Phase 3 (AI conversation engine):**

`chat_messages`:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE`
- `organization_id UUID NOT NULL REFERENCES organizations(id)` — denormalized for RLS policy without joining sessions
- `role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool'))` — matches Vercel AI SDK message roles
- `content TEXT NOT NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

**On `updated_at` for sessions:** Include `last_active_at` instead of a generic `updated_at`. The AI engine (Phase 3) will update it on every message exchange. A separate `updated_at` timestamp would be redundant.

**RLS policy pattern (follows existing `get_current_org_id()` pattern from migration 010):**
```sql
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation"
  ON public.chat_sessions
  FOR ALL
  TO authenticated
  USING (organization_id = public.get_current_org_id())
  WITH CHECK (organization_id = public.get_current_org_id());

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation"
  ON public.chat_messages
  FOR ALL
  TO authenticated
  USING (organization_id = public.get_current_org_id())
  WITH CHECK (organization_id = public.get_current_org_id());
```

### Brand Rename Scope

**Complete list of occurrences confirmed by grep (2026-04-04):**

In `src/` (10 occurrences, 10 files — must update):

| File | Line | Current | Replace With |
|------|------|---------|--------------|
| `src/app/layout.tsx` | 10 | `title: 'VoiceOps'` | `title: 'Leaidear'` |
| `src/app/layout.tsx` | 11 | `description: 'Voice AI Operations Platform'` | `description: 'AI Operations Platform'` |
| `src/app/(auth)/login/page.tsx` | 88 | `VoiceOps` (h1 text) | `Leaidear` |
| `src/app/(auth)/login/page.tsx` | 91 | `Voice AI Operations Platform` (subtitle) | `AI Operations Platform` |
| `src/app/(dashboard)/tools/page.tsx` | 16 | `VoiceOps actions and integrations` | `Leaidear actions and integrations` |
| `src/app/(dashboard)/tools/[toolConfigId]/page.tsx` | 125 | `VoiceOps mapping` | `Leaidear mapping` |
| `src/components/assistants/assistant-mapping-form.tsx` | 140 | `read in VoiceOps` | `read in Leaidear` |
| `src/components/assistants/assistant-mappings-table.tsx` | 232 | `inside VoiceOps` | `inside Leaidear` |
| `src/components/layout/app-sidebar.tsx` | 95 | `VoiceOps` (brand span) | `Leaidear` |
| `src/components/tools/tools-table.tsx` | 218 | `through VoiceOps actions` | `through Leaidear actions` |
| `src/lib/knowledge/extract-text.ts` | 31 | `VoiceOps-KnowledgeBot/1.0` | `Leaidear-KnowledgeBot/1.0` |
| `src/types/database.ts` | 1 | `// Database type definitions for VoiceOps` | `// Database type definitions for Leaidear` |

Outside `src/` (documentation files — update for consistency per D-03):

| File | Notes |
|------|-------|
| `CLAUDE.md` | Title and product framing copy — update to Leaidear |
| `AGENTS.md` | Agent instructions — update to Leaidear |
| `README.md` | Project readme — update to Leaidear |
| `.paul/codebase/*.md` | Internal codebase notes — update to Leaidear |

**Note on `CLAUDE.md` specifically:** The file currently says `# VoiceOps - Claude Code Instructions` on line 1 and references `VoiceOps` in product framing. Per D-03 the rename covers non-UI strings for consistency. However, the planner should scope this carefully: updating `CLAUDE.md` itself is fine; do NOT change webhook URLs like `https://voiceops.skale.club` which are intentionally the canonical production origin (per PROJECT.md — "to be updated to leaidear domain when ready"). That URL change is explicitly deferred.

### Widget Placeholder

Next.js serves files in `public/` at the root path with no extra configuration. A file at `public/widget.js` is available at `https://voiceops.skale.club/widget.js` immediately after deployment. No `next.config` changes needed.

**File content (D-08):**
```javascript
// Leaidear widget
// Full implementation in Phase 4
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redis connection pooling / reconnect logic | Custom reconnect loop | `redis` npm built-in retry | The client has built-in exponential backoff and reconnect |
| HMR connection isolation | Module-level caching with WeakMap, etc. | `globalThis` guard pattern | globalThis persists across HMR module boundaries; module cache does not |
| Public write access to RLS tables | anon-role RLS policy | `createServiceRoleClient()` | Service-role bypass is already established, avoids policy complexity |
| Session UUID generation | `crypto.randomUUID()` in app code | `gen_random_uuid()` in SQL default | DB-generated IDs eliminate race conditions and are consistent |

**Key insight:** All four deliverables have established solutions already used in this codebase or in the reference chatbot. No new patterns are needed.

---

## Runtime State Inventory

> Included because this phase contains a brand rename.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | No Leaidear/VoiceOps string stored as a key in any database table (org names, session IDs, etc. are user-defined UUIDs). No Mem0 or ChromaDB collections found. | None — code edit only |
| Live service config | Vapi webhook URLs use `voiceops.skale.club` domain — intentionally NOT renamed in Phase 1 (deferred per PROJECT.md). No n8n workflows. No Datadog. | None in this phase |
| OS-registered state | No Windows Task Scheduler tasks, pm2 saved processes, or systemd units found referencing VoiceOps. GitHub Actions workflows exist but none embed the string "VoiceOps" as a service name. | None |
| Secrets/env vars | No env var names reference "VoiceOps" by string. `NEXT_PUBLIC_SUPABASE_URL` and others are generic. The `vo_active_org` cookie uses `vo_` prefix — this is a short internal prefix, NOT the brand name, and is out of scope for rename. | None |
| Build artifacts | `package.json` name is `"voiceops"` (the npm package name, not user-visible). No installed global npm packages. No pip egg-info. | `package.json` name field — planner to decide if in scope; it is never user-visible |

**Conclusion:** This rename is a pure source-file text substitution. No database records, live service configs, or OS registrations store the string "VoiceOps" as identity-bearing data.

---

## Common Pitfalls

### Pitfall 1: Multiple Redis connections in dev (HMR)

**What goes wrong:** Without the `globalThis` guard, every file save during development re-evaluates `src/lib/redis.ts`, calling `createClient()` and `connect()` on each evaluation. After dozens of saves, the process holds many open TCP connections to Redis.

**Why it happens:** Node.js module cache is cleared per HMR boundary in Turbopack. Module-level `let client` is reset on each evaluation.

**How to avoid:** Use the `globalThis` guard pattern shown in the Architecture Patterns section. Only enable it in `process.env.NODE_ENV !== 'production'`.

**Warning signs:** Redis connection count climbs during dev session; `redis-cli info clients` shows `connected_clients` growing.

### Pitfall 2: Using anon-role RLS policy for multi-tenant public writes

**What goes wrong:** A policy like `CREATE POLICY "public_insert" ON chat_messages FOR INSERT TO anon WITH CHECK (true)` allows any request without an `organization_id` check. Since the anon role has no auth context, `get_current_org_id()` returns NULL and the check passes for any org_id.

**Why it happens:** anon policies have no native org scoping mechanism.

**How to avoid:** Use `createServiceRoleClient()` in the server-side chat API route handler. The service-role client bypasses RLS and the route handler itself enforces org scoping by resolving the org from the widget token before writing.

**Warning signs:** Rows inserted with arbitrary `organization_id` values, data leaking across tenants.

### Pitfall 3: Changing the `voiceops.skale.club` webhook origin

**What goes wrong:** Changing the canonical webhook URL in `CLAUDE.md` or Vapi config causes live webhook calls from Vapi to a wrong URL, silently breaking voice call tool routing.

**Why it happens:** `CLAUDE.md` says "Canonical production origin: https://voiceops.skale.club" — this is intentionally not renamed yet.

**How to avoid:** The brand rename only updates the string "VoiceOps" → "Leaidear" in UI labels and documentation copy. The domain `voiceops.skale.club` must remain unchanged until a domain migration is explicitly planned.

**Warning signs:** Vapi webhook calls returning 404 or no-op after rename.

### Pitfall 4: Forgetting `last_active_at` index on `chat_sessions`

**What goes wrong:** Phase 3 will query sessions by `last_active_at` to check session freshness or expire old sessions. Without an index, these queries do full-table scans.

**Why it happens:** Convention only requires `idx_tablename_org_id` and time-based index on high-volume tables. `chat_sessions` is high-volume by design.

**How to avoid:** Add `CREATE INDEX idx_chat_sessions_last_active_at ON chat_sessions USING btree (last_active_at DESC)` in the migration.

### Pitfall 5: TypeScript strict mode with `redis` v5 types

**What goes wrong:** `createClient()` returns `RedisClientType` which is a complex generic. Assigning to `globalThis` without a proper `declare global` block produces a TypeScript error.

**Why it happens:** TypeScript strict mode (mandatory in this project) does not allow ad-hoc property assignment to `globalThis`.

**How to avoid:** Use the `declare global { var _redisClient: RedisClientType | undefined }` block shown in the Architecture Patterns section. Use `var` (not `let`/`const`) inside `declare global` — that is the correct TypeScript syntax.

---

## Code Examples

Verified patterns from codebase and reference implementation:

### Redis singleton with HMR guard

```typescript
// src/lib/redis.ts
// Source: chatbot reference + globalThis pattern (oneuptime.com blog, 2026-01)
import { createClient, type RedisClientType } from 'redis'

declare global {
  // var is required inside declare global (not let/const)
  // eslint-disable-next-line no-var
  var _redisClient: RedisClientType | undefined
}

function buildClient(): RedisClientType {
  const client = createClient({
    url: process.env.REDIS_URL,
  }) as RedisClientType
  client.on('error', (err: Error) => {
    console.error('[redis] error:', err.message)
  })
  void client.connect().catch((err: Error) => {
    console.error('[redis] connect failed:', err.message)
  })
  return client
}

const redis: RedisClientType =
  process.env.NODE_ENV !== 'production'
    ? (global._redisClient ??= buildClient())
    : buildClient()

export default redis
```

### Migration skeleton: 011_chat_schema.sql

```sql
-- =============================================================================
-- Migration 011: Chat Schema — chat_sessions + chat_messages
-- Phase: 01-foundation (v1.2)
-- =============================================================================

-- chat_sessions: one record per anonymous visitor session per org
CREATE TABLE public.chat_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  widget_token    TEXT        NOT NULL,
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_sessions_org_id       ON public.chat_sessions USING btree (organization_id);
CREATE INDEX idx_chat_sessions_last_active  ON public.chat_sessions USING btree (last_active_at DESC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.chat_sessions
  FOR ALL TO authenticated
  USING (organization_id = public.get_current_org_id())
  WITH CHECK (organization_id = public.get_current_org_id());

-- chat_messages: one record per message turn (user or assistant)
CREATE TABLE public.chat_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID        NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_session_id ON public.chat_messages USING btree (session_id);
CREATE INDEX idx_chat_messages_org_id     ON public.chat_messages USING btree (organization_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages USING btree (created_at DESC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.chat_messages
  FOR ALL TO authenticated
  USING (organization_id = public.get_current_org_id())
  WITH CHECK (organization_id = public.get_current_org_id());
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `redis` npm package | `src/lib/redis.ts` | ✗ (not installed) | — | None — must install |
| Redis server / Upstash | INFRA-01 runtime test | ✗ (not running locally) | — | Singleton silently no-ops; no test of connection at this phase |
| Supabase (remote) | Migration push | ✓ (assumed) | — | Cannot push without remote access |
| Node.js | Build + lint | ✓ | via npm scripts | — |

**Missing dependencies with no fallback:**
- `redis` npm package must be installed before writing `src/lib/redis.ts` — planner must include `npm install redis` as Wave 0 or first task.

**Missing dependencies with fallback:**
- Local Redis server not running — the singleton is written to degrade gracefully (D-07), so unit tests do not require a live Redis connection. Integration of actual connection is validated at Phase 2 runtime.

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
| BRAND-01 | "VoiceOps" string does not appear in rendered UI output | smoke | `npm run build` (type check catches import errors; no dedicated brand test needed) | ✅ build gate |
| BRAND-02 | `metadata.title` equals "Leaidear", `description` equals "AI Operations Platform" | unit | `npx vitest run tests/brand.test.ts` | ❌ Wave 0 |
| INFRA-01 | `src/lib/redis.ts` exports a client; module loads without crashing when `REDIS_URL` is unset | unit | `npx vitest run tests/redis.test.ts` | ❌ Wave 0 |
| INFRA-02 | Migration `011_chat_schema.sql` is valid SQL (structure test) | manual | `npx supabase db push` + inspect tables | manual |
| INFRA-04 | `public/widget.js` exists and contains the Leaidear stub comment | unit | `npx vitest run tests/widget-asset.test.ts` (fs.existsSync) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run build` (catches TypeScript errors immediately)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + `npm run build` clean before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/brand.test.ts` — reads `src/app/layout.tsx` metadata export, asserts title/description values
- [ ] `tests/redis.test.ts` — imports `src/lib/redis.ts` without `REDIS_URL` set, asserts module loads (and gracefully no-ops or defers connection)
- [ ] `tests/widget-asset.test.ts` — asserts `public/widget.js` exists and contains `// Leaidear widget`

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on This Phase |
|-----------|---------------------|
| Always run `npm run build` after changes | Phase gate must include build check |
| TypeScript strict mode — no `any`, no `@ts-ignore` | Redis client type must use `declare global` pattern; all types explicit |
| `supabase/migrations/` — never edit old migrations; add new ones | `011_chat_schema.sql` is a new file; never touch 001–010 |
| Never call `supabase.auth.getUser()` directly; use cached helpers | Not applicable to this phase (no auth calls) |
| API routes: `export const runtime = 'nodejs'` | Not applicable in this phase (no new route handlers) |
| `src/lib/crypto.ts` — do not change the encryption format | Not touched in this phase |
| All tables must have `organization_id`, `id UUID`, `created_at`, RLS enabled | Applied to both `chat_sessions` and `chat_messages` |
| Never manually filter by `org_id` in queries through the authenticated client | Phase 2 concern; noted for context |
| `NEXT_PUBLIC_` prefix only for browser-safe vars | `REDIS_URL` must NOT have `NEXT_PUBLIC_` prefix |

---

## Open Questions

1. **Should `CLAUDE.md`, `AGENTS.md`, and `README.md` be updated in this phase?**
   - What we know: D-03 says non-UI strings should also be updated for consistency; these files have multiple "VoiceOps" occurrences.
   - What's unclear: Whether documentation files outside `src/` are in Phase 1 scope or treated as a lower-priority follow-up.
   - Recommendation: Include them. They are the first thing a new contributor reads. The effort is low (text substitution). Exclude the domain `voiceops.skale.club` from substitution.

2. **Should `package.json` `"name": "voiceops"` be renamed?**
   - What we know: It is not user-visible (private package, no npm publish). Cookie prefix `vo_active_org` uses `vo_` not `voiceops`.
   - What's unclear: Whether internal consistency matters here.
   - Recommendation: Skip. The `name` field is never shown to end users and renaming it has no functional effect.

3. **Is `REDIS_URL` already in `.env.local`?**
   - What we know: `.env.local.example` does not include `REDIS_URL`. The project has no Redis dependency yet.
   - What's unclear: Whether the developer's local `.env.local` has a value.
   - Recommendation: Planner should include a step to add `REDIS_URL=redis://localhost:6379` to `.env.local.example` as documentation.

---

## Sources

### Primary (HIGH confidence)
- Reference implementation: `C:\Users\Vanildo\Dev\chatbot\lib\ratelimit.ts` — exact `redis` npm singleton pattern used in sister project
- Live grep of `src/` tree — authoritative list of VoiceOps occurrences (10 hits, 10 files)
- `src/lib/supabase/admin.ts` — existing `createServiceRoleClient()` pattern
- `supabase/migrations/010_knowledge_langchain.sql` — reference migration structure and RLS policy style
- `vitest.config.ts` — confirmed test framework and configuration

### Secondary (MEDIUM confidence)
- npm registry: `npm view redis version` → `5.11.0` as of 2026-04-04
- Supabase docs (Postgres Roles) — confirmed service_role bypasses all RLS; anon role subject to policies
- oneuptime.com Redis + Next.js guide (2026-01) — globalThis HMR guard pattern, matches chatbot reference

### Tertiary (LOW confidence)
- None — all critical claims have HIGH or MEDIUM backing

---

## Metadata

**Confidence breakdown:**
- Brand rename scope: HIGH — confirmed by live grep of the codebase
- Redis singleton pattern: HIGH — verified against reference implementation in sister project
- RLS strategy for public writes: HIGH — service-role client already used in this project for same purpose
- Chat schema columns: MEDIUM — column design is informed by Phase 2/3 requirements but those phases are not yet implemented; columns may need additions
- Widget placeholder: HIGH — Next.js `public/` serving behavior is well-established

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (stable tech stack; redis v5 API is stable)
