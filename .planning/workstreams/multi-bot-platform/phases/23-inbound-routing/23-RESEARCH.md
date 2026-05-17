# Phase 23: Inbound Routing - Research

**Researched:** 2026-05-06
**Domain:** Supabase migrations · Server actions · Webhook dispatch · Action engine integration · JSONB matching
**Confidence:** HIGH — all findings come from direct inspection of the existing codebase. No external library decisions are required.

---

## Summary

Phase 23 wires the always-200 ManyChat webhook (delivered in Phase 22) into the action engine. It is entirely backend work: a new `manychat_rules` table, server actions for rule CRUD, a small dispatcher module that selects the first matching rule and invokes `executeAction()`, and a TS-layer relaxation of `manychat_events.Update` so the dispatcher can flip `status` to `matched` and link `action_log_id`.

The codebase already has every primitive needed. `executeAction(actionType, params, credentials, ctx)` lives at `src/lib/action-engine/execute-action.ts` and returns a `Promise<string>` (the result message). `resolveTool(orgId, toolName, supabase)` returns the `tool_configs` row joined with `integrations` (including `encrypted_api_key` and `location_id`) — but routing is bound by `tool_config_id` (UUID FK), not `tool_name`, so we will need a sibling resolver `resolveToolById(toolConfigId, supabase)` or a one-line variant. The Vapi tools handler at `src/app/api/vapi/tools/route.ts` is a complete reference for the orchestration sequence: secret-gate → resolve org → resolve tool → decrypt → executeAction → log → return.

The two real design questions for this phase are: (1) how to capture the `action_logs.id` for `manychat_events.action_log_id` linking, and (2) whether dispatch should run inline or via `next/server`'s `after()`. Recommendations below: extend `logAction()` to return the inserted row id (via `.insert().select('id').single()`) and run dispatch **inline** before the 200 response — the action engine has a 400ms timeout per outbound call and ManyChat External Request will not retry on a fast 200, so inline is simpler and observable. `after()` adds value only when total latency would exceed the 10s ManyChat timeout, which the current GHL/SMS/knowledge_base path will not.

For JSONB condition matching, recommend **pure JS object containment** (not SQL `@>`). Rule sets per org will be small (tens of rules), the matcher needs to short-circuit on first match in priority order, and a JS check is trivially testable in Vitest. Postgres `@>` would force a network round-trip per candidate.

**Primary recommendation:** Mirror the Vapi tools route pattern (resolve → execute → log → 200), add `manychat_rules` migration as **027**, write a `resolveRule(orgId, channelId, eventType, payload, supabase)` helper plus a `dispatchManychatEvent(...)` orchestrator, and update `manychat_events` post-dispatch with `status` + `action_log_id`. Run inline; do not use `after()` for v1.

---

<user_constraints>
## User Constraints (from `additional_context` — Phase 23 locked design decisions)

### Locked Decisions
- New table: `manychat_rules` with columns `id`, `org_id`, `channel_id` (FK → `manychat_channels`), `event_type` TEXT, `condition` JSONB, `tool_config_id` (FK → `tool_configs`), `is_active` BOOLEAN, `priority` INT.
- Rule matcher selection: query by `org_id + channel_id + event_type + is_active=true`, ordered by `priority`. For each candidate, check `condition` JSONB matches payload.
- **First-match wins** in priority order — no fan-out, no aggregation.
- Use existing `executeAction()` from `src/lib/action-engine/execute-action.ts` to dispatch — no new dispatcher engine.
- `manychat_events.Update` was typed `Record<string, never>` in Phase 22 — must be widened to allow `status` + `action_log_id` updates while keeping all other column updates impossible.

### Claude's Discretion
- JSONB condition matching strategy (JS containment vs SQL `@>`) — recommendation below.
- Migration number — confirmed **027** (last existing is `026_manychat_foundation.sql`).
- Whether the webhook handler invokes the dispatcher inline or via `after()` — recommendation below.
- Whether to extend `logAction()` to return the new row id, or write a parallel logger that does — recommendation below.
- Whether `manychat_rules` should add an `updated_at` column + trigger (PLANNING.md omits it but every other channel table has one).
- Phase 22 migration noted: "matched_rule_id and action_log_id FKs added in Phase 23 migration once those tables exist." This phase MUST add those FK constraints to `manychat_events`.

### Deferred Ideas (OUT OF SCOPE)
- Multiple rules matching one event (fan-out / N actions per event) — first-match-wins is locked.
- Rule priority ordering UI — Phase 26.
- Rule create/edit UI surface — Phase 26 (this phase ships server actions only).
- Manychat-specific outbound action types (`manychat_set_field`, etc.) — Phase 25.
- Webhook retry handling and dead-letter queue — future milestone (per REQUIREMENTS.md).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROUTING-01 (backend) | Admin can create a routing rule mapping `event_type + condition` JSONB → `tool_config_id` | New `manychat_rules` table + `createManychatRule()` server action; FK to `tool_configs` already RLS-scoped per org |
| ROUTING-02 (backend) | Admin can edit and delete routing rules | `updateManychatRule()` + `deleteManychatRule()` server actions following the `integrations/actions.ts` pattern; RLS handles org scoping |
| ROUTING-03 | When a webhook payload matches a rule, the bound `tool_config` action executes via the existing action engine | Mirror `vapi/tools/route.ts` orchestration: `resolveRule()` → `resolveToolById()` → `decrypt()` → `executeAction()` → `logAction()` |
| ROUTING-04 | Matched events are linked to the `action_logs` entry via `manychat_events.action_log_id` | Capture inserted `action_logs.id` (extend `logAction` or use `.insert(...).select('id').single()`); update `manychat_events` row inline after dispatch |

Phase 26 will add the UI surface for ROUTING-01 + ROUTING-02. This phase is **server-side only**: actions and dispatcher.
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

These directives MUST be honored by every plan in this phase:

- **Build verification:** `npm run build` must pass after changes — catches type errors before finishing.
- **Webhook handlers always return 200:** Confirmed by Phase 22; routing extension must preserve this contract. Any error path in dispatch logs to `manychat_events.status='error'` but still returns 200.
- **Webhook runtime:** `export const runtime = 'nodejs'` — already set in `route.ts` (line 12).
- **Multi-tenancy:** Every new table has RLS. Never manually filter by `org_id` in queries that go through the authenticated client (`createClient()`) — RLS handles it. The webhook uses `createServiceRoleClient()` which bypasses RLS, so it MUST set `org_id` explicitly from the resolved `channel.org_id` (never from request body — locked Phase 22 decision).
- **Auth in server actions:** Always `await getUser()` from `@/lib/supabase/server` — never `supabase.auth.getUser()` directly. `getUser()` is `cache()`-deduplicated per request.
- **Migration discipline:** Never edit existing migrations. Add `027_manychat_rules.sql` as a new file. Update `src/types/database.ts` manually after adding the migration.
- **Encryption:** Decryption in dispatch path uses `decrypt()` from `src/lib/crypto.ts`. Never hand-roll AES.
- **No new env vars / no new infra:** This phase is pure code + migration on existing Supabase.

---

## Standard Stack

### Core (already installed — no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.101.1 | Service-role DB ops + auth client | Used by all webhooks and server actions |
| `next` | ^16.2.2 | Route handler + `after()` async tasks | App Router runtime; `after()` is GA since 15 (already used by `vapi/tools`, `vapi/campaigns`, `meta/webhook`, `chat/[token]`) |
| `next/cache` | bundled | `revalidatePath()` after rule mutations | Standard pattern across all server actions |
| `src/lib/crypto.ts` | in-repo | `decrypt()` for tool integration API key | Sole encryption module |
| `src/lib/supabase/server.ts` | in-repo | `createClient()` + `getUser()` for server actions | Cached, RLS-aware |
| `src/lib/supabase/admin.ts` | in-repo | `createServiceRoleClient()` for the webhook dispatch path | Same as Phase 22 webhook |
| `src/lib/action-engine/execute-action.ts` | in-repo | `executeAction(actionType, params, credentials, ctx)` returns `Promise<string>` | Sole dispatch entry point |
| `src/lib/action-engine/resolve-tool.ts` | in-repo | Reference shape for tool+integration join | We need a sibling that resolves by `id` instead of `tool_name` |
| `vitest` | ^4.1.2 | Unit tests with mocked Supabase chains | Existing pattern in `tests/manychat/` |

### No New Dependencies
Zero new npm packages. Everything composes from primitives delivered in milestones v1.0–v1.5.

**Version verification:** `npm view next version` → 16.2.2 (matches `package.json`). `after()` is stable in 15+ and unchanged in 16.

---

## Architecture Patterns

### Recommended File Structure (Phase 23 additions)
```
supabase/migrations/
  027_manychat_rules.sql                 # new table + FK constraints to manychat_events

src/
  lib/manychat/
    resolve-rule.ts                      # rule lookup + condition matching (NEW)
    dispatch-event.ts                    # orchestrator: resolve → execute → log → update event (NEW)
  lib/action-engine/
    resolve-tool-by-id.ts                # NEW: variant of resolveTool keyed by tool_config.id
    log-action.ts                        # MODIFIED: return inserted row id (or sibling logManychatAction)
  app/(dashboard)/integrations/manychat/
    rules-actions.ts                     # NEW: createManychatRule / updateManychatRule / deleteManychatRule
  app/api/manychat/webhook/
    route.ts                             # MODIFIED: insert event, then call dispatchEvent (still always 200)
  types/database.ts                      # MODIFIED: add manychat_rules table types; widen manychat_events.Update

tests/manychat/
  rule-actions.test.ts                   # NEW: server action unit tests (RED Wave 0)
  resolve-rule.test.ts                   # NEW: matcher unit tests (RED Wave 0)
  dispatch-event.test.ts                 # NEW: orchestrator unit tests with mocked executeAction (RED Wave 0)
  webhook.test.ts                        # MODIFIED: add matched-path assertion (status='matched' + action_log_id linked)
```

### Pattern 1: Migration 027 — `manychat_rules` table + Phase-22 deferred FKs

The Phase 22 migration explicitly deferred two FKs on `manychat_events` because the target tables didn't exist yet (`026_manychat_foundation.sql` lines 65, 67):

```sql
matched_rule_id UUID,  -- FK to manychat_rules added in Phase 23 migration
action_log_id   UUID,  -- FK to action_logs added in Phase 23 migration
```

Migration 027 must:
1. Create `manychat_rules` table (with RLS, `updated_at` trigger, indexes for the matcher hot path).
2. Add the deferred FKs to `manychat_events`.

```sql
-- 1. Create manychat_rules
CREATE TABLE IF NOT EXISTS public.manychat_rules (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_id      UUID         NOT NULL REFERENCES public.manychat_channels(id) ON DELETE CASCADE,
  event_type      TEXT         NOT NULL,
  condition       JSONB        NOT NULL DEFAULT '{}',
  tool_config_id  UUID         NOT NULL REFERENCES public.tool_configs(id) ON DELETE RESTRICT,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  priority        INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE public.manychat_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.manychat_rules
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

CREATE TRIGGER trg_manychat_rules_updated_at
  BEFORE UPDATE ON public.manychat_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Composite index for matcher hot path:
-- WHERE org_id = $1 AND channel_id = $2 AND event_type = $3 AND is_active = true ORDER BY priority
CREATE INDEX idx_manychat_rules_match
  ON public.manychat_rules (org_id, channel_id, event_type, is_active, priority);

-- 2. Backfill the FKs deferred in Phase 22
ALTER TABLE public.manychat_events
  ADD CONSTRAINT manychat_events_matched_rule_id_fkey
  FOREIGN KEY (matched_rule_id) REFERENCES public.manychat_rules(id) ON DELETE SET NULL;

ALTER TABLE public.manychat_events
  ADD CONSTRAINT manychat_events_action_log_id_fkey
  FOREIGN KEY (action_log_id) REFERENCES public.action_logs(id) ON DELETE SET NULL;
```

`ON DELETE RESTRICT` on `tool_config_id`: prevents accidental deletion of a tool that rules depend on. The Phase 26 UI must surface this as a "this tool is bound to N rules" warning before allowing deletion. (Alternative: `ON DELETE SET NULL`, then add `is_active = false` semantics. RESTRICT is safer for v1.)

`ON DELETE SET NULL` on the deferred FKs: matches `action_logs.tool_config_id` precedent (preserves audit history when a rule or log is rebuilt).

### Pattern 2: TypeScript types — widen `manychat_events.Update`

Phase 22 typed `Update: Record<string, never>` to mirror the SQL append-only RLS at the TS layer (locked decision in STATE.md). Phase 23 must allow EXACTLY two fields to be updated — `status` and `action_log_id` — and only by the service role (which bypasses RLS, so the SQL append-only contract is enforced by NOT having `UPDATE`/`DELETE` policies for authenticated users; the policy stays unchanged).

```typescript
manychat_events: {
  Row: { /* unchanged */ }
  Insert: { /* unchanged */ }
  Update: {
    status?: 'matched' | 'unmatched' | 'error'
    action_log_id?: string | null
    matched_rule_id?: string | null
    // No other fields permitted — preserves audit-trail semantics
  }
  Relationships: [
    /* existing two FKs */
    {
      foreignKeyName: 'manychat_events_matched_rule_id_fkey'
      columns: ['matched_rule_id']
      isOneToOne: false
      referencedRelation: 'manychat_rules'
      referencedColumns: ['id']
    },
    {
      foreignKeyName: 'manychat_events_action_log_id_fkey'
      columns: ['action_log_id']
      isOneToOne: false
      referencedRelation: 'action_logs'
      referencedColumns: ['id']
    }
  ]
}
```

Add new `manychat_rules` block to the `Tables` union — full Row/Insert/Update/Relationships shape.

### Pattern 3: Rule matcher (model: `resolve-tool.ts` shape, pure JS containment)

```typescript
// src/lib/manychat/resolve-rule.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export type ManychatRuleRow = Database['public']['Tables']['manychat_rules']['Row']

/**
 * Resolves the first rule (priority order) whose condition is contained in the payload.
 * Returns null if no rule matches.
 *
 * Matching strategy: pure JS object containment.
 *   For each (k, v) in rule.condition:
 *     - if v is a primitive: payload[k] === v (strict equality)
 *     - if v is an object:   recursive containment
 *   Empty condition `{}` matches everything (use sparingly — typically with a unique event_type).
 */
export async function resolveRule(
  orgId: string,
  channelId: string,
  eventType: string,
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>
): Promise<ManychatRuleRow | null> {
  const { data, error } = await supabase
    .from('manychat_rules')
    .select('*')
    .eq('org_id', orgId)
    .eq('channel_id', channelId)
    .eq('event_type', eventType)
    .eq('is_active', true)
    .order('priority', { ascending: true })

  if (error || !data) return null
  for (const rule of data) {
    if (matchesCondition(rule.condition as Record<string, unknown>, payload)) {
      return rule
    }
  }
  return null
}

function matchesCondition(
  condition: Record<string, unknown>,
  payload: Record<string, unknown>
): boolean {
  for (const [k, v] of Object.entries(condition)) {
    const pv = payload[k]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (pv === null || typeof pv !== 'object' || Array.isArray(pv)) return false
      if (!matchesCondition(v as Record<string, unknown>, pv as Record<string, unknown>)) return false
    } else {
      if (pv !== v) return false
    }
  }
  return true
}
```

**Why JS containment over SQL `@>`:**
- Per-org rule sets are small (expected: 5–50). A single SELECT with `ORDER BY priority` returns all candidates in one round-trip; matching in JS is microseconds.
- First-match-wins is trivial to short-circuit in JS.
- Vitest unit tests can validate matching without a DB.
- SQL `@>` semantics differ subtly from JS object equality (e.g., array element containment, type coercion of JSON numbers vs. text). Avoiding it removes a class of bugs.
- If perf becomes an issue (1000+ rules per org), upgrade path is to add a SQL pre-filter using `condition @> $1` then keep the JS fallback for non-trivial conditions.

### Pattern 4: Tool resolver by ID (sibling of `resolveTool`)

Existing `resolveTool(orgId, toolName, supabase)` at `src/lib/action-engine/resolve-tool.ts` keys by `tool_name`. Routing rules bind by `tool_config_id` (UUID), so we need a parallel lookup:

```typescript
// src/lib/action-engine/resolve-tool-by-id.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ToolConfigWithIntegration } from './resolve-tool'

export async function resolveToolById(
  toolConfigId: string,
  supabase: SupabaseClient<Database>
): Promise<ToolConfigWithIntegration | null> {
  const { data, error } = await supabase
    .from('tool_configs')
    .select('*, integrations!inner(*)')
    .eq('id', toolConfigId)
    .eq('is_active', true)
    .single<ToolConfigWithIntegration>()

  if (error || !data?.integrations?.encrypted_api_key) return null
  return data
}
```

Reuses the `ToolConfigWithIntegration` type — single source of truth.

### Pattern 5: Dispatcher orchestrator

```typescript
// src/lib/manychat/dispatch-event.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import { resolveRule } from './resolve-rule'
import { resolveToolById } from '@/lib/action-engine/resolve-tool-by-id'
import { executeAction } from '@/lib/action-engine/execute-action'
import { decrypt } from '@/lib/crypto'

interface DispatchInput {
  eventId: string         // manychat_events.id (already inserted by webhook)
  orgId: string
  channelId: string
  eventType: string
  payload: Record<string, unknown>
}

export async function dispatchManychatEvent(
  input: DispatchInput,
  supabase: SupabaseClient<Database>
): Promise<void> {
  const startedAt = Date.now()

  // 1. Find first matching rule
  const rule = await resolveRule(
    input.orgId, input.channelId, input.eventType, input.payload, supabase
  )
  if (!rule) {
    // Already 'unmatched' from Phase 22 insert — nothing to do
    return
  }

  // 2. Resolve tool + integration
  const tool = await resolveToolById(rule.tool_config_id, supabase)
  if (!tool) {
    await markEvent(supabase, input.eventId, {
      status: 'error',
      matched_rule_id: rule.id,
    })
    return
  }

  // 3. Execute
  let actionLogId: string | null = null
  let status: 'success' | 'error' | 'timeout' = 'success'
  let errorDetail: string | null = null
  let result = ''

  try {
    const apiKey = await decrypt(tool.integrations.encrypted_api_key)
    const credentials = { apiKey, locationId: tool.integrations.location_id ?? '' }
    result = await executeAction(tool.action_type, input.payload, credentials, {
      organizationId: input.orgId,
      supabase,
    })
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    status = isTimeout ? 'timeout' : 'error'
    errorDetail = err instanceof Error ? err.message : String(err)
    result = tool.fallback_message
  }

  // 4. Log to action_logs and capture id
  const { data: logRow } = await supabase
    .from('action_logs')
    .insert({
      organization_id: input.orgId,
      tool_config_id: tool.id,
      vapi_call_id: `manychat:${input.eventId}`,  // synthetic — see open question
      tool_name: tool.tool_name,
      status,
      execution_ms: Date.now() - startedAt,
      request_payload: input.payload as Json,
      response_payload: { result } as Json,
      error_detail: errorDetail,
    })
    .select('id')
    .single()

  actionLogId = logRow?.id ?? null

  // 5. Link the event to the log + final status
  await markEvent(supabase, input.eventId, {
    status: status === 'success' ? 'matched' : 'error',
    matched_rule_id: rule.id,
    action_log_id: actionLogId,
  })
}

async function markEvent(
  supabase: SupabaseClient<Database>,
  eventId: string,
  updates: Database['public']['Tables']['manychat_events']['Update']
): Promise<void> {
  await supabase.from('manychat_events').update(updates).eq('id', eventId)
}
```

### Pattern 6: Webhook integration (modify `route.ts`)

The existing webhook inserts the event with `status='unmatched'` — Phase 23 should:
1. Capture the inserted row id by changing `.insert(...)` → `.insert(...).select('id').single()`.
2. After the insert, call `dispatchManychatEvent({...}, supabase)` **inline** (still inside the outer `try/catch`).
3. Still return `Response.json({ ok: true })` regardless.

```typescript
// In src/app/api/manychat/webhook/route.ts, after the existing channel lookup:
try {
  // ... existing body parse, eventType extract ...

  const { data: inserted } = await supabase
    .from('manychat_events')
    .insert({
      org_id: channel.org_id,
      channel_id: channel.id,
      event_type: eventType,
      event_payload: body as Json,
      status: 'unmatched',
    })
    .select('id')
    .single()

  if (inserted?.id) {
    // Dispatch inline — total path stays under 1s typical, ManyChat timeout is 10s
    await dispatchManychatEvent({
      eventId: inserted.id,
      orgId: channel.org_id,
      channelId: channel.id,
      eventType,
      payload: body,
    }, supabase)
  }
} catch {
  // Swallow — always 200 after secret validation
}

return Response.json({ ok: true })
```

**Inline vs `after()`:** See Open Questions for the full tradeoff. Inline is recommended for v1.

### Pattern 7: Rules CRUD server actions (model: `integrations/actions.ts`)

```typescript
// src/app/(dashboard)/integrations/manychat/rules-actions.ts
'use server'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface RuleInput {
  channelId: string
  eventType: string
  condition: Record<string, unknown>
  toolConfigId: string
  priority?: number
  isActive?: boolean
}

export async function createManychatRule(
  data: RuleInput
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase.from('manychat_rules').insert({
    channel_id: data.channelId,
    event_type: data.eventType,
    condition: data.condition,
    tool_config_id: data.toolConfigId,
    priority: data.priority ?? 0,
    is_active: data.isActive ?? true,
    // org_id auto-populated by RLS WITH CHECK
  })
  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat')
  revalidatePath('/integrations/manychat/rules')
}

export async function updateManychatRule(
  id: string,
  data: Partial<RuleInput>
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const update: Record<string, unknown> = {}
  if (data.eventType !== undefined) update.event_type = data.eventType
  if (data.condition !== undefined) update.condition = data.condition
  if (data.toolConfigId !== undefined) update.tool_config_id = data.toolConfigId
  if (data.priority !== undefined) update.priority = data.priority
  if (data.isActive !== undefined) update.is_active = data.isActive

  const { error } = await supabase.from('manychat_rules').update(update).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat/rules')
}

export async function deleteManychatRule(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const { error } = await supabase.from('manychat_rules').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/integrations/manychat/rules')
}
```

`org_id` is NOT manually set in the insert — RLS `WITH CHECK (org_id = get_current_org_id())` populates it. Same pattern as `createManychatChannel` from Phase 22 (locked decision).

### Anti-Patterns to Avoid

- **Trusting `org_id` from request body (still applies):** Same Phase 22 trap. The dispatcher's `orgId` MUST come from the `channel.org_id` resolved by the webhook handler — never from the payload.
- **Updating `manychat_events` from the authenticated client:** No `UPDATE` policy exists for authenticated users — the post-dispatch update MUST go through the service-role client. The dispatcher already receives the service-role client from the webhook caller.
- **Calling `executeAction()` outside a try/catch:** GHL executors throw on timeout (`AbortError`) and on failed responses. Wrap as in `vapi/tools/route.ts` and capture status='timeout'/'error'.
- **Decrypting the API key before the rule is matched:** Decryption is cheap but the rule may not match; only decrypt after `resolveToolById` succeeds.
- **Returning the rule row to the dispatcher caller:** The webhook never reads the dispatcher result — keep `dispatchManychatEvent` returning `void` to discourage coupling.
- **Forgetting to `revalidatePath()` from rule mutations:** Phase 26 UI will read rules via Server Components; stale cache breaks edit flows.
- **Adding an `UPDATE` policy on `manychat_events` for authenticated users:** Audit-trail violation. The TS-layer Update widening is for the service-role dispatcher only; SQL must remain INSERT+SELECT only for authenticated.
- **Using `executeAction()` with `action_type='custom_webhook'` or `'send_sms'`:** Both throw `Unsupported action type` (line 41–43 of execute-action.ts). Currently only `create_contact`, `get_availability`, `create_appointment`, and `knowledge_base` are wired. The Phase 26 UI must filter the tool selector or the dispatch will land in `status='error'`. Document this explicitly in the plan.
- **Re-inserting `manychat_events` in the dispatcher:** The webhook inserted it; the dispatcher only `UPDATE`s. Do not `upsert`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONB matching | Custom regex / SQL builder | The `matchesCondition` recursive equality helper above | Small, tested, no DB round-trip; SQL `@>` has subtle JSON-vs-JS semantic differences |
| Action dispatch | New executor framework | `executeAction()` from `src/lib/action-engine/execute-action.ts` | Already routes 4+ action types; adding a parallel dispatcher creates two engines to maintain |
| Tool credential resolution | New join query | Either `resolveTool` (by name) or the new `resolveToolById` mirroring its shape | Reuses `ToolConfigWithIntegration` type; consistent with hot-path index strategy |
| API key decryption | Re-implement AES | `decrypt()` from `src/lib/crypto.ts` | Format `iv:ciphertext` is locked; never re-implement |
| Action logging | New `manychat_logs` table | Existing `action_logs` table | Single source of truth for execution audit. `vapi_call_id` field is repurposed as `manychat:{event_id}` (see open question) |
| Async-after-response | Custom queue | `after()` from `next/server` (if needed) | Already used by 4 routes; battle-tested. Inline is preferred for v1 — see open question |
| Server-action auth | Manual session check | `getUser()` from `@/lib/supabase/server` | Cached, RLS-aware, used by every existing server action |
| Org scoping | Manual `.eq('org_id', ...)` | RLS via `createClient()` | Codebase convention; redundant filters are inconsistent (Phase 22 explicitly relies on this) |

**Key insight:** Phase 23 is composition, not invention. Every pitfall has been solved in the v1.0 action engine or v1.6 Phase 22.

---

## Common Pitfalls

### Pitfall 1: `action_logs.vapi_call_id` is `NOT NULL TEXT`
**What goes wrong:** Dispatcher tries to insert a `manychat`-source log with `vapi_call_id: null` and the insert fails silently because the webhook handler swallows errors.
**Why it happens:** The column was named for the v1.0 use case; ManyChat events have no Vapi call ID.
**How to avoid:** Use a synthetic value like `manychat:{event_id}` so the column stays non-null and the row is queryable per-event for the Phase 26 UI. Plan should call out this synthesis explicitly.
**Warning signs:** `action_logs` insert returns `{ error: 'null value in column "vapi_call_id" violates not-null constraint' }`. Or worse, no row in `action_logs` and `manychat_events.action_log_id` is null on supposed match.

### Pitfall 2: Forgetting to widen `manychat_events.Update` before writing the dispatcher
**What goes wrong:** TypeScript error `Type '{ status: "matched"; ... }' is not assignable to type 'Record<string, never>'` blocks the build.
**Why it happens:** Phase 22 locked `Update: Record<string, never>` for append-only enforcement at the TS layer.
**How to avoid:** Wave 0 of Phase 23 must include the `database.ts` widening before any code that calls `.update()` on `manychat_events`. Order matters — make the type change a prerequisite task.
**Warning signs:** `npm run build` fails with `manychat_events` Update type error.

### Pitfall 3: Race between webhook insert and dispatcher select
**What goes wrong:** The dispatcher tries to UPDATE the event by id before the INSERT commits; with PostgREST's pooled connection, this is usually fine inside a single request but could surface under heavy load.
**Why it happens:** Two separate calls in the webhook handler.
**How to avoid:** The dispatcher receives `eventId` as an argument from the same `await supabase.from(...).insert(...).select('id').single()`. The promise chain guarantees the row exists when the dispatcher runs. No transaction needed.

### Pitfall 4: `tool_config.is_active = false` not honored
**What goes wrong:** A rule binds to a deactivated tool, dispatch tries to execute, gets stale credentials.
**Why it happens:** `resolveToolById` must filter `.eq('is_active', true)` (mirroring `resolveTool`).
**How to avoid:** The pattern shown above already includes the filter. Test: rule matches but tool is inactive → `manychat_events.status='error'`.

### Pitfall 5: `executeAction()` throws on unsupported action types
**What goes wrong:** A rule binds to `tool_config.action_type='custom_webhook'` or `'send_sms'`. `executeAction()` throws `Error('Unsupported action type: ${actionType}')`. The dispatcher catches it and writes `status='error'` — correct behavior, but invisible until the user sees `unmatched`/`error` in Phase 26 UI.
**Why it happens:** v1.0 stubbed those branches; Phase 25 adds `manychat_*` types.
**How to avoid:** Plan should note that until Phase 25 lands, only rules pointing at `create_contact | get_availability | create_appointment | knowledge_base` will succeed. Phase 26 UI should filter or warn.

### Pitfall 6: Inline dispatch latency under poor network
**What goes wrong:** GHL `create_contact` takes 380ms typical, can spike to 1s+ on a bad day. Plus Supabase round-trips (~5–25ms each, ~5 of them) = total ~500–1500ms inline, before returning 200 to ManyChat.
**Why it happens:** Inline path is the simplest design.
**How to avoid:** ManyChat External Request timeout is 10 seconds (per ManyChat docs). 1.5s ceiling stays safely inside. If we ever wire `manychat_send_message` (Phase 25), which adds another outbound HTTP call, total may approach 3s — re-evaluate `after()` then.
**Warning signs:** ManyChat dashboard shows External Request errors / retries. p95 latency on `/api/manychat/webhook` exceeds 5s in Vercel logs.

### Pitfall 7: `priority` ordering is ASC vs DESC ambiguity
**What goes wrong:** Developer assumes "priority 1 wins" but the matcher uses `ORDER BY priority ASC` and matches priority=0 first.
**Why it happens:** Convention is ambiguous — pick one and document.
**How to avoid:** `ORDER BY priority ASC` (lower number = earlier match). Default in DDL is `0`. Document this in the migration comment AND on the server action JSDoc.
**Warning signs:** Matcher tests fail when multiple rules match — the wrong rule wins.

### Pitfall 8: `manychat_events` has no `UPDATE` RLS policy
**What goes wrong:** Even if TS Update is widened, an authenticated client trying to call `.update()` will be silently blocked by RLS.
**Why it happens:** Audit-trail design (Phase 22 locked: append-only for authenticated).
**How to avoid:** The dispatcher MUST receive the service-role client (`createServiceRoleClient()`). The webhook already creates one — pass it through. Never call `.update()` on `manychat_events` from a server action or page.

---

## Code Examples

### Verified webhook orchestration sequence (model: `vapi/tools/route.ts`)

```typescript
// Reference: src/app/api/vapi/tools/route.ts:64-95 — full hot path
const orgId = await resolveOrg(call.assistantId, supabase)
if (!orgId) { /* fallback */ }

const toolConfig = await resolveTool(orgId, toolCall.name, supabase)
if (!toolConfig) { /* fallback */ }

try {
  const apiKey = await decrypt(toolConfig.integrations.encrypted_api_key)
  const credentials = { apiKey, locationId: toolConfig.integrations.location_id ?? '' }
  result = await executeAction(toolConfig.action_type, args, credentials, {
    organizationId: orgId,
    supabase,
  })
} catch (err) {
  const isTimeout = err instanceof Error && err.name === 'AbortError'
  status = isTimeout ? 'timeout' : 'error'
  errorDetail = err instanceof Error ? err.message : String(err)
  result = toolConfig.fallback_message
}
```

This is the canonical pattern — Phase 23 dispatcher mirrors it line-for-line, swapping `resolveTool(name)` for `resolveToolById(id)` and adding the `manychat_events` link step.

### Verified `.insert(...).select('id').single()` pattern

```typescript
// Capture inserted UUID in one round-trip
const { data: inserted, error } = await supabase
  .from('manychat_events')
  .insert({ org_id, channel_id, event_type, event_payload, status: 'unmatched' })
  .select('id')
  .single()
// inserted?.id is the new UUID
```

This shape is supported by `@supabase/supabase-js` v2.x; no version concern.

### Verified Vitest pattern for webhook tests (model: `tests/manychat/webhook.test.ts`)

The Phase 22 tests use `vi.resetModules()` + dynamic `await import('@/app/api/manychat/webhook/route')` so the route is imported fresh per test. Phase 23 tests should follow the same pattern. Add a third `describe` block:

```typescript
describe('ROUTING-03: matched event dispatches and links action_log_id', () => {
  // mock channel found, mock rule found, mock executeAction → 'success', mock action_logs.insert returns {id: 'log-1'}
  // assert: manychat_events update called with status='matched', action_log_id='log-1', matched_rule_id='rule-1'
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vapi tools = sole entry to action engine | Webhook (any source) → routing layer → action engine | This phase | ManyChat reuses action engine without Vapi-specific assumptions; future channels (Slack, etc.) can bind to the same dispatcher |
| `manychat_events` strictly append-only at TS layer | Service-role can flip `status` + link `action_log_id` | This phase | Required for routing observability; SQL still enforces append-only for authenticated |

**Deprecated/outdated:** Nothing. All v1.0 patterns remain valid.

---

## Runtime State Inventory

This is a greenfield additive phase (new table, new code), not a rename or migration. No existing runtime state needs adjusting. Phase 22 is fully shipped and stable; this phase extends it without renaming any column, table, or service identifier.

Confirmed by checking:
- **Stored data:** None — `manychat_rules` is new. `manychat_events` rows from Phase 22 are still 'unmatched'; the dispatcher only acts on NEW events from this point forward. No backfill required.
- **Live service config:** None — no external system stores rule references.
- **OS-registered state:** None — no scheduled tasks or registered services touch ManyChat routing.
- **Secrets/env vars:** None new. `ENCRYPTION_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are reused from existing setup.
- **Build artifacts:** None — pure code addition.

**Section status:** Inventoried; nothing to do.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified).

This phase requires no new tools, services, runtimes, or env vars beyond the already-configured Vercel + Supabase stack. The dispatcher path uses the same Supabase service-role client and decryption secret as Phase 22.

**Pre-existing pending todo (carried from Phase 22):** `npx supabase db push` requires `SUPABASE_DB_PASSWORD`. Migration 027 will add to the same pending push. This is a prerequisite for live verification but does not block plan/research/build.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run tests/manychat/` |
| Full suite command | `npx vitest run` |
| Build verification | `npm run build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROUTING-01 | `createManychatRule` inserts row with org_id resolved by RLS | unit | `npx vitest run tests/manychat/rule-actions.test.ts` | ❌ Wave 0 |
| ROUTING-01 | `createManychatRule` rejects unauthenticated calls | unit | `npx vitest run tests/manychat/rule-actions.test.ts` | ❌ Wave 0 |
| ROUTING-02 | `updateManychatRule` patches only specified fields | unit | `npx vitest run tests/manychat/rule-actions.test.ts` | ❌ Wave 0 |
| ROUTING-02 | `deleteManychatRule` removes the row by id | unit | `npx vitest run tests/manychat/rule-actions.test.ts` | ❌ Wave 0 |
| ROUTING-03 | Matcher returns first rule by priority where condition is contained | unit | `npx vitest run tests/manychat/resolve-rule.test.ts` | ❌ Wave 0 |
| ROUTING-03 | Matcher returns null when no rule matches | unit | `npx vitest run tests/manychat/resolve-rule.test.ts` | ❌ Wave 0 |
| ROUTING-03 | Matcher honors `is_active=false` (excludes from results) | unit | `npx vitest run tests/manychat/resolve-rule.test.ts` | ❌ Wave 0 |
| ROUTING-03 | Dispatcher calls `executeAction(actionType, payload, credentials, ctx)` on match | unit | `npx vitest run tests/manychat/dispatch-event.test.ts` | ❌ Wave 0 |
| ROUTING-03 | Dispatcher writes `status='error'` on `executeAction` throw | unit | `npx vitest run tests/manychat/dispatch-event.test.ts` | ❌ Wave 0 |
| ROUTING-03 | Webhook with matching payload returns 200 AND logs `status='matched'` | unit | `npx vitest run tests/manychat/webhook.test.ts` | ✅ (extend existing) |
| ROUTING-04 | Dispatcher writes inserted `action_logs.id` to `manychat_events.action_log_id` | unit | `npx vitest run tests/manychat/dispatch-event.test.ts` | ❌ Wave 0 |
| ROUTING-04 | Webhook with non-matching payload leaves `status='unmatched'`, no action_log_id | unit | `npx vitest run tests/manychat/webhook.test.ts` | ✅ (extend existing) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/manychat/`
- **Per wave merge:** `npx vitest run` (full suite — confirms no regressions in 156 existing tests)
- **Phase gate:** Full suite green + `npm run build` exits 0 before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/manychat/rule-actions.test.ts` — covers ROUTING-01, ROUTING-02 (createManychatRule, updateManychatRule, deleteManychatRule)
- [ ] `tests/manychat/resolve-rule.test.ts` — covers `resolveRule()` and `matchesCondition()` (priority order, condition containment, is_active filter)
- [ ] `tests/manychat/dispatch-event.test.ts` — covers `dispatchManychatEvent()` with mocked `executeAction`, `resolveRule`, `resolveToolById`
- [ ] `tests/manychat/webhook.test.ts` — extend existing file with matched-path assertion (status='matched', action_log_id linked)
- [ ] `npm run build` after `database.ts` widening must remain clean — no new framework install needed (Vitest already present)

---

## Open Questions

1. **Should `logAction()` be extended to return the inserted `action_logs.id`, or should the dispatcher write its own insert?**
   - What we know: `logAction()` currently returns `void`, swallows all errors, and is designed to be called inside `after()` without blocking. Extending it changes the contract for the existing Vapi caller.
   - What's unclear: Whether the Vapi caller cares about the id (it doesn't — it ignores the return value).
   - Recommendation: Modify `logAction()` to return `Promise<string | null>` (id or null on failure) — minimal blast radius, the Vapi caller continues to ignore it. Alternatively, the dispatcher writes its own `action_logs.insert(...).select('id').single()` (shown in the example above) and skips `logAction()` entirely. The second option avoids touching `logAction` but duplicates the insert shape. **Pick option 1** — single source of truth.

2. **Should dispatch be inline in the webhook handler, or via `next/server`'s `after()`?**
   - What we know: Inline path latency is dominated by GHL HTTP calls (~400ms hard timeout from `ghl/client.ts`) plus 4-5 Supabase round-trips (~50-150ms total). Total p95 estimate: 500-700ms inline. ManyChat External Request timeout is 10s (per ManyChat docs).
   - What's unclear: Whether ManyChat retries on slow 200s. Per Phase 22 PLANNING.md "Open Questions" #2, retry behavior on 403 is unverified — but a 200 inside the 10s window will not retry.
   - Recommendation: **Inline for v1.** Simpler, observable, well within timeout. Reasons to switch to `after()` later: (a) Phase 25 adds an outbound `manychat_send_message` action that round-trips to ManyChat API, adding 200-500ms; (b) future fan-out to multiple actions per event. Document the trigger conditions in the plan.

3. **`action_logs.vapi_call_id` is `NOT NULL TEXT` — what value to write for ManyChat-sourced logs?**
   - What we know: Column was named for the v1.0 Vapi use case but is just a TEXT identifier. Phase 26 will read these logs back.
   - What's unclear: Whether to rename it (column rename = breaking schema change touching every reader) or repurpose it.
   - Recommendation: **Repurpose with synthetic prefix** — `vapi_call_id = 'manychat:' + event_id`. Phase 26 UI can branch on prefix to display the source. Future cleanup: a v2.0 migration could rename to `source_event_id` once multiple channel sources exist. Plan should add a code comment in the dispatcher acknowledging this.

4. **Does `manychat_rules` need an `updated_at` column + trigger?**
   - What we know: PLANNING.md data model lists only `created_at`. Phase 22's migration comment for `config JSONB` says "Future: payload field mappings, default event_type" implying rule config is stable. But every other channel/integration table has `updated_at`.
   - What's unclear: Whether Phase 26 UI will show "last edited" metadata.
   - Recommendation: **Add `updated_at` + trigger.** Trivial cost, future-proofs Phase 26's UX, and consistent with `manychat_channels` from Phase 22. Documented in the migration template above.

5. **Should the matcher support nested condition values, or only flat `key=value`?**
   - What we know: PLANNING.md shows only flat conditions: `{ "flow_id": "abc123" }` or `{ "tag": "qualified" }`.
   - What's unclear: Whether v1 admins will want `{ "user.tags": ["qualified"] }` (path-based) or `{ "user": { "tags": "qualified" } }` (nested object).
   - Recommendation: Support **nested object containment** (recursive equality, shown in `matchesCondition` above). Path syntax adds complexity (regex, tokenizer) without clear demand. Document in JSDoc that conditions match the structure of the payload.

6. **What happens if `tool_config.is_active = false` between rule creation and webhook fire?**
   - What we know: `resolveToolById` filters `.eq('is_active', true)`. Result: tool not found → dispatcher writes `status='error'`.
   - What's unclear: Whether this should be `status='unmatched'` instead (rule didn't actually fire, but the tool doesn't exist).
   - Recommendation: `status='error'` with a code comment. The rule matched, but execution failed — that's the canonical "error" branch from the audit log perspective. UI can disambiguate via `error_detail`.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `src/app/api/manychat/webhook/route.ts` — current webhook handler (Phase 22)
- `src/app/api/vapi/tools/route.ts` — canonical orchestration template (resolve → execute → log → 200)
- `src/lib/action-engine/execute-action.ts` — `executeAction(actionType, params, credentials, ctx) → Promise<string>` signature
- `src/lib/action-engine/resolve-tool.ts` — `ToolConfigWithIntegration` type, joined query pattern
- `src/lib/action-engine/log-action.ts` — current `logAction()` shape (returns void, swallows errors)
- `src/lib/action-engine/resolve-org.ts` — single-table resolver template
- `src/lib/crypto.ts` — `decrypt()` API
- `src/lib/supabase/admin.ts` — `createServiceRoleClient()`
- `src/lib/supabase/server.ts` — `createClient()` + `getUser()`
- `src/app/(dashboard)/integrations/actions.ts` — server actions pattern (auth gate, RLS scoping, revalidatePath)
- `supabase/migrations/002_action_engine.sql` — `tool_configs`, `action_logs` schema (verified `vapi_call_id NOT NULL`)
- `supabase/migrations/019_meta_channels.sql` — channel table RLS template
- `supabase/migrations/025_tool_folders.sql` — confirms `update_updated_at()` reusability
- `supabase/migrations/026_manychat_foundation.sql` — current Phase 22 schema; deferred FKs noted
- `src/types/database.ts` — current TS types for `manychat_events`, `manychat_channels`, `tool_configs`, `action_logs`
- `tests/manychat/webhook.test.ts` — Vitest pattern: dynamic import + service-role mock
- `tests/manychat/channel-actions.test.ts` — server action test pattern
- `package.json` — Next 16.2.2 confirmed
- `.planning/STATE.md` — locked v1.6 architecture decisions
- `.planning/REQUIREMENTS.md` — ROUTING-01 through ROUTING-04 definitions

### Secondary (MEDIUM confidence)
- `projects/manychat-integration/PLANNING.md` — data model authored by project owner (rule columns: id, org_id, channel_id, event_type, condition, tool_config_id, is_active, priority, created_at — implied no updated_at, but adding is non-breaking)
- ManyChat External Request timeout (10s) — taken from PLANNING.md and ManyChat help docs reference; not independently retrieved this session

### Tertiary (LOW confidence — needs validation if relied upon)
- ManyChat retry behavior on slow 200s (no retries expected) — inferred from REQUIREMENTS.md "always 200 to prevent retry storms" framing

---

## Metadata

**Confidence breakdown:**
- Migration 027 SQL: HIGH — direct templates in this repo (`019_meta_channels.sql`, `025_tool_folders.sql`, `026_manychat_foundation.sql`)
- Dispatcher orchestration: HIGH — `vapi/tools/route.ts` is a near-1:1 model
- TS type widening: HIGH — exact `database.ts` block read
- JSONB matching strategy: MEDIUM — recommendation backed by sound reasoning but no perf benchmark in-repo for comparison
- Inline-vs-after dispatch: MEDIUM — latency math is conservative estimate, not measured
- Test patterns: HIGH — `tests/manychat/webhook.test.ts` is a direct extension target

**Research date:** 2026-05-06
**Valid until:** Indefinite — all findings are from this codebase's own source files. Re-verify only if action-engine signatures change in v1.7+.
