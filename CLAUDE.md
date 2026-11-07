# Xphere - Claude Code Instructions

<!-- journal-protocol:v1 -->
## Journal (mandatory)

This app's history (what it does, how each part was built, decisions and releases) lives in its Notion Journal. It replaces the old GSD/PAUL planning flow; `.planning/` and `.paul/`, if present, are a read-only legacy archive.

- Journal hub: https://app.notion.com/p/411b7a6861218106afe4d8d52ae2ac2e
- Journal Entries data source: collection://bcf52840-9e24-4df0-92cc-09135e0d8456
- Latest view: view://411b7a68-6121-815b-a65c-000cf926a348
- Entry prefix: XPH
- Rules (they win on any conflict): https://app.notion.com/p/411b7a68612181b3ac36f4ce2b2c3850 (skill: `app-journal`)

**Start of session:** fetch the hub and read Identity and Current State; list the latest 20 entries with Notion query-data-sources in `view` mode on the Latest view above (`page_size` 20; view mode has no plan quota) and read only titles and summaries; use `rows` mode with a filter only to narrow down (it has a plan quota); if a read fails, say so and continue from the code, never guess journal content; open only the entries you need; never read the whole database. Cross-check with the code: the code is the fact.

**End of every task that changed code, behavior, infrastructure or a decision:**
1. Create ONE entry in the data source above (one per logical unit of work, not per commit): `Title` = `YYYY-MM-DD — <imperative summary>`, `date:Date:start` (YYYY-MM-DD, with `date:Date:is_datetime` = 0), `Type`, `Area` (JSON array of existing options), `Status`, `Summary` (max 280 characters), `Agent`, `Model`, `Repo / Branch`, `Commits / PR`, `Tests` (what ran, or "Not run"), and `Decision ID` / `Decision Status` when a choice was made.
2. Body headings: Context · What changed · How it was built · Decisions and why · Tests and evidence · Not done / risks · Next.
3. If the app changed, rewrite the affected part of the hub's Current State. Read back what you wrote; never report a write you did not see.
4. Notion unavailable: append the full entry to `docs/journal/PENDING-NOTION.md` and tell the owner.

Journal records are in English. No secrets.
<!-- /journal-protocol -->

## Prospecting system documentation (read first, keep current)

Xphere is one part of the Skale Club prospecting pipeline (homelab scraper → Xcraper → Xphere →
Xmail, driven by the Hermes agent). The whole system is described in ONE place, in English:
`docs/prospecting/README.md` in the **xmail** repository
(https://github.com/Skale-Club/xmail/blob/main/docs/prospecting/README.md). Any change here that
alters prospecting behavior (verification, the website analyzer and booking detection, the
platform-email rule, import to Xmail, Meta audiences) updates that file too, in a commit of the
xmail repo made alongside this one.


## Commands

```bash
npm run dev      # dev server (Turbopack on port 4267)
npm run build    # production build + type check
npm run lint     # ESLint
npx supabase db push            # apply pending migrations to the DEV database (Supabase)
scripts/migrate-prod.sh --apply # apply them to PRODUCTION (Coolify Postgres); dry run without --apply
```

Always run `npm run build` after changes to catch type errors before finishing.

## Architecture

**Stack:** Next.js 16 (App Router) · TypeScript 5 (strict) · PostgreSQL 17 + pgvector behind PostgREST (supabase-js client) · Cloudflare R2 for files · Tailwind 4 · shadcn/ui

**Where the data lives (since 2026-11-05):**
- **Production:** Coolify Postgres `xphere-db` (container `mpvfrbenkwtvziunmelx7ars`, image `xphere-postgres:17` from `infra/postgres/Dockerfile`) and PostgREST container `xphere-postgrest` on the internal `coolify` network of the Hetzner host. No public port. The app reaches it through `SUPABASE_REST_URL` and signs its own tokens with `DB_JWT_SECRET` (`src/lib/supabase/db-exit.ts`). Daily backup to the private R2 bucket at 03:17 UTC, 14 days (`infra/postgres/backup.sh`, root crontab on the host).
- **Development:** the Supabase project (`.env.local`). It holds a copy of production as of the cutover, with a dev-only `ENCRYPTION_SECRET`, so real integrations cannot be decrypted locally.
- Plan and record: `docs/database/execution-plan.md`.

**Runtime split:**
- Node.js - dashboard pages, server actions, all webhook receivers (`/api/vapi/*`, `/api/meta/`, `/api/manychat/`, etc.), and the former Edge Functions (`EDGE_FUNCTIONS_IN_APP`)
- GitHub Actions - auxiliary scheduled automation. `meta-capi-worker` and `meta-audience-sync` now run in the app (`/api/cron/meta-capi-worker`, `/api/cron/meta-audience-sync`, scheduled by skale-cron); their workflows are manual `workflow_dispatch` triggers that only curl the route. `eval-harness` stays a disabled GitHub workflow: it was never configured (no EVAL_*/ANTHROPIC secrets) and its judge calls Anthropic directly, which `src/` forbids

**Product framing:** Xphere is a tenant-aware integration and orchestration platform. Client workflows can differ significantly, so prefer reusable platform capabilities over hardcoding one client's playbook as product-wide behavior.

**Canonical production origin:** `https://xphere.app`. Use this host for first-party webhook construction and documentation examples unless an updated production host is explicitly documented.

**Multi-tenancy:** Every table has RLS. `get_current_org_id()` (SECURITY DEFINER) resolves the active org. All queries are automatically scoped - never manually filter by `org_id` in queries that already go through the authenticated client.

## Key Patterns

### Auth
Sign-in is Google Identity Platform (texted code or Google) with an app-owned session cookie and `public.users`. Read the session with the cached helpers - never call `supabase.auth.*` (clients use `accessToken`, so it throws, and a test enforces it):

```ts
import { createClient, getUser } from '@/lib/supabase/server'

const user = await getUser()   // reads the app session, not Supabase Auth
const supabase = await createClient()
```

`cache()` deduplicates these across the render tree per request. Auth gating happens in layouts, pages, route handlers, and server actions instead of middleware. The only file allowed to touch Supabase Auth is `src/lib/auth/supabase-jwt.ts`, a temporary bridge that fetches the database token with the service role key and goes away with Supabase. Design: `docs/auth/identity-platform-migration.md`.

### API Routes

**Inbound webhooks** (Vapi, Meta, ManyChat, etc.) always return HTTP 200:

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

**Public REST API** (`/api/v1/`) uses Bearer token auth via the `api_keys` table — different pattern from webhooks:

```ts
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.slice(7)
  const supabase = createServiceRoleClient()
  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('id, org_id')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()
  if (!apiKey) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  // ... process with apiKey.org_id
}
```

- Tokens: `xph_<64 hex>` — SHA-256 hash stored, plaintext never persisted
- Managed via `Settings → API Keys` UI
- Returns proper HTTP status codes (201/200/401/422) — NOT always-200 like webhooks
- CORS headers included — external sites call this cross-origin
- Full reference: `docs/api/public-api.md`

### Components
- Server components by default
- Client components use `'use client'`
- Forms use `react-hook-form` + `zod` + `zodResolver`
- Toasts use `sonner`

## Development database

Production runs on a self-hosted Postgres. The Supabase project in `.env.local` is the **dev**
database and holds sample data only.

- **Never copy production data into it** (no dumps, no restores, no sync jobs).
- `npm run db:seed-dev -- --reset` rebuilds it: wipes tenant data, keeps the owner login
  (`DEV_KEEP_USER_EMAILS`), and seeds three obviously fake orgs. Run `-- --dry-run` first to
  see the guard result and the wipe/keep table lists. Without `--reset` the seed is additive and
  idempotent. The script refuses to run unless `DEV_SUPABASE_PROJECT_REF` matches
  `NEXT_PUBLIC_SUPABASE_URL` and `DATABASE_URL`, or if `SUPABASE_REST_URL` / `DB_JWT_SECRET` is set.
- The Supabase keepalive workflow (`.github/workflows/supabase-keepalive.yml`) keeps this project
  from pausing.

## Database

Migrations live in `supabase/migrations/` as numbered SQL files (`1281_short_name.sql`).

### `db push` is the only way to apply a migration

**Never apply schema changes with the Supabase MCP `apply_migration` tool or the
dashboard SQL editor.** Both write to production without leaving a file in this
repo, and `apply_migration` additionally records its own generated timestamp
version (`20260815021606`) in `supabase_migrations.schema_migrations`. Because
that version has no counterpart in `supabase/migrations/`, the next
`supabase db push` aborts with *"Remote migration versions not found in local
migrations directory"* — the whole team is then blocked from shipping schema
until someone reconciles the history table by hand.

**Since 2026-11-05 `db push` reaches only the DEVELOPMENT database** (the
Supabase project). Production is the Coolify Postgres; `scripts/migrate-prod.sh`
is its `db push`: it applies the files above production's newest recorded
version, one transaction each, and records them in the same history table.

To add a migration:

1. Write `supabase/migrations/<next-number>_<short_name>.sql`. Make it
   idempotent (`IF NOT EXISTS`, `DROP … IF EXISTS` before `CREATE`) so a re-run
   is a no-op. It must not depend on Supabase-only schemas (`storage`, `vault`,
   `realtime`, `auth.users`): production has none of them.
2. `npx supabase db push` (development)
3. `scripts/migrate-prod.sh` to list, then `scripts/migrate-prod.sh --apply` (production)
4. Update `src/types/database.ts` manually or regenerate it
5. Commit the migration file in the same PR as the code that depends on it

`supabase db push` is the only path that keeps three things in agreement: the
files in this repo, the remote history table, and what a fresh
`supabase db reset` reproduces. The MCP tool keeps only the third.

**Read-only MCP/SQL-editor queries are fine** — inspecting the live schema,
checking data, running `SELECT`. The rule is about DDL.

### If the history table drifts anyway

`npx supabase migration list --linked` shows Local vs Remote. Before repairing,
verify against the live schema whether each migration's objects actually exist —
never trust the recorded `name`, which has drifted from the file numbering
before (a row named `1266_event_types_look_busy` was really file `1267`).

- Applied but unrecorded → `npx supabase migration repair --linked --status applied <version>`
- Recorded but no local file → recover the DDL from the live schema into a new
  numbered file and mark that applied; only use `--status reverted` once nothing
  is left to preserve, since it deletes the row outright.

Back up `supabase_migrations.schema_migrations` before any repair pass.

A migration whose effects were later undone by a *subsequent* migration (1267
added `event_types.look_busy_*`; 1268 dropped them) is still **applied** — its
DDL ran. Marking it `reverted` would make `db push` re-run it and reintroduce
what 1268 deliberately removed.

**Active org is per browser tab:** dashboard URLs carry `/o/<org-id>/…`. `src/proxy.ts` strips the prefix and forwards the org in the `x-xphere-org` header, the server Supabase client passes it to PostgREST, and `get_current_org_id()` honours it only for a member (migration 1308). Without it, `user_active_org` (the last focused tab's org) and then the first membership apply. In dashboard code use `usePathname` from `@/lib/org/navigation` (prefix stripped), `return orgRedirect(...)` from `@/lib/org/redirect` for server redirects to dashboard routes, and `window.location.assign(orgPath(id, …))` to switch org. Realtime has no request headers: org-scoped tables published to `supabase_realtime` need the `CASE WHEN is_realtime_rls_check()` policy form from migration 1309. Rationale and pitfalls live in `src/lib/org/request-org.ts` and the 1308/1309 headers.

## File Structure

```text
src/
  app/(auth)/          login page
  app/(dashboard)/     protected pages
  app/api/v1/          public REST API (Bearer token auth via api_keys table)
    contacts/          POST /api/v1/contacts — upsert contact from external source
  app/api/vapi/        webhook receivers (Node.js runtime)
  app/api/campaigns/   campaign control API
  components/layout/   AppSidebar, OrgSwitcher
  components/ui/       shadcn primitives
  lib/action-engine/   Action dispatch engine (webhook → action routing)
  lib/ads/commands/    Ads Command Engine — the ONLY path that writes to Google/Meta Ads
  lib/ads/providers/   Google/Meta adapters (snapshot, plan, validate, execute, verify, rollback)
  lib/campaigns/       outbound campaign engine
  lib/ghl/             GoHighLevel API
  lib/knowledge/       embeddings + semantic search
  lib/supabase/        cached auth + server clients
  lib/crypto.ts        AES-256-GCM for stored API keys
  types/database.ts    Supabase schema types
supabase/
  migrations/          numbered SQL files
  functions/           Deno edge functions
docs/
  api/public-api.md    Full public API reference for integrators
  ads/control-plane.md Ads Command Engine: ledger, policies, commands, MCP flow
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

- **GitHub Actions builds the image; self-hosted Coolify only runs it.** The
  Docker image is built on GitHub runners from the `Dockerfile` (standalone
  output) and pushed to GHCR — Coolify pulls that prebuilt image and rolls it
  out. Production: `xphere.app`, on a Hetzner box (shared Docker host).
  Coolify app `xphere-zdt`, uuid `fwjo7xriuqibl01v96vah7fz` — a **Docker Image**
  resource (rolling update, zero-downtime) tracking
  `ghcr.io/skale-club/xphere:latest`; serves `xphere.app`, `www.xphere.app`,
  `xphere-stage.skale.club`. (Superseded the old app
  `c70jg4t9o88x985dctsl57qy` during the 2026-06-10 migration; the build moved
  off the VPS because the 8GB CX32 OOM-thrashes on `next build`.)
- **Auto-deploy:** every push to `main` runs `.github/workflows/build-deploy.yml`
  ("Build and Deploy", job `build-and-deploy`): Checkout → Set up Docker Buildx →
  Log in to GHCR → **Build image and push to GHCR** (tags `:latest` and
  `:<sha>`, GHA layer cache, `NEXT_PUBLIC_*` passed as build args) → **Trigger
  Coolify deploy** via `POST /api/v1/deploy?uuid=…`. Coolify then pulls
  `:latest`, starts the new container, waits for `/api/health`, and swaps
  traffic. Because the build now happens in CI, a run takes **~8 minutes** end
  to end (measured 7m44s-9m39s over the last seven successful runs) — not the
  few seconds the old trigger-only workflow took. `deploy.yml`
  no longer exists (removed to stop a double Coolify trigger); `concurrency:
  build-deploy` with `cancel-in-progress` means a newer push cancels an
  in-flight build. Requires repo secret `COOLIFY_TOKEN` — if it is missing the
  job still builds and pushes to GHCR and only warns on the deploy step, so a
  rotated token shows up as "image updated, site unchanged". Don't also enable
  Coolify's UI "Automatic Deployment" or pushes will deploy twice.
- **Manual-dispatch ops workflows** (never run on push):
  `coolify-set-envs.yml` upserts runtime env vars from GitHub Secrets into the
  Coolify app and redeploys — runtime env is *not* managed by `build-deploy.yml`,
  which only passes `NEXT_PUBLIC_*` build args. `coolify-zero-downtime.yml`
  enables the Coolify health check on `/api/health`; note it still targets the
  superseded uuid `c70jg4t9o88x985dctsl57qy`.
- Supabase handles background Edge Functions and database-backed jobs
- Other GitHub Actions are low-risk scheduled automation (cron-tick, keepalive,
  etc.) — domain-stable.

## Sensitive Paths

- `src/lib/crypto.ts` - do not change the encryption format
- `supabase/migrations/` - never edit old migrations; add new ones
- `src/app/api/vapi/` - keep webhook handlers fast and Node.js-compatible
- Ad-platform writes - never call Google Ads `:mutate` or Meta Graph `POST` from a
  route, tool or workflow; submit a command to `src/lib/ads/commands/engine.ts`
  (see `docs/ads/control-plane.md`) so it gets policy, ledger and read-back
