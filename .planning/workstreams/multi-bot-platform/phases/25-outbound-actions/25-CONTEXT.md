# Phase 25: Outbound Actions - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Add 4 outbound ManyChat action types to the existing action engine so operators can configure tool_configs that push data back to ManyChat as action outputs:

1. `manychat_set_field` — set a subscriber custom field via ManyChat API
2. `manychat_add_tag` — add a tag to a subscriber via ManyChat API
3. `manychat_trigger_flow` — trigger an existing ManyChat flow for a subscriber
4. `manychat_send_message` — send a message to a subscriber via ManyChat API

These executors are invoked from the existing dispatcher in `src/lib/manychat/dispatch-event.ts` (inbound webhook → rule match → action) and via any future caller using `executeAction(...)`.

**In scope:** action_type enum extension, bridge between `manychat_channels` and `integrations` for credentials, executor implementations, action_logs entries, migration with backfill.

**Out of scope:** Routing rules UI (Phase 26), event log UI (Phase 26), name → ID resolution helpers in dashboard (deferred — see Deferred Ideas).

</domain>

<decisions>
## Implementation Decisions

### Credentials Bridge (the core architectural decision)

- **D-01:** Strategy is **A. Bridge** — outbound executors fetch the ManyChat API key through the existing `tool_configs.integration_id → integrations.encrypted_api_key` join. No special-casing in `dispatch-event.ts`, no full migration of `manychat_channels`. Reason: the dispatcher already assumes credentials live in `integrations`; mirroring is the smallest change that preserves Phase 22's design.

- **D-02:** **`manychat_channels` is canonical.** The bridge `integrations` row is a read-only mirror maintained by the server actions. Phase 22's dashboard code (`createManychatChannel`, `testManychatConnection`, `deleteManychatChannel`) keeps reading/writing the channel row directly.

- **D-03:** **Sync lives in the server actions** (`src/app/(dashboard)/integrations/manychat/actions.ts`). On `createManychatChannel`, also `INSERT` into `integrations`. On `deleteManychatChannel`, the `ON DELETE CASCADE` from the FK takes care of the integration row. On any future API key rotation flow, the server action updates both rows. Reason: single, debuggable application-layer location; encryption stays where it belongs.

- **D-04:** **Schema link: `integrations.manychat_channel_id UUID REFERENCES manychat_channels(id) ON DELETE CASCADE`** (nullable; only set for `provider='manychat'` rows). Cascade delete keeps the bridge row from outliving its channel. Add a partial unique index `(organization_id) WHERE provider = 'manychat'` to enforce one bridge row per org.

- **D-05:** **Migration backfills** — for any existing `manychat_channels` rows from Phase 22 testing, the migration runs `INSERT INTO integrations (...) SELECT ... FROM manychat_channels` after the FK column is added, idempotent via the partial unique index above.

- **D-06:** **`is_active` is mirrored.** Server actions write the same `is_active` value to both rows. Disabling a ManyChat channel automatically disables outbound actions because `resolveTool`/`resolveToolById` require `is_active=true` on `integrations`. Single source of truth for "this org's ManyChat is on/off."

- **D-07:** **`integrations.name` mirrors `manychat_channels.channel_name`.** If the admin named the channel "My ManyChat", the bridge row carries the same name. Future channel-rename flows must update both rows (no rename UI today, so this is a "when we add it" note).

- **D-08:** **`integrations.location_id = NULL`, `integrations.config = '{}'`** for the bridge row. ManyChat has no per-location concept, and channel-specific data (`webhook_secret`, `key_hint`) intentionally stays in `manychat_channels`.

### action_type Enum + Executors

- **D-09:** Migration extends `public.action_type` with 4 new values: `manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message`. Per Phase 22's lesson, `ALTER TYPE ... ADD VALUE` runs as a **standalone statement** (PostgreSQL forbids ALTER TYPE inside a transaction).

- **D-10:** Executor file layout follows the GHL pattern: one file per action type under `src/lib/manychat/`:
  - `set-field.ts` exports `setManychatField(params, credentials)`
  - `add-tag.ts` exports `addManychatTag(params, credentials)`
  - `trigger-flow.ts` exports `triggerManychatFlow(params, credentials)`
  - `send-message.ts` exports `sendManychatMessage(params, credentials)`
  - `client.ts` (new) — low-level fetch wrapper with 5s `AbortController` timeout, shared with `testManychatConnection` (refactor opportunity, not required).

- **D-11:** `executeAction` in `src/lib/action-engine/execute-action.ts` adds 4 new `case` branches that call the executors above. Credentials shape stays compatible with the existing `GhlCredentials` interface (`apiKey: string` is what executors actually need; `locationId` is unused for ManyChat).

### Claude's Discretion

The user opted not to discuss these — the planner picks reasonable defaults and flags them in `25-PLAN.md` for review:

- **Subscriber ID source** — How the executor knows which subscriber to act on. Default: read `subscriber_id` from runtime params, fall back to `payload.subscriber_id` if not provided. Works for both inbound-webhook chains and external callers (Vapi, future).
- **Static config vs runtime params** — How tool_config.config carries action-specific data (tag name, field id, flow_ns, message body). Default: support both — `config` provides defaults, runtime `params` override. Single tool_config can serve multiple uses.
- **ManyChat ID resolution** — Whether the executor accepts names ("vip") or opaque IDs (`tag_id`). Default: accept IDs only in Phase 25 (no name resolution); Phase 26's Rules UI may add a name-resolution helper later.
- **Error semantics + retry** — Default: single attempt, 5s timeout, on failure write `status='error'` to `action_logs` with `error_detail`, return `tool.fallback_message` to caller. No retry logic in Phase 25 (parity with existing GHL executors).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 25 spec
- `.planning/ROADMAP.md` § "Phase 25: Outbound Actions" — goal, depends_on, requirements list, success criteria
- Git `7e43a45:.planning/REQUIREMENTS.md` § OUTBOUND-01..04 — original v1.6 requirements (current REQUIREMENTS.md was overwritten when v1.7 started; archive to `.planning/milestones/v1.6-REQUIREMENTS.md` is recommended)

### Existing code that must be respected / extended
- `src/lib/action-engine/execute-action.ts` — dispatcher pattern, exhaustiveness check, `ActionContext` shape
- `src/lib/action-engine/resolve-tool.ts` — `ToolConfigWithIntegration` type, `!inner` join contract
- `src/lib/action-engine/resolve-tool-by-id.ts` — sibling resolver used by ManyChat dispatcher
- `src/lib/manychat/dispatch-event.ts` — inbound dispatcher; line 68 (`decrypt(tool.integrations.encrypted_api_key)`) is the call site that the bridge has to satisfy unchanged
- `src/app/(dashboard)/integrations/manychat/actions.ts` — `createManychatChannel`, `testManychatConnection`, `deleteManychatChannel`; this is where the bridge sync lives
- `src/app/(dashboard)/integrations/manychat/constants.ts` — `MANYCHAT_PAYLOAD_TEMPLATE` defines the `subscriber_id` shape that flows through inbound payloads
- `src/lib/ghl/create-contact.ts` (and siblings) — reference for executor file layout and signature convention
- `src/lib/crypto.ts` — `encrypt` / `decrypt` / `maskApiKey`; format is locked (`iv:ciphertext` base64), do not change

### Schema
- `supabase/migrations/002_action_engine.sql` lines 34-87 — `integrations` and `tool_configs` table definitions; FK is `integration_id NOT NULL REFERENCES integrations(id) ON DELETE RESTRICT`
- `supabase/migrations/026_manychat_foundation.sql` — `manychat_channels` table, encryption columns, `'manychat'` enum value
- `supabase/migrations/027_manychat_rules.sql` — `manychat_rules.tool_config_id` FK that connects rules to outbound actions

### Project-level
- `CLAUDE.md` — runtime split (Node.js for webhooks, Deno for edge functions), webhook always-200 contract, RLS via `get_current_org_id()`
- `.planning/codebase/CONVENTIONS.md` — TDD pattern (RED → GREEN), file-per-action layout, module boundaries

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`encrypt` / `decrypt` from `src/lib/crypto.ts`** — Already used by Phase 22 channel creation; bridge sync reuses it (no re-encryption needed when copying the blob).
- **`AbortController` 5s timeout pattern** — Demonstrated in [actions.ts:72](src/app/(dashboard)/integrations/manychat/actions.ts:72) for `testManychatConnection`. Extract into `src/lib/manychat/client.ts` so all 4 outbound executors plus `testManychatConnection` share one fetch wrapper.
- **`executeAction` switch dispatcher** — Add 4 `case` arms; executors return `string` (success message or fallback), keeping the existing contract intact.
- **`resolveToolById` + `tool.integrations!inner(*)` join** — Works as-is once the bridge integration row exists. No dispatcher changes required for the credentials path.
- **`action_logs` insert pattern** in `dispatch-event.ts:88-102` — Captures `request_payload`, `response_payload`, `execution_ms`, `status`, `error_detail`, `vapi_call_id='manychat:{event_id}'`. Outbound executors run inside this same wrapper, so logging is automatic for inbound-triggered chains.

### Established Patterns

- **Dispatcher decrypts at the boundary** — `dispatch-event.ts:68` is the only place that touches the encrypted blob; executors receive `apiKey: string`. Phase 25 must not move decryption into the executors.
- **Executors throw on failure, dispatcher catches** — `dispatch-event.ts:79-84` differentiates `AbortError` (timeout) from generic errors. Outbound executors follow the same convention.
- **TDD at the migration boundary** — Phase 22 wrote 11 RED test stubs in Plan 01, made them GREEN in Plan 02. Phase 25 should land migration + types in Plan 01 (RED tests for the bridge), executors in Plan 02 (GREEN).
- **action_type enum migrations are standalone** — `ALTER TYPE ... ADD VALUE` cannot run inside a transaction; Phase 22 already learned this. Migration files split it into a top-level statement before any other DDL.

### Integration Points

- **`tool_configs` row creation for ManyChat outbound** — Admin (or future Phase 26 Rules UI) inserts a tool_config with `integration_id` pointing at the bridge row, `action_type` = one of the 4 new enum values, `config` carrying any static defaults.
- **`/api/manychat/webhook` → `dispatchManychatEvent` → `executeAction`** — Inbound chain that lights up automatically once Phase 25 ships, because the dispatcher just passes `tool.action_type` to `executeAction` (already exhaustive-checked at the type layer).
- **Future Vapi → ManyChat outbound** — Same `executeAction(...)` call site can fire from a Vapi tool call. No phase-25-specific scaffolding needed; just register a tool_name in `tool_configs` for the org.

</code_context>

<specifics>
## Specific Ideas

- **Bridge row identity:** one bridge `integrations` row per ManyChat channel, enforced by partial unique index `(organization_id) WHERE provider = 'manychat'`. Cascade delete from `manychat_channels(id)`.
- **`integrations.name` rule:** mirrors `manychat_channels.channel_name`. Channel rename UI doesn't exist yet — when it lands, that flow updates both rows.
- **`integrations.config` for the bridge:** empty `{}`. Channel-specific data (`webhook_secret`, `key_hint`) stays in `manychat_channels`. The integrations row carries credentials only.
- **Migration backfill:** idempotent `INSERT INTO integrations ... ON CONFLICT DO NOTHING` against the partial unique index. Safe to re-run if the migration is replayed in dev.

</specifics>

<deferred>
## Deferred Ideas

- **Subscriber-ID source / runtime params / static config / name resolution** — User opted to defer to Claude's discretion (defaults documented above); revisit if Phase 26's Rules UI needs different ergonomics.
- **Webhook secret rotation flow** — Out of scope for Phase 25; when added, must rotate both `manychat_channels.webhook_secret` (used by `/api/manychat/webhook`) and any UI display, but does NOT touch `integrations.encrypted_api_key`.
- **Multi-channel-per-org** — Today `manychat_channels` has `UNIQUE(org_id)`. The partial unique index on the bridge integrations row enforces 1:1 too. If multi-channel ever lands, both constraints relax together.
- **Refactor `testManychatConnection` to use `src/lib/manychat/client.ts`** — Recommended cleanup once Phase 25's `client.ts` exists; not strictly required to land outbound actions.
- **v1.6 REQUIREMENTS.md archive** — Current `.planning/REQUIREMENTS.md` was overwritten when v1.7 started. Archive the v1.6 spec to `.planning/milestones/v1.6-REQUIREMENTS.md` (content available in git `7e43a45`). Pure hygiene.

### Reviewed Todos (not folded)

None — `gsd-tools todo match-phase 25` returned no matches.

</deferred>

---

*Phase: 25-outbound-actions*
*Context gathered: 2026-05-07*
