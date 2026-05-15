# Phase 32: GHL Lost-Lead Reengagement SMS Automation — Research

**Researched:** 2026-05-15
**Revised:** 2026-05-15 — SMS executor swapped from Twilio to GHL Conversations API (`sendSmsViaGhl`). Rationale: keep the conversation thread inside the GHL sub-account so replies route back through GHL's inbound webhook and stay in the CRM contact history.
**Domain:** Scheduled outbound automation — GHL Opportunities API + GHL Conversations SMS executor + Supabase anti-loop persistence + GitHub Actions scheduler
**Confidence:** HIGH (internal patterns) · MEDIUM (GHL Opportunities Search API field shape — docs are JS-rendered)

## Summary

Phase 32 entrega um MVP end-to-end de reengagement SMS para a sub-account Skleanings no GoHighLevel. A maior parte do trabalho é **integração** de peças já existentes no codebase, não código novo de plataforma: o executor GHL SMS (`sendSmsViaGhl`) já está implementado em `src/lib/ghl/send-sms.ts`, o wrapper GHL (`ghlFetch` / `ghlFetchJson` com `timeoutMs` opcional) já está pronto em `src/lib/ghl/client.ts`, o padrão de logging em `action_logs` já existe e está tipado, e o scheduler já tem um precedente (`.github/workflows/supabase-keepalive.yml`). As únicas peças novas são: (1) um novo método `listOpportunities()` que usa cursor pagination da GHL, (2) uma migration adicionando a tabela `ghl_reengagement_sent` com RLS org-scoped, (3) um endpoint Node `POST /api/automations/ghl-reengagement/run` autenticado por bearer secret e usando service-role client (sem sessão de usuário), e (4) um workflow YAML de cron diário.

**Key simplification from the Twilio version:** porque `/opportunities/search` já retorna `contact.id`, o runner passa `contactId` direto pro `sendSmsViaGhl` e pula o branch find-or-create — exatamente 1 chamada GHL por dispatch.

A maior incerteza concentra-se nos detalhes exatos da GHL Search Opportunities API — o nome canônico do filtro de data (`updatedAt` vs `lastStatusChangeStartDate`) e a forma exata em que o contato é embutido no item do response. A documentação oficial é renderizada via JS e bloqueia scraping. A pagination cursor (`startAfter` + `startAfterId` + `meta` no response) está confirmada por fonte secundária independente.

**Primary recommendation:** Reusar agressivamente — não criar novos abstrações. O runner é um arquivo de ~150 linhas que orquestra peças prontas. Tratar a chamada GHL como o único ponto que precisa de probing em runtime (printar o response uma vez em staging antes de assumir o shape).

<user_constraints>
## User Constraints (from STATE.md — no separate CONTEXT.md exists)

### Locked Decisions
- **[v1.9]** Hardcoded para Skleanings via env vars — versão multi-cliente é trabalho de plataforma, fica para milestone futura
- **[v1.9]** GitHub Actions como **pulse** (cron `*/15 * * * *`); horário real do dispatch **vive no DB** (tabela `automation_schedules`). Permite mudar quando rodar sem redeploy. Revisado 2026-05-15 — antes era cron hardcoded no YAML.
- **[v1.9]** Anti-loop persistido em DB (não em GHL tag) — fonte da verdade no nosso lado, evita depender de tags GHL que podem ser removidas
- **[v1.9]** Single-phase decomposition (Phase 32) — MVP scope is small and tightly coupled
- **[v1.9]** Schedule single-tenant (sem `org_id` na `automation_schedules`) — uma row por automation_key. Multi-tenant é trabalho de plataforma futura (Automations Platform).

### Env vars (required)
- `GHL_REENGAGEMENT_LOCATION_ID` (sub-account)
- `GHL_REENGAGEMENT_INTEGRATION_ID` (qual integration row usar — `provider='gohighlevel'`; o mesmo row serve para listar oportunidades E enviar SMS)
- `GHL_REENGAGEMENT_MESSAGE` (template com `{{first_name}}`)
- `GHL_REENGAGEMENT_TRIGGER_SECRET` (bearer pro endpoint)

### Env vars (optional, with defaults)
- `GHL_REENGAGEMENT_THRESHOLD_DAYS` (default 180)
- `GHL_REENGAGEMENT_BATCH_LIMIT` (default 100)
- `GHL_REENGAGEMENT_FROM_NUMBER` (override do número GHL — sem isso, usa o número default da sub-account)

### Out of Scope (do NOT build in v1.9)
- Dashboard UI para configurar automação — pertence à futura "Automations Platform"
- Multi-tenant rules / múltiplas sub-accounts — Skleanings-only
- Email / WhatsApp channels — GHL SMS apenas
- Retry com backoff — one-shot per cron tick; falhas visíveis em `action_logs`
- Real-time / event-driven triggers — cron-only
- Template substitution avançada (custom fields, conditional) — apenas `{{first_name}}`
- STOP / opt-out handling em produto — manual cleanup em v1.9
- Tabela `automations` genérica
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REENG-01 | Add `listOpportunities(locationId, { status, updatedBefore, limit })` to `src/lib/ghl/` using cursor pagination | See "GHL Opportunities Search API" + reuse `ghlFetchJson` from `src/lib/ghl/client.ts:45` |
| REENG-02 | List method accepts `location_id` and uses decrypted credentials from `integrations.encrypted_api_key` | Existing `GhlCredentials` shape (`src/lib/ghl/client.ts:8-11`) + decrypt pattern (`src/lib/crypto.ts:48`) |
| REENG-03 | Returns only `status=Lost` opportunities older than threshold | GHL status values: `open\|won\|lost\|abandoned`; cutoff filter via `updatedAt`/`statusChangeDate` — exact field name flagged as OPEN QUESTION |
| REENG-04 | Each opportunity includes `contact.id`, `contact.firstName`, `contact.phone` | Behavior to verify in staging — see "Open Questions" #1 |
| REENG-05 | `POST /api/automations/ghl-reengagement/run` Node-runtime endpoint executes one pass | Pattern: `src/app/api/vapi/tools/route.ts:1-126`; runtime declaration line 17 |
| REENG-06 | Bearer auth via `GHL_REENGAGEMENT_TRIGGER_SECRET`; missing/incorrect → 401 | Use constant-time compare; no precedent in codebase but a 1-liner with `crypto.timingSafeEqual` |
| REENG-07 | Returns `{ processed, sent, skipped, failed, errors[] }` | Define result shape inline in the endpoint |
| REENG-08 | `{{first_name}}` substitution with "amigo(a)" fallback | Write inline 5-line helper; no existing template engine in codebase |
| REENG-09 | New migration creates `ghl_reengagement_sent` (org-scoped + RLS) | Pattern: `manychat_rules` migration `027` + `action_logs` policies in `002_action_engine.sql:162-175` |
| REENG-10 | Skip contacts already in `ghl_reengagement_sent` | Pre-dispatch SELECT or in-memory set after one bulk query |
| REENG-11 | After success, INSERT into `ghl_reengagement_sent` | Standard `.insert()` call; service-role bypasses RLS |
| REENG-12 | Log every dispatch (success or fail) to `action_logs` with `tool_name='ghl_reengagement_sms'` | `tool_name` is a free-text column (`002_action_engine.sql:102`); reuse `logAction()` from `src/lib/action-engine/log-action.ts:23` |
| REENG-13 | Pulse cron `*/15 * * * *` workflow POSTs runner endpoint with secret; runner reads `automation_schedules.next_run_at` to decide whether to actually dispatch | Pattern: `.github/workflows/supabase-keepalive.yml:1-23` + new schedule check pattern |
| REENG-14 | Workflow also supports `workflow_dispatch` (manual run bypasses the schedule check via `?force=1` query param) | Same file pattern — combine `schedule:` + `workflow_dispatch:` triggers |
| REENG-18 | New migration `033_automation_schedules.sql` — single-row schedule registry; seed `ghl_reengagement_sms` daily | Pattern 5 (migration shape) + new pattern 9 (DB-backed schedule check) |
| REENG-15 | Required env vars; missing → HTTP 500 with clear message | Validation block at top of POST handler |
| REENG-16 | Optional env vars with defaults | Same env-read block |
| REENG-17 | `docs/automations/ghl-reengagement.md` with setup + cron + manual trigger | New docs/ folder (does not exist yet) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

| Constraint | Implication for Phase 32 |
|------------|--------------------------|
| `npm run build` after changes | Type errors in the new endpoint, lib method, and migration types must pass before commit |
| TypeScript 5 **strict** | New `listOpportunities` and runner code must be fully typed; no `any` |
| Multi-tenancy: every table has RLS | `ghl_reengagement_sent` MUST enable RLS with org-scoped policy |
| **Never** call `supabase.auth.getUser()` directly | Use `createClient` / `getUser` from `@/lib/supabase/server` — BUT runner endpoint has no user session → use service-role client (precedent: `/api/vapi/tools/route.ts:50-54`) |
| Webhooks return HTTP 200 | The runner is NOT a webhook — it's a protected internal endpoint, so it CAN return non-200 (401, 500, etc.) per REENG-06/REENG-15 |
| `export const runtime = 'nodejs'` for webhook receivers | Apply to the new runner — needs `crypto.timingSafeEqual` (Node-only) for bearer compare |
| Sensitive paths: never edit old migrations | Create NEW migration `032_ghl_reengagement_sent.sql` |
| Sensitive paths: `src/lib/crypto.ts` — do not change encryption format | Only consume `decrypt()` — never modify |
| Production origin `https://operator.skale.club` | Use this as `OPERATOR_BASE_URL` documentation default |

## Standard Stack

### Core (already in `package.json` — `[VERIFIED: package.json]`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | ^16.2.2 | Route handler runtime | Project framework |
| `@supabase/supabase-js` | ^2.101.1 | Service-role client for runner endpoint | Project standard for non-session DB access |
| `zod` | ^3.25.76 | Body / env var validation | Project standard for input validation |
| `vitest` | (devDep) | Unit testing | Project standard — `npm test` runs `vitest run` |

### Supporting (already wired, no install needed)
| Library | Purpose | Reuse Point |
|---------|---------|-------------|
| Native `fetch` | GHL HTTP | `src/lib/ghl/client.ts:29` |
| `sendSmsViaGhl` | SMS dispatch via GHL Conversations API | `src/lib/ghl/send-sms.ts` (já existe; aceita `contactId` direto → 1 chamada GHL por dispatch) |
| Web Crypto (`crypto.subtle`) | AES-GCM decrypt of stored API key | `src/lib/crypto.ts:48` |
| Node `crypto` | `timingSafeEqual` for bearer secret compare | Node-runtime only — fine because runner is `runtime = 'nodejs'` |

### Alternatives Considered (and rejected)
| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| GitHub Actions | Vercel Cron | Locked decision in STATE.md — keepalive pattern already proven and free |
| Anti-loop in GHL tag | Tag the GHL contact | Locked decision — GHL tag is mutable from any team member, DB is our source of truth |
| Service-role Supabase client in runner | Authenticated user client (`createClient` from server.ts) | No user session in cron context; service-role is the existing pattern (`/api/vapi/tools/route.ts:50`) |
| Custom small templating lib (Handlebars, Mustache) | Inline `replace` | One placeholder only; no dep cost worth it |

**Installation:** none — all libraries already in `package.json`.

**Version verification:** Library versions read from existing `package.json`; no new dependencies introduced by this phase.

## Architecture Patterns

### Recommended File Layout
```
src/
├── lib/
│   └── ghl/
│       ├── client.ts                       # ← already exists, reuse ghlFetchJson
│       └── list-opportunities.ts           # ← NEW (REENG-01..04)
│   └── automations/                        # ← NEW folder
│       └── ghl-reengagement/
│           ├── runner.ts                   # ← NEW — pure orchestration logic
│           └── render-template.ts          # ← NEW — {{first_name}} substitution
├── app/
│   └── api/
│       └── automations/
│           └── ghl-reengagement/
│               └── run/
│                   └── route.ts            # ← NEW Node route handler
supabase/
└── migrations/
    └── 032_ghl_reengagement_sent.sql       # ← NEW
.github/
└── workflows/
    └── ghl-reengagement.yml                # ← NEW
docs/
└── automations/
    └── ghl-reengagement.md                 # ← NEW (docs/ folder does not exist yet)
tests/
└── ghl-reengagement-runner.test.ts         # ← NEW (Vitest)
```

**Rationale:** colocate orchestration logic under `src/lib/automations/ghl-reengagement/` so the route handler stays a thin wrapper (just env var parsing, auth, calling the runner). This mirrors the executor/dispatcher pattern in `src/lib/action-engine/` and makes the runner unit-testable without spinning up a Next route.

### Pattern 1: Reuse `ghlFetchJson` for opportunities list
**What:** Add a new file `src/lib/ghl/list-opportunities.ts` that thinly wraps `ghlFetchJson<T>('/opportunities/search', 'GET', null, credentials, queryParams)`.
**When to use:** Always for new GHL endpoints — keeps the timeout, headers, and error shape uniform.
**Caveat:** `ghlFetch` has a 400ms `TIMEOUT_MS` hard limit (`src/lib/ghl/client.ts:6`) designed for Vapi hot path. For a background cron with potentially large result sets, this is too aggressive. **Action:** add an optional `timeoutMs` parameter to `ghlFetch` (backwards-compatible) OR perform the cron call with a direct `fetch()` that uses the same headers. The first option is preferred (DRY).

```typescript
// src/lib/ghl/client.ts — proposed addition (NOT a breaking change)
// Source: existing code at src/lib/ghl/client.ts:6,13-43
const DEFAULT_TIMEOUT_MS = 400  // existing — keeps Vapi hot path within 500ms budget

export async function ghlFetch(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body: unknown | null,
  credentials: GhlCredentials,
  queryParams?: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,   // ← NEW optional arg
): Promise<Response> {
  // …rest unchanged
}
```

### Pattern 2: Cursor pagination loop
**What:** GHL v2 uses cursor pagination: response includes `meta.startAfter` + `meta.startAfterId` that you feed back into the next request as query params. `[VERIFIED: medium.com/@tuguidragos]`
**When to use:** Any list endpoint on `services.leadconnectorhq.com`.

```typescript
// src/lib/ghl/list-opportunities.ts — pagination skeleton
// Source pattern: medium.com/@tuguidragos (cursor scheme), src/lib/ghl/client.ts:13 (fetch wrapper)

interface PaginationMeta {
  startAfter?: number
  startAfterId?: string
  nextPageUrl?: string | null
  total?: number
  currentPage?: number
}

interface OpportunitiesSearchResponse {
  opportunities: GhlOpportunity[]
  meta: PaginationMeta
}

export async function listOpportunities(
  credentials: GhlCredentials,
  opts: { status?: 'open'|'won'|'lost'|'abandoned'; updatedBefore?: Date; limit?: number; maxPages?: number }
): Promise<GhlOpportunity[]> {
  const out: GhlOpportunity[] = []
  const limit = String(opts.limit ?? 100)
  let startAfter: string | undefined
  let startAfterId: string | undefined
  const maxPages = opts.maxPages ?? 50   // hard cap on pages — defensive

  for (let page = 0; page < maxPages; page++) {
    const qp: Record<string, string> = {
      location_id: credentials.locationId,
      limit,
    }
    if (opts.status) qp.status = opts.status
    // OPEN QUESTION: exact param name — probe in staging first.
    // Candidates seen in GHL docs: 'date', 'endDate', 'lastStatusChangeStartDate'
    if (opts.updatedBefore) qp.date = opts.updatedBefore.toISOString()   // TENTATIVE
    if (startAfter) qp.startAfter = startAfter
    if (startAfterId) qp.startAfterId = startAfterId

    const data = await ghlFetchJson<OpportunitiesSearchResponse>(
      '/opportunities/search', 'GET', null, credentials, qp,
      /* timeoutMs */ 10_000,
    )
    out.push(...data.opportunities)

    if (!data.meta.startAfterId || !data.meta.startAfter) break
    startAfter = String(data.meta.startAfter)
    startAfterId = data.meta.startAfterId
  }

  return out
}
```

### Pattern 3: Service-role client in non-session context
**Source:** `src/app/api/vapi/tools/route.ts:50-54` `[VERIFIED: codebase]`

```typescript
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)
```

The runner has no user session (GitHub Action POSTs without auth cookies), so it MUST use the service-role client. There is also a helper `createServiceRoleClient()` at `src/lib/supabase/admin.ts:7` that returns exactly this — **use the helper, don't re-instantiate inline**.

### Pattern 4: `action_logs` insert via `logAction()`
**Source:** `src/lib/action-engine/log-action.ts:23` `[VERIFIED: codebase]`

The existing helper never throws (catches its own errors and returns `null`), so it's safe to fire-and-forget per dispatch. Fields:

| Column | For ghl_reengagement_sms |
|--------|--------------------------|
| `organization_id` | Resolved from `integrations` row in step 1 |
| `tool_config_id` | `null` — this dispatch is not tied to a `tool_configs` row |
| `vapi_call_id` | `'cron:ghl-reengagement:<run_started_at_iso>'` — synthetic ID grouping per run; column is TEXT NOT NULL (`002_action_engine.sql:101`) |
| `tool_name` | `'ghl_reengagement_sms'` — TEXT column, free-text (`002_action_engine.sql:102`) |
| `status` | `'success'` \| `'error'` (CHECK on these values per `002_action_engine.sql:103`; `'timeout'` also valid) |
| `execution_ms` | Per-contact elapsed ms |
| `request_payload` | `{ ghl_contact_id, phone_masked, message_rendered_first40 }` — DO NOT log full phone or full body |
| `response_payload` | `{ result: 'SMS sent. SID: …' }` or `{}` on error |
| `error_detail` | Twilio error string or null |

### Pattern 5: Migration shape for `ghl_reengagement_sent`
**Source pattern:** `027_manychat_rules.sql:13-32` (table + RLS) and `002_action_engine.sql:113-115` (indexes).

```sql
-- supabase/migrations/032_ghl_reengagement_sent.sql
-- Phase 32: v1.9 anti-loop tracking — one row per (org, ghl_contact_id) ever messaged.

CREATE TABLE IF NOT EXISTS public.ghl_reengagement_sent (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id      TEXT         NOT NULL,
  ghl_contact_id   TEXT         NOT NULL,
  sent_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uniq_reeng_org_contact UNIQUE (org_id, ghl_contact_id)
);

ALTER TABLE public.ghl_reengagement_sent ENABLE ROW LEVEL SECURITY;

-- Org-scoped policy (matches manychat_rules:28-32 pattern)
CREATE POLICY "org_isolation" ON public.ghl_reengagement_sent
  FOR ALL
  TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- Defensive index for the skip query (the UNIQUE already provides a backing index for the same shape,
-- so this is technically redundant — kept commented out unless a different access pattern emerges).
-- CREATE INDEX idx_reeng_org_contact ON public.ghl_reengagement_sent (org_id, ghl_contact_id);
```

**Note on FK column naming:** The codebase has two conventions side by side — `organization_id` (e.g., `action_logs`, `integrations`, `tool_configs`) and `org_id` (e.g., `manychat_rules`, `manychat_channels`, `manychat_events`). Both are valid. The Phase 32 table is new and standalone; **use `org_id`** to match the more recent `manychat_*` migrations.

### Pattern 6: GitHub Actions workflow (pulse cron + workflow_dispatch)
**Source:** `.github/workflows/supabase-keepalive.yml:1-23` `[VERIFIED: codebase]`

**REVISED 2026-05-15:** YAML cron is just a 15-minute pulse. Operator decides actual schedule via the DB-backed `automation_schedules` table (Pattern 9). This lets the schedule change at runtime without YAML edits / redeploys.

```yaml
# .github/workflows/ghl-reengagement.yml
name: GHL Lost-Lead Reengagement (SMS)

on:
  schedule:
    - cron: '*/15 * * * *'   # pulse every 15 minutes; runner reads automation_schedules to decide if it's actually due
  workflow_dispatch:         # manual trigger from GitHub UI — runner accepts ?force=1 to bypass schedule check

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: POST runner endpoint
        run: |
          RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
            "${{ secrets.OPERATOR_BASE_URL }}/api/automations/ghl-reengagement/run" \
            -H "Authorization: Bearer ${{ secrets.GHL_REENGAGEMENT_TRIGGER_SECRET }}" \
            -H "Content-Type: application/json")
          BODY=$(echo "$RESPONSE" | head -n -1)
          STATUS=$(echo "$RESPONSE" | tail -n 1)
          echo "Status: $STATUS"
          echo "Body: $BODY"
          if [ "$STATUS" != "200" ]; then
            echo "Runner failed" && exit 1
          fi
```

GitHub Actions secrets required: `OPERATOR_BASE_URL` (e.g., `https://operator.skale.club`) and `GHL_REENGAGEMENT_TRIGGER_SECRET`.

### Pattern 9: DB-backed schedule check (added 2026-05-15)
**What:** New table `automation_schedules` holds the actual when-to-run for each automation. GH Actions is just a 15-minute pulse; the runner consults the DB to decide if it's due.

**Migration sketch** (`supabase/migrations/033_automation_schedules.sql`):

```sql
CREATE TABLE IF NOT EXISTS public.automation_schedules (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_key     TEXT         NOT NULL UNIQUE,        -- 'ghl_reengagement_sms'
  is_active          BOOLEAN      NOT NULL DEFAULT true,
  next_run_at        TIMESTAMPTZ  NOT NULL,
  interval_minutes   INTEGER      NOT NULL CHECK (interval_minutes > 0),
  last_run_at        TIMESTAMPTZ,
  last_run_status    TEXT         CHECK (last_run_status IN ('success','error','skipped')),
  last_run_result    JSONB,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Single-tenant for v1.9: no org_id, no user-facing RLS.
-- Service-role bypasses RLS, so enabling RLS without a policy effectively locks the table to server code only.
ALTER TABLE public.automation_schedules ENABLE ROW LEVEL SECURITY;

-- Seed: daily at 14:00 UTC = 11h BRT, starting tomorrow.
INSERT INTO public.automation_schedules (automation_key, next_run_at, interval_minutes)
VALUES ('ghl_reengagement_sms', (date_trunc('day', now()) + interval '1 day 14 hours'), 1440)
ON CONFLICT (automation_key) DO NOTHING;
```

**Runner check** (snippet, lives at the top of the runner — before listing opportunities):

```typescript
const force = new URL(request.url).searchParams.get('force') === '1'

const { data: sched } = await supabase
  .from('automation_schedules')
  .select('id, next_run_at, interval_minutes, is_active')
  .eq('automation_key', 'ghl_reengagement_sms')
  .single()

if (!sched) {
  return Response.json({ error: 'automation_schedules row missing' }, { status: 500 })
}
if (!sched.is_active) {
  return Response.json({ skipped: 'inactive' })
}
if (!force && new Date(sched.next_run_at) > new Date()) {
  return Response.json({ skipped: 'not_due_yet', next_run_at: sched.next_run_at })
}

// ... run the work ...

const nextRun = new Date(Date.now() + sched.interval_minutes * 60_000).toISOString()
await supabase.from('automation_schedules').update({
  last_run_at: new Date().toISOString(),
  next_run_at: nextRun,
  last_run_status: result.failed > 0 ? 'error' : 'success',
  last_run_result: result,
  updated_at: new Date().toISOString(),
}).eq('id', sched.id)
```

**Why this design:**
- Single source of truth for when-to-run lives in DB → operator can change via SQL (or future UI) without redeploy.
- GH Actions stays as a "tick" — same `secrets.OPERATOR_BASE_URL` + bearer pattern.
- `?force=1` lets manual `workflow_dispatch` bypass the schedule check for testing / ad-hoc runs.
- `interval_minutes` is simpler than cron parsing (no new dependency). To "run daily at 11h BRT", set `next_run_at` to next 11h BRT and `interval_minutes=1440`.

### Pattern 7: Bearer auth with constant-time compare
**No existing precedent in codebase.** Implement directly:

```typescript
import { timingSafeEqual } from 'node:crypto'

function isAuthorized(req: Request): boolean {
  const header = req.headers.get('authorization') ?? ''
  const m = header.match(/^Bearer\s+(.+)$/)
  if (!m) return false
  const expected = process.env.GHL_REENGAGEMENT_TRIGGER_SECRET ?? ''
  if (!expected) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

### Anti-Patterns to Avoid
- **Anti-pattern: 400ms timeout on GHL list call.** The hot-path budget in `client.ts:6` is for Vapi tool calls. A cron job with potentially hundreds of opportunities needs ~10s. **Solution:** make `ghlFetch` accept a `timeoutMs` param.
- **Anti-pattern: Loading the entire opportunities response into memory then filtering by date in JS.** Use the GHL date filter param so we don't paginate through years of data. The exact param name is the OPEN QUESTION — even if we initially over-fetch, gate the SMS dispatch on a JS-side date check (defense in depth).
- **Anti-pattern: Using `getUser()` / cookie-based supabase in the runner.** No user session exists in cron context. Use `createServiceRoleClient()`.
- **Anti-pattern: Returning 200 on auth failure** (the webhook convention). The runner is internal; failure should be visible to the GitHub Action and surface as a failed workflow run.
- **Anti-pattern: Inserting into `ghl_reengagement_sent` BEFORE the Twilio response.** Insert ONLY after Twilio returns 2xx — otherwise a Twilio outage permanently blocks the contact.
- **Anti-pattern: Logging full phone number / message body in `action_logs.request_payload`.** Mask the phone (`***last4`) and truncate the body. The phone is PII; the body in plaintext bloats the JSONB.
- **Anti-pattern: Reading `process.env.GHL_REENGAGEMENT_*` inside the lib code.** Lib code stays env-agnostic; the route handler reads env, the lib accepts arguments.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP wrapper with auth headers + JSON parsing for GHL | A new fetch wrapper | `ghlFetchJson` from `src/lib/ghl/client.ts:45` | Já trata Bearer + Version header + error shape; agora aceita `timeoutMs` opcional |
| GHL SMS dispatch | Um chamador custom da Conversations API | `sendSmsViaGhl()` from `src/lib/ghl/send-sms.ts` | Já existe; aceita `contactId` (preferido) ou phone (find-or-create). Para o cron runner SEMPRE passar `contactId` da `/opportunities/search` — pula find-or-create |
| Supabase service-role client | Inline `createClient` call | `createServiceRoleClient()` from `src/lib/supabase/admin.ts:7` | Single source of truth; respects `auth.persistSession: false` |
| `action_logs` insert | Inline `.from('action_logs').insert(…)` | `logAction()` from `src/lib/action-engine/log-action.ts:23` | Wraps in try/catch (never throws); returns log id for chaining |
| API key decryption | Reimplementing AES-GCM | `decrypt()` from `src/lib/crypto.ts:48` | Edge/Node compatible; do not touch encryption format (CLAUDE.md sensitive path) |
| Constant-time string compare | `a === b` | `crypto.timingSafeEqual` (Node-only) | Prevents timing side-channel on secret comparison |

**Key insight:** Almost no new platform code is required — Phase 32 is *integration*, not *infrastructure*. If a task in the plan adds a new abstraction layer, that is likely scope creep.

## Runtime State Inventory

> Phase 32 is a **greenfield** addition (new endpoint, new table, new workflow file, new lib method). No renames or refactors. **Section intentionally minimal.**

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `ghl_reengagement_sent` is a new empty table | None on first deploy |
| Live service config | A new GitHub Actions secret `GHL_REENGAGEMENT_TRIGGER_SECRET` + `OPERATOR_BASE_URL` must be set in **GitHub repo settings**, not in git | Manual setup step documented in `docs/automations/ghl-reengagement.md` |
| OS-registered state | None | None |
| Secrets / env vars | NEW: `GHL_REENGAGEMENT_LOCATION_ID`, `GHL_REENGAGEMENT_INTEGRATION_ID`, `GHL_REENGAGEMENT_TWILIO_INTEGRATION_ID`, `GHL_REENGAGEMENT_MESSAGE`, `GHL_REENGAGEMENT_TRIGGER_SECRET`, `GHL_REENGAGEMENT_THRESHOLD_DAYS` (opt), `GHL_REENGAGEMENT_BATCH_LIMIT` (opt) — set in **Vercel env vars** for the production scope | Operator must add these to Vercel before first run |
| Build artifacts | None | None |

**Nothing else found:** This is a clean additive phase. Verified by `git status` showing no rename/refactor in scope.

## Common Pitfalls

### Pitfall 1: GHL date filter param name mismatch
**What goes wrong:** Code uses `updatedAt`, but the GHL API expects `date` / `endDate` / `lastStatusChangeStartDate`. Result: filter is silently ignored and the runner messages contacts touched *today* if they happen to be Lost.
**Why it happens:** The marketplace docs page is JS-rendered and not scrapable; the OpenAPI yaml in the GitHub mirror is not at a stable public URL. Different GHL endpoints use different date-filter spellings.
**How to avoid:** First-run probing — log the full GHL response JSON keys once in staging (use the GHL_REENGAGEMENT_BATCH_LIMIT=1 + tail logs). Then commit the correct param name as a constant.
**Warning signs:** Runner sends to contacts whose `updatedAt` < threshold; first deploy must include a JS-side date guard as defense in depth.

### Pitfall 2: GHL contact phone formatting (mitigado pelo dispatch GHL-nativo)
**What goes wrong:** Com o executor Twilio, o runner precisava rejeitar contatos sem E.164. Com `sendSmsViaGhl`, a Conversations API usa o phone que o GHL já tem armazenado naquele `contactId` — a gente nunca passa um phone raw.
**Por que ainda importa:** Um contato GHL sem phone ou sem permissão de mensageria fará a Conversations API retornar erro tipo "contact has no phone number" ou "messaging not enabled". Trate como `failed` (não `skipped`) — não dá pra saber sem ler o contato antes, que custa uma chamada extra.
**How to avoid:** Confie nos dados do GHL. Surface erros da API em `action_logs.error_detail` para o operador corrigir no CRM.
**Warning signs:** GHL responde `400` / `422` com mensagem sobre missing phone ou messaging permissions.

### Pitfall 3: Pagination loop without a hard page cap
**What goes wrong:** A bug in GHL pagination metadata (or a misread of the response shape) causes infinite loop until function timeout.
**How to avoid:** Hard cap (`maxPages = 50` in the pattern above) — with `limit=100`, this caps at 5,000 opportunities per run, which is far above Skleanings' actual volume.

### Pitfall 4: Vercel route handler timeout
**What goes wrong:** Vercel Hobby plan caps function execution at 10s (per `vercel.json` defaults). If 100 contacts × ~400ms GHL call = 40s serial, the runner gets killed mid-loop.
**Why it happens:** Hobby plan free-tier limit (CLAUDE.md confirms Vercel Hobby host).
**How to avoid:**
  1. Process serially in small batches that fit the budget — `GHL_REENGAGEMENT_BATCH_LIMIT=20` default would be safer than 100 for Hobby. **However the locked decision says default = 100** — flag this for the planner.
  2. Use `Promise.allSettled` to parallelize GHL Conversations calls (each takes ~300-500ms; 20 in parallel takes ~700ms total).
  3. Document the limit and set the batch default conservatively.
**Warning signs:** Vercel function logs show `Task timed out after 10.00 seconds`; some contacts in `action_logs` but no `ghl_reengagement_sent` row.
**Validation needed:** Confirm current Vercel plan timeout (Hobby = 10s; Pro = 60s for default, 300s for Edge). If on Pro, batch=100 is fine.

### Pitfall 5: Concurrent runs racing the anti-loop write
**What goes wrong:** `workflow_dispatch` fires while the scheduled cron is still running → both runners SELECT the same Lost contact (no anti-loop row yet), both dispatch SMS.
**How to avoid:** The `UNIQUE (org_id, ghl_contact_id)` constraint prevents the second insert from succeeding — but the SMS already went out. **Mitigation:** insert the anti-loop row with `ON CONFLICT DO NOTHING` and check the affected-rows count *before* sending. Or: only worry about it if the operator triggers manually during the daily window. The v1.9 scope is one-shot anyway.

### Pitfall 6: Missing `first_name` field defaults to literal string
**What goes wrong:** GHL response uses `firstName` (camelCase), template uses `{{first_name}}`. If you naively `.replace('{{first_name}}', contact.first_name)`, you get `undefined` substituted into the SMS.
**How to avoid:** Explicit fallback chain: `contact.firstName ?? contact.first_name ?? 'amigo(a)'`. Strict-null check.

### Pitfall 7: Service-role client + RLS confusion
**What goes wrong:** Developer tests the runner locally with the anon key, gets RLS-blocked when inserting into `integrations` or `ghl_reengagement_sent`, thinks the migration is broken.
**How to avoid:** Document explicitly that the runner requires `SUPABASE_SERVICE_ROLE_KEY` set locally. The service-role client bypasses RLS by design — this is why `org_id` MUST be set explicitly on every insert (no `get_current_org_id()` fallback in this context).

## Code Examples

### Loading the GHL integration row + decrypted credentials
```typescript
// src/app/api/automations/ghl-reengagement/run/route.ts (excerpt)
// Pattern source: src/lib/twilio/send-sms.ts:22-49 (integrations row + decrypt)
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

const supabase = createServiceRoleClient()
const { data: row, error } = await supabase
  .from('integrations')
  .select('id, organization_id, encrypted_api_key, location_id, is_active')
  .eq('id', process.env.GHL_REENGAGEMENT_INTEGRATION_ID!)
  .eq('provider', 'gohighlevel')
  .eq('is_active', true)
  .single()

if (error || !row) {
  return Response.json({ error: 'GHL integration not found or inactive' }, { status: 500 })
}

const apiKey = await decrypt(row.encrypted_api_key)
const credentials: GhlCredentials = {
  apiKey,
  locationId: process.env.GHL_REENGAGEMENT_LOCATION_ID!,
}
const orgId = row.organization_id   // CRITICAL: used for log + anti-loop inserts
```

### GHL SMS reuse pattern — call sendSmsViaGhl with contactId direct
```typescript
// GHL SMS executor é uma função simples — não precisa de ActionContext porque
// as creds são passadas explicitamente. Ver src/lib/ghl/send-sms.ts:42-99.

import { sendSmsViaGhl } from '@/lib/ghl/send-sms'
import type { GhlCredentials } from '@/lib/ghl/client'

// IMPORTANTE: SEMPRE passar contactId direto da /opportunities/search.
// Isso bypassa o branch find-or-create do sendSmsViaGhl → 1 chamada GHL por
// dispatch ao invés de 2-3. O loop de pagination já tem opp.contact.id.

const result = await sendSmsViaGhl(
  {
    contactId: opp.contact.id,
    body: rendered,
    ...(fromNumberOverride ? { fromNumber: fromNumberOverride } : {}),
  },
  ghlCredentials,
)
// Retorna: "SMS sent via GHL. ID: <messageId|conversationId>"
// Lança em GHL API error (non-2xx) — runner captura e marca como failed.
```

**Pre-flight check:** Antes do loop de dispatch, asserir que a integration row resolvida por `GHL_REENGAGEMENT_INTEGRATION_ID` tem `provider='gohighlevel'` E `is_active=true`. Senão, retornar HTTP 500 do route handler com erro actionable (REENG-15).

### Anti-loop check (in-memory bulk skip)
```typescript
// One bulk SELECT instead of N queries — important for the 10s Hobby budget.
const ghlContactIds = opportunities.map(o => o.contact.id)
const { data: already } = await supabase
  .from('ghl_reengagement_sent')
  .select('ghl_contact_id')
  .eq('org_id', orgId)
  .in('ghl_contact_id', ghlContactIds)

const alreadySet = new Set((already ?? []).map(r => r.ghl_contact_id))
const toSend = opportunities.filter(o => !alreadySet.has(o.contact.id))
```

### Template substitution helper
```typescript
// src/lib/automations/ghl-reengagement/render-template.ts
export function renderMessage(template: string, firstName: string | null | undefined): string {
  const name = (firstName?.trim() || 'amigo(a)')
  return template.replace(/\{\{\s*first_name\s*\}\}/g, name)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GHL API v1 (`rest.gohighlevel.com/v1/…`) | GHL API v2 (`services.leadconnectorhq.com/…` + `Version: 2021-07-28` header) | v1 deprecated; v2 standard since 2021 | Phase 32 uses v2 — already the codebase convention (`client.ts:4-5`) |
| Direct DB insert into `action_logs` from every callsite | Centralized `logAction()` helper that never throws | Phase 4 / v1.0 era | Phase 32 must use the helper — see `Don't Hand-Roll` table |
| Custom Supabase clients per route | Centralized `createServiceRoleClient()` helper | v1.7 / v1.8 era | Phase 32 must use the helper |

**Deprecated/outdated:**
- GHL v1 API endpoints — never use.
- Direct `process.env.SUPABASE_SERVICE_ROLE_KEY` inline in routes — use the helper.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GHL opportunities response embeds `contact.id`, `contact.firstName`, `contact.phone` directly (not as a separate fetch) | Phase requirements REENG-04 | If wrong, we need an extra N+1 fetch per opportunity — DOUBLES the runtime cost and may exceed Vercel timeout. **Mitigation: probe with one real call in staging before committing the loop shape.** |
| A2 | GHL date-filter parameter for "older than N days" is `date` (taking an ISO string upper bound) | Pattern 2 / Code example | If wrong, all Lost opportunities returned and threshold is enforced only in JS — works but pages more. **Mitigation: JS-side date guard as defense.** |
| A3 | GHL status filter value is lowercase `lost` | Pattern 2 | If GHL expects `Lost` (capitalized) the filter returns empty. **Mitigation: probe + assert non-empty response in staging.** |
| A4 | A sub-account GHL identificada por `GHL_REENGAGEMENT_LOCATION_ID` está messaging-enabled (tem número SMS configurado) | Code Examples — GHL SMS reuse | Se GHL retornar "no SMS-enabled number" todo o dispatch falha. **Mitigation: deixar o primeiro erro aparecer em `action_logs` — operador corrige no GHL Dashboard.** |
| A5 | Vercel plan timeout is enough for `batch=100` parallel dispatch | Pitfall 4 | If on Hobby (10s cap), `batch=100` will time out. **Mitigation: parallelize with `Promise.allSettled` and/or batch default 20.** Recommend planner make `BATCH_LIMIT` default conservative. |
| A6 | `tool_name='ghl_reengagement_sms'` is acceptable as free-text in `action_logs.tool_name` | REENG-12 | **[VERIFIED: `002_action_engine.sql:102`]** Column is `TEXT NOT NULL` with no CHECK — confirmed not assumed. |
| A7 | GHL pagination response includes `meta.startAfter` + `meta.startAfterId` and we can detect end-of-pages by their absence | Pattern 2 | If GHL returns null vs missing differently, loop termination may be off-by-one. **Mitigation: check both `!startAfter && !startAfterId` AND `opportunities.length === 0`.** |
| A8 | The `docs/` folder is acceptable as a new top-level directory | REENG-17 | None — documentation is non-load-bearing for production. |

## Open Questions (RESOLVED)

1. **What is the exact GHL date-filter parameter for "updatedAt before X"?**

   **RESOLVED (32-02-PLAN.md):** Param locked to `'date'` via exported constant `GHL_DATE_FILTER_PARAM` in `src/lib/ghl/list-opportunities.ts`. Defense-in-depth: 32-03-PLAN.md runner applies a JS-side date guard (`opportunity.updatedAt < cutoffIso`) so over-fetched items are filtered before dispatch. Re-evaluate constant after first staging run; if response shape demands a different param, update only `GHL_DATE_FILTER_PARAM`.

   - What we know: Cursor pagination is `startAfter`/`startAfterId`; date filter likely exists but spelling varies across endpoints.
   - What's unclear: `date`, `endDate`, `updatedBefore`, `lastStatusChangeStartDate` — multiple candidates seen in different GHL docs pages.
   - Recommendation: Plan one task as "Probe GHL response shape in staging" — call `/opportunities/search` once with `status=lost&limit=2`, log the response keys, then lock the param name. This task must run BEFORE the loop is wired in.

2. **Does the opportunity item embed contact fields, or is a per-opportunity contact fetch needed?**

   **RESOLVED (32-02-PLAN.md / 32-03-PLAN.md):** Assumed embedded — `listOpportunities` returns `GhlOpportunity` with nested `contact: { id, firstName, phone }`. If staging probe shows contact is not embedded, only `list-opportunities.ts` and the test fixture need updating (no callsite changes in runner). N+1 fetch fallback NOT implemented in v1.9 — operator notifies if needed.

   - What we know: GHL contacts endpoint embeds basic fields; v1 had separate contact endpoint.
   - What's unclear: v2 opportunities/search response shape — could embed contact object, contact_id only, or include enough fields without phone.
   - Recommendation: Same staging probe task answers this. Cost if a separate fetch is needed: N+1 GHL calls per run. Plan for both shapes; the lib code can normalize.

3. **What is the production Vercel plan?**

   **RESOLVED (32-04-PLAN.md):** Treated as Hobby (10s). Mitigations: `DEFAULT_BATCH_LIMIT = 20` in route handler (override via env var if Pro plan is provisioned), `Promise.allSettled` parallelization in runner (32-03-PLAN.md). REQUIREMENTS.md REENG-16 updated to reflect new default.

   - What we know: CLAUDE.md says "Vercel Hobby". Hobby caps Node functions at 10s. The cron will process up to `BATCH_LIMIT` contacts per run.
   - What's unclear: Whether Skleanings' actual Lost-over-180-days volume + Twilio latency fits in 10s.
   - Recommendation: Use `Promise.allSettled` for parallel Twilio dispatch; document the timeout; consider Pro upgrade if `BATCH_LIMIT > 50` is needed regularly. **Set `GHL_REENGAGEMENT_BATCH_LIMIT` default to 20 in code even though STATE.md says 100** — flag for user confirmation; STATE.md's "100" is a ceiling, not a recommendation.

4. **Should the workflow_dispatch trigger accept inputs?**

   **RESOLVED (32-04-PLAN.md):** No. Workflow is parameterless — matches the locked decision "Hardcoded via env vars" (STATE.md). Future iteration can add `inputs:` for ad-hoc overrides.

   - What we know: `workflow_dispatch:` supports optional `inputs:` for ad-hoc parameter override.
   - What's unclear: Whether the operator wants to override `BATCH_LIMIT` or `THRESHOLD_DAYS` per-run.
   - Recommendation: v1.9 keeps it parameterless (env vars only — matches the locked decision "Hardcoded via env vars"). Future iteration can add inputs.

5. **Should the runner support a dry-run mode?**

   **RESOLVED (32-04-PLAN.md):** No in v1.9. Deferred to future iteration. Operator can set `BATCH_LIMIT=1` for staged rollout instead.

   - What we know: Easy to add as a `?dry=1` query param — skips Twilio call, just logs intended dispatches.
   - What's unclear: Whether operator wants this before going live.
   - Recommendation: Add it — costs ~10 lines, drastically reduces blast-radius risk on first production run.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js runtime | Route handler | ✓ | ^20 (per `@types/node`) | — |
| Next.js 16 | Route handler | ✓ | ^16.2.2 | — |
| Supabase (postgres) | New migration + queries | ✓ | hosted | — |
| `SUPABASE_SERVICE_ROLE_KEY` env var | Runner DB access | ✓ (existing, used by `/api/vapi/tools`) | — | — |
| `ENCRYPTION_SECRET` env var | `decrypt()` for GHL key | ✓ (existing) | 64-char hex | — |
| GitHub Actions | Scheduler | ✓ (already runs `supabase-keepalive`) | — | — |
| GHL Private Integration token for Skleanings | API access (list + SMS dispatch) | **?** | — | Must be encrypted + stored in `integrations` row (`provider='gohighlevel'`) before deploy. O mesmo row serve para `listOpportunities` E `sendSmsViaGhl`. |
| GHL sub-account SMS-enabled number | SMS dispatch | **?** | — | Configurar dentro do GHL sub-account; v1.9 não tem UI de verification — o primeiro dispatch falha loud se faltar |
| Vercel project + env vars set | Runner serves traffic | ✓ (existing prod) | — | — |
| Vitest | Unit tests | ✓ | (devDep) | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** The Skleanings-specific GHL + Twilio integrations are operator-side data prerequisites, not build-time dependencies. The phase ships even if the rows are absent — the runner will return a clean 500 with a "integration not found" error message (REENG-15), and the operator sets it up before flipping the GitHub Action on.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (already installed; project standard) `[VERIFIED: package.json]` |
| Config file | (vitest config inferred — no top-level `vitest.config.ts` visible; defaults via `vitest run`) |
| Quick run command | `npx vitest run tests/ghl-reengagement-runner.test.ts` |
| Full suite command | `npm test` (= `vitest run`) + `npm run build` (type-check) |
| Test directory pattern | `tests/*.test.ts` (flat) — see existing 50+ test files at `tests/` root |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REENG-01 | `listOpportunities()` calls GHL `/opportunities/search` with Bearer + Version + correct query params | unit | `npx vitest run tests/ghl-list-opportunities.test.ts` | ❌ Wave 0 |
| REENG-01 | Cursor pagination loops correctly, stops when `meta.startAfter` absent | unit | same file | ❌ Wave 0 |
| REENG-01 | Hard page cap is enforced | unit | same file | ❌ Wave 0 |
| REENG-02 | `location_id` passed; credentials decrypted from `integrations.encrypted_api_key` | integration | `npx vitest run tests/ghl-reengagement-runner.test.ts` (mock supabase + decrypt) | ❌ Wave 0 |
| REENG-03 | Status filter sends `status=lost`; date filter sends correct param | unit | tests/ghl-list-opportunities.test.ts | ❌ Wave 0 |
| REENG-03 | JS-side defense: opportunities younger than threshold are filtered out post-fetch | unit | tests/ghl-reengagement-runner.test.ts | ❌ Wave 0 |
| REENG-04 | Runner uses `contact.id`, `contact.firstName`, `contact.phone` from response | unit | tests/ghl-reengagement-runner.test.ts | ❌ Wave 0 |
| REENG-05 | POST `/api/automations/ghl-reengagement/run` executes full pass | integration | `npx vitest run tests/ghl-reengagement-route.test.ts` (mock fetch + supabase) | ❌ Wave 0 |
| REENG-06 | Missing `Authorization` header → 401 | unit | tests/ghl-reengagement-route.test.ts | ❌ Wave 0 |
| REENG-06 | Wrong secret → 401 (constant-time compare) | unit | same file | ❌ Wave 0 |
| REENG-06 | Correct secret → proceeds (not 401) | unit | same file | ❌ Wave 0 |
| REENG-07 | Response body matches `{ processed, sent, skipped, failed, errors[] }` shape | unit | tests/ghl-reengagement-route.test.ts | ❌ Wave 0 |
| REENG-08 | `{{first_name}}` replaced with `contact.firstName` | unit | `npx vitest run tests/ghl-render-template.test.ts` | ❌ Wave 0 |
| REENG-08 | Missing `firstName` → `amigo(a)` fallback | unit | same file | ❌ Wave 0 |
| REENG-08 | Empty / whitespace-only `firstName` → fallback | unit | same file | ❌ Wave 0 |
| REENG-09 | Migration creates table with PK, FK, UNIQUE, RLS — verified by inspecting the migration file | manual + lint | `cat supabase/migrations/032_*.sql` review checklist | ❌ Wave 0 |
| REENG-09 | RLS policy uses `(SELECT public.get_current_org_id())` subquery pattern | manual | same review | — |
| REENG-10 | Existing `(org_id, ghl_contact_id)` rows are skipped before dispatch | integration | tests/ghl-reengagement-runner.test.ts (seeded fake row) | ❌ Wave 0 |
| REENG-11 | Successful dispatch inserts a new `ghl_reengagement_sent` row | integration | same file (assert insert call with org_id + ghl_contact_id) | ❌ Wave 0 |
| REENG-11 | Failed dispatch does NOT insert (negative test) | integration | same file | ❌ Wave 0 |
| REENG-12 | `logAction` called once per dispatch attempt with `tool_name='ghl_reengagement_sms'` | unit | tests/ghl-reengagement-runner.test.ts (spy on logAction) | ❌ Wave 0 |
| REENG-12 | Error case: `status='error'` + `error_detail` populated | unit | same file | ❌ Wave 0 |
| REENG-13 | `.github/workflows/ghl-reengagement.yml` has cron `0 14 * * *` | manual | YAML inspection checklist | ❌ Wave 0 |
| REENG-14 | Same workflow file includes `workflow_dispatch:` trigger | manual | same | — |
| REENG-15 | Missing required env var → 500 with actionable error string | unit | tests/ghl-reengagement-route.test.ts | ❌ Wave 0 |
| REENG-16 | `THRESHOLD_DAYS` defaults to 180 when env absent | unit | same | — |
| REENG-16 | `BATCH_LIMIT` defaults to its safe value when env absent | unit | same | — |
| REENG-17 | `docs/automations/ghl-reengagement.md` exists and includes env var table + cron + manual trigger steps | manual | doc review checklist | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/ghl-*.test.ts` (touches only new tests, ~seconds)
- **Per wave merge:** `npm test` + `npm run build` (type check)
- **Phase gate:** Full suite green before `/gsd-verify-work`; manual checks on migration SQL + YAML + docs

### Edge Cases Requiring Explicit Coverage
- **Empty Lost list:** `processed=0, sent=0, skipped=0, failed=0, errors=[]` — return cleanly.
- **All in anti-loop:** `processed=N, sent=0, skipped=N`.
- **Mixed success/failure (GHL error on one of three):** `sent=2, failed=1, errors=[{ ghl_contact_id, error_message }]`.
- **Missing `firstName`:** SMS contains `amigo(a)`, dispatch succeeds.
- **GHL contact sem phone / sem permissão SMS:** counted as `failed` (GHL Conversations API retorna erro). Runner NÃO pré-valida phones — confia nos dados do CRM e surfaca falhas em `action_logs.error_detail`.
- **GHL 5xx durante dispatch:** counted as `failed`, error_detail logged, claim anti-loop rolled back (retried next day).
- **GHL 401 (auth error on first call):** entire run aborts with HTTP 500 + clear message.
- **Pagination — second page errors:** opportunities from page 1 still processed if page 2 throws (per `Promise.allSettled` style); error logged.

### Wave 0 Gaps
- [ ] `tests/ghl-list-opportunities.test.ts` — covers REENG-01, REENG-03 (request shape, pagination, page cap)
- [ ] `tests/ghl-render-template.test.ts` — covers REENG-08 (substitution + fallback)
- [ ] `tests/ghl-reengagement-runner.test.ts` — covers REENG-02, REENG-04, REENG-10, REENG-11, REENG-12 (orchestration with mocks)
- [ ] `tests/ghl-reengagement-route.test.ts` — covers REENG-05, REENG-06, REENG-07, REENG-15, REENG-16 (route handler shape + auth + env)
- [ ] Manual review checklists for migration SQL (REENG-09), workflow YAML (REENG-13, REENG-14), and docs file (REENG-17)
- [ ] No framework install needed — Vitest already in devDependencies (`[VERIFIED: package.json]`)

## Security Domain

`security_enforcement` is not explicitly set in `.planning/config.json` → treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes — runner endpoint | Bearer secret `GHL_REENGAGEMENT_TRIGGER_SECRET` via `Authorization: Bearer` header; constant-time compare with `crypto.timingSafeEqual` |
| V3 Session Management | no | N/A — no user session in cron context |
| V4 Access Control | yes — DB writes | RLS on `ghl_reengagement_sent` (org-scoped); service-role client used only inside the trusted server route handler (never imported in client code) — same pattern as `src/lib/supabase/admin.ts:1-3` |
| V5 Input Validation | yes — env vars + GHL/Twilio responses | Zod-validate or explicit null-checks on required env vars (REENG-15); guard against `firstName` injection into SMS (no template engine eval, only literal `.replace`) |
| V6 Cryptography | yes — GHL key decryption | Use existing `decrypt()` from `src/lib/crypto.ts:48` (AES-GCM, never modified — sensitive path per CLAUDE.md) |
| V7 Error Handling and Logging | yes — `action_logs` | Mask phone (`***last4`) in `request_payload`; truncate body to first 40 chars; never log raw API keys |
| V13 API and Web Service | yes | Endpoint is internal, not public — IP allow-listing optional (GitHub Actions IPs are dynamic; rely on bearer secret) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Bearer secret leaked via timing attack | Information disclosure | `crypto.timingSafeEqual` — see Pattern 7 |
| Bearer secret leaked via Vercel logs | Information disclosure | Never log the `Authorization` header value; redact in any debug print |
| GHL cred leakage via error message | Information disclosure | `ghlFetchJson` already throws sanitized errors (GHL status + text only — nunca echoa o Bearer) — `[VERIFIED: src/lib/ghl/client.ts:54-56]` |
| PII (phone + first name) logged in DB | Confidentiality | Mask phone to last 4 in `action_logs.request_payload`; do NOT log full body. Note: anti-loop table itself stores `ghl_contact_id` (not phone), which is fine. |
| SQL injection via env vars | Tampering | Supabase JS client is parameterized; service-role bypasses RLS but does NOT bypass parameterization. No raw SQL in this phase. |
| SMS template injection (user-controlled `firstName` containing weird chars) | Reputation / abuse | The template engine here is literal `String.replace` — no eval. Worst case: SMS body contains odd chars from a hostile contact name; not a vector for code execution. |
| Replay attack on runner endpoint | DoS / unintended dispatch | Bearer secret + UNIQUE anti-loop constraint = repeated POSTs are idempotent for already-contacted leads. Within the same run, two concurrent dispatches risk double-send (see Pitfall 5). Mitigation: use `INSERT … ON CONFLICT DO NOTHING RETURNING id` and only send if a row was actually inserted (claim-first pattern). |
| GitHub Actions secret exfiltration | Confidentiality | Secrets in `${{ secrets.X }}` are masked in logs by default; never echo them in run scripts. |

**Recommendation: claim-first anti-loop pattern.** Insert `ghl_reengagement_sent` row BEFORE chamando `sendSmsViaGhl` usando `ON CONFLICT DO NOTHING` e cláusula `RETURNING id`. Se `id` retornou → claimed → dispatch. Se conflito → outro run já claimou → skip. Em GHL API failure, DELETE o claim recém-inserido (pequeno rollback). Mais robusto que "send-then-record".

## Sources

### Primary (HIGH confidence)
- **Codebase** — direct file reads:
  - `src/lib/ghl/client.ts:1-60` (ghlFetch + headers + timeout — `timeoutMs` param já adicionado)
  - `src/lib/ghl/send-sms.ts:1-99` (GHL Conversations API executor — `sendSmsViaGhl`, find-or-create branch + 2500ms per-call timeout)
  - `src/lib/action-engine/execute-action.ts:1-108` (ActionContext shape + provider branch no send_sms)
  - `src/lib/action-engine/log-action.ts:1-43` (logAction never-throws helper)
  - `src/lib/crypto.ts:48-56` (decrypt)
  - `src/lib/supabase/admin.ts:7-13` (service-role helper)
  - `src/app/api/vapi/tools/route.ts:17-126` (route handler pattern + service-role + after())
  - `supabase/migrations/002_action_engine.sql:97-175` (action_logs schema + RLS policies)
  - `supabase/migrations/027_manychat_rules.sql:13-41` (org-scoped table + RLS policy pattern + index naming)
  - `.github/workflows/supabase-keepalive.yml:1-23` (cron + workflow_dispatch + curl pattern)
  - `src/types/database.ts:317-360` (action_logs typed Insert shape)
  - `package.json` (versions)

### Secondary (MEDIUM confidence — verified across multiple sources)
- [GHL Search Opportunity (POST + GET endpoint)](https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity) — endpoint path confirmed
- [GHL Search Opportunities Advanced (POST endpoint)](https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunities-advanced/index.html) — alternative endpoint
- [n8n / GHL contacts pagination Medium article](https://medium.com/@tuguidragos/fetch-all-gohighlevel-contacts-with-n8n-api-pagination-explained-25621d6e6976) — confirms `meta.startAfter` + `meta.startAfterId` cursor model
- [Mixed Analytics — Import GoHighLevel Data into Sheets](https://mixedanalytics.com/knowledge-base/import-gohighlevel-data-to-google-sheets/) — confirms v2 base URL + `Version: 2021-07-28` header
- [HighLevel filtering opportunities (UI doc)](https://help.gohighlevel.com/support/solutions/articles/155000001241-how-to-filter-opportunities) — confirms status values: Open / Won / Lost / Abandoned

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Exact date-filter parameter name for `/opportunities/search` — could not be scraped from JS-rendered marketplace docs; **must be probed in staging before locking the lib code.**
- Exact embedded shape of `contact` object in opportunity response — **same probe.**

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libs already in `package.json` and patterns proven in codebase
- Architecture: HIGH — pattern derived from existing webhook routes + Twilio executor + action_logs migration
- Pitfalls: HIGH for internal (timeout, RLS, anti-loop race) — based on real codebase constraints; MEDIUM for GHL-specific (date filter param) — flagged in Open Questions
- GHL API details: MEDIUM — cursor pagination confirmed; field-name specifics need staging probe (A1, A2, A3)
- Security: HIGH — reuses existing crypto + RLS patterns; no new attack surface besides the bearer endpoint

**Research date:** 2026-05-15
**Valid until:** 2026-06-14 (30 days for codebase patterns); GHL API docs valid until next GHL breaking change (historically stable since 2021-07-28 version stamp)
