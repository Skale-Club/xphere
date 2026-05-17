# Phase 25: Outbound Actions — Human UAT

**Status:** Pending (Phase 25 code complete; awaiting user sign-off)
**Required before:** `/gsd:verify-work 25` can mark Phase 25 closed
**Estimated time:** ~30-45 minutes (assuming a test ManyChat account is already provisioned)

> Unit tests confirm the EXECUTOR sends the right HTTP request. This UAT confirms ManyChat ACTUALLY APPLIED the change to a real subscriber. Both layers required for Phase 25 sign-off.

<!-- ─────────── -->

## Pre-Flight Checklist

Before running any of the 4 test scripts below, confirm ALL of the following:

- [ ] **Migration 028 pushed:** `npx supabase db push` succeeded against the dev DB. Verify with: `psql $DATABASE_URL -c "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.action_type'::regtype ORDER BY enumsortorder;"` returns 10 rows including `manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message`. *(If 018-020 are missing, see MEMORY.md note — push them first.)*
- [ ] **Bridge backfill verified:** `SELECT COUNT(*) FROM manychat_channels;` and `SELECT COUNT(*) FROM integrations WHERE provider='manychat';` return the SAME number. *(See "Migration Sanity Check" below for full procedure.)*
- [ ] **Test ManyChat account ready:**
  - [ ] You have a ManyChat account in Sandbox or Live mode
  - [ ] You have the API key from ManyChat Settings → API → "Your API Token"
  - [ ] You have at least one test subscriber (you yourself, ideally — DM-test from your own Facebook/Instagram account)
  - [ ] You know the test subscriber's `subscriber_id`
- [ ] **Operator dashboard ready:**
  - [ ] You're logged into Operator at https://operator.skale.club (or local dev)
  - [ ] A ManyChat channel is configured at /integrations/manychat (Phase 22 deliverable)
  - [ ] The "Test Connection" button on /integrations/manychat shows green ✓
- [ ] **Test ManyChat assets created:**
  - [ ] One **custom field** named e.g. `operator_test_field` (note its `field_id`)
  - [ ] One **tag** named e.g. `operator-test-tag` (note its `tag_id`)
  - [ ] One **flow** with a single text-message step "Hello from Operator UAT" (note its `flow_ns` — the namespace string starting with `content...`, NOT the numeric ID)
- [ ] **`tool_configs` rows for each test:** insert 4 tool_config rows pointing at the bridge integration. Use the SQL templates in each section below.

<!-- ─────────── -->

## Migration Sanity Check (do this once, before the 4 scripts)

1. Before pushing migration 028: `SELECT COUNT(*) FROM manychat_channels;` → record as `N_BEFORE`.
2. Push: `npx supabase db push` → confirm "applied 028_manychat_outbound.sql" in output.
3. Immediately after: `SELECT COUNT(*) FROM integrations WHERE provider='manychat';` → record as `N_AFTER`.
4. Assert: **`N_AFTER === N_BEFORE`** (one bridge row per channel — backfill correct).
5. Idempotency: re-run the backfill SQL fragment from `028_manychat_outbound.sql`. Bridge count UNCHANGED. ✓ idempotent.
6. Cascade-delete proof (DEV ONLY — skip on production): pick a throwaway test channel, run `DELETE FROM manychat_channels WHERE id = '<test-channel-id>';`, then `SELECT COUNT(*) FROM integrations WHERE manychat_channel_id = '<test-channel-id>';` returns 0 (FK CASCADE wiped the bridge row).

- [ ] Migration sanity check complete + signed: ____________

<!-- ─────────── -->

## OUTBOUND-01 — `manychat_set_field`

### Setup

```sql
INSERT INTO public.tool_configs (organization_id, integration_id, tool_name, action_type, config, fallback_message, is_active)
VALUES (
  '<your-org-id>',
  (SELECT id FROM integrations WHERE provider='manychat' AND organization_id='<your-org-id>'),
  'set_test_field',
  'manychat_set_field',
  '{"field_id": "<your-test-field-id>"}',
  'Could not set field.',
  true
);
```

### Steps

1. Trigger the executor via the inbound webhook:

```bash
curl -X POST https://operator.skale.club/api/manychat/webhook \
  -H "Content-Type: application/json" \
  -H "X-Operator-Secret: <your-channel-webhook-secret>" \
  -d '{
    "subscriber_id": "<test-subscriber-id>",
    "event_type": "uat_test",
    "field_id": "<your-test-field-id>",
    "field_value": "OPERATOR-UAT-2026-05-07"
  }'
```

> Requires a `manychat_rules` row matching `event_type='uat_test'` bound to the tool_config above. Insert via SQL or wait for Phase 26 UI.

2. Wait ~5 seconds.
3. ManyChat → Audience → click test subscriber → check `operator_test_field`.
4. Expected: field shows `OPERATOR-UAT-2026-05-07`. ✓
5. `SELECT * FROM action_logs WHERE tool_config_id = '<id>' ORDER BY created_at DESC LIMIT 1;` shows `status='success'`.

### Sign-off

- [ ] Field value updated in ManyChat dashboard: ✓
- [ ] action_logs row shows status=success: ✓
- [ ] Signed: ____________ Date: ____________

<!-- ─────────── -->

## OUTBOUND-02 — `manychat_add_tag`

### Setup

```sql
INSERT INTO public.tool_configs (organization_id, integration_id, tool_name, action_type, config, fallback_message, is_active)
VALUES (
  '<your-org-id>',
  (SELECT id FROM integrations WHERE provider='manychat' AND organization_id='<your-org-id>'),
  'add_test_tag',
  'manychat_add_tag',
  '{"tag_id": "<your-test-tag-id>"}',
  'Could not add tag.',
  true
);
```

### Steps

1. Confirm subscriber starts WITHOUT the test tag (verify in ManyChat Audience).
2. Trigger via webhook with `tag_id` in the payload (or relying on `config.tag_id`):

```bash
curl -X POST https://operator.skale.club/api/manychat/webhook \
  -H "Content-Type: application/json" \
  -H "X-Operator-Secret: <your-channel-webhook-secret>" \
  -d '{
    "subscriber_id": "<test-subscriber-id>",
    "event_type": "uat_add_tag",
    "tag_id": "<your-test-tag-id>"
  }'
```

> Requires a `manychat_rules` row matching `event_type='uat_add_tag'` bound to the tool_config above.

3. Wait ~5 seconds.
4. ManyChat → Audience → subscriber profile → confirm `operator-test-tag` is now in the Tags list.
5. action_logs row shows `status='success'`.

### Sign-off

- [ ] Tag visible in ManyChat dashboard: ✓
- [ ] action_logs row shows status=success: ✓
- [ ] Signed: ____________ Date: ____________

<!-- ─────────── -->

## OUTBOUND-03 — `manychat_trigger_flow`

> **Pitfall warning:** `flow_ns` is the NAMESPACE STRING (e.g. `content20250616151905_320176`), NOT the numeric flow ID. Find it in the URL bar when editing the flow in the ManyChat dashboard. Numeric IDs trigger 400 "flow_ns is invalid".

### Setup

```sql
INSERT INTO public.tool_configs (organization_id, integration_id, tool_name, action_type, config, fallback_message, is_active)
VALUES (
  '<your-org-id>',
  (SELECT id FROM integrations WHERE provider='manychat' AND organization_id='<your-org-id>'),
  'trigger_test_flow',
  'manychat_trigger_flow',
  '{"flow_ns": "<your-test-flow-namespace-string>"}',
  'Could not trigger flow.',
  true
);
```

### Steps

1. Open the test subscriber's Messenger/Instagram inbox.
2. Trigger via webhook:

```bash
curl -X POST https://operator.skale.club/api/manychat/webhook \
  -H "Content-Type: application/json" \
  -H "X-Operator-Secret: <your-channel-webhook-secret>" \
  -d '{
    "subscriber_id": "<test-subscriber-id>",
    "event_type": "uat_trigger_flow",
    "flow_ns": "<your-test-flow-namespace-string>"
  }'
```

> Requires a `manychat_rules` row matching `event_type='uat_trigger_flow'` bound to the tool_config above.

3. Within ~10 seconds: the test flow's first message ("Hello from Operator UAT") arrives in your inbox.
4. action_logs row shows `status='success'`.

### Sign-off

- [ ] Flow message received in inbox: ✓
- [ ] action_logs row shows status=success: ✓
- [ ] Signed: ____________ Date: ____________

<!-- ─────────── -->

## OUTBOUND-04 — `manychat_send_message`

> **Note:** ManyChat enforces Facebook's 24-hour messaging window. For UAT, send within 24 hours of last subscriber interaction. The default `message_tag='ACCOUNT_UPDATE'` enables out-of-window delivery for transactional updates — but Meta may still gate it.

### Setup

```sql
INSERT INTO public.tool_configs (organization_id, integration_id, tool_name, action_type, config, fallback_message, is_active)
VALUES (
  '<your-org-id>',
  (SELECT id FROM integrations WHERE provider='manychat' AND organization_id='<your-org-id>'),
  'send_test_message',
  'manychat_send_message',
  '{}',
  'Could not send message.',
  true
);
```

### Steps

1. Trigger via webhook with `text` in the payload:

```bash
curl -X POST https://operator.skale.club/api/manychat/webhook \
  -H "Content-Type: application/json" \
  -H "X-Operator-Secret: <secret>" \
  -d '{
    "subscriber_id": "<test-subscriber-id>",
    "event_type": "uat_send_message",
    "text": "UAT test message from Operator at 2026-05-07T<HH:MM>"
  }'
```

2. Within ~5 seconds: message arrives in inbox with EXACT text.
3. action_logs row shows `status='success'`.
4. **Bonus:** repeat with `data` instead of `text`, passing a v2 dynamic-block (e.g. quick replies). Confirm structured message renders. *(Optional.)*

### Sign-off

- [ ] Text message received in inbox: ✓
- [ ] action_logs row shows status=success: ✓
- [ ] Signed: ____________ Date: ____________

<!-- ─────────── -->

## Error-Path Checks (optional)

Confirm the executor's THROW path produces a proper `action_logs.status='error'` row.

| Failure Mode | How to Trigger | Expected | Signed |
|--------------|----------------|----------|--------|
| Bad subscriber_id | Pass `subscriber_id: "definitely-not-real"` | status=error, error_detail mentions "Subscriber does not exist" | ☐ |
| Bad tag_id | Pass `tag_id: "no-such-tag"` to manychat_add_tag | status=error, error_detail contains "tag" | ☐ |
| Bad flow_ns format | Pass `flow_ns: "12345"` (numeric — should be namespace string) | status=error, error_detail mentions "flow_ns" | ☐ |
| 24h-window block | Send to subscriber with no recent interaction using non-permitted message_tag | status=error, error_detail contains 400 + window message | ☐ |

<!-- ─────────── -->

## Final Phase 25 Sign-Off

- [ ] Pre-flight checklist complete
- [ ] Migration sanity check complete
- [ ] OUTBOUND-01 signed off
- [ ] OUTBOUND-02 signed off
- [ ] OUTBOUND-03 signed off
- [ ] OUTBOUND-04 signed off
- [ ] At least one error-path check completed (recommended)

**Phase 25 closed:** ____________ (date) by ____________ (user)

After this sign-off, run `/gsd:verify-work 25` to mark the phase done in STATE.md.
