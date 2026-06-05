# AGENTS.md

This file is for AI coding agents and automation working inside the Xphere repository. Read this before making changes.

## Mission

Xphere is a multi-tenant operations platform spanning voice AI (Vapi), chat (embeddable widget + multi-channel agents on WhatsApp/Instagram/Messenger), inbound webhook integrations (ManyChat, GHL, Meta), CRM, scheduling, unified workflows, knowledge, outbound campaigns, and a public REST API for external integrations.

The most important invariant in the system is the **Action Engine path** — the shared executor at `src/lib/action-engine/execute-action.ts` that every runtime calls into:

- receive an inbound trigger (Vapi tool call, chat tool invocation mid-stream, agent action, webhook event)
- resolve the right organization (tenant)
- execute the configured action via the right provider
- return a response quickly enough for the calling runtime — voice calls have the tightest latency budget

If you are unsure how to prioritize a change, protect that path first.

Xphere should be treated as a shared integration and orchestration platform for many tenant-specific workflows. Example automations for one client should not be assumed to be universal product behavior unless the planning docs explicitly say so.

The canonical production host is `https://xphere.app`. When documenting or wiring first-party webhooks, callbacks, or Vapi server URLs, use that origin unless the repository docs explicitly state a new production host.

## Read First

Before making non-trivial changes, ground yourself in these files:

1. [`README.md`](/README.md)
2. [`CLAUDE.md`](/CLAUDE.md)
3. [`WORKFLOWS.md`](/WORKFLOWS.md) — required before authoring any workflow
4. [`PROJECT.md`](/.planning/PROJECT.md)
5. [`STATE.md`](/.planning/STATE.md)
6. Relevant phase or milestone artifacts in [`.planning/milestones`](/.planning/milestones)
7. For workflow authoring specifically: [`.planning/agents/workflow-authoring.md`](/.planning/agents/workflow-authoring.md)

## Repo Facts

- Framework: Next.js 16 App Router
- Language: TypeScript strict mode
- UI: Tailwind CSS 4 plus shadcn/ui
- Data layer: Supabase Postgres with RLS and pgvector
- Tests: Vitest
- Current planning status: `v3.0` Workflow Runtime Hardening shipped as of `2026-05-22`

## Non-Negotiable Rules

### 1. Respect runtime boundaries

- `src/app/api/vapi/*` runs on the Node.js runtime in the current codebase.
- `supabase/functions/process-embeddings/` runs on Deno.
- Do not introduce runtime-incompatible APIs into shared paths.

### 2. The Vapi webhook contract must stay stable

For Vapi-facing routes:

- keep responses lean
- do not block on non-essential work
- preserve the "always return HTTP 200" behavior unless product requirements explicitly change
- prefer deferred side effects with the established async pattern
- construct public webhook targets against `https://xphere.app`

Start with [`src/app/api/vapi/tools/route.ts`](/c:/Users/Vanildo/Dev/xphere/src/app/api/vapi/tools/route.ts) when reasoning about this area.

### 3. Multi-tenancy is enforced with RLS first

- Assume tenant isolation should happen through Supabase RLS and org context, not ad hoc filtering
- `get_current_org_id()` is the central org-resolution primitive
- avoid introducing code that bypasses tenant scoping for authenticated user flows
- service-role clients are only for explicit bootstrap, webhook, or privileged paths

### 4. Use the cached auth helpers

For server components and server actions, use helpers from [`src/lib/supabase/server.ts`](/c:/Users/Vanildo/Dev/xphere/src/lib/supabase/server.ts):

- `createClient()`
- `getUser()`

Do not scatter direct `supabase.auth.getUser()` calls if the cached helper already covers the case.

### 5. Treat credential handling as sensitive

- integration secrets are encrypted with AES-256-GCM
- do not log plaintext API keys
- do not change encryption storage format casually
- do not move secret storage back to plain env vars for tenant-managed providers

See [`src/lib/crypto.ts`](/c:/Users/Vanildo/Dev/xphere/src/lib/crypto.ts).

### 6. Never rewrite migration history

- existing files in [`supabase/migrations`](/c:/Users/Vanildo/Dev/xphere/supabase/migrations) are append-only
- add a new numbered migration for schema changes
- if schema changes affect TypeScript types, update [`src/types/database.ts`](/c:/Users/Vanildo/Dev/xphere/src/types/database.ts)

## Working Style Expectations

- Prefer small, surgical changes over broad refactors unless the task truly needs one.
- Preserve established patterns before inventing new ones.
- Keep imports on the `@/` alias path.
- Use server components by default unless interactivity requires a client component.
- When touching user flows, match the existing admin-panel tone and structure.
- Prefer reusable platform primitives over hardcoding a one-off client workflow into the product model when the behavior can remain tenant-specific.

## Planning Folder Expectations

The `.planning` directory is part of the project source of truth, not background clutter.

Use it to answer:

- what the product is trying to do: [`PROJECT.md`](/c:/Users/Vanildo/Dev/xphere/.planning/PROJECT.md)
- what has already shipped: [`MILESTONES.md`](/c:/Users/Vanildo/Dev/xphere/.planning/MILESTONES.md)
- what the current state and next priorities are: [`STATE.md`](/c:/Users/Vanildo/Dev/xphere/.planning/STATE.md)
- how a feature was originally implemented: phase archives in [`.planning/milestones`](/c:/Users/Vanildo/Dev/xphere/.planning/milestones)

When a code change materially alters product behavior, architecture, or milestone status, update the relevant planning docs as part of the same task when appropriate.

## Recommended Workflow

1. Inspect the relevant feature area and tests.
2. Check `.planning` for intent, constraints, or known gaps.
3. Make the smallest change that solves the problem cleanly.
4. Run verification proportional to the change.
5. Call out any residual risk, especially around Edge latency, RLS, or secrets.

## Verification

Preferred checks:

```bash
npm run build
npx vitest
```

Use narrower test selection when the change is localized, but favor `npm run build` before finishing any non-trivial task.

## Workflows (Unified System — SEED-025)

This platform has a **single unified workflow system**. There is no separate "Automations". Both invokable tools (1-node, callable by name) and multi-step flows (DAGs) live in the same `workflows` table, distinguished by `kind` (`'tool' | 'flow'`).

**Before authoring any workflow** — manually, via Copilot, or as an external coding agent — you must read:

1. [`WORKFLOWS.md`](/WORKFLOWS.md) — the authoring contract (mental model, YAML format, validation, submission)
2. [`.planning/agents/workflow-authoring.md`](/.planning/agents/workflow-authoring.md) — decision tree, scope reference, pre-flight checklist, pattern catalog, anti-patterns
3. [`.planning/workflows/examples/`](/.planning/workflows/examples) — canonical YAML examples (copy and adapt rather than hand-rolling from scratch)

**The validator is the contract.** Run `npm run workflows:validate <file>` locally or POST to `/api/workflows/validate` for dry-run. Every error has a structured `suggestion` field engineered for direct LLM consumption — iterate until clean before submitting.

**Org-filtered spec.** `GET /api/workflows/spec` is the source of truth for what's authorable per org. Disconnected integrations are filtered out server-side — an AI literally cannot generate a workflow referencing a capability that doesn't exist for the target org. Use the static spec in `src/lib/workflows/spec.ts` (or the JSONSchema in `docs/workflows/`) when no live org context is available.

**Where workflows live.**

- Runtime per-tenant workflows: `workflows` + `workflow_versions` (RLS-scoped)
- Platform-default workflows: `supabase/seeds/workflows/*.yaml` (validated in CI, loaded on deploy)
- Examples / reference: `.planning/workflows/examples/`

**Coordinate seeds.** SEED-025 (data model + engine), SEED-026 (AI authoring), SEED-027 (calendar triggers), SEED-028 (meeting locations). Status of each is in the `.planning/seeds/` frontmatter (`planted` / `shipped`).

## Public REST API (`/api/v1/`)

The platform exposes a versioned public REST API at `/api/v1/` for external applications (forms, websites, Zapier, n8n, etc.) to push data into Xphere without a user session.

**Auth pattern:** `Authorization: Bearer xph_<64-hex>` — different from webhooks.

- Tokens are generated in `Settings → API Keys` and stored as SHA-256 hashes in the `api_keys` table.
- Route handlers use `createServiceRoleClient()` to look up the hash, resolve `org_id`, then operate on behalf of that org with explicit `org_id` filters (no RLS session cookie available).
- These routes return proper HTTP status codes (201/200/401/422/500) — **not** always-200 like inbound webhooks.
- CORS headers (`Access-Control-Allow-Origin: *`) are set so external sites can call cross-origin.

**Current endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/contacts` | Upsert a contact. Deduplicates by phone → email. |

See `docs/api/public-api.md` for the full integrator reference.

**When extending the public API:**
- New endpoints go under `src/app/api/v1/<resource>/route.ts`
- Always export an `OPTIONS` handler for CORS preflight
- Validate the Bearer token at the top of every handler (copy the pattern from `contacts/route.ts`)
- Update `docs/api/public-api.md` with the new endpoint

## Areas To Be Extra Careful With

- [`src/app/api/vapi/tools/route.ts`](/c:/Users/Vanildo/Dev/xphere/src/app/api/vapi/tools/route.ts): latency-sensitive live-call path
- [`src/app/api/v1/contacts/route.ts`](/c:/Users/Vanildo/Dev/xphere/src/app/api/v1/contacts/route.ts): public API — any regression breaks external integrations silently
- [`src/lib/crypto.ts`](/c:/Users/Vanildo/Dev/xphere/src/lib/crypto.ts): encryption format compatibility
- [`src/lib/supabase/server.ts`](/c:/Users/Vanildo/Dev/xphere/src/lib/supabase/server.ts): cached auth and client creation
- [`src/app/(dashboard)/outbound/actions.ts`](/c:/Users/Vanildo/Dev/xphere/src/app/(dashboard)/outbound/actions.ts): service-role and campaign control paths
- [`supabase/migrations`](/c:/Users/Vanildo/Dev/xphere/supabase/migrations): schema history

## Known Product Gaps

These are already acknowledged in planning and should not be mistaken for accidental omissions:

- webhook HMAC or secret validation is still pending
- campaign calls are not fully wired into observability yet

You can fix these if asked, but do not "quietly complete" them as incidental cleanup.

## Local Commands

```bash
npm run dev
npm run build
npm run lint
npx vitest
npx supabase db push
```

## Final Reminder

Optimize for correctness, tenant safety, and operational clarity. In this repo, a small safe change that preserves the Action Engine contract is better than a clever change that adds latency, weakens RLS assumptions, or muddies the planning trail.
