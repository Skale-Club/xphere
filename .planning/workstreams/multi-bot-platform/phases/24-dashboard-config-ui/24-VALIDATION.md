# Phase 24: Dashboard Config UI — Validation Strategy

**Phase:** 24-dashboard-config-ui
**Created:** 2026-05-06
**Requirements covered:** CHANNEL-02, CHANNEL-03, CHANNEL-04

---

## Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` |
| Per-task command | `npx vitest run tests/manychat/channel-actions.test.ts` |
| Full suite command | `npx vitest run` |
| Build gate | `npm run build` |

---

## Wave 0 Requirements (RED tests — must exist before GREEN implementation)

Wave 0 tests must be written and confirmed failing BEFORE any implementation code is added. This is the Nyquist rule for Phase 24.

**File:** `tests/manychat/channel-actions.test.ts` (exists — add new `describe` blocks)

Wave 0 adds three new `describe` blocks to the existing file. The existing mocks (`vi.mock('@/lib/supabase/server')`, `vi.mock('@/lib/crypto')`, `vi.mock('next/cache')`) are already in place and reusable.

### New `describe` blocks required

#### 1. `describe('CHANNEL-02: getManychatChannel')`

```
it('returns null when no channel row exists')
it('returns ManychatChannelForDisplay with webhookSecret when channel exists')
it('returns null (not an error) when not authenticated — or returns error object')
```

Mock shape needed: `from('manychat_channels').select(...).maybeSingle()` returning `{ data: null }` or `{ data: channelRow }`.

#### 2. `describe('CHANNEL-03: MANYCHAT_PAYLOAD_TEMPLATE constant')`

```
it('exports MANYCHAT_PAYLOAD_TEMPLATE matching canonical template from PLANNING.md')
```

The canonical template (from `projects/manychat-integration/PLANNING.md`) is:

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

Test assertion: `expect(MANYCHAT_PAYLOAD_TEMPLATE).toMatchObject({ subscriber_id: '{{user.id}}', event_type: 'flow_completed', flow_id: '{{flow_id}}' })`

#### 3. `describe('CHANNEL-04: testManychatConnection')`

```
it('returns { success: false, error } when not authenticated')
it('returns { success: false, error } when no channel row exists')
it('calls GET /fb/page/getFlows with Authorization: Bearer {decryptedKey}')
it('returns { success: true } when fetch responds with 200')
it('returns { success: false, error } when fetch responds with non-200 (e.g. 401)')
it('returns timeout error message when AbortController fires after 5s')
```

Mocks needed:
- `vi.mock('@/lib/crypto')` — add `decrypt: vi.fn().mockResolvedValue('real-api-key')` to existing mock
- `global.fetch` spy: `vi.spyOn(global, 'fetch')`
- `buildMockSupabaseClient` must be extended or a new local builder used to support `.select(...).single()` returning `{ data: { encrypted_api_key: '...' } }`

---

## Requirement → Test Map

| Req ID | Behavior | Test Type | Automated Command | Wave 0 Gap? |
|--------|----------|-----------|-------------------|-------------|
| CHANNEL-02 | `getManychatChannel()` returns `webhookSecret` (non-null) for connected org | unit | `npx vitest run tests/manychat/channel-actions.test.ts` | YES |
| CHANNEL-02 | `getManychatChannel()` returns null when no channel configured | unit | same | YES |
| CHANNEL-03 | `MANYCHAT_PAYLOAD_TEMPLATE` constant matches canonical template | unit | same | YES |
| CHANNEL-04 | `testManychatConnection()` calls `GET /fb/page/getFlows` with Bearer token | unit | same | YES |
| CHANNEL-04 | `testManychatConnection()` returns `{ success: true }` on 200 | unit | same | YES |
| CHANNEL-04 | `testManychatConnection()` returns `{ success: false, error }` on non-200 | unit | same | YES |
| CHANNEL-04 | `testManychatConnection()` returns timeout error on AbortController abort | unit | same | YES |
| CHANNEL-02 (UI) | Connected state displays webhook URL + secret | visual | manual checkpoint in 24-02 | N/A |
| CHANNEL-03 (UI) | Payload template textarea is populated and copyable | visual | manual checkpoint in 24-02 | N/A |
| CHANNEL-04 (UI) | Test Connection button shows result toast | visual | manual checkpoint in 24-02 | N/A |

---

## Sampling Rate

| Gate | Command |
|------|---------|
| After Wave 0 (RED confirmed) | `npx vitest run tests/manychat/channel-actions.test.ts` — all new tests must FAIL |
| After Plan 24-01 Task 2 (GREEN) | `npx vitest run tests/manychat/channel-actions.test.ts` — all tests must PASS |
| After Plan 24-01 complete | `npx vitest run` — full suite, no regressions |
| After Plan 24-02 complete | `npm run build` — exits 0 |
| Phase gate | Full suite green + `npm run build` pass + visual checkpoint approved |

---

## UI Verification (Manual — Plan 24-02 checkpoint)

Visual states verified by human:

**Not connected state:**
- Form renders with "Bot name" and "ManyChat API key" fields
- Submit button reads "Connect"
- Submitting valid values creates the channel and switches to connected state

**Connected state:**
- Channel name visible in card header with "Active" badge
- Webhook URL field shows `https://operator.skale.club/api/manychat/webhook`
- "Copy URL" button copies to clipboard and shows toast
- Webhook secret field shows masked-but-readable value
- "Copy Secret" button copies to clipboard and shows toast
- Payload template textarea shows formatted JSON matching canonical template
- "Copy JSON" button copies template to clipboard and shows toast
- "Test Connection" button shows spinner while pending, then toast with result
- "Disconnect" button returns page to not-connected state

---

## Build Gate

`npm run build` must pass with TypeScript 5 strict before Phase 24 is marked complete.

`manychat_channels` columns (`webhook_secret`, `key_hint`, `is_active`, etc.) are already typed in `src/types/database.ts` — no manual type additions needed.
