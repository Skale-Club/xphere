#!/usr/bin/env tsx
// Thin dev wrapper. Production runs the same code from the app:
// GET /api/cron/meta-audience-sync (src/app/api/cron/meta-audience-sync/route.ts),
// logic in src/lib/meta/audience-job.ts.
//
// Usage: tsx scripts/meta-audience-sync.ts [--org <id>] [--audience <id>] [--dry-run]

import { parseOptions, runAudienceJob } from '../src/lib/meta/audience-job'

async function main() {
  const options = parseOptions(process.argv.slice(2))
  console.log(`[meta-audience-sync] starting${options.dryRun ? ' dry-run' : ''}`)
  const report = await runAudienceJob(options)
  if (report.failed > 0) throw new Error(`${report.failed} Meta audience reconciliation(s) failed`)
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/meta-audience-sync.ts')) {
  main().catch((error) => {
    console.error('[meta-audience-sync] fatal:', error instanceof Error ? error.message : 'unknown error')
    process.exitCode = 1
  })
}
