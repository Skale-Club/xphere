---
phase: 01-foundation
plan: "03"
subsystem: infra
tags: [redis, node-redis, singleton, widget, hmr-guard]

# Dependency graph
requires:
  - phase: 01-01
    provides: Brand rename and project setup needed before infra modules land

provides:
  - "src/lib/redis.ts — singleton Redis client with HMR guard for Phase 2 chat session storage"
  - "public/widget.js — static widget placeholder served at /widget.js"
  - "REDIS_URL documented in .env.local.example"

affects:
  - "02-chat-api"
  - "03-ai-engine"
  - "04-widget-embed"

# Tech tracking
tech-stack:
  added: ["redis@5.x (npm node-redis package)"]
  patterns:
    - "globalThis HMR guard for Next.js singleton modules"
    - "Graceful Redis error handling — log but don't crash"

key-files:
  created:
    - "src/lib/redis.ts"
    - "public/widget.js"
  modified:
    - ".env.local.example"
    - "package.json"
    - "package-lock.json"

key-decisions:
  - "Used redis npm package (not @upstash/redis) for provider-agnostic URL-based connection"
  - "globalThis._redisClient guard reuses connection across HMR reloads in development"
  - "Connection errors logged via client.on('error') but never throw — graceful degradation"
  - "widget.js is a static stub; Phase 4 replaces it with the real embed script"

patterns-established:
  - "HMR singleton guard: process.env.NODE_ENV !== 'production' ? (global._x ??= build()) : build()"
  - "Redis error logging pattern: client.on('error', err => console.error('[redis] error:', err.message))"

requirements-completed: ["INFRA-01", "INFRA-04"]

# Metrics
duration: 5min
completed: "2026-04-04"
---

# Phase 01 Plan 03: Redis Client + Widget Placeholder Summary

**Singleton Redis client (redis npm, globalThis HMR guard) and Leaidear widget stub delivering INFRA-01 and INFRA-04**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-04T05:10:00Z
- **Completed:** 2026-04-04T05:15:55Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Installed `redis` npm package and created `src/lib/redis.ts` with globalThis HMR guard and graceful error handling
- Created `public/widget.js` Leaidear stub file served statically by Next.js
- Documented `REDIS_URL` in `.env.local.example` with local dev and Upstash guidance
- All 4 automated tests pass GREEN (2 redis + 2 widget-asset)
- Build exits 0 with no TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Install redis package and create singleton client module** - `bb4975f` (feat)
2. **Task 2: Create widget placeholder and update .env.local.example** - `b9fbe4d` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/lib/redis.ts` - Singleton Redis client with HMR guard, graceful error handling
- `public/widget.js` - Leaidear widget stub comment placeholder
- `.env.local.example` - Added REDIS_URL with dev/production guidance
- `package.json` - Added redis dependency
- `package-lock.json` - Updated lockfile

## Decisions Made
- Used `redis` npm package (not `@upstash/redis`) per D-04 — URL-based connection works with local Redis and Upstash without provider lock-in
- globalThis guard mirrors supabase/server.ts singleton pattern per D-06
- Graceful error handling per D-07 — connection errors logged but never crash the process

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The `[redis] error:` stderr line in test output is expected — Redis isn't running locally during tests, and the error-handler correctly logs it without throwing.

## User Setup Required

**External services require manual configuration:**

- **Environment variable to add:** `REDIS_URL`
  - Local dev: `redis://localhost:6379` (requires `redis-server` running)
  - Production: Upstash Redis dashboard → Databases → Connect → copy Redis URL

No dashboard configuration steps beyond copying the URL.

## Next Phase Readiness
- `src/lib/redis.ts` is ready to be imported by Phase 2 chat API route handlers
- `public/widget.js` resolves at `https://voiceops.skale.club/widget.js` — Phase 4 replaces with real embed
- Phase 2 requires `REDIS_URL` set in Vercel env vars before chat sessions can persist

---
*Phase: 01-foundation*
*Completed: 2026-04-04*
