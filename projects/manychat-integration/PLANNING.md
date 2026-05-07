# ManyChat Integration

> Connect ManyChat flows to Operator's orchestration engine — receive subscriber events as triggers and fire back actions across GHL, Twilio, and any configured integration.

**Created:** 2026-05-06
**Type:** Application
**Stack:** Next.js 15 · TypeScript · Supabase (PostgreSQL) · Tailwind 4 · shadcn/ui · Vercel
**Skill Loadout:** PAUL (required), gsd:ui-phase (frontend phases), AEGIS (post-build audit)
**Quality Gates:** type safety (tsc --noEmit), build pass, RLS coverage on new tables, webhook secret verification

---

## Problem Statement

Operators (agencies) managing ManyChat bots want to connect subscriber events from ManyChat flows into Operator's action engine — creating GHL contacts, triggering Vapi calls, sending SMS, or updating CRM data — without writing custom code per client.

Currently the platform has webhook ingestion for Vapi and Meta but no ManyChat surface. Agencies using ManyChat as their lead qualification layer have no path to route qualified subscribers into downstream systems automatically.

This integration adds ManyChat as a **trigger source**: a ManyChat flow fires an External Request → Operator receives it, resolves the org, matches a routing rule, and executes the configured action. Operator can also call back to ManyChat's API to set subscriber custom fields, add tags, or trigger flows as action outputs.

**For:** Agency admins managing multiple client orgs on the platform.
**Why build vs. buy:** Operator already has the action dispatch engine, encryption, RLS multi-tenancy, and integration primitives. This is an extension, not a new product.

---

## Tech Stack

Same stack as the rest of Operator — no new dependencies required.

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Next.js 15 App Router + shadcn/ui | Consistent with existing dashboard |
| Backend | Next.js Route Handlers (Node.js runtime) | Same runtime as all other webhook receivers |
| Database | Supabase PostgreSQL + RLS | Multi-tenant isolation already in place |
| Encryption | AES-256-GCM via `src/lib/crypto.ts` | API keys encrypted at rest, same as all integrations |
| Deployment | Vercel + Supabase | No infra changes needed |

### Research Needed
- ManyChat API rate limits and pagination for `/fb/page/getFlows` (used in flow selector UI)
- ManyChat External Request retry behavior on non-200 responses

---

## Data Model

### New Tables

**`manychat_channels`** — one connected ManyChat bot per org

| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | UNIQUE — one per org |
| channel_name | TEXT | Human label (e.g. "Main Bot") |
| encrypted_api_key | TEXT | AES-256-GCM, format: `iv:ciphertext` |
| key_hint | TEXT | Masked display (e.g. `••••••••last4`) |
| webhook_secret | TEXT | Random token — admin copies to ManyChat External Request header |
| is_active | BOOLEAN | |
| config | JSONB | Future: payload field mappings, default event_type |
| created_at, updated_at | TIMESTAMPTZ | |

**`manychat_rules`** — event routing rules (ManyChat event → tool_config action)

| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| channel_id | UUID FK → manychat_channels | |
| event_type | TEXT | e.g. `flow_completed`, `tag_added`, `message` |
| condition | JSONB | e.g. `{ "flow_id": "abc123" }` or `{ "tag": "qualified" }` |
| tool_config_id | UUID FK → tool_configs | Action to execute |
| is_active | BOOLEAN | |
| priority | INTEGER | Order when multiple rules match same event |
| created_at | TIMESTAMPTZ | |

**`manychat_events`** — audit log of all inbound webhooks

| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| org_id | UUID FK → organizations | |
| channel_id | UUID FK → manychat_channels | |
| event_type | TEXT | Parsed from payload |
| event_payload | JSONB | Raw inbound body |
| matched_rule_id | UUID FK → manychat_rules | NULL = unmatched |
| status | TEXT | `matched` \| `unmatched` \| `error` |
| action_log_id | UUID FK → action_logs | NULL if no action fired |
| created_at | TIMESTAMPTZ | |

### Schema Notes
- All tables follow existing RLS pattern: `USING (org_id = get_current_org_id())`
- `manychat_events` is append-only — no UPDATE/DELETE policies
- `action_type` enum extended with: `manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message`
- `integration_provider` enum extended with: `manychat`

---

## API Surface

### Webhook Endpoint (inbound from ManyChat)

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/manychat/webhook` | GET | `X-Operator-Secret` header | URL verification (returns challenge) |
| `/api/manychat/webhook` | POST | `X-Operator-Secret` header | Receive External Request from ManyChat flow |

**Security:** Every POST verifies `X-Operator-Secret` against `manychat_channels.webhook_secret` resolved from org. Invalid secret → 403. All other responses → 200 (prevents ManyChat retries on application errors).

**Payload contract** — Operator provides a standard template the admin copies into ManyChat External Request:
```json
{
  "subscriber_id": "{{user.id}}",
  "first_name": "{{user.first_name}}",
  "last_name": "{{user.last_name}}",
  "email": "{{user.email}}",
  "phone": "{{user.phone}}",
  "tags": "{{user.tags}}",
  "event_type": "flow_completed",
  "flow_id": "{{flow_id}}"
}
```

### ManyChat REST API (outbound — Operator → ManyChat)

| Endpoint | Purpose |
|----------|---------|
| `GET /fb/page/getFlows` | List flows for selector UI |
| `POST /fb/sending/sendContent` | Send message to subscriber |
| `POST /fb/subscriber/setCustomFieldByName` | Set custom field value |
| `POST /fb/subscriber/addTagByName` | Add tag to subscriber |
| `POST /fb/sending/sendFlow` | Trigger an existing flow |

Auth: `Authorization: Bearer {decrypted_api_key}`

### Dashboard Server Actions

```
createManychatChannel()     — save API key (encrypted) + generate webhook_secret
updateManychatChannel()     — update config
deleteManychatChannel()
createManychatRule()        — create event routing rule
updateManychatRule()
deleteManychatRule()
getManychatEvents()         — list events with status/date filters
getManychatFlows()          — proxy call to ManyChat API for flow selector
```

### Internal vs External
- **Public (no user auth):** `/api/manychat/webhook` — verified via `X-Operator-Secret` header
- **Dashboard (org-scoped):** all server actions via authenticated Supabase session + RLS

---

## Deployment Strategy

### Local Development
No new services needed. Add to `.env.local`:
```
# No new env vars required — API key encrypted per org in DB
```

### Production
- Same Vercel deployment — new webhook route auto-deployed
- New migrations pushed via `npx supabase db push`
- Webhook URL to give admins: `https://operator.skale.club/api/manychat/webhook`

---

## Security Considerations

- **Webhook auth:** No HMAC signing from ManyChat — verified via shared secret in `X-Operator-Secret` header. Secret is generated randomly per org (crypto.randomUUID or similar), stored plaintext in `manychat_channels.webhook_secret` (not the API key — this is the inbound verification token).
- **API key storage:** Encrypted at rest via existing `src/lib/crypto.ts` (AES-256-GCM). Never returned to UI.
- **Tenant isolation:** `webhook_secret` must be looked up by matching against `manychat_channels` — never trust `org_id` from request body.
- **Inbound payload:** All fields validated/sanitized before use in action dispatch. JSONB stored as-is for logging.
- **Rate limiting:** ManyChat retries on non-200 — always return 200 after secret validation to prevent flood.
- **Outbound API calls:** API key decrypted only at execution time via service-role client.

---

## UI/UX Needs

### Design System
Tailwind 4 + shadcn/ui — consistent with existing dashboard. No new primitives needed.

### Key Views

| View | Path | Purpose | Complexity |
|------|------|---------|------------|
| ManyChat Setup | `/integrations/manychat` | Connect API key, display webhook URL + secret to copy | Medium |
| Rules Manager | `/integrations/manychat/rules` | Create/edit/delete routing rules with flow selector | High |
| Event Log | `/integrations/manychat/events` | Browse inbound events, filter by status/date | Medium |

### Setup Page Details
- API key input + test connection button (calls `GET /fb/page/getFlows` to verify)
- Generated webhook URL (copyable): `https://operator.skale.club/api/manychat/webhook`
- Generated secret (copyable): random token the admin pastes into ManyChat External Request headers
- Payload template (copyable): JSON block admin pastes into ManyChat External Request body config
- Active/inactive toggle

### Rules Manager Details
- Event type selector (text input + suggestions: `flow_completed`, `tag_added`, `message`)
- Condition builder: key/value pairs mapping to `condition` JSONB (e.g. `flow_id = abc123`)
- Flow selector dropdown: fetches from ManyChat API via `getManychatFlows()` — shows flow names
- Action selector: existing `tool_configs` for the org
- Priority ordering

### Responsive Needs
Desktop-first — admin panel, not consumer-facing.

---

## Integration Points

| Integration | Direction | Purpose | Auth |
|------------|-----------|---------|------|
| ManyChat External Request | Inbound | Subscriber events from flows | `X-Operator-Secret` header |
| ManyChat REST API | Outbound | Send messages, set fields, add tags, trigger flows | Bearer token (encrypted per org) |
| Operator Action Engine | Internal | Dispatch existing actions (GHL, Twilio, etc.) on rule match | Service role |
| `tool_configs` table | Internal | Bind routing rules to existing configured actions | RLS |

---

## Phase Breakdown

### Phase 1: Foundation
- **Build:** Migration for `manychat_channels` + `manychat_events` tables. Add `manychat` to `integration_provider` enum. `/api/manychat/webhook` route with `X-Operator-Secret` verification + raw event logging. Server actions for channel CRUD.
- **Testable:** POST to webhook with valid/invalid secret. Verify events appear in `manychat_events`. Test encryption of API key on save.
- **Outcome:** Admin can register a ManyChat channel. All inbound webhooks are logged. Invalid secrets are rejected.

### Phase 2: Inbound Routing
- **Build:** Migration for `manychat_rules` table. Payload parser (extracts `event_type`, `flow_id`, `tag`, subscriber fields). Rule matcher (event_type + condition JSONB). Dispatch to existing action engine on match. `matched` / `unmatched` status written to `manychat_events`.
- **Testable:** Configure a rule "flow_completed + flow_id=X → create_contact". Fire webhook with matching payload. Verify GHL contact created and event logged as `matched`. Fire non-matching payload — verify `unmatched` log.
- **Outcome:** A ManyChat flow can trigger a GHL action via Operator.

### Phase 3: Dashboard Config UI
- **Build:** `/integrations/manychat` setup page (API key form, webhook URL + secret display, payload template). Integration listed on `/integrations` page. `getManychatFlows()` proxy action. ManyChat channel appears in integrations list.
- **Testable:** Admin can connect ManyChat, copy webhook URL and secret, see test connection result.
- **Outcome:** Admin has a full setup flow without touching the database directly.

### Phase 4: Outbound Actions
- **Build:** New `action_type` enum values: `manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message`. `src/lib/manychat/` client module. Executors registered in action dispatch engine.
- **Testable:** Configure a tool_config with `manychat_add_tag`. Trigger it. Verify tag appears on subscriber in ManyChat.
- **Outcome:** Operator can push data back to ManyChat as an action output.

### Phase 5: Rules UI + Event Log
- **Build:** `/integrations/manychat/rules` full CRUD UI with flow selector dropdown + condition builder. `/integrations/manychat/events` log page with status/event_type/date filters + pagination.
- **Testable:** Create, edit, reorder, and delete rules from the UI. Browse event log and filter by `unmatched`.
- **Outcome:** Admin has full observability and self-serve rule management without writing SQL.

---

## Skill Loadout & Quality Gates

### Skills Used During Build

| Skill | When It Fires | Purpose |
|-------|--------------|---------|
| PAUL | Full build | Milestone and phase management |
| gsd:ui-phase | Phases 3 + 5 | UI design contract before frontend implementation |
| AEGIS | Post-build | Security audit — webhook auth, RLS coverage, encryption |

### Quality Gates

| Gate | Threshold | When |
|------|-----------|------|
| TypeScript build | Zero errors (`npm run build`) | Every phase |
| RLS coverage | All new tables have policies | Phase 1 |
| Webhook secret verification | 403 on invalid secret, 200 on valid | Phase 1 |
| Rule match accuracy | Correct action fires for matching payload | Phase 2 |
| Encrypted key never exposed | Key hint only in UI responses | Phase 3 |

---

## Design Decisions

1. **No HMAC signing on inbound webhook:** ManyChat External Request does not support HMAC signing — using shared secret header (`X-Operator-Secret`) instead. Admin configures this header in ManyChat's External Request setup.
2. **Standardized payload template:** ManyChat doesn't enforce a schema — Operator provides a copyable JSON template that the admin pastes into the External Request body config. This ensures predictable field names.
3. **One ManyChat account per org:** `UNIQUE(org_id)` on `manychat_channels`. Relaxable in a future migration if multi-bot per org is needed.
4. **Always-200 on valid webhook:** After secret verification passes, all responses are HTTP 200 — prevents ManyChat from retrying on application errors.
5. **Flows created manually in ManyChat:** ManyChat API does not support programmatic flow creation or editing. Admins create their flows in ManyChat's UI and add the External Request step. Operator's `getFlows` API call is used only to populate the flow selector dropdown in the rules UI.
6. **Event log is append-only:** `manychat_events` has no UPDATE/DELETE policies — full audit trail preserved.

---

## Open Questions

1. Does ManyChat's `getFlows` endpoint paginate? Need to confirm limit before building the flow selector.
2. ManyChat External Request retry behavior on non-200 — confirm whether a 403 triggers retries (should not, but verify).
3. Are there ManyChat API rate limits that affect the flow selector polling frequency?

---

## Next Actions

- [ ] Run `/gsd:plan-phase` for Phase 1 (Foundation) — migrations + webhook endpoint
- [ ] Verify ManyChat API token format from a real account before Phase 4 executor implementation
- [ ] Confirm `getFlows` pagination behavior before Phase 5 flow selector build

---

## References

- [ManyChat Swagger API](https://api.manychat.com/swagger)
- [Dev Tools: External Request](https://help.manychat.com/hc/en-us/articles/14281285374364-Dev-Tools-External-request)
- Existing Meta webhook pattern: `src/app/api/meta/webhook/route.ts`
- Existing integrations pattern: `src/app/(dashboard)/integrations/`
- Encryption: `src/lib/crypto.ts`

---

*Last updated: 2026-05-06*
