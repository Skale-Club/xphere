# Phase 25: Outbound Actions - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 25-outbound-actions
**Areas discussed:** Credentials source

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Credentials source | Where outbound executors fetch the ManyChat API key from. The crux of Phase 25's architecture. | ✓ |
| Subscriber ID source | How the executor knows which ManyChat subscriber to act on (payload, params, or both). | |
| Static config vs runtime params | For each action, whether target data lives in tool_configs.config or runtime params. | |
| ManyChat ID resolution | Whether config stores names, opaque IDs, or both. | |

**User's choice:** Credentials source only.
**Notes:** Other gray areas defer to Claude's discretion (defaults captured in CONTEXT.md).

---

## Credentials source — Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| A. Bridge | Mirror creds into `integrations` table on channel create; tool_configs binds to integrations like every other provider. dispatch-event.ts unchanged. | ✓ |
| B. Special-case in dispatcher | Make `tool_configs.integration_id` nullable + add `credentials_source` discriminator; dispatcher branches on `manychat_*` action_types. | |
| C. Full migrate channels → integrations | Move `manychat_channels` rows into `integrations`; drop or view-ify channels. Larger migration. | |
| D. Defer | Let the planner present a more detailed comparison later. | |

**User's choice:** A. Bridge.
**Notes:** Existing dispatcher already assumes credentials live in `integrations`; bridge is the smallest change consistent with Phase 22's design.

---

## Credentials source — Canonical table

| Option | Description | Selected |
|--------|-------------|----------|
| `manychat_channels` | Channel stays source of truth; `integrations` row is a read-only mirror. Phase 22 dashboard code unchanged. | ✓ |
| `integrations` | Migrate canonical encrypted_api_key to `integrations`; channel keeps webhook_secret/key_hint only. More invasive. | |
| Both — idempotent two-way sync | Treat as paired; any update upserts the other. Safer for hand-edits, more code. | |

**User's choice:** `manychat_channels` (canonical).
**Notes:** Preserves Phase 22's design intent. Mirror direction is one-way: channel → integration.

---

## Credentials source — Sync trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Inside server actions | `createManychatChannel` / `deleteManychatChannel` upsert / delete the integrations row in the same transaction. | ✓ |
| Database trigger | PG `AFTER INSERT/UPDATE/DELETE` trigger on `manychat_channels` keeps `integrations` in lockstep automatically. | |
| Migration backfill + server-action sync | Migration backfills existing rows; ongoing sync in server actions. | |

**User's choice:** Inside server actions.
**Notes:** Single application-layer location; encryption stays where it belongs; easy to test. (Migration backfill is also added — see "Migration handles existing data" below — so this is effectively a hybrid with backfill at migration time and ongoing sync in server actions.)

---

## Credentials source — Schema link

| Option | Description | Selected |
|--------|-------------|----------|
| `integrations.manychat_channel_id` FK | Nullable FK on integrations side; CASCADE on channel delete. | ✓ |
| `manychat_channels.integration_id` FK | FK on channel side; weirder ownership semantics, no clean cascade. | |
| No FK — implicit join on `(org_id, provider='manychat')` | UNIQUE(org_id) on channels means the implicit join works. Less explicit. | |

**User's choice:** `integrations.manychat_channel_id` FK with `ON DELETE CASCADE`.
**Notes:** Explicit ownership; cascade cleans up bridge row when channel is deleted. Partial unique index `(organization_id) WHERE provider = 'manychat'` enforces one bridge row per org.

---

## Credentials source — Migration backfill

| Option | Description | Selected |
|--------|-------------|----------|
| Backfill in migration | INSERT…SELECT to create one bridge integration row per existing channel. Idempotent via partial unique index. | ✓ |
| Skip backfill — reconnect to populate | Migration only adds schema; existing channels need delete-and-readd to populate. | |
| Backfill + validation step | Backfill, then ASSERT every active channel has a matching integration. Migration fails loudly on mismatch. | |

**User's choice:** Backfill in migration.
**Notes:** Phase 22 already created channels in dev; backfill keeps them working. Idempotent with `ON CONFLICT DO NOTHING`.

---

## Credentials source — is_active sync

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror both | Server actions update both rows together. Disabling a channel disables outbound. | ✓ |
| Independent | Channel disable does NOT affect bridge integration; admin manages each separately. | |
| Channel-controlled with a config flag | Default to mirroring, optional `bridge_active` override in `manychat_channels.config`. | |

**User's choice:** Mirror both.
**Notes:** Single source of truth for "this org's ManyChat is on/off"; resolveTool already requires `is_active=true`.

---

## Credentials source — Bridge row name

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror `channel.channel_name` | Bridge row carries the user's chosen channel name. | ✓ |
| Fixed string `'ManyChat'` | All bridge rows have the same name. Simpler but loses the user's label. | |
| Channel name + suffix `(bridge)` | e.g. 'My ManyChat (bridge)' to flag it as auto-managed in any future integrations list view. | |

**User's choice:** Mirror `channel.channel_name`.
**Notes:** Consistent with how the channel is referenced in the dashboard; channel rename (when added) updates both rows.

---

## Credentials source — Continue or wrap

| Option | Description | Selected |
|--------|-------------|----------|
| Ready for CONTEXT.md | Write up decisions and hand off to /gsd:plan-phase. | ✓ |
| One more credentials question | Continue probing credentials. | |
| Open up more gray areas | Discuss subscriber-ID source / static-vs-runtime / name resolution. | |

**User's choice:** Ready for CONTEXT.md.
**Notes:** Other gray areas captured as "Claude's Discretion" with documented defaults in CONTEXT.md.

---

## Claude's Discretion

User opted to let Claude choose for these (defaults documented in CONTEXT.md):

- **Subscriber ID source** — Default: read `subscriber_id` from runtime params, fall back to `payload.subscriber_id`.
- **Static config vs runtime params** — Default: support both; `config` provides defaults, runtime `params` override.
- **ManyChat ID resolution** — Default: opaque IDs only in Phase 25 (no name resolution).
- **Error semantics + retry** — Default: single attempt, 5s timeout, log error + return fallback_message; no retry.

## Deferred Ideas

- Subscriber-ID/static-vs-runtime/name-resolution refinements (revisit if Phase 26 Rules UI needs different ergonomics).
- Webhook secret rotation flow (out of scope for Phase 25).
- Multi-channel-per-org (today UNIQUE(org_id) on both sides).
- Refactor `testManychatConnection` to use the new `src/lib/manychat/client.ts`.
- Archive v1.6 REQUIREMENTS.md to `.planning/milestones/v1.6-REQUIREMENTS.md` (current REQUIREMENTS.md was overwritten when v1.7 started).
