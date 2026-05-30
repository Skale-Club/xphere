// tests/contact-identity-impl.test.ts
//
// Phase 7 QA — Unit + integration tests for Contact Identity implementation
// (Phases 3–6 of the contact-identity-impl feature branch).
//
// Covers:
//   T-01  E.164 normalization (normalisePhone)
//   T-02  Email normalization (normaliseEmail)
//   T-03  findByPhone / findByEmail null short-circuit (unit)
//   T-04  getPendingMergeConflict + mergeContactAction exports (module smoke)
//   T-05  createContact sets channel_only for social source + no phone/email (unit)
//   DB-01 DB: findByPhone returns null for archived_duplicate contacts
//   DB-02 DB: findByEmail returns null for archived_duplicate contacts
//   DB-03 DB: channel_only contact can be inserted (satisfies deferrable trigger)
//
// DB tests soft-skip when SUPABASE_DB_URL / DATABASE_URL is not set,
// matching the precedent from contacts-unique-constraint.test.ts.

import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'

// Mock server-only so pure function modules can be imported outside Next.js.
vi.mock('server-only', () => ({}))

// Mock next/cache (revalidatePath is a no-op in tests).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// Keep the RBAC permission gate transparent — these tests cover contact identity.
vi.mock('@/lib/rbac/server', () => ({
  requirePermission: vi.fn().mockResolvedValue({ ok: true, error: null }),
}))

// ─── Unit imports ────────────────────────────────────────────────────────────

import { normalisePhone, normaliseEmail } from '@/lib/contacts/zod-schemas'

// ─── T-01: E.164 normalization ───────────────────────────────────────────────

describe('normalisePhone — E.164 normalization', () => {
  it('strips spaces, dashes, parentheses and preserves leading +', () => {
    // '+55 (11) 9 9999-9999' → '+' + '5511' + '9' + '9999' + '9999' = '+55119999999999' (14 digits)
    // but normalisePhone strips non-digits: '+' + '551199999999' (12 digits without spaces/parens)
    // Actual phone: +55 (11) 9 9999-9999 → digits 5511999999999 → '+5511999999999'
    expect(normalisePhone('+55 (11) 99999-9999')).toBe('+5511999999999')
  })
  it('handles digits-only (no +) input', () => {
    expect(normalisePhone('5511999999999')).toBe('5511999999999')
  })
  it('returns null for empty string', () => {
    expect(normalisePhone('')).toBeNull()
  })
  it('returns null for whitespace only', () => {
    expect(normalisePhone('   ')).toBeNull()
  })
  it('returns null for null input', () => {
    expect(normalisePhone(null)).toBeNull()
  })
  it('returns null for undefined input', () => {
    expect(normalisePhone(undefined)).toBeNull()
  })
  it('strips dots and hyphens from formatted US number', () => {
    expect(normalisePhone('+1 415-555-1234')).toBe('+14155551234')
  })
})

// ─── T-02: Email normalization ───────────────────────────────────────────────

describe('normaliseEmail — email normalization', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Jane@EXAMPLE.COM  ')).toBe('jane@example.com')
  })
  it('returns null for empty string', () => {
    expect(normaliseEmail('')).toBeNull()
  })
  it('returns null for whitespace only', () => {
    expect(normaliseEmail('   ')).toBeNull()
  })
  it('returns null for null', () => {
    expect(normaliseEmail(null)).toBeNull()
  })
  it('preserves dots in local part', () => {
    expect(normaliseEmail('First.Last@Example.com')).toBe('first.last@example.com')
  })
})

// ─── T-03: findByPhone / findByEmail null short-circuit ──────────────────────

describe('lib/contacts/server — findByPhone, findByEmail null short-circuit', () => {
  it('findByPhone returns null when phone normalizes to null (no DB call)', async () => {
    const { findByPhone } = await import('@/lib/contacts/server')
    const mockFrom = vi.fn()
    const mockSupabase = { from: mockFrom } as unknown as Parameters<typeof findByPhone>[0]
    const result = await findByPhone(mockSupabase, 'org-1', null)
    expect(result).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('findByEmail returns null when email normalizes to null (no DB call)', async () => {
    const { findByEmail } = await import('@/lib/contacts/server')
    const mockFrom = vi.fn()
    const mockSupabase = { from: mockFrom } as unknown as Parameters<typeof findByEmail>[0]
    const result = await findByEmail(mockSupabase, 'org-1', '')
    expect(result).toBeNull()
    expect(mockFrom).not.toHaveBeenCalled()
  })
})

// ─── T-04: module export smoke ────────────────────────────────────────────────

describe('Phase 6 exports — getPendingMergeConflict + mergeContactAction', () => {
  it('exports getPendingMergeConflict as a function', async () => {
    const { getPendingMergeConflict } = await import('@/app/(dashboard)/contacts/actions')
    expect(typeof getPendingMergeConflict).toBe('function')
  })

  it('exports mergeContactAction as a function', async () => {
    const { mergeContactAction } = await import('@/app/(dashboard)/contacts/actions')
    expect(typeof mergeContactAction).toBe('function')
  })
})

// ─── T-05: createContact channel_only for social sources ─────────────────────
// Mock supabase/server so we can test action-level logic without a real DB.

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

describe('createContact — channel_only for social source without phone/email', () => {
  it('passes identity_status: channel_only in the insert payload', async () => {
    const { createClient, getUser } = await import('@/lib/supabase/server')
    const mockGetUser = getUser as ReturnType<typeof vi.fn>
    const mockCreateClient = createClient as ReturnType<typeof vi.fn>

    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'test@test.com' })

    const insertedId = 'new-contact-id'
    const mockSingle = vi.fn().mockResolvedValue({ data: { id: insertedId }, error: null })

    let capturedInsertPayload: Record<string, unknown> | undefined
    const mockInsert = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      capturedInsertPayload = payload
      return { select: vi.fn().mockReturnValue({ single: mockSingle }) }
    })

    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null })
    const chainable = {
      eq: vi.fn(),
      neq: vi.fn(),
      maybeSingle: mockMaybeSingle,
    }
    chainable.eq.mockReturnValue(chainable)
    chainable.neq.mockReturnValue(chainable)

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        return {
          select: vi.fn().mockReturnValue(chainable),
          insert: mockInsert,
        }
      }
      if (table === 'tags') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [] }),
          }),
        }
      }
      return { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [] }) }
    })

    const supabaseMock = {
      rpc: vi.fn().mockResolvedValue({ data: 'org-1' }),
      from: mockFrom,
    }
    mockCreateClient.mockResolvedValue(supabaseMock)

    const { createContact } = await import('@/app/(dashboard)/contacts/actions')

    await createContact({
      first_name: 'Social',
      last_name: 'User',
      phone: '',
      email: '',
      source: 'instagram',
      tags: [],
    })

    expect(capturedInsertPayload).toBeDefined()
    expect(capturedInsertPayload?.identity_status).toBe('channel_only')
  })

  it('passes identity_status: identified when phone is provided', async () => {
    const { createClient, getUser } = await import('@/lib/supabase/server')
    const mockGetUser = getUser as ReturnType<typeof vi.fn>
    const mockCreateClient = createClient as ReturnType<typeof vi.fn>

    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'test@test.com' })

    const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'contact-2' }, error: null })

    let capturedInsertPayload: Record<string, unknown> | undefined
    const mockInsert = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      capturedInsertPayload = payload
      return { select: vi.fn().mockReturnValue({ single: mockSingle }) }
    })

    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null })
    const chainable = { eq: vi.fn(), neq: vi.fn(), maybeSingle: mockMaybeSingle }
    chainable.eq.mockReturnValue(chainable)
    chainable.neq.mockReturnValue(chainable)

    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === 'contacts') {
        return { select: vi.fn().mockReturnValue(chainable), insert: mockInsert }
      }
      if (table === 'tags') {
        return { select: vi.fn().mockReturnValue({ in: vi.fn().mockResolvedValue({ data: [] }) }) }
      }
      return { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [] }) }
    })

    const supabaseMock = {
      rpc: vi.fn().mockResolvedValue({ data: 'org-1' }),
      from: mockFrom,
    }
    mockCreateClient.mockResolvedValue(supabaseMock)

    const { createContact } = await import('@/app/(dashboard)/contacts/actions')

    await createContact({
      phone: '+15551234567',
      email: '',
      source: 'instagram',
      tags: [],
    })

    expect(capturedInsertPayload).toBeDefined()
    expect(capturedInsertPayload?.identity_status).toBe('identified')
  })
})

// ─── DB tests ────────────────────────────────────────────────────────────────

const DB_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
const hasPg = Boolean(DB_URL)
const dbSuite = hasPg ? describe : describe.skip

if (!hasPg) {
  console.warn(
    '[contact-identity-impl] SUPABASE_DB_URL missing — skipping DB integration tests',
  )
}

dbSuite('DB: Phase 3–5 integration proofs', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client } = require('pg') as typeof import('pg')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto')

  let probe: import('pg').Client
  let TEST_ORG_ID: string
  const cleanupIds: string[] = []

  beforeAll(async () => {
    probe = new Client({ connectionString: DB_URL })
    await probe.connect()
    const { rows } = await probe.query<{ id: string }>(
      'SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1',
    )
    if (!rows[0]) throw new Error('No organizations — cannot run DB tests')
    TEST_ORG_ID = rows[0].id
  }, 30000)

  afterAll(async () => {
    if (cleanupIds.length > 0) {
      await probe.query(
        'DELETE FROM public.contact_channel_identities WHERE contact_id = ANY($1)',
        [cleanupIds],
      )
      await probe.query('DELETE FROM public.contacts WHERE id = ANY($1)', [cleanupIds])
    }
    if (probe) await probe.end()
  }, 30000)

  it('DB-01: findByPhone returns null for archived_duplicate contact', async () => {
    const phone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`
    const id = randomUUID()
    cleanupIds.push(id)
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, phone, source, identity_status)
       VALUES ($1, $2, 'arch-phone-impl', $3, 'manual', 'archived_duplicate')`,
      [id, TEST_ORG_ID, phone],
    )

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createServiceRoleClient } = require('@/lib/supabase/admin') as typeof import('@/lib/supabase/admin')
    const { findByPhone } = await import('@/lib/contacts/server')
    const svc = createServiceRoleClient()

    const result = await findByPhone(svc, TEST_ORG_ID, phone)
    expect(result).toBeNull()
  }, 30000)

  it('DB-02: findByEmail returns null for archived_duplicate contact', async () => {
    const email = `arch-impl-${randomUUID()}@example.com`
    const id = randomUUID()
    cleanupIds.push(id)
    await probe.query(
      `INSERT INTO public.contacts (id, org_id, name, email, source, identity_status)
       VALUES ($1, $2, 'arch-email-impl', $3, 'manual', 'archived_duplicate')`,
      [id, TEST_ORG_ID, email],
    )

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createServiceRoleClient } = require('@/lib/supabase/admin') as typeof import('@/lib/supabase/admin')
    const { findByEmail } = await import('@/lib/contacts/server')
    const svc = createServiceRoleClient()

    const result = await findByEmail(svc, TEST_ORG_ID, email)
    expect(result).toBeNull()
  }, 30000)

  it('DB-03: channel_only contact with channel identity satisfies the deferrable trigger', async () => {
    const id = randomUUID()
    cleanupIds.push(id)
    const extId = `impl-ch-only-${id}`
    // Insert contact + identity in a single transaction (deferrable trigger fires at COMMIT)
    await probe.query('BEGIN')
    try {
      await probe.query(
        `INSERT INTO public.contacts (id, org_id, name, source, identity_status)
         VALUES ($1, $2, 'ImplChannelOnly', 'instagram', 'channel_only')`,
        [id, TEST_ORG_ID],
      )
      await probe.query(
        `INSERT INTO public.contact_channel_identities
           (org_id, contact_id, provider, external_id)
         VALUES ($1, $2, 'instagram', $3)`,
        [TEST_ORG_ID, id, extId],
      )
      await probe.query('COMMIT')
    } catch (err) {
      await probe.query('ROLLBACK').catch(() => {})
      throw err
    }
    const { rows } = await probe.query<{ identity_status: string }>(
      'SELECT identity_status FROM public.contacts WHERE id = $1',
      [id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].identity_status).toBe('channel_only')
  }, 30000)
})
