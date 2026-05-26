// tests/contacts-csv-import.test.ts
// SEED-006 / v2.1 — CSV import: parsing, mapping suggestion, dedup logic.
//
// Phase 110 Plan 06 additions (D-06, D-06a, D-04a, CID-16):
//   - Pre-flight dedup uses normalized phone_e164/email_normalized (RESEARCH bug fix)
//   - Pre-flight surfaces wouldConflict + wouldBlockedEmail counters
//   - Blocked-email rows still import via phone (phone carries the contact)
//   - Batch INSERT chunk size remains 500 (Pitfall 3 — source-file assertion)
//
// We test the pure pre-flight LOGIC in isolation (no Supabase) by re-deriving
// the same predicates the action uses. Server-action E2E is covered by the
// wizard UI tests and manual QA.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCsv, suggestColumnMapping, CONTACT_FIELDS } from '@/lib/contacts/csv'
import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'
import { isBlockedEmail } from '@/lib/contacts/blocked-emails'

describe('parseCsv', () => {
  it('parses a simple CSV with headers and rows', () => {
    const txt = 'name,phone,email\nJane,+5511999999999,jane@x.com\nJohn,+5511888888888,john@x.com'
    const r = parseCsv(txt)
    expect(r.headers).toEqual(['name', 'phone', 'email'])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toEqual(['Jane', '+5511999999999', 'jane@x.com'])
    expect(r.rows[1]).toEqual(['John', '+5511888888888', 'john@x.com'])
  })

  it('handles quoted fields with embedded commas', () => {
    const txt = 'name,company\n"Doe, Jane","Acme, Inc."'
    const r = parseCsv(txt)
    expect(r.rows[0]).toEqual(['Doe, Jane', 'Acme, Inc.'])
  })

  it('handles escaped quotes ("")', () => {
    const txt = 'name,notes\n"Jane","She said ""hi"""'
    const r = parseCsv(txt)
    expect(r.rows[0]).toEqual(['Jane', 'She said "hi"'])
  })

  it('handles CRLF line endings', () => {
    const txt = 'name,phone\r\nJane,123\r\nJohn,456\r\n'
    const r = parseCsv(txt)
    expect(r.rows).toHaveLength(2)
  })

  it('trims trailing blank rows', () => {
    const txt = 'name\nJane\n\n\n'
    const r = parseCsv(txt)
    expect(r.rows).toEqual([['Jane']])
  })

  it('returns empty result on empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
  })
})

describe('suggestColumnMapping', () => {
  it('maps obvious English headers', () => {
    const m = suggestColumnMapping(['Name', 'Phone', 'Email', 'Company', 'Notes', 'Tags'])
    expect(m['Name']).toBe('name')
    expect(m['Phone']).toBe('phone')
    expect(m['Email']).toBe('email')
    expect(m['Company']).toBe('company')
    expect(m['Notes']).toBe('notes')
    expect(m['Tags']).toBe('tags')
  })

  it('maps Portuguese variants', () => {
    const m = suggestColumnMapping(['nome', 'telefone', 'empresa'])
    expect(m['nome']).toBe('name')
    expect(m['telefone']).toBe('phone')
    expect(m['empresa']).toBe('company')
  })

  it('maps WhatsApp/mobile variants to phone', () => {
    expect(suggestColumnMapping(['WhatsApp'])['WhatsApp']).toBe('phone')
    expect(suggestColumnMapping(['Mobile'])['Mobile']).toBe('phone')
    expect(suggestColumnMapping(['celular'])['celular']).toBe('phone')
  })

  it('returns null for unknown columns', () => {
    const m = suggestColumnMapping(['frobnication_factor'])
    expect(m['frobnication_factor']).toBeNull()
  })

  it('every suggestion is a CONTACT_FIELDS member or null', () => {
    const m = suggestColumnMapping(['name', 'phone', 'unknown'])
    for (const v of Object.values(m)) {
      if (v !== null) expect(CONTACT_FIELDS).toContain(v)
    }
  })
})

describe('import dedup logic (unit-level)', () => {
  it('normalisePhone yields a stable key for varied formats', () => {
    expect(normalisePhone('+55 (11) 99999-9999')).toBe(normalisePhone('+5511999999999'))
    expect(normalisePhone('+55-11-99999.9999')).toBe('+5511999999999')
  })

  it('different formats hash to the same dedup key', () => {
    const seen = new Set<string>()
    const candidates = ['+55 (11) 99999-9999', '+5511999999999', '+55-11-99999-9999']
    for (const c of candidates) {
      const k = normalisePhone(c)
      if (k) seen.add(k)
    }
    expect(seen.size).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Phase 110 Plan 06 — pre-flight refactor coverage (D-06, D-04a, CID-16)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-implements the (pure) pre-flight scan that lives inside `importContactsCsv`
 * so we can assert its behavior without a Supabase round-trip. The set arguments
 * stand in for what the action computes from `SELECT phone_e164, email_normalized`.
 *
 * Mirrors the live code closely:
 *   - phone dedup wins over email (matches actions.ts line ~810)
 *   - blocked emails are treated as null but the row still imports if phone is valid
 *   - conflictRows counts skip-due-to-existing-match
 */
function preflightScan(
  rows: Array<{ phone?: string | null; email?: string | null }>,
  existingPhones: Set<string>,
  existingEmails: Set<string>,
) {
  const summary = { willCreate: 0, willSkip: 0, conflictRows: 0, blockedEmailCount: 0 }
  const seenPhones = new Set<string>()
  const seenEmails = new Set<string>()
  for (const row of rows) {
    const phone = normalisePhone(row.phone ?? null)
    const rawEmail = normaliseEmail(row.email ?? null)
    const finalEmail = rawEmail && !isBlockedEmail(rawEmail) ? rawEmail : null
    if (rawEmail && !finalEmail) summary.blockedEmailCount++

    if (!phone && !finalEmail) {
      summary.willSkip++
      continue
    }
    if (phone && (existingPhones.has(phone) || seenPhones.has(phone))) {
      summary.willSkip++
      summary.conflictRows++
      continue
    }
    if (!phone && finalEmail && (existingEmails.has(finalEmail) || seenEmails.has(finalEmail))) {
      summary.willSkip++
      summary.conflictRows++
      continue
    }
    if (phone) seenPhones.add(phone)
    if (finalEmail) seenEmails.add(finalEmail)
    summary.willCreate++
  }
  return summary
}

describe('Phase 110-06 — CSV pre-flight (normalized columns + blocklist)', () => {
  it('detects conflict when CSV phone in mixed formatting matches stored phone_e164 (RESEARCH bug fix)', () => {
    // Existing contact stored with the normalized E.164 form.
    const existingPhones = new Set(['+5511999990000'])
    // CSV row with the SAME number but human-formatted (parens, spaces, dashes).
    const result = preflightScan(
      [{ phone: '+55 (11) 99999-0000', email: 'someone@gmail.com' }],
      existingPhones,
      new Set(),
    )
    expect(result.conflictRows).toBe(1)
    expect(result.willSkip).toBe(1)
    expect(result.willCreate).toBe(0)
  })

  it('reports blockedEmailCount when CSV row email is noemail@example.com', () => {
    const result = preflightScan(
      [{ phone: '+5511988887777', email: 'noemail@example.com' }],
      new Set(),
      new Set(),
    )
    expect(result.blockedEmailCount).toBe(1)
    // Row still creates (phone carries the contact) — D-04a phone-carries-contact path.
    expect(result.willCreate).toBe(1)
    expect(result.willSkip).toBe(0)
  })

  it('row with blocked email AND no phone is skipped (no identifier left)', () => {
    const result = preflightScan(
      [{ phone: null, email: 'placeholder@x.com' }],
      new Set(),
      new Set(),
    )
    expect(result.blockedEmailCount).toBe(1)
    expect(result.willSkip).toBe(1)
    expect(result.willCreate).toBe(0)
    expect(result.conflictRows).toBe(0) // blocklist drop is NOT a conflict
  })

  it('email-only dedup hits when phone is absent and email_normalized matches', () => {
    const existingEmails = new Set(['jane@example.io'])
    const result = preflightScan(
      [{ phone: null, email: 'Jane@Example.IO' }], // case + format variation
      new Set(),
      existingEmails,
    )
    expect(result.conflictRows).toBe(1)
    expect(result.willSkip).toBe(1)
  })

  it('aggregates counts across a mixed batch', () => {
    const existingPhones = new Set(['+5511999990000'])
    const existingEmails = new Set(['dup@gmail.com'])
    const result = preflightScan(
      [
        { phone: '+55 (11) 99999-0000', email: null }, // conflict (phone)
        { phone: null, email: 'dup@gmail.com' },        // conflict (email)
        { phone: '+5511988887777', email: 'noemail@example.com' }, // blocked email, still creates via phone
        { phone: null, email: 'noemail@foo.com' },      // blocked + no phone → skip
        { phone: '+5511977776666', email: 'real@gmail.com' }, // creates
      ],
      existingPhones,
      existingEmails,
    )
    expect(result.conflictRows).toBe(2)
    expect(result.blockedEmailCount).toBe(2)
    expect(result.willCreate).toBe(2)
    expect(result.willSkip).toBe(3) // 2 conflicts + 1 blocked-no-phone
  })

  it('in-batch duplicates are counted as conflicts (seenInBatch* sets)', () => {
    const result = preflightScan(
      [
        { phone: '+5511955554444', email: null },
        { phone: '+55 (11) 95555-4444', email: null }, // same number, different formatting
      ],
      new Set(),
      new Set(),
    )
    expect(result.willCreate).toBe(1)
    expect(result.conflictRows).toBe(1)
  })
})

describe('Phase 110-06 — batch INSERT chunk size preserved (Pitfall 3)', () => {
  it('actions.ts still uses CHUNK = 500 for the batch insert loop', () => {
    // Source-file assertion: if someone changes the chunk size, this test fails
    // loudly. The 500-row chunk is a hard-won perf/safety balance documented
    // in the plan and RESEARCH; do not regress without explicit review.
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/(dashboard)/contacts/actions.ts'),
      'utf8',
    )
    expect(src).toMatch(/const\s+CHUNK\s*=\s*500/)
  })

  it('actions.ts dedup loads normalized columns (RESEARCH bug fix)', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/(dashboard)/contacts/actions.ts'),
      'utf8',
    )
    expect(src).toMatch(/phone_e164/)
    expect(src).toMatch(/email_normalized/)
    expect(src).toMatch(/archived_duplicate/)
  })

  it('import-actions.ts dryRunImport returns wouldConflict + wouldBlockedEmail', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/(dashboard)/contacts/import-actions.ts'),
      'utf8',
    )
    expect(src).toMatch(/wouldConflict/)
    expect(src).toMatch(/wouldBlockedEmail/)
    expect(src).toMatch(/phone_e164/)
    expect(src).toMatch(/email_normalized/)
  })
})
