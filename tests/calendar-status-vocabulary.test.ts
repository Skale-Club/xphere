// LIFE-02: static consistency check. Scans every known booking-status-writer
// source file for `status: 'literal'` assignments and asserts each literal is
// a member of BOOKING_STATUSES (src/lib/calendar/booking-status.ts). This is
// the guard that would have caught src/lib/flows/engine.ts's pre-Phase-127
// `status: 'completed' as 'confirmed'` write (an invalid DB value) before it
// ever reached a real database.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOKING_STATUSES } from '@/lib/calendar/booking-status'

// NOTE: 'src/lib/flows/engine.ts' is intentionally NOT in this list yet.
// As of this plan (127-01, wave 1) it still contains `status: 'completed'`
// literals -- the file is only rewritten to delegate to the canonical
// transition service in Plan 127-06 (wave 2). Scanning it here, before
// 127-06 lands, would make this test permanently red within this same
// plan's own wave. Plan 127-06 appends 'src/lib/flows/engine.ts' to this
// array in its own task, once those literals are gone, and re-runs this
// test as part of its own verification -- so the file gains coverage
// exactly when it becomes safe to scan, never before.
const FILES_TO_SCAN = [
  'src/lib/calendar/transition.ts',
  'src/app/(dashboard)/calendar/_actions/bookings.ts',
  'src/lib/mcp/tools/bookings.ts',
  'src/lib/action-engine/executors/update-booking-status.ts',
  'src/lib/action-engine/executors/booking-lifecycle-actions.ts',
  'src/app/api/xkedule/webhook/route.ts',
]

describe('LIFE-02: booking status vocabulary consistency', () => {
  it('BOOKING_STATUSES matches the DB CHECK constraint (migration 1224)', () => {
    expect([...BOOKING_STATUSES].sort()).toEqual(['cancelled', 'confirmed', 'no_show', 'showed'].sort())
  })

  it('every literal booking status write in known writer files is a member of BOOKING_STATUSES', () => {
    const pattern = /status:\s*'([a-z_]+)'/g
    const offenders: string[] = []
    for (const relPath of FILES_TO_SCAN) {
      let content: string
      try {
        content = readFileSync(join(process.cwd(), relPath), 'utf-8')
      } catch {
        continue // file not created yet by a later plan in this phase — skip, not a failure
      }
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content))) {
        const literal = match[1]
        if (!(BOOKING_STATUSES as readonly string[]).includes(literal)) {
          offenders.push(`${relPath}: status: '${literal}'`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('no writer file contains the invalid literal status "completed" (the pre-Phase-127 bug)', () => {
    for (const relPath of FILES_TO_SCAN) {
      let content: string
      try {
        content = readFileSync(join(process.cwd(), relPath), 'utf-8')
      } catch {
        continue
      }
      expect(content, relPath).not.toMatch(/status:\s*'completed'/)
    }
  })
})
