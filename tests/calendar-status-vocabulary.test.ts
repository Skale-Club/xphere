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

const FILES_TO_SCAN = [
  'src/lib/calendar/transition.ts',
  'src/app/(dashboard)/calendar/_actions/bookings.ts',
  'src/lib/mcp/tools/bookings.ts',
  'src/lib/action-engine/executors/update-booking-status.ts',
  'src/lib/action-engine/executors/booking-lifecycle-actions.ts',
  'src/app/api/xkedule/webhook/route.ts',
  'src/lib/flows/engine.ts',
]

// src/lib/flows/engine.ts also writes `status: '...'` literals for two OTHER
// status columns that share this same `status: 'literal'` shape but belong to
// an entirely different domain: workflow_runs / workflow_run_steps / RunResult
// ('running' | 'succeeded' | 'failed' | 'waiting'). The scanner below is a
// plain-text regex with no table/column awareness, so it cannot tell those
// apart from a bookings.status write on its own -- allowlisted here by
// literal value (none of these four values collide with BOOKING_STATUSES) so
// the guard keeps catching genuine bookings.status regressions without
// false-positiving on a sibling status vocabulary that happens to live in the
// same file.
const NON_BOOKING_STATUS_LITERALS = ['running', 'succeeded', 'failed', 'waiting']

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
        if (NON_BOOKING_STATUS_LITERALS.includes(literal)) continue
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
