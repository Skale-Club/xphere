#!/usr/bin/env tsx
// scripts/meta-capi-worker.ts
// Thin dev wrapper. Production runs the same code from the app:
// GET /api/cron/meta-capi-worker (src/app/api/cron/meta-capi-worker/route.ts),
// logic in src/lib/meta/capi-worker.ts.
//
// Usage (from repo root):
//   tsx scripts/meta-capi-worker.ts
//   tsx scripts/meta-capi-worker.ts --org <org-id>
//   tsx scripts/meta-capi-worker.ts --test       # send with test_event_code
//   tsx scripts/meta-capi-worker.ts --dry-run    # log, do not POST
//
// Required env vars: the app's DB env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// or DB_JWT_SECRET + SUPABASE_REST_URL), ENCRYPTION_SECRET, META_SYSTEM_USER_TOKEN (fallback).

import { runCapiDrain } from '../src/lib/meta/capi-worker'

const args = process.argv.slice(2)
const orgFlag = args.indexOf('--org')

runCapiDrain({
  orgId: orgFlag >= 0 ? (args[orgFlag + 1] ?? null) : null,
  test: args.includes('--test'),
  dryRun: args.includes('--dry-run'),
  // A dev run has no 100s proxy in front of it.
  budgetMs: 10 * 60_000,
}).catch((err) => {
  console.error('[meta-capi-worker] fatal:', err)
  process.exit(1)
})
