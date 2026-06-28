# Xphere

Xphere is a multi-tenant operations platform for agencies. It unifies voice AI (Vapi), an embeddable chat widget, multi-channel agents (WhatsApp, Instagram, Messenger), inbound webhook integrations (ManyChat, GoHighLevel, Meta), CRM, scheduling, knowledge base, unified workflows, and outbound campaigns under one admin panel — with Supabase RLS enforcing tenant isolation at the data layer.

The platform is intentionally designed as a configurable integration and orchestration layer, not as a single hardcoded workflow. Each client organization can have its own assistant mappings, provider credentials, tool behaviors, inbound routing rules, and follow-up actions while sharing the same product foundation.

The shared substrate is the **Action Engine**: a single executor that any runtime (voice call, chat stream, agent invocation, inbound webhook) can call with a tool name + params. The engine resolves the tenant, loads the configured action, executes against the right provider, and logs the result. This means a new channel only needs to wire into the engine — the universe of available actions is shared.

The canonical production origin for the app and all first-party webhooks is `https://xphere.app`.

## What It Does

- Routes tool calls from any runtime (Vapi voice, chat widget, multi-channel agents, ManyChat, Meta, GHL) through a shared Action Engine
- Maps assistants/agents/channels to tenant organizations
- Stores per-organization integration credentials with AES-256-GCM encryption
- Logs every tool execution with timing, payloads, and outcomes (`action_logs`)
- Ingests completed call data, chat conversations, and inbound messages for observability
- Manages CRM (contacts, accounts, opportunities, custom fields, tags) with per-org RLS
- Runs Calendly-style scheduling with Google Calendar integration and public booking pages
- Powers an embeddable chat widget with knowledge base pre-retrieval and tool-calling mid-stream
- Runs outbound voice campaigns with CSV import and status tracking
- Supports client-specific operational workflows built from shared primitives instead of one fixed universal flow

## Product Framing

Xphere should be understood as the shared platform underneath many per-client workflows and automations.

- The product owns tenant resolution, credential storage, tool execution, observability, and outbound infrastructure.
- A concrete workflow such as "find appointments in 1 hour, call to confirm, then notify the owner by SMS" is a client-specific orchestration built on top of those primitives.
- Not every customer will use the same sequence, providers, or post-call actions, so avoid documenting example workflows as if they are mandatory product-wide behavior.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript 5 in strict mode
- Supabase for Postgres, Auth, RLS, and pgvector
- Tailwind CSS 4 and shadcn/ui
- Vitest for tests
- Vapi for voice assistant and outbound call integration

## Architecture At A Glance

### Runtime split

- Node.js: dashboard pages, server actions, and `src/app/api/vapi/*` webhook routes
- Deno: Supabase Edge Function in [`supabase/functions/process-embeddings/index.ts`](/c:/Users/Vanildo/Dev/xphere/supabase/functions/process-embeddings/index.ts)
- GitHub Actions: low-frequency maintenance cron like [`.github/workflows/supabase-keepalive.yml`](/c:/Users/Vanildo/Dev/xphere/.github/workflows/supabase-keepalive.yml)

### Core flow — Action Engine

Any runtime can invoke a configured tool:

| Runtime | Entry point |
|---------|-------------|
| Vapi voice call | `src/app/api/vapi/tools/route.ts` |
| Chat widget stream | `src/lib/chat/stream/{anthropic,openrouter}.ts` |
| Multi-channel agent | `src/lib/agent-runtime/run-agent.ts` |
| ManyChat inbound | `src/lib/manychat/dispatch-event.ts` |
| Meta (WhatsApp/IG/Messenger) inbound | `src/lib/meta/process-event.ts` |
| GoHighLevel inbound | `src/lib/ghl/process-event.ts` |

Each entry point follows the same shape:

1. Verify webhook signature / API key, resolve the tenant (org)
2. Call `executeAction(toolConfig, params, context)` in `src/lib/action-engine/`
3. The engine dispatches to the provider executor (GHL, Twilio, Evolution Go, ManyChat, Custom Webhook, Knowledge Base, Google Contacts)
4. Result returns to the caller; execution is logged to `action_logs` asynchronously

This shared substrate is why adding a new channel doesn't require duplicating tool implementations — wire the runtime into the engine and every existing action becomes available.

### Canonical public URLs

Use `https://xphere.app` as the definitive public base URL for the product.

- App origin: `https://xphere.app`
- Vapi tool-call webhook: `https://xphere.app/api/vapi/tools`
- Vapi end-of-call webhook: `https://xphere.app/api/vapi/calls`
- Vapi campaign webhook: `https://xphere.app/api/vapi/campaigns`

When configuring Vapi server URLs, external callbacks, or customer-specific integrations that call into Xphere, prefer these canonical URLs over temporary Vercel preview URLs or other legacy webhook hosts.

### Tenant model

- Every tenant-facing table is protected with Supabase RLS.
- Active org context is resolved with the `get_current_org_id()` database function.
- The current org is also cached in the `vo_active_org` cookie for fast navigation.

## Main Product Areas

- `Calls`: unified timeline (AI + human), transcripts, recordings, tool execution visibility, campaigns, assistants, routing settings
- `Conversations`: multi-channel inbox (chat widget, WhatsApp, Instagram, Messenger, SMS) with bot pause/resume
- `Contacts / Accounts / Pipeline`: full CRM with custom fields, tags, bulk import, and Kanban opportunities
- `Tasks / Notes`: per-entity follow-up tracking
- `Scheduling`: Calendly-style booking pages with Google Calendar sync
- `Agents`: multi-agent platform with per-agent tools, delegation, and channel routing
- `Workflows`: unified per-org action and flow system — the LLM-callable tool catalog and DAG runtime used by agents, events, schedules, and manual runs
- `Knowledge`: tenant-scoped document RAG plus a super-admin Global Knowledge corpus that can use Notion as an authoritative, automatically synchronized source
- `Integrations`: encrypted credentials and provider configuration (GHL, Twilio, Meta, Google, Evolution Go, etc.)
- `Reviews`: Google Reviews via SerpAPI with embeddable widgets
- `Admin`: super-admin panel (platform owner only) — org overview, platform stats, feature flags, SEO config

Across these areas, the design goal is composability: the same base capabilities should support many client-specific operational playbooks.

## Integration Conventions

- When linking a Vapi assistant into the platform, store a human-friendly assistant name alongside the Vapi assistant ID — prefer the same readable name your team uses in Vapi.
- Don't use raw UUIDs, timestamps, or generated test labels as the primary label for assistants, agents, or tools.
- Treat external provider IDs (Vapi assistant ID, GHL location ID, Twilio account SID) as routing keys, not user-facing identifiers.
- Inbound webhook receivers (`/api/{provider}/*`) always return HTTP 200, even on internal errors — investigate via `action_logs` instead.
- New action types must be added to the `action_type` enum + dispatcher in `src/lib/action-engine/execute-action.ts`. Once added, every runtime can use them without further wiring.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Create local env

Copy `.env.local.example` to `.env.local` and fill in the base app values.

Required app-level values used by the current code:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ENCRYPTION_SECRET=
VAPI_API_KEY=
```

Notes:

- `ENCRYPTION_SECRET` must be a 64-character hex string.
- `VAPI_API_KEY` is required for outbound campaign and Vapi API helpers.
- OpenAI, Anthropic, OpenRouter, and most Vapi credentials are designed to be configured per organization in the `Integrations` area and stored encrypted in the database.
- `.env.example` still includes `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` placeholders, but the current app flow primarily reads provider keys from tenant integrations rather than global env vars.

### 3. Apply database migrations

```bash
npx supabase db push
```

Migrations live in [`supabase/migrations`](/c:/Users/Vanildo/Dev/xphere/supabase/migrations).

### 4. Run the app

```bash
npm run dev
```

The root route redirects to `/calls`.

## Deployment Target

- Vercel Hobby: hosts the Next.js app with Node.js route handlers
- Supabase: Postgres, Auth, Storage, pgvector, and background Edge Functions
- GitHub Actions: auxiliary scheduled automation only

This repo is aligned to avoid depending on Vercel Edge Runtime or Vercel Cron for core product flows.

Production traffic should terminate at `https://xphere.app`. Treat that host as the stable public address for app access, Vapi webhooks, and any first-party webhook construction.

## Useful Commands

```bash
npm run dev
npm run build
npm run lint
npx vitest
npx supabase db push
```

`npm run build` is the best single verification pass here because it also catches type issues.

## Testing

Tests live in [`tests`](/c:/Users/Vanildo/Dev/xphere/tests) and run under Vitest in a Node environment. The current suite covers multi-tenancy, auth, calls, campaigns, integrations, workflows, knowledge base behavior, and action-engine flows.

Run all tests with:

```bash
npx vitest
```

## Repository Layout

```text
src/
  app/
    (auth)/            login flow
    (dashboard)/       protected product areas
    api/vapi/          Vapi-facing webhook routes
    api/campaigns/     campaign control endpoints
    api/knowledge/     upload helpers
  components/          UI and feature components
  lib/
    action-engine/     tool resolution and execution
    campaigns/         outbound campaign logic
    ghl/               GoHighLevel integration helpers
    knowledge/         text extraction, chunking, embeddings, retrieval
    supabase/          cached server/client/admin helpers
  types/               database and Vapi types
supabase/
  migrations/          numbered SQL migrations
  functions/           Supabase Edge Functions
skills/
  vapi/                local skill for Vapi API usage and conventions
  ghl/                 local skill for GoHighLevel integration patterns
tests/                 Vitest test suite
.planning/             roadmap, state, milestone archive, and phase artifacts
```

The `skills/` folder is the repo-local library for reusable integration skills. Add new provider-specific skills there as Xphere gains more integrations.

## Planning Folder

This repo keeps delivery context in [`.planning`](/c:/Users/Vanildo/Dev/xphere/.planning):

- [`PROJECT.md`](/c:/Users/Vanildo/Dev/xphere/.planning/PROJECT.md): product definition, validated requirements, active gaps, key decisions
- [`STATE.md`](/c:/Users/Vanildo/Dev/xphere/.planning/STATE.md): current milestone state and immediate next priorities
- [`MILESTONES.md`](/c:/Users/Vanildo/Dev/xphere/.planning/MILESTONES.md): milestone history
- [`milestones/`](/c:/Users/Vanildo/Dev/xphere/.planning/milestones): archived roadmap, requirements, audits, and phase outputs
- [`RETROSPECTIVE.md`](/c:/Users/Vanildo/Dev/xphere/.planning/RETROSPECTIVE.md): lessons learned across milestones
