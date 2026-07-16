// tests/ghl-no-bookings-writes.test.ts
//
// SYNC-02 (GHL half) — orchestrator-locked scope decision (see
// .planning/workstreams/calendar-reliability/phases/129-provider-synchronization-integrity/129-CONTEXT.md
// and 129-RESEARCH.md's "GHL Reality Check"): no GHL→bookings write path
// exists today. src/lib/ghl/create-appointment.ts and get-availability.ts
// call GHL's own REST API directly and never touch the native `bookings`
// table; the only GHL webhook route (/api/ghl/webhook) handles inbound
// text messages only, never appointment/booking events. Building a new
// GHL→bookings inbound sync path is explicitly OUT OF SCOPE (D-03: "no new
// providers" / no new bidirectional sync capability).
//
// This test is a structural guardrail, not a functional one: it fails if
// any future change adds a direct `bookings` table write inside
// src/lib/ghl/** or src/app/api/ghl/**, forcing that future work to route
// through the canonical lifecycle service (src/lib/calendar/transition.ts
// as of Phase 127) instead of writing bookings.status directly — the same
// discipline SYNC-02 enforces for the Xkedule inbound path.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src/lib/ghl', 'src/app/api/ghl']
const BOOKINGS_WRITE_PATTERN = /\.from\(\s*['"]bookings['"]\s*\)\s*\.(insert|update|upsert|delete)\s*\(/

function listFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listFilesRecursive(full)
    if (/\.(ts|tsx)$/.test(entry.name)) return [full]
    return []
  })
}

describe('SYNC-02 (GHL half): no direct bookings writes under src/lib/ghl or src/app/api/ghl', () => {
  it('Test 1: no file under the GHL surface writes to the bookings table directly', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      let files: string[] = []
      try {
        files = listFilesRecursive(join(process.cwd(), root))
      } catch {
        continue // root may not exist in some environments — not a failure
      }
      for (const file of files) {
        const contents = readFileSync(file, 'utf-8')
        if (BOOKINGS_WRITE_PATTERN.test(contents)) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
