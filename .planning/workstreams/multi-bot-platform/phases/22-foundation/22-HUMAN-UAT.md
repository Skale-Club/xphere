---
status: partial
phase: 22-foundation
source: [22-VERIFICATION.md]
started: 2026-05-06T19:40:00Z
updated: 2026-05-06T19:40:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Apply migration 026 to live Supabase
expected: Tables `manychat_channels` and `manychat_events` exist; `org_isolation` policies in place; `manychat_events` has SELECT+INSERT only (no UPDATE/DELETE); `integration_provider` enum includes `'manychat'`
result: [pending]
how_to_run: `SUPABASE_DB_PASSWORD=*** npx supabase db push`

### 2. Create channel via UI/server action against live DB
expected: Row in `manychat_channels` with `encrypted_api_key` matching `iv-base64:ciphertext-base64` format, `key_hint = '••••••••<last4>'`, `webhook_secret` is a UUID, `org_id` auto-populated by RLS
result: [pending]
how_to_run: After migration, invoke `createManychatChannel({ channel_name: 'Test', api_key: 'test-key' })` and SELECT the row

### 3. Live webhook POST
expected: HTTP 200 with `{ok:true}` for valid secret + event row in `manychat_events` with `status='unmatched'`; HTTP 403 for missing/invalid secret + no event written
result: [pending]
how_to_run: `curl -X POST https://operator.skale.club/api/manychat/webhook -H "X-Operator-Secret: <real-secret>" -H "Content-Type: application/json" -d '{"event_type":"flow_completed","subscriber_id":"123"}'`

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
