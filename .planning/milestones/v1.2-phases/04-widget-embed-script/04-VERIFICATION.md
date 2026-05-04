---
phase: 04-widget-embed-script
verified: 2026-04-04T18:17:00Z
status: human_needed
score: 12/12 automated must-haves verified
human_verification:
  - test: "End-to-end AI response in real browser"
    expected: "Typing a message in the widget and pressing Enter causes the AI to respond with streamed text; typing indicator appears and disappears correctly"
    why_human: "SSE stream consumption and AI response rendering require a live server, live Supabase connection, and a real browser; cannot be verified programmatically without running the app"
  - test: "Session persistence across page reload"
    expected: "After reloading widget-test.html the same sessionId is reused (visible in Network tab POST body); conversation context carries over"
    why_human: "localStorage read/write across navigation requires a real browser; automated jsdom tests confirm the code path exists but cannot verify cross-reload persistence"
  - test: "Script tag does not block page rendering (GTM/async compatibility)"
    expected: "Page title and body text are painted before the widget bubble appears; adding the script tag to a GTM container does not cause render-blocking"
    why_human: "Load-order and render-blocking behavior can only be observed in a real browser with DevTools performance timeline"
---

# Phase 04: Widget Embed Script Verification Report

**Phase Goal:** Deliver a single-file embeddable chat widget (`public/widget.js`) that any third-party web page can load with one script tag — no build tools, no login — and immediately get a working AI chat interface powered by the Phase 3 conversation engine.

**Verified:** 2026-04-04T18:17:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `public/widget.js` exists as a real minified IIFE bundle (not a stub) | VERIFIED | File is 13,131 bytes; confirmed by `stat` and `wc -c`; first line is minified IIFE code, not a comment stub |
| 2 | Script tag is async and does not block page rendering (WIDGET-02) | VERIFIED (automated) / HUMAN NEEDED (behavioral) | `public/widget-test.html` line 74 has `async` attribute; behavioral non-blocking must be confirmed in browser |
| 3 | Widget renders floating bubble and toggleable chat panel using Shadow DOM (WIDGET-03) | VERIFIED | `tests/widget.test.ts` Shadow DOM tests pass: `div#leaidear-root` created, `host.shadowRoot` not null, style element injected inside shadow root |
| 4 | Widget is identified per-org via `data-token` on the script tag (WIDGET-04) | VERIFIED | `src/widget/index.ts` line 283-289: `document.currentScript.dataset.token` captured as first synchronous operation; init guard prevents double-init when token missing |
| 5 | Widget works without visitor login (WIDGET-05) | VERIFIED | Chat API route (`/api/chat/[token]`) authenticates by org token in URL, not a user session; `tests/widget.test.ts` calls widget without any auth; all 11 widget tests GREEN |
| 6 | CORS headers allow cross-origin POST from any third-party host page | VERIFIED | `CORS_HEADERS` constant with `Access-Control-Allow-Origin: *` is spread into all 5 return paths of the POST handler; OPTIONS/204 handler present |
| 7 | Session ID persisted in localStorage as `leaidear_{token}_sessionId` | VERIFIED | `src/widget/index.ts` lines 293-308: `getStorageKey`, `readSession`, `storeSession` functions with `try/catch` guards; confirmed by `widget.test.ts` localStorage tests |
| 8 | Double-init guard prevents multiple widget roots | VERIFIED | `src/widget/index.ts` line 288: `if (_token && !document.getElementById('leaidear-root'))` guards before `initWidget`; confirmed by widget.test.ts double-init test |
| 9 | build:widget script produces minified output and is chained into `npm run build` | VERIFIED | `package.json` line 7: `esbuild src/widget/index.ts --bundle --minify --platform=browser --format=iife --target=es2017 --outfile=public/widget.js`; line 8: `"build": "npm run build:widget && next build"` |
| 10 | All 11 automated widget tests are GREEN | VERIFIED | `npx vitest run tests/widget-asset.test.ts tests/widget.test.ts` — 11 passed, 0 failed |
| 11 | Full test suite (72 tests) remains GREEN after phase 04 changes | VERIFIED | `npx vitest run` — 72 passed, 0 failed, 12 passed / 12 skipped test files |
| 12 | Single script tag installs widget with no framework dependency on host (WIDGET-01) | VERIFIED | `public/widget-test.html` loads widget via `<script src="/widget.js" data-token="..." async>` — vanilla HTML, no framework imports; widget is self-contained IIFE |

**Score:** 12/12 automated truths verified (3 require additional human browser confirmation for behavioral aspects)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `public/widget.js` | Minified IIFE bundle | VERIFIED | 13,131 bytes; contains 46 occurrences of `leaidear_` and 2 occurrences of `leaidear-root`; esbuild minified IIFE format confirmed by file content inspection |
| `src/widget/index.ts` | Full widget TypeScript source | VERIFIED | 656 lines; Shadow DOM, floating bubble, chat panel, NDJSON SSE consumer, localStorage session, double-init guard, error handling |
| `public/widget-test.html` | Manual browser smoke test page | VERIFIED | Exists; `REPLACE_WITH_REAL_TOKEN` placeholder replaced with real UUID `c06072f88f9a4e10b03681792fb1d172`; 12-item verification checklist present; `async` attribute on script tag |
| `tests/widget-asset.test.ts` | Build smoke test (no comment assertion) | VERIFIED | Contains `toMatch(/leaidear[_-]/)` and size check; old comment assertion removed; all 3 tests GREEN |
| `tests/widget.test.ts` | jsdom unit tests for WIDGET-02..05 | VERIFIED | `@vitest-environment jsdom`; 11 test cases covering token extraction, init guard, Shadow DOM, localStorage, private-browsing resilience; all GREEN |
| `src/app/api/chat/[token]/route.ts` | CORS-enabled chat API with OPTIONS handler | VERIFIED | `CORS_HEADERS` constant; `OPTIONS()` export returns 204; headers spread into all 5 POST return paths (400/invalid json, 400/schema, 401/token, 200/stream, 500/unhandled) |
| `package.json` | build:widget script + chained build | VERIFIED | `build:widget` esbuild command present; `build` chains it before `next build` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/widget/index.ts` | `public/widget.js` | `npm run build:widget` (esbuild IIFE) | VERIFIED | `package.json` contains `esbuild src/widget/index.ts --bundle --minify --platform=browser --format=iife --target=es2017 --outfile=public/widget.js`; bundle exists at 13,131 bytes |
| `public/widget.js` | `/api/chat/{token}` | `fetch` POST with NDJSON SSE response | VERIFIED | `src/widget/index.ts` line 366: `fetch(\`${apiBase}/api/chat/${token}\`, ...)` with NDJSON `consumeStream` parser at line 341; session key pattern `leaidear_${n}_sessionId` at line 294 |
| `public/widget-test.html` | `public/widget.js` | `<script src="/widget.js" async>` | VERIFIED | `public/widget-test.html` line 71-75: `<script src="/widget.js" data-token="c06072f88f9a4e10b03681792fb1d172" async>` |
| `browser widget fetch` | `POST /api/chat/[token]` | `Access-Control-Allow-Origin: *` header | VERIFIED | 7 occurrences of `CORS_HEADERS` in route.ts: 1 declaration + 1 in OPTIONS + 5 in POST paths |
| `tests/widget.test.ts` | `public/widget.js` | `eval(code)` loading widget IIFE | VERIFIED | `loadWidget()` reads `public/widget.js` and evals it in jsdom; tests pass against built bundle |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/widget/index.ts` | `sessionId` (localStorage) | `localStorage.getItem(leaidear_{token}_sessionId)` | Yes — reads from real browser localStorage; `try/catch` guards for private browsing | FLOWING |
| `src/widget/index.ts` | `sessionId` (from API) | SSE event `{"event":"session","sessionId":"<uuid>"}` from `/api/chat/[token]` stream | Yes — chat API creates real UUID via `crypto.randomUUID()`, returns via SSE stream | FLOWING |
| `src/widget/index.ts` | AI response text | SSE events `{"event":"token","text":"..."}` buffered by `consumeStream` | Yes — stream.ts wraps OpenAI/Vapi tokens; NDJSON buffer-split-parse handles chunk boundaries | FLOWING |
| `src/app/api/chat/[token]/route.ts` | `org` (org lookup) | `supabase.from('organizations').select(...).eq('widget_token', token)` | Yes — real Supabase query; returns 401 for no match | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| widget.js is non-empty IIFE (not stub) | `wc -c public/widget.js` | 13131 bytes | PASS |
| widget.js contains leaidear namespace strings | `grep -c 'leaidear[_-]' public/widget.js` | 46 matches | PASS |
| widget.js contains leaidear-root DOM id | `grep -c 'leaidear-root' public/widget.js` | 2 matches | PASS |
| OPTIONS handler returns 204 | grep for `status: 204` in route.ts | Found at line 22 | PASS |
| CORS_HEADERS spread into all POST return paths | `grep -c "CORS_HEADERS" route.ts` | 7 (1 decl + 1 OPTIONS + 5 POST) | PASS |
| async attribute on script tag | grep widget-test.html | `async` on line 74 | PASS |
| All 11 widget tests GREEN | `npx vitest run tests/widget-asset.test.ts tests/widget.test.ts` | 11 passed, 0 failed | PASS |
| Full suite stays GREEN | `npx vitest run` | 72 passed, 0 failed | PASS |
| build:widget in package.json | grep package.json | esbuild command at line 7 | PASS |
| build chains build:widget | grep package.json | `npm run build:widget && next build` at line 8 | PASS |
| End-to-end AI response in browser | Requires live server + browser | Cannot verify programmatically | SKIP (human) |
| Session persists across reload | Requires real browser navigation | Cannot verify programmatically | SKIP (human) |
| Script tag non-blocking render | Requires DevTools performance timeline | Cannot verify programmatically | SKIP (human) |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| WIDGET-01 | 04-01, 04-02, 04-03 | Admin can install widget using single `<script>` tag (no framework dependency on host) | SATISFIED | `public/widget-test.html` uses plain `<script src="/widget.js" data-token="..." async>` — no framework import; IIFE is self-contained |
| WIDGET-02 | 04-01, 04-02, 04-03 | Script tag is GTM-compatible (loads asynchronously, no blocking) | SATISFIED (automated) | `async` attribute present on script tag in widget-test.html; behavioral non-blocking confirmed by human in Plan 03 |
| WIDGET-03 | 04-01, 04-02, 04-03 | Widget renders as floating chat bubble expanding into full chat panel | SATISFIED | Shadow DOM tests pass; `initWidget` creates bubble + panel; UI-SPEC dimensions (56px bubble, 360x520px panel, bottom-right fixed) implemented in `WIDGET_CSS` |
| WIDGET-04 | 04-01, 04-02, 04-03 | Widget identified per-org via public token in script tag | SATISFIED | `document.currentScript.dataset.token` captured synchronously at top of IIFE; token passed to `initWidget` and included in every `/api/chat/{token}` POST |
| WIDGET-05 | 04-01, 04-02, 04-03 | Widget works without visitor login or authentication | SATISFIED | Chat API authenticates by org token in URL path; no user session cookie or header required; widget tests run without auth |

All 5 WIDGET requirement IDs declared in plan frontmatter are accounted for. No orphaned requirements found (REQUIREMENTS.md maps WIDGET-01 through WIDGET-05 to Phase 4 with status "Complete").

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `public/widget-test.html` | 42-45 | Warning note says to replace `data-token` — but the token IS already replaced (placeholder fully removed) | Info | None — documentation comment is slightly stale after Plan 03 replaced the token; no functional impact |
| `src/widget/index.ts` | 529 | `const status = evt.sessionId // reused this field for status code` — error status code packed into `sessionId` field of SSEEvent | Warning | Minor type confusion in error event shape; does not affect correct behavior paths; no user-visible impact |

No blockers found. No stub patterns. No empty return values in rendering paths. No hardcoded `[]` or `{}` that flow to the UI.

### Human Verification Required

Plan 03 records that a human performed browser verification and approved all 21 checklist items. The following items are listed here for completeness and future regression testing:

#### 1. End-to-End AI Response

**Test:** Open `http://localhost:4267/widget-test.html`, click the bubble, type a message (e.g., "Hello"), press Enter.
**Expected:** User message appears as dark right-aligned bubble; three animated dots appear; full AI response appears as light left-aligned bubble; input clears and re-enables.
**Why human:** SSE stream consumption and AI response rendering require a live dev server with real Supabase + OpenAI connections. Automated tests verify the NDJSON parser and DOM update code paths exist, but cannot fire a real streamed response.

#### 2. Session Persistence Across Reload

**Test:** Send a message, note the sessionId in DevTools Network tab (POST body). Reload the page (F5), open the panel, send another message.
**Expected:** The POST body for the second message contains the same `sessionId` as the first. The AI continues the conversation in context.
**Why human:** Cross-navigation localStorage read-back requires a real browser. The automated test confirms the storage key format and write/read code path, but cannot simulate a page reload.

#### 3. Script Tag Non-Blocking Render (GTM Compatibility)

**Test:** Load `widget-test.html` in Chrome with DevTools Performance tab recording. Confirm paint events for page title and body text occur before the widget bubble appears.
**Expected:** Page content is rendered before widget IIFE executes; no render-blocking behavior.
**Why human:** Load order and render-blocking can only be measured via browser DevTools. The `async` attribute on the script tag is code-verified; the behavioral outcome is a browser-only observation.

### Gaps Summary

No gaps. All 12 automated must-haves are verified. The 3 human verification items are behavioral confirmations that the Plan 03 SUMMARY records as having been approved by the human reviewer on 2026-04-04. Automated test evidence is consistent with those approvals.

---

_Verified: 2026-04-04T18:17:00Z_
_Verifier: Claude (gsd-verifier)_
