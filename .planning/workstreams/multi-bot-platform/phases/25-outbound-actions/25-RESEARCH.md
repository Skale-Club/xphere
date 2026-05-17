# Phase 25: Outbound Actions — Research

**Researched:** 2026-05-07
**Domain:** ManyChat REST API · Supabase migration patterns · Action engine executor extension
**Confidence:** HIGH (endpoints verified from official PHP SDK and live community evidence; existing code paths read from source).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Credentials Bridge (the core architectural decision)**

- **D-01:** Strategy is **A. Bridge** — outbound executors fetch the ManyChat API key through the existing `tool_configs.integration_id → integrations.encrypted_api_key` join. No special-casing in `dispatch-event.ts`, no full migration of `manychat_channels`. Reason: the dispatcher already assumes credentials live in `integrations`; mirroring is the smallest change that preserves Phase 22's design.
- **D-02:** **`manychat_channels` is canonical.** The bridge `integrations` row is a read-only mirror maintained by the server actions. Phase 22's dashboard code (`createManychatChannel`, `testManychatConnection`, `deleteManychatChannel`) keeps reading/writing the channel row directly.
- **D-03:** **Sync lives in the server actions** (`src/app/(dashboard)/integrations/manychat/actions.ts`). On `createManychatChannel`, also `INSERT` into `integrations`. On `deleteManychatChannel`, the `ON DELETE CASCADE` from the FK takes care of the integration row. On any future API key rotation flow, the server action updates both rows. Reason: single, debuggable application-layer location; encryption stays where it belongs.
- **D-04:** **Schema link: `integrations.manychat_channel_id UUID REFERENCES manychat_channels(id) ON DELETE CASCADE`** (nullable; only set for `provider='manychat'` rows). Cascade delete keeps the bridge row from outliving its channel. Add a partial unique index `(organization_id) WHERE provider = 'manychat'` to enforce one bridge row per org.
- **D-05:** **Migration backfills** — for any existing `manychat_channels` rows from Phase 22 testing, the migration runs `INSERT INTO integrations (...) SELECT ... FROM manychat_channels` after the FK column is added, idempotent via the partial unique index above.
- **D-06:** **`is_active` is mirrored.** Server actions write the same `is_active` value to both rows. Disabling a ManyChat channel automatically disables outbound actions because `resolveTool`/`resolveToolById` require `is_active=true` on `integrations`.
- **D-07:** **`integrations.name` mirrors `manychat_channels.channel_name`.**
- **D-08:** **`integrations.location_id = NULL`, `integrations.config = '{}'`** for the bridge row.

**Action_type Enum + Executors**

- **D-09:** Migration extends `public.action_type` with 4 new values: `manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message`. `ALTER TYPE ... ADD VALUE` runs as a **standalone statement** (PostgreSQL forbids ALTER TYPE inside a transaction).
- **D-10:** Executor file layout follows the GHL pattern: one file per action type under `src/lib/manychat/`:
  - `set-field.ts` exports `setManychatField(params, credentials)`
  - `add-tag.ts` exports `addManychatTag(params, credentials)`
  - `trigger-flow.ts` exports `triggerManychatFlow(params, credentials)`
  - `send-message.ts` exports `sendManychatMessage(params, credentials)`
  - `client.ts` (new) — low-level fetch wrapper with 5s `AbortController` timeout.
- **D-11:** `executeAction` in `src/lib/action-engine/execute-action.ts` adds 4 new `case` branches that call the executors above. Credentials shape stays compatible with the existing `GhlCredentials` interface (`apiKey: string` is what executors need; `locationId` is unused for ManyChat).

### Claude's Discretion

- **Subscriber ID source:** read `subscriber_id` from runtime params, fall back to `payload.subscriber_id` if not provided.
- **Static config vs runtime params:** support both — `config` provides defaults, runtime `params` override.
- **ManyChat ID resolution:** accept opaque IDs only in Phase 25 (no name resolution); Phase 26's Rules UI may add a name-resolution helper later.
- **Error semantics + retry:** single attempt, 5s timeout; on failure write `status='error'` to `action_logs` with `error_detail`, return `tool.fallback_message`. No retry logic.

### Deferred Ideas (OUT OF SCOPE for Phase 25)

- Webhook secret rotation flow.
- Multi-channel-per-org (today both `manychat_channels.UNIQUE(org_id)` and the new partial index enforce 1:1).
- Refactor `testManychatConnection` to use the new `src/lib/manychat/client.ts` (recommended cleanup; not required).
- Archive of v1.6 REQUIREMENTS.md to `.planning/milestones/v1.6-REQUIREMENTS.md` (pure hygiene).
- Name → ID resolution helpers (defer to Phase 26 if needed).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **OUTBOUND-01** | `manychat_set_field` action type sets a subscriber custom field via ManyChat API | Endpoint confirmed: `POST /fb/subscriber/setCustomField` with `{subscriber_id, field_id, field_value}`. Optional `setCustomFieldByName` variant uses `field_name`. See Code Examples §1. |
| **OUTBOUND-02** | `manychat_add_tag` action type adds a tag to a subscriber via ManyChat API | Endpoint confirmed: `POST /fb/subscriber/addTag` with `{subscriber_id, tag_id}`. Optional `addTagByName` variant uses `tag_name`. See Code Examples §2. |
| **OUTBOUND-03** | `manychat_trigger_flow` action type triggers an existing ManyChat flow for a subscriber | Endpoint confirmed: `POST /fb/sending/sendFlow` with `{subscriber_id, flow_ns}`. Note: it lives under `/fb/sending/`, NOT `/fb/subscriber/`. See Code Examples §3. |
| **OUTBOUND-04** | `manychat_send_message` action type sends a message to a subscriber via ManyChat API | Endpoint confirmed: `POST /fb/sending/sendContent` with `{subscriber_id, data, message_tag}`. `data` follows the Dynamic Block v2 schema. See Code Examples §4. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

These are repository-wide rules the planner MUST honor when shaping Phase 25 tasks:

| Constraint | Implication for Phase 25 |
|------------|--------------------------|
| `npm run build` after every change | Each plan/wave must end with build passing (TypeScript strict catches enum widening, new column types, executor signatures). |
| Webhook receivers always return HTTP 200 | Phase 25 does NOT touch `/api/manychat/webhook` directly — but the dispatcher continues to swallow executor errors and log them. Confirmed in `dispatch-event.ts` (already correct). |
| RLS via `get_current_org_id()` | New bridge `INSERT` into `integrations` from `createManychatChannel` runs with the authenticated user's session — RLS WITH CHECK gates `organization_id`. Bridge backfill runs as service role (migration). |
| `src/lib/crypto.ts` format is locked (`iv:ciphertext` base64, AES-256-GCM) | Bridge sync REUSES the already-encrypted blob from `manychat_channels.encrypted_api_key` — no re-encryption, no new keys. |
| Migrations folder is append-only | Add `028_manychat_outbound.sql`. Never edit 026/027. |
| Update `src/types/database.ts` after every migration | Manual edits required (see Type Generation §). |
| Server components by default; client components use `'use client'` | Not relevant — Phase 25 has no UI surface. |

## Summary

Phase 25 implements 4 outbound ManyChat action types (`manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message`) by extending the existing action engine. Architecturally it is two distinct chunks of work: **(a) the credentials bridge** (one DB migration + sync code in the existing channel server actions, so `tool_configs.integration_id → integrations` joins still work without any change to the dispatcher), and **(b) four executor files** under `src/lib/manychat/` plus a shared low-level fetch client wired into `executeAction`'s switch.

The ManyChat REST API surface is well-known and stable: every relevant endpoint is `POST` to `https://api.manychat.com/fb/{namespace}/{method}` with `Authorization: Bearer {api_key}` and a JSON body. Two endpoints live under `/fb/subscriber/` (setCustomField, addTag); two live under `/fb/sending/` (sendFlow, sendContent). All return `{status: "success", ...}` on 2xx and a structured error body on 4xx. The account-wide rate limit is **10 RPS for subscriber endpoints**, well below the single-call-per-action pattern Phase 25 uses.

The existing GHL executor pattern (`src/lib/ghl/create-contact.ts` + `src/lib/ghl/client.ts`) is the canonical reference. Each ManyChat executor will be a ~30-line file: validate inputs, call `manychatFetchJson(...)`, return a single-line success string (no newlines — Vapi parser breaks on `\n`, same constraint as GHL).

**Primary recommendation:** Land the migration + types + bridge sync in Plan 01 (RED test stubs for the 4 endpoints + bridge invariants); land the 4 executors + dispatcher cases + GREEN tests in Plan 02. Mirror Phase 22's TDD cadence exactly. Use the `addTag`/`setCustomField` ID-only variants (not the *ByName variants) — IDs are opaque strings the operator pastes into `tool_config.config`, no name resolution needed.

## Standard Stack

### Core (already in repo — no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.x (App Router) | Runtime for server actions and webhook routes | Verified via repo `package.json`. |
| TypeScript | 5.x (strict) | Type safety, exhaustiveness checks on `action_type` switch | `_exhaustive: never` pattern is locked-in (see `execute-action.ts:46`). |
| Supabase JS | latest in repo | RLS-scoped DB client | Already imported in every dispatcher path. |
| Vitest | ^4.1.2 | Unit + integration tests | Verified in `package.json`. Existing pattern: `vi.stubGlobal('fetch', mockFetch)` per `tests/ghl-executor.test.ts`. |
| AES-256-GCM via `src/lib/crypto.ts` | locked | Encrypted API key reuse | Existing format `iv:ciphertext`. Bridge does NOT re-encrypt. |

**No new npm packages required for Phase 25.** Native `fetch` + `AbortController` are sufficient (already used by GHL client and `testManychatConnection`).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native `fetch` + `AbortController` for ManyChat client | Axios | Adds dep weight, no ergonomic gain. GHL client uses native; we mirror it. |
| `setCustomFieldByName` (lookup by string) | `setCustomField` (ID) | Locked decision: IDs only in Phase 25 (D Discretion). |

**Installation:** None.

**Version verification:** All deps are already pinned in `package.json`. No registry lookup needed.

## Architecture Patterns

### Recommended Project Structure (post-Phase-25)
```
src/
├── lib/
│   ├── manychat/
│   │   ├── client.ts          # NEW — manychatFetch + manychatFetchJson + 5s timeout
│   │   ├── set-field.ts       # NEW — setManychatField executor
│   │   ├── add-tag.ts         # NEW — addManychatTag executor
│   │   ├── trigger-flow.ts    # NEW — triggerManychatFlow executor
│   │   ├── send-message.ts    # NEW — sendManychatMessage executor
│   │   ├── dispatch-event.ts  # UNCHANGED — line 68 already gets credentials from integrations
│   │   └── resolve-rule.ts    # UNCHANGED
│   └── action-engine/
│       └── execute-action.ts  # +4 case arms
├── app/(dashboard)/integrations/manychat/
│   └── actions.ts             # +bridge sync in createManychatChannel
└── types/database.ts           # +manychat_channel_id column on integrations.Row/Insert/Update; +4 enum values
supabase/migrations/
└── 028_manychat_outbound.sql  # NEW — enum extension + FK column + partial unique index + backfill
tests/
└── manychat/
    ├── set-field.test.ts          # NEW
    ├── add-tag.test.ts            # NEW
    ├── trigger-flow.test.ts       # NEW
    ├── send-message.test.ts       # NEW
    ├── client.test.ts             # NEW (timeout + auth header behavior)
    ├── execute-action-manychat.test.ts  # NEW (dispatcher case routing)
    └── channel-actions.test.ts    # EXTEND — bridge invariants on createManychatChannel
```

### Pattern 1: Executor file layout (mirror GHL)
**What:** Each action type → one file → one exported async function with signature `(params: Record<string, unknown>, credentials: { apiKey: string; locationId: string }) => Promise<string>`.
**When to use:** Every Phase 25 executor.
**Example:**
```typescript
// Source: pattern derived from src/lib/ghl/create-contact.ts (lines 1-43)
import { manychatFetchJson, type ManychatCredentials } from './client'

interface AddTagParams {
  subscriber_id?: string | number
  tag_id?: string | number
  [key: string]: unknown
}

export async function addManychatTag(
  params: Record<string, unknown>,
  credentials: ManychatCredentials
): Promise<string> {
  const subscriberId = params.subscriber_id
  const tagId = params.tag_id
  if (!subscriberId) throw new Error('subscriber_id is required for manychat_add_tag')
  if (!tagId) throw new Error('tag_id is required for manychat_add_tag')

  await manychatFetchJson(
    '/fb/subscriber/addTag',
    'POST',
    { subscriber_id: subscriberId, tag_id: tagId },
    credentials
  )
  return `Tag ${tagId} added to subscriber ${subscriberId}.`
}
```

### Pattern 2: Shared low-level fetch wrapper
**What:** `src/lib/manychat/client.ts` exposes `manychatFetch` and `manychatFetchJson<T>` with the 5s `AbortController` already used by `testManychatConnection`.
**When to use:** Every executor goes through this wrapper. Future cleanup: refactor `testManychatConnection` to use it (deferred — see CONTEXT).
**Why:** Single decryption boundary (already in dispatcher); single timeout boundary (here); single auth header construction.
**Example:**
```typescript
// Source: pattern derived from src/lib/ghl/client.ts (lines 1-58) + actions.ts:72-91
const MANYCHAT_BASE_URL = 'https://api.manychat.com'
const TIMEOUT_MS = 5000   // matches testManychatConnection — outbound has 5s budget

export interface ManychatCredentials {
  apiKey: string
  // locationId stays on the credentials shape for compat with GhlCredentials
  // (executors don't read it — but executeAction passes the same object).
  locationId: string
}

export async function manychatFetch(
  path: string,
  method: 'GET' | 'POST',
  body: unknown | null,
  credentials: ManychatCredentials
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${MANYCHAT_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function manychatFetchJson<T>(
  path: string,
  method: 'GET' | 'POST',
  body: unknown | null,
  credentials: ManychatCredentials
): Promise<T> {
  const response = await manychatFetch(path, method, body, credentials)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`ManyChat API error ${response.status}: ${errorText}`)
  }
  return response.json() as Promise<T>
}
```

### Pattern 3: Dispatcher case extension (`execute-action.ts`)
**What:** Add 4 `case` arms to the existing switch. The `_exhaustive: never` check at the bottom enforces that every enum value is handled.
**When to use:** Once per new action_type.
**Example:**
```typescript
// Source: src/lib/action-engine/execute-action.ts pattern
import { setManychatField } from '@/lib/manychat/set-field'
import { addManychatTag } from '@/lib/manychat/add-tag'
import { triggerManychatFlow } from '@/lib/manychat/trigger-flow'
import { sendManychatMessage } from '@/lib/manychat/send-message'

// inside the switch:
case 'manychat_set_field':
  return setManychatField(params, credentials)
case 'manychat_add_tag':
  return addManychatTag(params, credentials)
case 'manychat_trigger_flow':
  return triggerManychatFlow(params, credentials)
case 'manychat_send_message':
  return sendManychatMessage(params, credentials)
```

### Pattern 4: Bridge sync inside server action
**What:** `createManychatChannel` writes both `manychat_channels` and `integrations` in the same server-action call. RLS handles `organization_id` scoping for both inserts.
**When to use:** Every channel CRUD path (create now; rotate/rename later).
**Example:**
```typescript
// Inside src/app/(dashboard)/integrations/manychat/actions.ts createManychatChannel
// AFTER the existing manychat_channels insert succeeds:
const { data: channel } = await supabase
  .from('manychat_channels')
  .insert({ /* existing fields */ })
  .select('id')
  .single()

if (channel) {
  // Bridge row — same encrypted blob, no re-encryption
  await supabase.from('integrations').insert({
    provider: 'manychat',
    name: data.channelName,
    encrypted_api_key: encryptedApiKey,  // already encrypted above
    key_hint: keyHint,
    location_id: null,
    config: {},
    is_active: true,
    manychat_channel_id: channel.id,    // FK link, ON DELETE CASCADE
  })
}
```

### Anti-Patterns to Avoid
- **Don't decrypt inside executors.** `dispatch-event.ts:68` is the only decryption site. Executors receive plaintext `apiKey` via `credentials`.
- **Don't re-encrypt during bridge sync.** The encrypted blob from `manychat_channels` is the same one stored in `integrations`. Re-encryption changes the IV — pointless and slows the action.
- **Don't put `ALTER TYPE … ADD VALUE` inside a transaction or compound migration block.** Phase 22's lesson. Each `ADD VALUE` is a top-level statement; everything else (FK column, index, backfill) goes after.
- **Don't insert ID-by-name lookup helpers.** Locked decision (Discretion): Phase 25 is opaque-IDs-only. The operator pastes `tag_id`/`field_id`/`flow_ns` into `tool_config.config` from the ManyChat dashboard.
- **Don't return multi-line strings from executors.** Vapi parser breaks on `\n` (see `create-contact.ts:41` comment). Single-line success strings only.
- **Don't catch errors in the executor.** Throw on failure; the dispatcher's try/catch in `dispatch-event.ts:79-84` differentiates `AbortError` (timeout) from generic errors and writes the right `action_logs.status`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP timeout | Custom `setTimeout` + `Promise.race` | Native `AbortController` (5s) | Existing pattern in `actions.ts:72-91` and `ghl/client.ts:21`; one-line. |
| API key encryption | New crypto helper | `src/lib/crypto.ts` `encrypt`/`decrypt` | Format is LOCKED (CLAUDE.md sensitive paths). |
| Bridge synchronization via DB trigger | PostgreSQL trigger that copies `manychat_channels` → `integrations` | Application-layer write inside the server action (D-03) | Triggers hide encryption boundary; debugging is harder; locked by user decision. |
| Manual `org_id` filtering on bridge insert | `WHERE org_id = ...` | RLS `WITH CHECK (organization_id = get_current_org_id())` | CLAUDE.md: "never manually filter by org_id". RLS already enforces. |
| Custom error envelope | Wrapping every executor in try/catch | Throw — let dispatcher catch (existing `dispatch-event.ts:67-84`) | Dispatcher already maps errors to `action_logs.status` and `error_detail`. |
| Tool-config UI for outbound | New admin page | Defer to Phase 26 — Rules UI will fold in tool_config CRUD | Out of scope per CONTEXT. |
| Type generation | Hand-write `Database` type from scratch | Edit existing `src/types/database.ts` (manual, per CLAUDE.md) | The repo uses manual edits; see Type Generation § for surgical changes. |

**Key insight:** Almost every primitive Phase 25 needs already exists. The work is **wiring** — bridge schema link, 4 thin executor files, 4 switch arms, and a 1-block addition to `createManychatChannel`. There is no novel infrastructure.

## Runtime State Inventory

> Phase 25 adds new code paths and a schema migration. It does NOT rename, refactor, or delete anything. Most categories are empty by design.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | None — no enum values being removed; no row identifiers being renamed. | None. |
| **Live service config** | The remote Supabase database may have **0 or more existing `manychat_channels` rows** from Phase 22 testing. Each must get a corresponding `integrations` bridge row at migration time. | Migration includes idempotent backfill (`INSERT … SELECT … ON CONFLICT DO NOTHING`). Confirmed via `manychat_channels.UNIQUE(org_id)` + new partial unique index acting together. |
| **OS-registered state** | None — no scheduled jobs, no pm2 processes, no systemd units. | None. |
| **Secrets/env vars** | None — `ENCRYPTION_SECRET` already in use by `src/lib/crypto.ts`; no new env vars introduced. ManyChat API keys are already in `manychat_channels.encrypted_api_key`. | None. |
| **Build artifacts / installed packages** | None — no new npm packages, no compiled artifacts. | None. |

**Special note — pending DB push:** Per the user's `MEMORY.md`, migrations 018/019/020 are written but not pushed to the remote DB (the dev DB is out of sync with the migrations folder). This is a **prerequisite blocker** for Phase 25 testing if any executor test relies on a pushed schema. See Open Questions §3 and Pitfall §6 for the recommended handling (run migrations before Phase 25 tests; do NOT add prerequisite migration tasks to Phase 25 plans).

## Common Pitfalls

### Pitfall 1: `ALTER TYPE … ADD VALUE` inside a transaction
**What goes wrong:** PostgreSQL rejects the statement: `ALTER TYPE ... ADD cannot run inside a transaction block`.
**Why it happens:** Supabase migration files default to wrapping multi-statement files in implicit transactions. `ALTER TYPE` enum extensions cannot participate.
**How to avoid:** Use `ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS '...'` as the **first statement(s)** in `028_manychat_outbound.sql`, before any other DDL — this is the same pattern Phase 22 used in `026_manychat_foundation.sql:17`. Run all 4 `ADD VALUE` statements first, then the FK column / partial index / backfill.
**Warning signs:** Migration push fails with "cannot run inside a transaction block".

### Pitfall 2: Partial unique index conflicts on backfill
**What goes wrong:** Re-running the migration in dev fails because the bridge row already exists.
**Why it happens:** `INSERT INTO integrations …` is not idempotent by default.
**How to avoid:** Use `INSERT … ON CONFLICT (organization_id) WHERE provider='manychat' DO NOTHING` — note that PostgreSQL syntax for partial-index ON CONFLICT requires the predicate to match. Alternative (simpler): `INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM integrations WHERE provider='manychat' AND organization_id = mc.org_id)`. The `WHERE NOT EXISTS` form is more portable across migration replay scenarios.
**Warning signs:** "duplicate key value violates unique constraint" on second migration run.

### Pitfall 3: `subscriber_id` as integer vs string
**What goes wrong:** ManyChat sometimes returns 400 with "subscriber_id cannot be blank" even when present.
**Why it happens:** ManyChat's docs are inconsistent; some sources show integer, others string. Community evidence: when subscribers come from a `{{user.id}}` template variable in External Request body, they arrive as strings. ManyChat accepts both at the API boundary but rejects empty/missing/falsy values.
**How to avoid:** Pass `subscriber_id` through unchanged (do NOT coerce). Validate truthiness only: `if (!subscriberId) throw new Error('subscriber_id is required')`. Do not parse as number.
**Warning signs:** 400 "subscriber_id cannot be blank" or "Subscriber does not exist". Latter is unrecoverable in Phase 25 — it means the operator misconfigured the subscriber ID source. Action_logs will show the error_detail; Phase 26 event-log UI is the diagnostic surface.

### Pitfall 4: `flow_ns` lives in URL, looks weird
**What goes wrong:** Operator pastes a bare flow ID like `12345` instead of the namespace string `content20250616151905_320176`.
**Why it happens:** ManyChat dashboard exposes both. The API requires the **namespace string** (the `content...` prefix), not the numeric ID.
**How to avoid:** Document this in the executor's JSDoc + the eventual Phase 26 Rules UI tooltip. Don't validate the format (might evolve) — just pass through and surface ManyChat's 400 error.
**Warning signs:** 400 "flow_ns is invalid" or "Flow not found".

### Pitfall 5: Rate limit at 10 RPS per account
**What goes wrong:** A bursty inbound webhook flood (e.g. mass campaign reply) triggers many outbound actions in <1s and ManyChat returns 429.
**Why it happens:** The 10 RPS limit is **per-account**, shared across all integrations holding that API key.
**How to avoid:** Phase 25 is single-shot per inbound event (one rule match → one action), so per-event load is ~1 outbound call. The pattern is naturally rate-limited by inbound webhook arrival rate. **Do not add throttling logic in Phase 25.** If 429 appears in `action_logs`, document for Phase 26+ to address.
**Warning signs:** `action_logs.error_detail` containing `429`.

### Pitfall 6: Pending migrations 018/019/020 not pushed
**What goes wrong:** A new Phase 25 migration (`028`) cannot apply against a dev DB still missing 018-020.
**Why it happens:** User's MEMORY.md notes `SUPABASE_DB_PASSWORD` was missing during v1.3 and migrations 018+ were never pushed.
**How to avoid:** **Do NOT add a "verify DB is pushed" task to Phase 25 plans.** That's a personal-environment concern, not a phase artifact. Instead: surface this in the phase-level prerequisite section of `25-01-PLAN.md` ("Before running Plan 01: `npx supabase db push` must succeed; this requires `SUPABASE_DB_PASSWORD`"). The phase verifier (`/gsd:verify-work`) will catch it as a runtime test failure if missed.
**Warning signs:** `npx supabase db push` reports "no migrations to apply" but the DB schema does not include `manychat_channels` (which means 026 was never applied either, which means 018-020 weren't applied either, which means the migration chain is fully behind).

### Pitfall 7: Bridge `is_active` divergence
**What goes wrong:** Admin disables a channel via `manychat_channels.is_active=false` but `integrations.is_active` stays `true` — outbound actions keep firing against a "disabled" channel.
**Why it happens:** Sync is in `createManychatChannel`/`deleteManychatChannel` (D-03), but no toggle action exists yet. The risk is real if Phase 26 adds an enable/disable UI without dual-writing.
**How to avoid:** Phase 25 doesn't ship a toggle UI. Add a comment in `actions.ts` flagging this when the toggle lands. Until then, `is_active=true` for both rows on create — fine.
**Warning signs:** Phase 26 UI lets admin "deactivate" a channel but `tool_configs` keep dispatching.

## Code Examples

Verified patterns from official sources and the existing repo.

### §1 set-field.ts — `manychat_set_field`
```typescript
// Endpoint source: https://manychat.github.io/manychat-api-php/source-class-ManyChat.Structure.Fb.Subscriber.html
// PHP signature: setCustomField(int $subscriber_id, int $field_id, $field_value)
// API path:      POST /fb/subscriber/setCustomField
import { manychatFetchJson, type ManychatCredentials } from './client'

interface SetFieldParams {
  subscriber_id?: string | number
  field_id?: string | number
  field_value?: unknown        // string | number | bool | null | array — ManyChat coerces
  [key: string]: unknown
}

export async function setManychatField(
  params: Record<string, unknown>,
  credentials: ManychatCredentials
): Promise<string> {
  const { subscriber_id: subscriberId, field_id: fieldId, field_value: fieldValue } = params as SetFieldParams
  if (!subscriberId) throw new Error('subscriber_id is required for manychat_set_field')
  if (!fieldId)      throw new Error('field_id is required for manychat_set_field')
  // field_value MAY be empty string / 0 / false — only reject undefined
  if (fieldValue === undefined) throw new Error('field_value is required for manychat_set_field')

  await manychatFetchJson(
    '/fb/subscriber/setCustomField',
    'POST',
    { subscriber_id: subscriberId, field_id: fieldId, field_value: fieldValue },
    credentials
  )
  return `Field ${fieldId} set on subscriber ${subscriberId}.`
}
```

### §2 add-tag.ts — `manychat_add_tag`
```typescript
// API path: POST /fb/subscriber/addTag
// Body:     { subscriber_id, tag_id }
import { manychatFetchJson, type ManychatCredentials } from './client'

interface AddTagParams {
  subscriber_id?: string | number
  tag_id?: string | number
  [key: string]: unknown
}

export async function addManychatTag(
  params: Record<string, unknown>,
  credentials: ManychatCredentials
): Promise<string> {
  const { subscriber_id: subscriberId, tag_id: tagId } = params as AddTagParams
  if (!subscriberId) throw new Error('subscriber_id is required for manychat_add_tag')
  if (!tagId)        throw new Error('tag_id is required for manychat_add_tag')

  await manychatFetchJson(
    '/fb/subscriber/addTag',
    'POST',
    { subscriber_id: subscriberId, tag_id: tagId },
    credentials
  )
  return `Tag ${tagId} added to subscriber ${subscriberId}.`
}
```

### §3 trigger-flow.ts — `manychat_trigger_flow`
```typescript
// API path: POST /fb/sending/sendFlow      (note: /fb/sending/, NOT /fb/subscriber/)
// Body:     { subscriber_id, flow_ns }
// flow_ns is the NAMESPACE STRING (e.g. "content20250616151905_320176"),
// NOT the numeric flow id. Operators get it from the ManyChat dashboard URL.
import { manychatFetchJson, type ManychatCredentials } from './client'

interface TriggerFlowParams {
  subscriber_id?: string | number
  flow_ns?: string
  [key: string]: unknown
}

export async function triggerManychatFlow(
  params: Record<string, unknown>,
  credentials: ManychatCredentials
): Promise<string> {
  const { subscriber_id: subscriberId, flow_ns: flowNs } = params as TriggerFlowParams
  if (!subscriberId) throw new Error('subscriber_id is required for manychat_trigger_flow')
  if (!flowNs)       throw new Error('flow_ns is required for manychat_trigger_flow')

  await manychatFetchJson(
    '/fb/sending/sendFlow',
    'POST',
    { subscriber_id: subscriberId, flow_ns: flowNs },
    credentials
  )
  return `Flow ${flowNs} triggered for subscriber ${subscriberId}.`
}
```

### §4 send-message.ts — `manychat_send_message`
```typescript
// API path: POST /fb/sending/sendContent
// Body:     { subscriber_id, data: { version: "v2", content: { messages: [...] } }, message_tag }
// Dynamic Block schema: https://manychat.github.io/dynamic_block_docs/  (version "v2")
//
// Phase 25 starts with text-only support. The `data` block is whatever the
// operator writes in tool_config.config (or runtime params). We pass it through.
// message_tag is required by Facebook policy for messages outside the 24h window.
// Default: "ACCOUNT_UPDATE" — safe for transactional outbound. Operator can override.
import { manychatFetchJson, type ManychatCredentials } from './client'

interface SendMessageParams {
  subscriber_id?: string | number
  data?: unknown               // dynamic-block v2 object
  message_tag?: string         // FB messaging tag, defaults to ACCOUNT_UPDATE
  text?: string                // convenience: if `data` not provided, build a text-only block
  [key: string]: unknown
}

export async function sendManychatMessage(
  params: Record<string, unknown>,
  credentials: ManychatCredentials
): Promise<string> {
  const p = params as SendMessageParams
  if (!p.subscriber_id) throw new Error('subscriber_id is required for manychat_send_message')

  // Convenience: build a minimal text block if caller passed `text` instead of `data`
  const data =
    p.data ??
    (typeof p.text === 'string'
      ? { version: 'v2', content: { messages: [{ type: 'text', text: p.text }] } }
      : undefined)
  if (!data) throw new Error('data or text is required for manychat_send_message')

  await manychatFetchJson(
    '/fb/sending/sendContent',
    'POST',
    {
      subscriber_id: p.subscriber_id,
      data,
      message_tag: p.message_tag ?? 'ACCOUNT_UPDATE',
    },
    credentials
  )
  return `Message sent to subscriber ${p.subscriber_id}.`
}
```

### §5 Migration 028 — `028_manychat_outbound.sql`
```sql
-- =============================================================================
-- Migration: 028_manychat_outbound
-- Phase: v1.6 ManyChat Integration — Phase 25 Outbound Actions
-- Adds:    4 enum values to public.action_type (set_field, add_tag, trigger_flow, send_message)
--          integrations.manychat_channel_id FK column (ON DELETE CASCADE)
--          partial unique index on integrations(organization_id) WHERE provider='manychat'
--          backfill: one bridge integration row per existing manychat_channels row
-- Note: ALTER TYPE ADD VALUE must run as standalone statements (no tx block).
-- =============================================================================

-- 1. Enum extension (must come first, MUST run outside transaction)
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'manychat_set_field';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'manychat_add_tag';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'manychat_trigger_flow';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'manychat_send_message';

-- 2. FK column linking the bridge row to the canonical channel
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS manychat_channel_id UUID
  REFERENCES public.manychat_channels(id) ON DELETE CASCADE;

-- 3. Partial unique index — one bridge row per org for provider='manychat'
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_manychat_one_per_org
  ON public.integrations (organization_id)
  WHERE provider = 'manychat';

-- 4. Idempotent backfill — one bridge row per existing manychat_channels row.
--    Uses WHERE NOT EXISTS for replay safety (more portable than ON CONFLICT
--    against a partial index, which requires the predicate in the conflict_target).
INSERT INTO public.integrations (
  organization_id,
  provider,
  name,
  encrypted_api_key,
  key_hint,
  location_id,
  config,
  is_active,
  manychat_channel_id
)
SELECT
  mc.org_id,
  'manychat',
  mc.channel_name,
  mc.encrypted_api_key,
  mc.key_hint,
  NULL,
  '{}'::jsonb,
  mc.is_active,
  mc.id
FROM public.manychat_channels mc
WHERE NOT EXISTS (
  SELECT 1
  FROM public.integrations i
  WHERE i.provider = 'manychat'
    AND i.organization_id = mc.org_id
);

-- 5. (Optional, defensive) Index on the FK column for cascade-delete performance.
--    Small table — could skip — but Postgres FK lookups benefit.
CREATE INDEX IF NOT EXISTS idx_integrations_manychat_channel_id
  ON public.integrations (manychat_channel_id)
  WHERE manychat_channel_id IS NOT NULL;
```

### §6 Bridge sync inside `createManychatChannel`
```typescript
// Source: extension to src/app/(dashboard)/integrations/manychat/actions.ts:108-133
export async function createManychatChannel(data: {
  channelName: string
  apiKey: string
}): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const encryptedApiKey = await encrypt(data.apiKey)
  const keyHint = maskApiKey(data.apiKey)
  const webhookSecret = crypto.randomUUID()

  // Insert into manychat_channels FIRST (canonical) — capture the id
  const { data: channel, error: channelErr } = await supabase
    .from('manychat_channels')
    .insert({
      channel_name: data.channelName,
      encrypted_api_key: encryptedApiKey,
      key_hint: keyHint,
      webhook_secret: webhookSecret,
      is_active: true,
      config: {},
    })
    .select('id')
    .single()

  if (channelErr) return { error: channelErr.message }

  // Bridge insert — same encrypted blob, same is_active, FK link
  // RLS WITH CHECK gates organization_id; do NOT pass it manually.
  const { error: bridgeErr } = await supabase.from('integrations').insert({
    provider: 'manychat',
    name: data.channelName,
    encrypted_api_key: encryptedApiKey,   // reuse — never re-encrypt
    key_hint: keyHint,
    location_id: null,
    config: {},
    is_active: true,
    manychat_channel_id: channel.id,
  })

  if (bridgeErr) {
    // Rollback the channel row to keep the two tables consistent
    await supabase.from('manychat_channels').delete().eq('id', channel.id)
    return { error: `Bridge sync failed: ${bridgeErr.message}` }
  }

  revalidatePath('/integrations/manychat')
}
```

### §7 Dispatcher case extension (`execute-action.ts`)
```typescript
// Source: extension to src/lib/action-engine/execute-action.ts
import { setManychatField } from '@/lib/manychat/set-field'
import { addManychatTag } from '@/lib/manychat/add-tag'
import { triggerManychatFlow } from '@/lib/manychat/trigger-flow'
import { sendManychatMessage } from '@/lib/manychat/send-message'

// inside executeAction's switch:
case 'manychat_set_field':
  return setManychatField(params, credentials)
case 'manychat_add_tag':
  return addManychatTag(params, credentials)
case 'manychat_trigger_flow':
  return triggerManychatFlow(params, credentials)
case 'manychat_send_message':
  return sendManychatMessage(params, credentials)
```

### §8 Test pattern — executor unit test (mirror `tests/ghl-executor.test.ts`)
```typescript
// tests/manychat/add-tag.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OUTBOUND-02: addManychatTag executor', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('POSTs to https://api.manychat.com/fb/subscriber/addTag with Bearer auth', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'success' }) })
    const { addManychatTag } = await import('@/lib/manychat/add-tag')
    await addManychatTag(
      { subscriber_id: 'sub-1', tag_id: 'tag-99' },
      { apiKey: 'mc-key', locationId: '' }
    )
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.manychat.com/fb/subscriber/addTag')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer mc-key')
    expect(JSON.parse(init.body as string)).toEqual({ subscriber_id: 'sub-1', tag_id: 'tag-99' })
  })

  it('throws when subscriber_id missing', async () => {
    const { addManychatTag } = await import('@/lib/manychat/add-tag')
    await expect(
      addManychatTag({ tag_id: 'tag-99' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/subscriber_id is required/)
  })

  it('throws on non-2xx ManyChat response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'tag does not exist' })
    const { addManychatTag } = await import('@/lib/manychat/add-tag')
    await expect(
      addManychatTag({ subscriber_id: 's', tag_id: 'bad' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/ManyChat API error 400/)
  })
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled HTTP client per executor | Shared fetch wrapper (`client.ts` module) | Established by GHL refactor (existing) | Phase 25 follows this — single timeout/auth boundary. |
| Decrypt inside the executor | Decrypt at the dispatcher boundary, pass plaintext through `credentials` | Established by Phase 22 (`dispatch-event.ts:67-72`) | Mandatory for Phase 25. |
| Database trigger for cross-table sync | Application-layer sync inside the server action (D-03) | Locked decision in CONTEXT (2026-05-07) | Bridge synchronization lives in `createManychatChannel`. |
| ManyChat name → ID resolution at executor time | Opaque IDs only (D Discretion) | Locked decision in CONTEXT | Operators paste opaque IDs into `tool_config.config`. |

**Deprecated/outdated:** None — Phase 25 doesn't touch deprecated surfaces.

**ManyChat API state:** The `/fb/...` v2 surface has been stable for 4+ years. The dynamic-block schema bumped from v1 to v2 (current). Phase 25 uses v2 throughout.

## Open Questions

1. **Should `testManychatConnection` be refactored to use `src/lib/manychat/client.ts` in Phase 25?**
   - What we know: refactor is "recommended but not required" per CONTEXT (deferred).
   - What's unclear: whether the planner adds a small wave for the refactor.
   - **Recommendation:** Skip the refactor in Phase 25. `testManychatConnection` is one place; risk of regressing the dashboard's "Test Connection" button outweighs the cleanup. Add a TODO comment in `client.ts` pointing at it.

2. **What `message_tag` should `manychat_send_message` default to?**
   - What we know: Facebook requires a message_tag for outbound Messenger messages outside the 24h window. Common safe choices: `ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE`, `CONFIRMED_EVENT_UPDATE`.
   - What's unclear: which fits "operator pushes data back as an action output" semantically.
   - **Recommendation:** Default to `ACCOUNT_UPDATE`. It's the most permissive transactional tag and matches "the bot is sending a system-driven update because user activity triggered it". Operator can override via `params.message_tag` or `tool_config.config.message_tag`. Document both in the executor JSDoc.

3. **Are migrations 018-020 actually pushed in the dev DB?**
   - What we know: MEMORY.md says "migrations 018/019/020 written but not pushed; needs SUPABASE_DB_PASSWORD".
   - What's unclear: whether Phase 22's 026 was somehow pushed despite this (would be surprising — Supabase requires sequential application).
   - **Recommendation:** Phase 25 plans should NOT include a "verify DB pushed" task (it's environment hygiene, not phase work). Instead, add a one-line PRE-REQUISITE to Plan 01: "Run `npx supabase db push` first; if it errors on missing env, set `SUPABASE_DB_PASSWORD` and retry." If the DB is not in sync, the executor unit tests still pass (they mock the DB), but the `vitest run` integration tests will fail at the migration boundary — caught by Plan 01's wave-merge gate.

4. **Should the bridge sync be transactional?**
   - What we know: Supabase JS client doesn't expose multi-statement transactions cleanly; the channel + bridge inserts are 2 separate calls.
   - What's unclear: how to handle partial failure (channel inserted, bridge insert fails — orphan channel row).
   - **Recommendation:** Implement a "compensating delete" pattern (Code Examples §6): if the bridge insert errors, delete the just-created channel row. Costly to test but the right shape. Document in JSDoc.

5. **Should `manychat_send_message` validate the `data` block schema?**
   - What we know: Dynamic Block v2 schema is documented at https://manychat.github.io/dynamic_block_docs/.
   - What's unclear: whether Phase 25 should reject malformed `data` early or let ManyChat's 400 surface through.
   - **Recommendation:** Pass through. Schema validation here would be ~80 lines of zod and would lag the upstream schema. Surface ManyChat's 400 via the existing error-detail path.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (server-side fetch + AbortController) | All executors | ✓ | 20.x (Vercel default) | — |
| Supabase remote project | Migration 028 push + integration tests | ✓ (presumed) | — | Manual SQL apply via Supabase Studio |
| `SUPABASE_DB_PASSWORD` env var | `npx supabase db push` | ⚠ (per MEMORY.md, was missing in v1.3) | — | None — user must set it before pushing |
| `ENCRYPTION_SECRET` env var | `src/lib/crypto.ts` for any decrypt path | ✓ (already in use by Phase 22) | — | — |
| ManyChat API account + valid API token | Manual end-to-end test (UAT) | ⚠ (existing in dev — Phase 22 verified Test Connection works) | — | Skip live UAT; rely on mocked unit tests + read-only canary |

**Missing dependencies with no fallback:**
- `SUPABASE_DB_PASSWORD` for migration push — environment-level, not phase-level. Plan 01 should call out the prerequisite in its preamble.

**Missing dependencies with fallback:**
- ManyChat live API for E2E — manual UAT in `25-HUMAN-UAT.md` is the standard fallback (matches Phase 22's pattern).

## Validation Architecture

> Nyquist validation enabled (`workflow.nyquist_validation: true` in `.planning/config.json`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 |
| Config file | `vitest.config.ts` (project root, environment: node) |
| Quick run command | `npm run build` (catches TS errors after enum widening + new types) |
| Full suite command | `npx vitest run` |
| Estimated runtime | ~30-45 seconds (current baseline ~30s for 151 tests + new 6-8 manychat tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OUTBOUND-01 | `setManychatField` POSTs `/fb/subscriber/setCustomField` with `{subscriber_id, field_id, field_value}` | unit (mocked fetch) | `npx vitest run tests/manychat/set-field.test.ts` | ❌ Wave 0 |
| OUTBOUND-01 | `manychat_set_field` enum value exists in `Database['public']['Enums']['action_type']` | build (TS) | `npm run build` | ✅ via type edit |
| OUTBOUND-01 | `executeAction('manychat_set_field', …)` routes to `setManychatField` | unit | `npx vitest run tests/manychat/execute-action-manychat.test.ts` | ❌ Wave 0 |
| OUTBOUND-02 | `addManychatTag` POSTs `/fb/subscriber/addTag` with `{subscriber_id, tag_id}` | unit | `npx vitest run tests/manychat/add-tag.test.ts` | ❌ Wave 0 |
| OUTBOUND-02 | Action_logs entry created with `status='success'` after successful inbound→outbound chain | integration (in-memory mock supabase) | `npx vitest run tests/manychat/dispatch-event.test.ts` (extend) | ✅ extend |
| OUTBOUND-03 | `triggerManychatFlow` POSTs `/fb/sending/sendFlow` with `{subscriber_id, flow_ns}` | unit | `npx vitest run tests/manychat/trigger-flow.test.ts` | ❌ Wave 0 |
| OUTBOUND-04 | `sendManychatMessage` POSTs `/fb/sending/sendContent` with `{subscriber_id, data, message_tag}` | unit | `npx vitest run tests/manychat/send-message.test.ts` | ❌ Wave 0 |
| OUTBOUND-04 | `text` convenience param builds the v2 dynamic-block | unit | `npx vitest run tests/manychat/send-message.test.ts` | ❌ Wave 0 |
| Bridge invariant | `createManychatChannel` writes both `manychat_channels` and `integrations` rows | unit (extend existing test) | `npx vitest run tests/manychat/channel-actions.test.ts` | ✅ extend |
| Bridge invariant | Bridge insert reuses encrypted blob (same string written twice, no re-encryption) | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | ✅ extend |
| Bridge invariant | Bridge insert failure rolls back channel insert | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | ✅ extend |
| Live API + UAT | All 4 actions deliver to a real ManyChat account | manual | (UAT script in `25-HUMAN-UAT.md`) | manual-only |

### Sampling Rate
- **Per task commit:** `npm run build` (catches enum + type drift in <10s; same baseline as Phase 22)
- **Per wave merge:** `npx vitest run` (full suite; ~30-45s)
- **Phase gate:** `npm run build` green + `npx vitest run` green + manual UAT signed off in `25-HUMAN-UAT.md`

### Wave 0 Gaps
- [ ] `tests/manychat/set-field.test.ts` — covers OUTBOUND-01 (POST body, missing-param errors, 4xx throw)
- [ ] `tests/manychat/add-tag.test.ts` — covers OUTBOUND-02
- [ ] `tests/manychat/trigger-flow.test.ts` — covers OUTBOUND-03
- [ ] `tests/manychat/send-message.test.ts` — covers OUTBOUND-04 (incl. `text` convenience)
- [ ] `tests/manychat/client.test.ts` — covers shared fetch wrapper (5s timeout via AbortController, Bearer header, JSON content-type)
- [ ] `tests/manychat/execute-action-manychat.test.ts` — covers dispatcher routing for all 4 new cases (mirror `tests/action-engine.test.ts`)
- [ ] Extend `tests/manychat/channel-actions.test.ts` — bridge insert assertions on `createManychatChannel` (same row count, encrypted blob equality, FK linkage, rollback path)
- [ ] Extend `tests/manychat/dispatch-event.test.ts` — assert one of the new action_types resolves end-to-end (use `manychat_add_tag` as the canary; mocks `executeAction`'s addManychatTag underneath)
- Framework install: ✅ none — Vitest is already wired and 151-test baseline is green.

## Sources

### Primary (HIGH confidence)
- **ManyChat PHP SDK source — Subscriber class:** https://manychat.github.io/manychat-api-php/source-class-ManyChat.Structure.Fb.Subscriber.html — definitive endpoint paths and parameter names for `setCustomField`, `addTag`, `removeTag`, `getInfo`, `findByCustomField`, etc.
- **ManyChat PHP SDK source — Sending class:** https://manychat.github.io/manychat-api-php/source-class-ManyChat.Structure.Fb.Sending.html — definitive endpoint paths for `sendFlow` (`/fb/sending/sendFlow`), `sendContent` (`/fb/sending/sendContent`), and the `data` parameter shape.
- **ManyChat Dynamic Block schema docs (v2):** https://manychat.github.io/dynamic_block_docs/ — official schema for `sendContent.data`, including text/image/cards/quick_replies and the version field.
- **Repo source — `src/lib/ghl/client.ts`** — canonical fetch wrapper pattern (lines 1-58), 400ms timeout, Bearer auth, error-text-on-non-2xx.
- **Repo source — `src/lib/ghl/create-contact.ts`** — canonical executor file layout (lines 1-43).
- **Repo source — `src/lib/manychat/dispatch-event.ts`** — definitive contract: executors receive plaintext `apiKey`, throw on failure, dispatcher catches + maps to `action_logs` (lines 67-84).
- **Repo source — `src/app/(dashboard)/integrations/manychat/actions.ts`** — existing 5s `AbortController` pattern (lines 72-91) to lift into `client.ts`.
- **Repo source — `supabase/migrations/026_manychat_foundation.sql`** — confirmed pattern for `ALTER TYPE … ADD VALUE IF NOT EXISTS` outside transaction (line 17).
- **Repo source — `supabase/migrations/002_action_engine.sql`** — `integrations` table schema (lines 34-45) and RLS policies (lines 119-138) the bridge row will share.
- **Repo source — `src/types/database.ts:166`, `:214`, `:1092-1093`** — current shape of `integrations.Row`, `tool_configs.action_type`, and the Enums declaration; surgical edit targets identified.
- **Repo source — `tests/ghl-executor.test.ts`** — canonical unit-test pattern (lines 1-194): `vi.stubGlobal('fetch', mockFetch)` + ok/non-ok branches.
- **Repo source — `tests/manychat/dispatch-event.test.ts`** — pattern for asserting new `executeAction` cases (lines 100-117).
- **CLAUDE.md** — webhook always-200 contract, RLS pattern, encryption format lock, migration append-only rule.

### Secondary (MEDIUM confidence)
- **ManyChat community thread on `subscriber_id` validation:** https://community.manychat.com/general-q-a-43/issue-with-sending-messages-via-manychat-api-subscriber-id-cannot-be-blank-error-5351 — confirms subscriber_id accepts both string and integer at the API level; "cannot be blank" arises from empty values, not type mismatch.
- **ManyChat community thread on `flow_ns`:** https://community.manychat.com/general-q-a-43/how-do-i-find-the-flow-ns-value-of-a-specific-flow-6499 — confirms flow_ns is a namespace string starting with `content...`, not a numeric ID.
- **ManyChat rate limit (community + help docs):** https://community.manychat.com/general-q-a-43/api-rate-limit-1206 — 10 RPS per account on subscriber endpoints.
- **ManyChat sendContent button bug thread:** https://community.manychat.com/general-q-a-43/manychat-api-fb-sending-sendcontent-multiple-buttons-5665 — confirms the dynamic-block v2 `data` shape in the wild.
- **ManyChat Help — Token generation:** https://help.manychat.com/hc/en-us/articles/14959510331420-How-to-generate-a-token-for-the-Manychat-API-and-where-to-get-parameters — confirms Bearer-token auth for the public REST API.

### Tertiary (LOW confidence — verify before relying)
- **n8n issue #17472:** https://github.com/n8n-io/n8n/issues/17472 — anecdotal evidence on dynamic-variable validation errors; not a primary source.
- **LeadsBridge ManyChat connector docs:** https://leadsbridge.com/documentation/manychat/http-request-get-post/ — third-party. Useful for cross-checking endpoint paths but not authoritative.

### Could Not Access
- `https://api.manychat.com/swagger` — returned a stripped HTML shell with no endpoint data when fetched. The interactive Swagger UI is JS-rendered; the underlying spec at `swagger.json` 404s. Authoritative paths recovered via the official PHP SDK source instead.
- `https://help.manychat.com/hc/en-us/articles/360038309634-API-and-Webhooks` — 403 on direct fetch (likely Cloudflare bot challenge). Manual browse would work.

## Metadata

**Confidence breakdown:**
- **Standard stack: HIGH** — Stack is repo-internal; verified by reading source.
- **Architecture: HIGH** — Decisions are locked in CONTEXT.md and aligned with existing GHL/dispatcher patterns verified in source.
- **ManyChat API endpoints: HIGH** — Endpoint paths, methods, and required parameters cross-verified between (a) the official ManyChat PHP SDK source and (b) multiple ManyChat community threads. The Swagger UI was inaccessible but the PHP SDK is authoritative.
- **Migration mechanics: HIGH** — Pattern lifted directly from `026_manychat_foundation.sql:17`. Idempotent backfill via `WHERE NOT EXISTS` is portable PostgreSQL.
- **Pitfalls: HIGH** for Pitfalls 1, 2, 6, 7 (verified from repo source + project memory). MEDIUM for Pitfalls 3, 4, 5 (community evidence; reasonable but not exhaustively confirmed).
- **Dynamic-block v2 schema: MEDIUM** — Documented at official GitHub Pages site, but Phase 25 only uses the trivial text shape; complex schemas pass through.

**Research date:** 2026-05-07
**Valid until:** ~2026-06-07 (ManyChat REST API has been stable >4 years; the only real drift risk is a v2→v3 schema bump, which would be announced).
