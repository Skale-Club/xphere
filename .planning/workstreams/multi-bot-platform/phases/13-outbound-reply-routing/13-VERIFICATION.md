---
phase: 13-outbound-reply-routing
verified: 2026-05-04T22:18:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 13: Outbound Reply Routing Verification Report

**Phase Goal:** When an admin manually replies in the inbox, the message is delivered to the correct channel — Messenger Send API, Instagram Messaging API, or existing widget path — with no risk of silent misdirection
**Verified:** 2026-05-04T22:18:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Widget replies persist to DB only — no outbound API call, returns 201 | ✓ VERIFIED | Route branches only on `messenger`/`instagram`; widget skips Meta call. Test passes GREEN. |
| 2 | Messenger replies call sendMetaMessage with sender_id and return 201 | ✓ VERIFIED | Route reads `metadata.sender_id`; test asserts `('decrypted-page-token', 'psid-321', 'hello')`. 8/8 GREEN. |
| 3 | Instagram replies call sendMetaMessage with igsid and return 201 | ✓ VERIFIED | Route reads `metadata.igsid`; test asserts `('decrypted-page-token', 'igsid-456', 'hello')`. 8/8 GREEN. |
| 4 | Token revoked (code 190) returns 400 { error: token_revoked, channel } | ✓ VERIFIED | `result.code === 190` branch returns 400 with correct shape. Test GREEN. |
| 5 | Other Meta errors return 502 { error: meta_send_failed, message } | ✓ VERIFIED | Else branch returns 502. Test GREEN. |
| 6 | Missing meta_channels returns 400 { error: channel_not_configured } | ✓ VERIFIED | `!metaChannel` guard returns 400 before calling decrypt/sendMetaMessage. Test GREEN. |
| 7 | npm run build passes with no type errors | ✓ VERIFIED | Build output: `✓ Compiled successfully in 3.6s`. Zero TypeScript errors. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/meta/send-message.ts` | Sole Meta Send API caller, exports `sendMetaMessage` | ✓ VERIFIED | 54 lines; imports `META_GRAPH_VERSION` from oauth.ts; correct `(pageToken, recipientId, text)` signature; 10s AbortController timeout; handles success, HTTP error, and timeout |
| `src/app/api/chat/conversations/[id]/messages/route.ts` | Modified POST handler with channel-branching after DB insert | ✓ VERIFIED | Lines 148-181 contain the `METAINBOX-03` channel branch; widget path unchanged; both `sendMetaMessage` import and call present |
| `tests/outbound-reply-routing.test.ts` | 8 GREEN tests covering all METAINBOX-03 branches | ✓ VERIFIED | 8/8 GREEN confirmed by live test run |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `route.ts` | `send-message.ts` | `import { sendMetaMessage }` at line 7, called at line 173 | ✓ WIRED | Import present AND called conditionally after DB insert for messenger/instagram |
| `route.ts` | `meta_channels` table | `supabase.from('meta_channels').select(...).eq('page_id',...).eq('channel_type',...).eq('is_active', true).maybeSingle()` | ✓ WIRED | Lines 153-158; exact query pattern matches plan spec |
| `route.ts` | `src/lib/crypto.ts` | `decrypt(metaChannel.encrypted_page_access_token)` at line 164 | ✓ WIRED | Import at line 6; called with correct field name |
| `send-message.ts` | Meta Graph API | `fetch` with `META_GRAPH_VERSION` at line 14 | ✓ WIRED | Uses constant from oauth.ts, not hardcoded `'v21.0'` |
| `tests` | `send-message.ts` | `vi.mock('@/lib/meta/send-message')` | ✓ WIRED | Mock declared at line 9 of test file |

### Data-Flow Trace (Level 4)

Not applicable for this phase — the artifacts are an API route and a library function, not UI components rendering dynamic data. The data flow is verified end-to-end by the test suite: mock Supabase provides `conv.channel` and `channel_metadata` → route branches → `sendMetaMessage` receives correct `recipientId`.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 8 METAINBOX-03 tests GREEN | `npx vitest run tests/outbound-reply-routing.test.ts` | 8 passed (8), Duration 264ms | ✓ PASS |
| TypeScript build clean | `npm run build` | `✓ Compiled successfully in 3.6s` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| METAINBOX-03 | 13-01, 13-02 | Manual admin replies sent via conversation's origin channel (Instagram → IG API, Messenger → Messenger API, widget → existing path) | ✓ SATISFIED | Route branches on `conv.channel`; widget path untouched; Meta path calls `sendMetaMessage` with channel-specific `recipientId`; all 3 channel behaviors confirmed GREEN by test suite |

### Anti-Patterns Found

None. Scanned `send-message.ts` and `route.ts` for TODO/FIXME, empty returns, placeholder comments, and hardcoded stubs. The only comment in the channel branch is an authoritative documentation note about the `sender_id` vs `psid` field name discrepancy in Migration 020 — this is intentional and correct.

One known non-issue: the `[redis] error:` lines in `npm run build` output are unrelated Redis connection warnings from the dev environment, not build failures. Build exits successfully.

### Human Verification Required

None. All METAINBOX-03 behaviors are covered by the automated test suite at unit level. The only gap that would require a human is end-to-end live delivery through the actual Meta Graph API, which is outside the scope of this phase's automated verification.

### Gaps Summary

No gaps. Phase 13 fully achieves its goal:

1. `src/lib/meta/send-message.ts` is a production-quality Meta Send API wrapper — not a stub — with timeout handling, proper error discrimination, and no hardcoded API version.
2. The POST handler in `route.ts` surgically adds channel branching after DB insert. The widget path is provably unchanged (test 1 asserts `sendMetaMessage` is never called for `channel: 'widget'`).
3. The correct field names are used: `sender_id` for Messenger, `igsid` for Instagram — matching the authoritative source (`process-event.ts`), not the incorrect Migration 020 SQL comment.
4. All 8 behavioral contracts are locked by GREEN tests. Build is clean.

---

_Verified: 2026-05-04T22:18:00Z_
_Verifier: Claude (gsd-verifier)_
