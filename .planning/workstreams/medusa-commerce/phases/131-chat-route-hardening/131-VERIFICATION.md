---
phase: 131-chat-route-hardening
verified: 2026-07-17T14:23:16Z
status: passed
score: 8/8 must-haves verified
re_verification: null
requirements:
  - id: CHT-01
    status: satisfied
  - id: CHT-02
    status: satisfied
  - id: CHT-03
    status: satisfied
  - id: CHT-04
    status: satisfied
notes:
  - "REQUIREMENTS.md CHT-04 checkbox is still `[ ]` (stale tracking marker); implementation, tests, and build all confirm it is done — recommend ticking to `[x]`."
---

# Phase 131: Chat Route Hardening Verification Report

**Phase Goal:** The public `/api/chat/{token}` endpoint can no longer be used to burn an org's LLM budget or flood the runtime — independent of any commerce feature.
**Verified:** 2026-07-17T14:23:16Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

The chat route now enforces a five-rule rate-limit matrix (per-IP, per-IP/day, per-session, per-new-session/IP, per-org), caps message size at 4,000 chars, and every legacy org-authored outbound fetch is SSRF-guarded. All protections live in the chat route, the rate-limit library, and the webhook executor — zero dependency on any commerce module. Goal achieved.

### Observable Truths

| #   | Truth (CHT-xx) | Status | Evidence |
| --- | -------------- | ------ | -------- |
| 1 | `failMode 'open'\|'memory'\|'closed'` (default open); 3-arg callers unchanged (CHT-01) | ✓ VERIFIED | `rate-limit.ts:26` type, `:122` `?? 'open'`; all 5 legacy call sites 3-arg, 0 `failMode` occurrences |
| 2 | Bounded memory fallback cannot grow past 10,000 (CHT-01) | ✓ VERIFIED | `MEMORY_STORE_MAX = 10_000` (`:49`), sweep-then-evict (`:61-72`); bounding unit test passes |
| 3 | R1 chat:ip 20/60 memory, evaluated BEFORE `createServiceRoleClient` (CHT-02) | ✓ VERIFIED | `route.ts:61` R1 vs `:107` org client; R1-denied test asserts `createServiceRoleClient` never called |
| 4 | R2 chat:ip:day 200/86400 memory (CHT-02) | ✓ VERIFIED | `route.ts:66` |
| 5 | R3 chat:sess 10/60 memory (CHT-02) | ✓ VERIFIED | `route.ts:93` |
| 6 | R4 chat:newsess 10/3600 memory on ALL session-create paths (CHT-02) | ✓ VERIFIED | `route.ts:99` (fresh/bogus/expired) + `:172` (org-mismatch); `grep -cF 'chat:newsess:${ip}'` = 2; `ensureDbSession` deduped to 1 |
| 7 | R5 chat:org 300/60 open (CHT-02); 429 `{error:'rate_limited'}` + CORS, never streamed (CHT-02) | ✓ VERIFIED | `route.ts:119` R5; `rateLimited()` helper (`:44`) returns `Response.json(...,{status:429,headers:CORS_HEADERS})` |
| 8 | message `.max(4000)` + `maxDuration = 60` (CHT-03); SSRF guard before fetch returns error string (CHT-04) | ✓ VERIFIED | `route.ts:35` `.max(4000,...)`, `:22` `maxDuration = 60`; `execute-webhook.ts:81` `await assertPublicHttpUrl(cfg.url)`, `:83` returns `Webhook blocked: ...` |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/rate-limit.ts` | failMode tri-state + bounded memory fallback | ✓ VERIFIED | Both fail seams route through `onRedisUnavailable(...,failMode)`; default 'open'; test-only introspection exports present |
| `src/lib/request-ip.ts` | Shared `getClientIp(request)` | ✓ VERIFIED | Exports `getClientIp`; first-hop x-forwarded-for parse; imported by chat + widget-config routes |
| `src/app/api/chat/[token]/route.ts` | R1-R5 in order + message cap + maxDuration 60 | ✓ VERIFIED | 5 `failMode:'memory'` + 1 `failMode:'open'`; ordering R1/R2 → body → R3/R4 → org → R5 confirmed by line numbers |
| `src/app/api/widget/[token]/config/route.ts` | Uses shared `getClientIp`, no inline copy | ✓ VERIFIED | `getClientIp(request)` = 1, `x-forwarded-for` = 0; rateLimit call stays 3-arg/fail-open |
| `src/lib/custom-webhook/execute-webhook.ts` | SSRF guard before fetch | ✓ VERIFIED | Imports + calls `assertPublicHttpUrl` before AbortController/fetch; returns sanitized single-line string |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| chat route | rate-limit.ts | 5 `rateLimit(...,{failMode})` calls (memory ×R1-R4, open ×R5) | ✓ WIRED |
| chat route | request-ip.ts | `getClientIp(request)` before R1 | ✓ WIRED |
| widget config route | request-ip.ts | `getClientIp(request)` replaces inline parse | ✓ WIRED |
| execute-webhook.ts | flows/url-guard.ts | `await assertPublicHttpUrl(cfg.url)` after parseConfig, before fetch | ✓ WIRED |
| R1/R2 | org lookup | both `chat:ip` keys evaluated above `createServiceRoleClient()` | ✓ WIRED (test-proven) |

### Contract Fidelity (INTEGRATION-CONTRACT §7)

| Rule | Contract (key / limit / window / failMode) | Code | Match |
| ---- | ------------------------------------------ | ---- | ----- |
| R1 | chat:ip / 20 / 60s / memory | `chat:ip:${ip}`, 20, 60, memory | ✓ |
| R2 | chat:ip:day / 200 / 24h / memory | `chat:ip:day:${ip}`, 200, 86400, memory | ✓ |
| R3 | chat:sess / 10 / 60s / memory | `chat:sess:${incomingSessionId}`, 10, 60, memory | ✓ |
| R4 | chat:newsess / 10 / 1h / memory | `chat:newsess:${ip}`, 10, 3600, memory | ✓ |
| R5 | chat:org / 300 / 60s / open | `chat:org:${org.id}`, 300, 60, open | ✓ |
| — | message max 4,000; maxDuration 10→60 | `.max(4000)`; `maxDuration = 60` | ✓ |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase test suite (4 files) | `npx vitest run tests/rate-limit.test.ts tests/chat-api.test.ts tests/custom-webhook.test.ts tests/widget-config-route.test.ts` | 4 files, 43 passed, 15 todo, 0 failed | ✓ PASS |
| Type gate | `npm run build` | Full route tree emitted + `postbuild verify-sw OK` (next build aborts before this on compile/type error) | ✓ PASS |

The 15 todo are the pre-existing out-of-scope WEBHOOK-01..05 stubs, as documented — not gaps.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| CHT-01 | 131-01 | rate-limit.ts failMode tri-state; existing callers unchanged | ✓ SATISFIED | `rate-limit.ts` + 10 unit tests + call-site scan |
| CHT-02 | 131-03 | Chat route R1-R5, 429 on breach | ✓ SATISFIED | `route.ts` matrix + chat-api tests |
| CHT-03 | 131-03 | message ≤ 4,000; maxDuration = 60 | ✓ SATISFIED | `route.ts:35`, `:22` + tests |
| CHT-04 | 131-02 | custom_webhook guarded by assertPublicHttpUrl | ✓ SATISFIED | `execute-webhook.ts:81-84` + 7 SSRF tests |

No orphaned requirements — REQUIREMENTS.md maps only CHT-01..04 to this phase, all claimed by a plan.

### Anti-Patterns Found

None blocking. No TODO/FIXME/placeholder or empty-return stubs in the modified source files. The `it.todo` stubs in `tests/custom-webhook.test.ts` are pre-existing, out-of-scope, and explicitly retained by plan 131-02.

### Info-Level Observations

| Item | Severity | Note |
| ---- | -------- | ---- |
| REQUIREMENTS.md CHT-04 checkbox is `[ ]` | ℹ️ Info | Stale tracking marker only — code, tests, and build all confirm CHT-04 is implemented. Recommend ticking to `[x]`. Does not affect goal achievement. |

### Human Verification Required

None required for phase-level sign-off. The one deferred item — live 429 behavior over HTTP with the memory fallback engaged — is an E2E-wiring concern noted in 131-VALIDATION.md ("Manual-Only Verifications"), not a blocker: every rule, key, limit, window, failMode, ordering, and the 429 body/CORS shape are proven by mocked unit tests and static verification.

### Gaps Summary

None. All 8 must-haves verified, all 5 artifacts pass exists/substantive/wired, all key links wired, contract §7 numbers match exactly, all 4 requirements satisfied, phase test suite green, build passes. The public chat endpoint is now bounded on every axis an attacker could use to burn LLM budget (R1/R2/R3/R5) or flood the runtime with session/DB rows (R4, message cap), and the last unguarded org-authored fetch is SSRF-closed — all independent of any commerce feature.

---

_Verified: 2026-07-17T14:23:16Z_
_Verifier: Claude (gsd-verifier)_
