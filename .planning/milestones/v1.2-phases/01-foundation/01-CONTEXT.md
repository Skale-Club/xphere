# Phase 1: Foundation - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver all infrastructure and branding prerequisites so downstream phases can build without blockers. Specifically:
- Rename every visible "VoiceOps" reference to "Leaidear" across the running app (9 files identified)
- Add the `redis` npm package and wire up a singleton Redis client at `src/lib/redis.ts`
- Create `chat_sessions` and `chat_messages` Supabase tables with RLS via a new migration `011_chat_schema.sql`
- Add a `public/widget.js` placeholder file served from the platform domain

This phase has no user-facing features beyond the brand rename. It is purely infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Brand Rename
- **D-01:** Replace all occurrences of `"VoiceOps"` in UI labels, metadata, and user-facing strings with `"Leaidear"`.
- **D-02:** The login page subtitle and `layout.tsx` metadata description should read `"AI Operations Platform"` (replaces `"Voice AI Operations Platform"`).
- **D-03:** Non-UI strings (e.g., User-Agent header in `extract-text.ts`, DB type comment in `types/database.ts`) should also be updated to `"Leaidear"` for consistency.

### Redis Client
- **D-04:** Use the `redis` npm package (standard Node.js Redis client) — NOT `@upstash/redis`.
- **D-05:** Add `REDIS_URL` as the single environment variable for the Redis connection. Works with local Redis (`redis-server`) and Upstash via URL — no provider lock-in.
- **D-06:** Create `src/lib/redis.ts` as a singleton module that lazy-connects on first use and exports the client. Pattern mirrors the Supabase client in `src/lib/supabase/`.
- **D-07:** Redis connection errors must be handled gracefully — if Redis is unavailable, log the error but do not crash the app (chat will degrade, not break the whole platform).

### Widget Placeholder
- **D-08:** Create `public/widget.js` as a minimal static JS placeholder (a `// Leaidear widget` comment stub is sufficient). This fulfills INFRA-04 without adding app code.
- **D-09:** Phase 4 (Widget Embed Script) will replace `public/widget.js` with the real implementation. The URL `https://voiceops.skale.club/widget.js` must resolve in Phase 1.

### Supabase Chat Schema
- **D-10:** Create `chat_sessions` and `chat_messages` in migration `011_chat_schema.sql`. Follow the existing RLS pattern: `organization_id` FK, `get_current_org_id()` policy.
- **D-11:** Note for planner: the public chat API (Phase 2) will write to these tables without an authenticated Supabase user. The migration should consider a service-role bypass policy or a `SECURITY DEFINER` RPC for the write path — planner should research the best approach.

### Claude's Discretion
- Exact column names and types for `chat_sessions` / `chat_messages` (beyond `id`, `organization_id`, `created_at` which are required by convention)
- Whether to add `updated_at` to sessions
- Exact error message or fallback behavior when Redis is unavailable

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project conventions
- `.planning/codebase/CONVENTIONS.md` — RLS policy pattern, table conventions, env var naming, singleton client patterns
- `CLAUDE.md` — Auth patterns, Supabase helpers, Node.js runtime for API routes

### Existing code to modify (brand rename)
- `src/app/layout.tsx` — metadata title/description
- `src/app/(auth)/login/page.tsx` — h1 and subtitle text
- `src/components/layout/app-sidebar.tsx:95` — sidebar brand text
- `src/app/(dashboard)/tools/page.tsx` — description copy
- `src/app/(dashboard)/tools/[toolConfigId]/page.tsx` — descriptive copy
- `src/components/assistants/assistant-mapping-form.tsx` — descriptive copy
- `src/components/assistants/assistant-mappings-table.tsx` — empty state copy
- `src/components/tools/tools-table.tsx` — empty state copy
- `src/lib/knowledge/extract-text.ts` — User-Agent header
- `src/types/database.ts` — file comment

### Reference implementation
- `C:\Users\Vanildo\Dev\chatbot\lib\ratelimit.ts` — reference Redis singleton pattern using `createClient` from `redis` npm

### Latest migration for numbering reference
- `supabase/migrations/010_knowledge_langchain.sql` — next migration is `011_chat_schema.sql`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Supabase server client pattern (`src/lib/supabase/server.ts`) — follow same lazy singleton pattern for `src/lib/redis.ts`
- RLS migration pattern from existing migrations — `011_chat_schema.sql` should follow `010_knowledge_langchain.sql` structure

### Established Patterns
- All tables: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `organization_id UUID NOT NULL`, `created_at TIMESTAMPTZ DEFAULT now()`, RLS enabled
- RLS policy: wrap `auth.uid()` in `(select ...)` for performance; use `get_current_org_id()` for org scoping
- Env vars: `NEXT_PUBLIC_` prefix for browser-safe only, secrets server-only

### Integration Points
- `src/lib/redis.ts` (new) — imported by Phase 2 chat API route handlers
- `supabase/migrations/011_chat_schema.sql` (new) — tables used by Phase 2 chat API and Phase 3 AI engine
- `public/widget.js` (new) — replaced with real implementation in Phase 4

</code_context>

<specifics>
## Specific Ideas

- Chatbot reference at `C:\Users\Vanildo\Dev\chatbot` uses `redis` npm + `REDIS_URL` — same client choice made here
- Widget placeholder URL will be `https://voiceops.skale.club/widget.js` (production origin per CLAUDE.md)
- Brand rename covers 9 identified files — planner should confirm no additional files via grep before marking complete

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-04*
