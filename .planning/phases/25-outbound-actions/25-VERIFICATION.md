---
phase: 25-outbound-actions
verified: 2026-05-07T08:20:00Z
status: gaps_found
score: 4/5 success criteria verified (criterion 1 partially blocked at UI layer)
gaps:
  - truth: "A tool_config can be created with action_type manychat_set_field, manychat_add_tag, manychat_trigger_flow, or manychat_send_message"
    status: partial
    reason: "Schema, DB enum, and action engine fully support the 4 new action types. However the tool-config-form.tsx Zod schema z.enum only lists the original 6 values — the 4 ManyChat action types are NOT selectable via the UI form. Additionally, tool_configs.Update in database.ts still has the old 6-value union at line 243, and the action_type cast in updateToolConfig (actions.ts:182) and createToolConfig (actions.ts:144) only enumerates the original 6 types."
    artifacts:
      - path: "src/components/tools/tool-config-form.tsx"
        issue: "z.enum at line 37–44 and ACTION_TYPE_OPTIONS at line 56–63 do not include manychat_set_field, manychat_add_tag, manychat_trigger_flow, manychat_send_message. ManyChat action types cannot be selected or saved via the UI form."
      - path: "src/types/database.ts"
        issue: "tool_configs.Update.action_type at line 243 still lists only the original 6 values. Row and Insert are correct (line 217, 231). Update is incomplete."
      - path: "src/app/(dashboard)/tools/actions.ts"
        issue: "createToolConfig (line 144) and updateToolConfig (line 182) cast action_type as the old 6-value union. These are as-casts so they do not break the build, but they are type-incorrect and will cause TypeScript tooling to complain if the actual value is a ManyChat type."
    missing:
      - "Add manychat_set_field, manychat_add_tag, manychat_trigger_flow, manychat_send_message to the z.enum in tool-config-form.tsx (lines 37–44)"
      - "Add corresponding ACTION_TYPE_OPTIONS entries in tool-config-form.tsx (lines 56–63)"
      - "Widen tool_configs.Update.action_type in src/types/database.ts (line 243) to match Row and Insert"
      - "Update the as-cast in createToolConfig and updateToolConfig in src/app/(dashboard)/tools/actions.ts to include the 4 new values"
human_verification:
  - test: "OUTBOUND-02: manychat_add_tag live execution"
    expected: "Tag appears on subscriber profile in ManyChat dashboard; action_logs row shows status=success"
    why_human: "Requires live ManyChat API credentials, real subscriber, and network call to api.manychat.com — cannot be verified programmatically"
  - test: "OUTBOUND-01: manychat_set_field live execution"
    expected: "Custom field updated on subscriber in ManyChat dashboard; action_logs row shows status=success"
    why_human: "Requires live ManyChat API call — cannot be verified programmatically"
  - test: "OUTBOUND-03: manychat_trigger_flow live execution"
    expected: "Flow triggered and first message arrives in subscriber inbox; action_logs row shows status=success"
    why_human: "Requires live ManyChat API call — cannot be verified programmatically"
  - test: "OUTBOUND-04: manychat_send_message live execution"
    expected: "Text message delivered to subscriber inbox; action_logs row shows status=success"
    why_human: "Requires live ManyChat API call — cannot be verified programmatically"
  - test: "Migration 028 sanity check"
    expected: "manychat_channels COUNT equals integrations WHERE provider='manychat' COUNT after db push"
    why_human: "Requires pushing migration 028 to a live Supabase instance and querying the result — cannot be verified without DB credentials"
---

# Phase 25: Outbound Actions — Verification Report

**Phase Goal:** Operators can configure tool_configs that push data back to ManyChat (set fields, add tags, trigger flows, send messages) as action outputs.
**Verified:** 2026-05-07T08:20:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A tool_config can be created with action_type manychat_set_field, manychat_add_tag, manychat_trigger_flow, or manychat_send_message | PARTIAL | DB enum extended (migration 028), database.ts Row/Insert correct, action engine handles all 4 types — but tool-config-form.tsx Zod schema and ACTION_TYPE_OPTIONS do NOT include the 4 new values; tool_configs.Update in database.ts also missing them |
| 2 | When manychat_add_tag executes, tag is added to subscriber in ManyChat and action_logs entry shows success | ? HUMAN NEEDED | Unit test (tests/manychat/add-tag.test.ts) passes — executor verified to POST to correct endpoint with correct shape; live ManyChat outcome requires human UAT per 25-HUMAN-UAT.md |
| 3 | When manychat_set_field executes, the custom field is updated on the subscriber in ManyChat | ? HUMAN NEEDED | Unit test (tests/manychat/set-field.test.ts) passes; live ManyChat outcome requires human UAT |
| 4 | When manychat_trigger_flow executes, the specified flow is triggered for the subscriber | ? HUMAN NEEDED | Unit test (tests/manychat/trigger-flow.test.ts) passes; live ManyChat outcome requires human UAT |
| 5 | When manychat_send_message executes, the message is delivered via ManyChat API | ? HUMAN NEEDED | Unit test (tests/manychat/send-message.test.ts) passes; live ManyChat outcome requires human UAT |

**Score:** Automated: 0/1 truths fully verified, 1/1 partially verified, 4/4 routed to human verification

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/028_manychat_outbound.sql` | 4 ALTER TYPE + FK column + partial unique index + backfill | VERIFIED | 64 lines; all 4 ALTER TYPE IF NOT EXISTS present; REFERENCES public.manychat_channels(id) ON DELETE CASCADE; CREATE UNIQUE INDEX idx_integrations_manychat_one_per_org; WHERE NOT EXISTS backfill; INSERT INTO public.integrations |
| `src/types/database.ts` | action_type union includes all 4 new values; integrations.Row has manychat_channel_id | PARTIAL | Row (line 217) and Insert (line 231) correct; Enums (line 1095) correct; integrations Row/Insert/Update have manychat_channel_id (lines 173/187/198); BUT tool_configs.Update at line 243 is still the old 6-value union — missing the 4 new types |
| `src/lib/manychat/client.ts` | exports manychatFetchJson with 5s timeout | VERIFIED | 52 lines; exports manychatFetch, manychatFetchJson, ManychatCredentials; MANYCHAT_BASE_URL = 'https://api.manychat.com'; TIMEOUT_MS = 5000; AbortController with 5s timeout; Bearer auth; Content-Type application/json |
| `src/lib/manychat/subscriber-id.ts` | exports resolveSubscriberId | VERIFIED | 34 lines; exports resolveSubscriberId(params): string \| number; reads params.subscriber_id, params.payload?.subscriber_id, params.user?.id in order; throws 'subscriber_id is required' |
| `src/lib/manychat/set-field.ts` | OUTBOUND-01 executor | VERIFIED | 34 lines; exports setManychatField; imports manychatFetchJson + resolveSubscriberId; posts to /fb/subscriber/setCustomField; returns single-line string |
| `src/lib/manychat/add-tag.ts` | OUTBOUND-02 executor | VERIFIED | 31 lines; exports addManychatTag; imports manychatFetchJson + resolveSubscriberId; posts to /fb/subscriber/addTag; returns single-line string |
| `src/lib/manychat/trigger-flow.ts` | OUTBOUND-03 executor | VERIFIED | 34 lines; exports triggerManychatFlow; imports manychatFetchJson + resolveSubscriberId; posts to /fb/sending/sendFlow; returns single-line string |
| `src/lib/manychat/send-message.ts` | OUTBOUND-04 executor | VERIFIED | 50 lines; exports sendManychatMessage; imports manychatFetchJson + resolveSubscriberId; posts to /fb/sending/sendContent; ACCOUNT_UPDATE default; text-to-v2-block convenience; returns single-line string |
| `src/lib/action-engine/execute-action.ts` | 4 new case arms, NO TODO(25-02) or stub string | VERIFIED | All 4 case arms present (lines 48–55); 4 executor imports at lines 9–12; TODO(25-02) not present; 'ManyChat executor not yet wired' not present; exhaustiveness check preserved |
| `src/app/(dashboard)/integrations/manychat/actions.ts` | createManychatChannel writes bridge row, compensating delete | VERIFIED | 'use server' at line 1; createManychatChannel inserts into manychat_channels with .select('id').single(); inserts into integrations with manychat_channel_id: channel.id, provider: 'manychat', reuses encryptedApiKey; compensating delete on bridgeErr; 'Bridge sync failed:' error string present |
| `tests/manychat/` | 6 executor/client test files + 2 extended test files | VERIFIED | All 8 required test files exist: client.test.ts, set-field.test.ts, add-tag.test.ts, trigger-flow.test.ts, send-message.test.ts, execute-action-manychat.test.ts, channel-actions.test.ts (OUTBOUND-bridge block), dispatch-event.test.ts (manychat_add_tag canary); 78 tests pass in 11 files |
| `.planning/phases/25-outbound-actions/25-HUMAN-UAT.md` | exists, 100+ lines, 4 OUTBOUND sections | VERIFIED | 261 lines; contains OUTBOUND-01 through OUTBOUND-04 (8 occurrences); 4 occurrences of production webhook URL; flow_ns namespace string warning; N_BEFORE/N_AFTER migration sanity check; ACCOUNT_UPDATE; Final Phase 25 Sign-Off checklist |
| `npm run build` | exits 0 | VERIFIED | Build compiled successfully in 31.8s; TypeScript check finished in 35.1s with no errors |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/app/(dashboard)/integrations/manychat/actions.ts createManychatChannel` | integrations table | supabase.from('integrations').insert(...) | WIRED | Pattern found at line 162 |
| `supabase/migrations/028_manychat_outbound.sql` | public.action_type enum | ALTER TYPE ADD VALUE statements | WIRED | Exactly 4 statements at lines 13–16 |
| `supabase/migrations/028_manychat_outbound.sql` | manychat_channels table | FK column REFERENCES public.manychat_channels(id) ON DELETE CASCADE | WIRED | Line 21 |
| `src/lib/action-engine/execute-action.ts` | src/lib/manychat/{set-field,add-tag,trigger-flow,send-message}.ts | switch case arms calling executors with (params, credentials) | WIRED | case 'manychat_set_field': return setManychatField(params, credentials) at lines 48–55 |
| `src/lib/manychat/{set-field,add-tag,trigger-flow,send-message}.ts` | src/lib/manychat/client.ts manychatFetchJson | import + call to manychatFetchJson | WIRED | All 4 executors import from './client' and call manychatFetchJson |
| `src/lib/manychat/{set-field,add-tag,trigger-flow,send-message}.ts` | src/lib/manychat/subscriber-id.ts resolveSubscriberId | import + call to resolveSubscriberId(params) | WIRED | All 4 executors import from './subscriber-id' and call resolveSubscriberId |

### Data-Flow Trace (Level 4)

The executors are not data-rendering components — they produce side effects (API calls) and return success strings. Data-flow trace is not applicable in the React/rendering sense. The critical data flow is:

| Executor | Credentials Source | Flow | Status |
|----------|--------------------|------|--------|
| All 4 executors | dispatch-event.ts:67-72 (decrypt boundary) | dispatchManychatEvent decrypts key → passes credentials to executeAction → case arm calls executor → executor calls manychatFetchJson with credentials.apiKey | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All manychat unit tests pass | npx vitest run tests/manychat/ | 78 tests passed across 11 files in 2.25s | PASS |
| Build exits 0 | npm run build | Compiled successfully in 31.8s, TypeScript finished in 35.1s | PASS |
| execute-action.ts has no stub text | grep "TODO(25-02)\|ManyChat executor not yet wired" execute-action.ts | No matches | PASS |
| All 4 action types in database.ts Enums | grep Enums+manychat_set_field in database.ts | Found at line 1095 | PASS |
| tool_configs.Update missing new values | grep "Update.*action_type" in database.ts | Line 243 still has old 6-value union | FAIL — type gap |
| ManyChat action types in tool-config-form | grep manychat in tool-config-form.tsx | No matches — form does not expose ManyChat action types | FAIL — UI gap |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| OUTBOUND-01 | 25-01, 25-02 | manychat_set_field action type + executor | PARTIAL | DB enum extended; executor exists and tested; UI form cannot select this action type |
| OUTBOUND-02 | 25-01, 25-02 | manychat_add_tag action type + executor | PARTIAL | DB enum extended; executor exists and tested; UI form cannot select this action type |
| OUTBOUND-03 | 25-01, 25-02 | manychat_trigger_flow action type + executor | PARTIAL | DB enum extended; executor exists and tested; UI form cannot select this action type |
| OUTBOUND-04 | 25-01, 25-02 | manychat_send_message action type + executor | PARTIAL | DB enum extended; executor exists and tested; UI form cannot select this action type |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/tools/tool-config-form.tsx` | 37–44 | z.enum missing 4 ManyChat action types | Blocker | ManyChat action types cannot be selected in the create/edit tool_config UI form |
| `src/components/tools/tool-config-form.tsx` | 56–63 | ACTION_TYPE_OPTIONS missing 4 ManyChat entries | Blocker | No UI labels for ManyChat action types — directly coupled to the z.enum gap |
| `src/types/database.ts` | 243 | tool_configs.Update.action_type only has original 6 values | Warning | TypeScript type mismatch between Update shape and actual DB capabilities; Row/Insert are correct |
| `src/app/(dashboard)/tools/actions.ts` | 144, 182 | createToolConfig and updateToolConfig cast action_type as old 6-value union | Warning | Type-incorrect as-casts; runtime behavior still works at DB level since the cast is not validated, but TypeScript tooling will not catch misuse |
| `tests/manychat/dispatch-event.test.ts` | 151 | `@ts-expect-error — Wave 0 RED: manychat_add_tag not yet a valid action_type literal` comment is now stale | Info | Comment documents Wave 0 intent but the enum is now widened; the @ts-expect-error at line 151 would be a TS error if strict ts-expect-error checking is enabled (the line no longer needs it since manychat_add_tag IS now a valid action_type) |

### Human Verification Required

#### 1. OUTBOUND-02: manychat_add_tag live execution

**Test:** Follow OUTBOUND-02 section in `.planning/phases/25-outbound-actions/25-HUMAN-UAT.md`. Insert a tool_config row directly via SQL (bypassing UI form gap), trigger via webhook with a real subscriber_id and tag_id, wait 5 seconds, verify tag appears on subscriber in ManyChat Audience panel.
**Expected:** Tag visible in ManyChat dashboard; action_logs row shows status=success
**Why human:** Requires live ManyChat API credentials, real subscriber ID, and network call to api.manychat.com

#### 2. OUTBOUND-01: manychat_set_field live execution

**Test:** Follow OUTBOUND-01 section in `25-HUMAN-UAT.md`. Insert tool_config via SQL, trigger via webhook, verify custom field updated on subscriber.
**Expected:** Field value updated in ManyChat dashboard; action_logs row shows status=success
**Why human:** Requires live ManyChat API call

#### 3. OUTBOUND-03: manychat_trigger_flow live execution

**Test:** Follow OUTBOUND-03 section in `25-HUMAN-UAT.md`. Note: use the flow_ns namespace string (e.g. content20250616...), NOT the numeric flow ID.
**Expected:** Flow triggered and first message arrives in subscriber inbox; action_logs row shows status=success
**Why human:** Requires live ManyChat API call

#### 4. OUTBOUND-04: manychat_send_message live execution

**Test:** Follow OUTBOUND-04 section in `25-HUMAN-UAT.md`. Use the text convenience parameter or build a full v2 dynamic-block for data.
**Expected:** Message delivered to subscriber inbox; action_logs row shows status=success
**Why human:** Requires live ManyChat API call

#### 5. Migration 028 database sanity check

**Test:** Follow "Migration Sanity Check" section in `25-HUMAN-UAT.md`. Run `npx supabase db push`, then compare COUNT(*) from manychat_channels vs integrations WHERE provider='manychat'.
**Expected:** Counts match (one bridge row per channel)
**Why human:** Requires Supabase DB credentials and live DB push

### Gaps Summary

The core execution infrastructure is complete and tested: migration 028 is written, the 4 executor files exist and are wired into the action engine, all 78 unit tests pass, and the build is green.

One gap was found: the UI layer was not updated for the new action types. The `tool-config-form.tsx` Zod enum and `ACTION_TYPE_OPTIONS` still only list the original 6 action types. This means operators cannot use the standard tool_config UI form to create or edit tool_configs with ManyChat action types — they must use direct SQL inserts. This partially blocks Success Criterion 1 ("A tool_config can be created with action_type manychat_set_field...") for the normal operator workflow.

The `tool_configs.Update` type in database.ts (line 243) is also incomplete, and the action_type as-casts in `tools/actions.ts` need widening, but these are type-safety issues that do not block runtime functionality.

Criteria 2–5 (live ManyChat execution) are deferred to human UAT per the phase design — the runbook at `25-HUMAN-UAT.md` covers all 4 scripts.

---

_Verified: 2026-05-07T08:20:00Z_
_Verifier: Claude (gsd-verifier)_
