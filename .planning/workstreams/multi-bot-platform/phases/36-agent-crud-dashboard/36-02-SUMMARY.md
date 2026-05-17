---
phase: 36-agent-crud-dashboard
plan: 02
subsystem: ui
tags: [shadcn, radix, react-hook-form, zod, nextjs-app-router, sidebar-nav]

# Dependency graph
requires:
  - phase: 33-schema-foundation-legacy-default-agent-backfill
    provides: "agents table + agent_channel enum (6 channels) + agent_model_pricing seed (7 models)"
  - phase: 36-agent-crud-dashboard/01
    provides: "agents.temperature + agents.max_tokens columns (migration 044)"
provides:
  - "shadcn Checkbox primitive (wraps @radix-ui/react-checkbox)"
  - "shadcn Collapsible primitive (wraps @radix-ui/react-collapsible)"
  - "src/lib/agents/slug.ts — slugify(name) helper (lowercase + hyphenate + 50-char cap)"
  - "src/lib/agents/models.ts — AVAILABLE_MODELS const (7 entries from D-36-09) + DEFAULT_MODEL"
  - "src/lib/agents/channels.ts — AGENT_CHANNELS const (6 channels) + AGENT_CHANNEL_LABELS"
  - "src/lib/agents/zod-schemas.ts — agentSchema + channelOverrideSchema (strips empty fields)"
  - "/agents, /agents/new, /agents/[id] route scaffolds (server components)"
  - "src/app/(dashboard)/agents/actions.ts — empty 'use server' module"
  - "AppSidebar — Agents nav entry with Bot icon, placed below Tools (D-36-11)"
affects: [36-03 (list page + channel defaults), 36-04 (edit form + tool picker), 36-05 (integration tests)]

# Tech tracking
tech-stack:
  added: [@radix-ui/react-checkbox@^1.3.3, @radix-ui/react-collapsible@^1.1.12]
  patterns:
    - "Shared form contracts in src/lib/agents/ (zod schemas + constants) — single source of truth for Plans 03/04"
    - "channel_overrides JSONB shape: empty fields stripped via .transform() so runtime fallback works"
    - "Page scaffolds use Next 15 await params pattern for [id] routes"

key-files:
  created:
    - src/components/ui/checkbox.tsx
    - src/components/ui/collapsible.tsx
    - src/lib/agents/slug.ts
    - src/lib/agents/models.ts
    - src/lib/agents/channels.ts
    - src/lib/agents/zod-schemas.ts
    - src/app/(dashboard)/agents/page.tsx
    - src/app/(dashboard)/agents/new/page.tsx
    - src/app/(dashboard)/agents/[id]/page.tsx
    - src/app/(dashboard)/agents/actions.ts
    - tests/agents/slug.test.ts
    - tests/agents/zod-schemas.test.ts
  modified:
    - src/components/layout/app-sidebar.tsx
    - package.json
    - package-lock.json

key-decisions:
  - "channel_overrides empty fields are stripped at schema-level (not at write-time) — keeps the runtime fallback honest"
  - "AGENT_CHANNEL_LABELS exported alongside AGENT_CHANNELS — Plans 03/04 use these for chip/dropdown rendering"
  - "EditAgentPage props use Promise<{id: string}> per Next 15 dynamic route convention"
  - "actions.ts uses `export {}` placeholder so empty 'use server' module compiles cleanly"

patterns-established:
  - "Pattern 1: src/lib/agents/* is the canonical contract surface — Plans 03/04 MUST import from here (no duplication)"
  - "Pattern 2: Shadcn shims follow src/components/ui/switch.tsx exactly (forwardRef + cn() + Radix re-export)"

requirements-completed: [AGENT-01, AGENT-02, AGENT-03, AGENT-08, TOOL-02, TOOL-03, TOOL-04]

# Metrics
duration: 15min
completed: 2026-05-16
---

# Phase 36 Plan 02: Wave 1 Setup Summary

**Two Radix primitives installed (Checkbox/Collapsible), src/lib/agents/ contract surface created (slug/models/channels/zod), agents route scaffolds wired, and Agents nav entry added — unlocks Plans 03/04.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-16T22:23:24Z
- **Completed:** 2026-05-16T22:38:26Z
- **Tasks:** 3/3
- **Files modified:** 13 (10 created + 3 modified)

## Accomplishments
- Installed `@radix-ui/react-checkbox` (^1.3.3) and `@radix-ui/react-collapsible` (^1.1.12) — the two missing shadcn-compatible primitives Plan 04 needs for the tool picker (collapsible folder tree) and channel multi-select.
- Authored `src/lib/agents/` (slug, models, channels, zod-schemas) — the single source of truth Plans 03/04 will consume; no duplication of model/channel constants.
- Scaffolded `/agents`, `/agents/new`, `/agents/[id]` routes + empty `actions.ts` ('use server' module) — all three render without runtime error.
- Added Agents nav entry (Bot icon from lucide-react) directly below Tools in `AppSidebar` per D-36-11.
- 15/15 Vitest assertions passing in `tests/agents/` (slugify behaviors + zod schema validation/transform).

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Radix Checkbox + Collapsible and create shadcn shims** — `735a62f` (feat)
2. **Task 2 (TDD RED): Failing tests for slug + zod-schemas** — `7f850bc` (test)
2. **Task 2 (TDD GREEN): Implement src/lib/agents/ helpers** — `8667e28` (feat)
3. **Task 3: Scaffold agents routes + sidebar entry** — `e68c312` (feat)

## Files Created/Modified

### Created
- `src/components/ui/checkbox.tsx` — shadcn Checkbox primitive (Radix Root + Indicator + Check icon)
- `src/components/ui/collapsible.tsx` — shadcn Collapsible primitive (re-exports Root/Trigger/Content)
- `src/lib/agents/slug.ts` — `slugify(input: string)` lowercase + hyphenate + 50-char truncate
- `src/lib/agents/models.ts` — `AVAILABLE_MODELS` (7 entries) + `DEFAULT_MODEL`
- `src/lib/agents/channels.ts` — `AGENT_CHANNELS` (6 entries) + `AGENT_CHANNEL_LABELS`
- `src/lib/agents/zod-schemas.ts` — `agentSchema` (full CRUD shape) + `channelOverrideSchema` (strips empties via `.transform()`)
- `src/app/(dashboard)/agents/page.tsx` — list page scaffold (Card placeholder; Plan 03 fills)
- `src/app/(dashboard)/agents/new/page.tsx` — create page scaffold (Plan 04 fills)
- `src/app/(dashboard)/agents/[id]/page.tsx` — edit page scaffold with Next 15 `await params`
- `src/app/(dashboard)/agents/actions.ts` — empty 'use server' module (Plans 03/04 export from here)
- `tests/agents/slug.test.ts` — 5 cases for slugify
- `tests/agents/zod-schemas.test.ts` — 10 cases across AVAILABLE_MODELS, AGENT_CHANNELS, agentSchema, channelOverrideSchema

### Modified
- `src/components/layout/app-sidebar.tsx` — added `Bot` to lucide-react import; inserted Agents nav entry directly below Tools entry (preserved existing array order and active-state matcher)
- `package.json` — added 2 Radix deps under `dependencies`
- `package-lock.json` — lockfile updated

## Sidebar Diff (before → after)

**Before:**
```
Dashboard / Phone / Tools / Knowledge / Integrations / Chat / Reviews
```

**After:**
```
Dashboard / Phone / Tools / Agents / Knowledge / Integrations / Chat / Reviews
                            ^^^^^^
```

## Verification Results

- `npx vitest run tests/agents/slug.test.ts tests/agents/zod-schemas.test.ts` — **15/15 passing** (5 slug + 10 zod-schemas)
- `npm run build` — **exit 0**, all routes including `/agents`, `/agents/[id]`, `/agents/new` registered as dynamic (ƒ) routes

## Decisions Made

- **`channel_overrides` empty-field stripping at zod transform level** (not at write-time) — keeps the runtime "key absent → use base agent value" fallback semantically clean. Plan 04 can pass user input directly through `channelOverrideSchema.parse()` and the result is safe to JSON-stringify into the DB.
- **`AGENT_CHANNEL_LABELS` exported alongside `AGENT_CHANNELS`** — Plans 03/04 will need display strings for chips and dropdowns; co-locating prevents drift.
- **`EditAgentPage` uses `Promise<{ id: string }>` props** — per Next 15 dynamic route convention used elsewhere in the codebase (matches `src/app/(dashboard)/tools/[toolConfigId]/page.tsx` pattern).
- **`actions.ts` uses `export {}` placeholder** — a 'use server' module with no exports throws a build warning; the placeholder satisfies the compiler until Plans 03/04 add real server actions.

## Deviations from Plan

None - plan executed exactly as written.

The plan's tasks, files, tests, and acceptance criteria were followed verbatim. The only environmental note is that the worktree branch was behind `main` at startup and a fast-forward merge of `main` was required to bring in Plan 01's migration 044 (agents.temperature + agents.max_tokens columns) and the rest of the Phase 36 planning docs. This is workspace plumbing, not a plan deviation.

## Issues Encountered

None — all three tasks ran first-time clean. TDD RED step confirmed (`ERR_MODULE_NOT_FOUND` for the four `src/lib/agents/*` modules before they existed); GREEN step turned all 15 assertions green in a single pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 03 and 04 can start immediately on top of these scaffolds with **zero new dependencies** needed.
- The contract surface (`agentSchema`, `channelOverrideSchema`, `AVAILABLE_MODELS`, `AGENT_CHANNELS`, `slugify`) is the single source of truth — Plans 03/04 should import from `@/lib/agents/*` rather than redefine.
- Sidebar route is live; clicking "Agents" loads the scaffold page (visible "Coming online" Card).
- `tests/agents/` directory is established; Plan 05 integration tests can co-locate there.

## Self-Check: PASSED

**Files verified:**
- FOUND: src/components/ui/checkbox.tsx
- FOUND: src/components/ui/collapsible.tsx
- FOUND: src/lib/agents/slug.ts
- FOUND: src/lib/agents/models.ts
- FOUND: src/lib/agents/channels.ts
- FOUND: src/lib/agents/zod-schemas.ts
- FOUND: src/app/(dashboard)/agents/page.tsx
- FOUND: src/app/(dashboard)/agents/new/page.tsx
- FOUND: src/app/(dashboard)/agents/[id]/page.tsx
- FOUND: src/app/(dashboard)/agents/actions.ts
- FOUND: tests/agents/slug.test.ts
- FOUND: tests/agents/zod-schemas.test.ts

**Commits verified:**
- FOUND: 735a62f (Task 1)
- FOUND: 7f850bc (Task 2 RED)
- FOUND: 8667e28 (Task 2 GREEN)
- FOUND: e68c312 (Task 3)

---
*Phase: 36-agent-crud-dashboard*
*Completed: 2026-05-16*
