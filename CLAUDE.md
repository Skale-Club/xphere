# Xphere - Claude Code Instructions

## Commands

```bash
npm run dev      # dev server (Turbopack on port 4267)
npm run build    # production build + type check
npm run lint     # ESLint
npx supabase db push   # apply pending migrations to remote DB
```

Always run `npm run build` after changes to catch type errors before finishing.

## Architecture

**Stack:** Next.js 16 (App Router) · TypeScript 5 (strict) · Supabase (PostgreSQL + pgvector + Auth) · Tailwind 4 · shadcn/ui

**Runtime split:**
- Node.js - dashboard pages, server actions, and all webhook receivers (`/api/vapi/*`, `/api/meta/`, `/api/manychat/`, etc.)
- Deno - `supabase/functions/process-embeddings/` (Supabase Edge Function)
- GitHub Actions - auxiliary scheduled automation such as Supabase keepalive

**Product framing:** Xphere is a tenant-aware integration and orchestration platform. Client workflows can differ significantly, so prefer reusable platform capabilities over hardcoding one client's playbook as product-wide behavior.

**Canonical production origin:** `https://xphere.app`. Use this host for first-party webhook construction and documentation examples unless an updated production host is explicitly documented.

**Multi-tenancy:** Every table has RLS. `get_current_org_id()` (SECURITY DEFINER) resolves the active org. All queries are automatically scoped - never manually filter by `org_id` in queries that already go through the authenticated client.

## Key Patterns

### Auth
Always use the cached helpers - never call `supabase.auth.getUser()` directly:

```ts
import { createClient, getUser } from '@/lib/supabase/server'

const user = await getUser()
const supabase = await createClient()
```

`cache()` deduplicates these across the render tree per request. Auth gating happens in layouts, pages, route handlers, and server actions instead of middleware.

### API Routes
Inbound webhooks (Vapi, Meta, ManyChat, etc.) always return HTTP 200:

```ts
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    return Response.json({ ok: true })
  } catch {
    return Response.json({ ok: true })
  }
}
```

Production webhook endpoints:

- `https://xphere.app/api/vapi/tools`
- `https://xphere.app/api/vapi/calls`
- `https://xphere.app/api/vapi/campaigns`

### Components
- Server components by default
- Client components use `'use client'`
- Forms use `react-hook-form` + `zod` + `zodResolver`
- Toasts use `sonner`

## Database

Migrations live in `supabase/migrations/`. After adding a migration:
1. `npx supabase db push`
2. Update `src/types/database.ts` manually or regenerate it

**Active org:** Stored in `user_active_org` plus the `vo_active_org` cookie. `get_current_org_id()` prefers the explicit selection and falls back to the first membership.

## File Structure

```text
src/
  app/(auth)/          login page
  app/(dashboard)/     protected pages
  app/api/vapi/        webhook receivers (Node.js runtime)
  app/api/campaigns/   campaign control API
  components/layout/   AppSidebar, OrgSwitcher
  components/ui/       shadcn primitives
  lib/action-engine/   Action dispatch engine (webhook → action routing)
  lib/campaigns/       outbound campaign engine
  lib/ghl/             GoHighLevel API
  lib/knowledge/       embeddings + semantic search
  lib/supabase/        cached auth + server clients
  lib/crypto.ts        AES-256-GCM for stored API keys
  types/database.ts    Supabase schema types
supabase/
  migrations/          numbered SQL files
  functions/           Deno edge functions
tests/                 Vitest tests
```

## Workflows

The platform has a **single unified workflow system** (SEED-025). There is no separate "Automations" — that name was retired. Everything callable, scheduled, or event-driven is a Workflow with `kind='tool'` (single action invokable by name) or `kind='flow'` (multi-node DAG).

When you need to author a workflow (manually, via Copilot, or from a Claude Code agent):

1. Read `WORKFLOWS.md` at the repo root — the authoring contract
2. Read `.planning/agents/workflow-authoring.md` for decision tree + checklist
3. Browse `.planning/workflows/examples/` for canonical patterns to copy
4. Workflow files are declarative YAML; `npm run workflows:validate <file>` runs the full validator with structured errors
5. Platform-default workflows live in `supabase/seeds/workflows/` (validated in CI)
6. The org-filtered capability spec is at `GET /api/workflows/spec` (auth required)

**Key principle:** the validator is the contract. Integrations that aren't connected for the org never appear in the spec — AI cannot generate workflows referencing them. Variables that aren't in scope at a node produce structured errors with `suggestion` fields engineered for LLM self-correction.

## Deployment

- Vercel Hobby hosts the Next.js app
- Supabase handles background Edge Functions and database-backed jobs
- GitHub Actions is reserved for low-risk scheduled automation

## Sensitive Paths

- `src/lib/crypto.ts` - do not change the encryption format
- `supabase/migrations/` - never edit old migrations; add new ones
- `src/app/api/vapi/` - keep webhook handlers fast and Node.js-compatible
