// tests/twilio-numbers-actions.test.ts
// v2.3 — verifies the Zod validation and atomicity invariants of the new
// twilio_phone_numbers CRUD server actions.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock supabase server client ─────────────────────────────────────────────

const rpcMock = vi.fn()

interface FluentBuilder {
  select: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
}

function makeBuilder(): FluentBuilder {
  const b = {} as FluentBuilder
  b.select = vi.fn().mockReturnValue(b)
  b.insert = vi.fn().mockReturnValue(b)
  b.update = vi.fn().mockReturnValue(b)
  b.eq = vi.fn().mockReturnValue(b)
  b.neq = vi.fn().mockReturnValue(b)
  b.order = vi.fn().mockReturnValue(b)
  b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  b.single = vi.fn().mockResolvedValue({ data: null, error: null })
  return b
}

let builders: FluentBuilder[] = []
const fromMock = vi.fn(() => {
  const b = makeBuilder()
  builders.push(b)
  return b
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: fromMock, rpc: rpcMock })),
  getUser: vi.fn(async () => ({ id: 'user-1', email: 'u@example.com' })),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  rpcMock.mockReset()
  fromMock.mockClear()
  builders = []
})

// Imports must come AFTER vi.mock setup
const {
  createTwilioNumber,
  updateTwilioNumber,
  softDeleteTwilioNumber,
  setDefaultTwilioNumber,
} = await import('@/app/(dashboard)/integrations/twilio/numbers-actions')

// ── Zod validation ───────────────────────────────────────────────────────────

describe('createTwilioNumber — Zod validation', () => {
  it('rejects E.164 missing leading +', async () => {
    rpcMock.mockResolvedValue({ data: 'org-1' })
    const res = await createTwilioNumber({
      friendly_name: 'Sales',
      e164: '14155551234',
      capability_sms: true,
    } as never)
    expect(res.error).toMatch(/E\.164/i)
  })

  it('rejects E.164 starting with +0', async () => {
    rpcMock.mockResolvedValue({ data: 'org-1' })
    const res = await createTwilioNumber({
      friendly_name: 'Sales',
      e164: '+04155551234',
      capability_sms: true,
    } as never)
    expect(res.error).toMatch(/E\.164/i)
  })

  it('rejects when no capability is enabled', async () => {
    rpcMock.mockResolvedValue({ data: 'org-1' })
    const res = await createTwilioNumber({
      friendly_name: 'Sales',
      e164: '+14155551234',
      capability_sms: false,
      capability_mms: false,
      capability_voice: false,
    } as never)
    expect(res.error).toMatch(/capability/i)
  })

  it('rejects forward mode without forward_to_number', async () => {
    rpcMock.mockResolvedValue({ data: 'org-1' })
    const res = await createTwilioNumber({
      friendly_name: 'Sales',
      e164: '+14155551234',
      capability_voice: true,
      default_routing_mode: 'forward',
    } as never)
    expect(res.error).toMatch(/forward/i)
  })

  it('rejects friendly_name longer than 64 chars', async () => {
    rpcMock.mockResolvedValue({ data: 'org-1' })
    const res = await createTwilioNumber({
      friendly_name: 'x'.repeat(65),
      e164: '+14155551234',
      capability_sms: true,
    } as never)
    expect(res.error).toBeTruthy()
  })

  it('rejects malformed phone_sid (missing PN prefix)', async () => {
    rpcMock.mockResolvedValue({ data: 'org-1' })
    const res = await createTwilioNumber({
      friendly_name: 'Sales',
      e164: '+14155551234',
      phone_sid: 'AB1234567890abcdef1234567890abcdef',
      capability_sms: true,
    } as never)
    expect(res.error).toMatch(/Phone SID/i)
  })
})

// ── Default-toggle atomicity ────────────────────────────────────────────────

describe('createTwilioNumber — default toggle', () => {
  it('clears prior defaults before inserting a new default', async () => {
    rpcMock.mockResolvedValue({ data: 'org-1' })
    // Set up the insert to return a fake row so the action treats it as success.
    // The first builder is the UPDATE that clears prior defaults; the second
    // is the INSERT.
    let callIndex = 0
    fromMock.mockImplementation(() => {
      const b = makeBuilder()
      builders.push(b)
      if (callIndex === 1) {
        b.single.mockResolvedValue({
          data: { id: 'new-1', friendly_name: 'Sales' },
          error: null,
        })
      }
      callIndex++
      return b
    })

    await createTwilioNumber({
      friendly_name: 'Sales',
      e164: '+14155551234',
      capability_sms: true,
      is_default: true,
    } as never)

    expect(builders.length).toBeGreaterThanOrEqual(2)
    // First builder: UPDATE clearing prior defaults
    expect(builders[0].update).toHaveBeenCalledWith({ is_default: false })
    expect(builders[0].eq).toHaveBeenCalledWith('is_default', true)
    // Second builder: INSERT for the new row
    expect(builders[1].insert).toHaveBeenCalled()
  })

  it('does NOT issue a clearing UPDATE when is_default is false', async () => {
    rpcMock.mockResolvedValue({ data: 'org-1' })
    fromMock.mockImplementation(() => {
      const b = makeBuilder()
      builders.push(b)
      b.single.mockResolvedValue({
        data: { id: 'new-2', friendly_name: 'Sales' },
        error: null,
      })
      return b
    })

    await createTwilioNumber({
      friendly_name: 'Sales',
      e164: '+14155551234',
      capability_sms: true,
      is_default: false,
    } as never)

    // Only one builder used (the INSERT) — no separate UPDATE for clearing.
    const updateCalls = builders.flatMap((b) => b.update.mock.calls)
    expect(updateCalls.length).toBe(0)
  })
})

// ── Soft delete ─────────────────────────────────────────────────────────────

describe('softDeleteTwilioNumber', () => {
  it('updates is_active=false and is_default=false together', async () => {
    const res = await softDeleteTwilioNumber('row-1')
    expect(res.error).toBeUndefined()
    expect(builders[0].update).toHaveBeenCalledWith({
      is_active: false,
      is_default: false,
    })
    expect(builders[0].eq).toHaveBeenCalledWith('id', 'row-1')
  })
})

// ── Set default ─────────────────────────────────────────────────────────────

describe('setDefaultTwilioNumber', () => {
  it('rejects an inactive number', async () => {
    fromMock.mockImplementation(() => {
      const b = makeBuilder()
      builders.push(b)
      b.maybeSingle.mockResolvedValue({
        data: { id: 'row-1', is_active: false },
        error: null,
      })
      return b
    })

    const res = await setDefaultTwilioNumber('row-1')
    expect(res.error).toMatch(/inactive/i)
  })

  it('rejects a non-existent number', async () => {
    fromMock.mockImplementation(() => {
      const b = makeBuilder()
      builders.push(b)
      b.maybeSingle.mockResolvedValue({ data: null, error: null })
      return b
    })

    const res = await setDefaultTwilioNumber('row-missing')
    expect(res.error).toMatch(/not found/i)
  })

  it('clears prior default and sets new default for active number', async () => {
    let callIndex = 0
    fromMock.mockImplementation(() => {
      const b = makeBuilder()
      builders.push(b)
      if (callIndex === 0) {
        // Lookup: row exists and is active
        b.maybeSingle.mockResolvedValue({
          data: { id: 'row-1', is_active: true },
          error: null,
        })
      }
      callIndex++
      return b
    })

    const res = await setDefaultTwilioNumber('row-1')
    expect(res.error).toBeUndefined()
    // Builders: [0] lookup, [1] clear prior defaults, [2] set new default
    expect(builders.length).toBeGreaterThanOrEqual(3)
    expect(builders[1].update).toHaveBeenCalledWith({ is_default: false })
    expect(builders[2].update).toHaveBeenCalledWith({ is_default: true })
    expect(builders[2].eq).toHaveBeenCalledWith('id', 'row-1')
  })
})

// ── Update validation ───────────────────────────────────────────────────────

describe('updateTwilioNumber — Zod partial validation', () => {
  it('rejects forward mode without forward_to_number on partial update', async () => {
    const res = await updateTwilioNumber('row-1', {
      default_routing_mode: 'forward',
    } as never)
    expect(res.error).toMatch(/forward/i)
  })

  it('rejects update that toggles all capabilities off', async () => {
    const res = await updateTwilioNumber('row-1', {
      capability_sms: false,
      capability_mms: false,
      capability_voice: false,
    } as never)
    expect(res.error).toMatch(/capability/i)
  })

  it('accepts a friendly_name-only update', async () => {
    fromMock.mockImplementation(() => {
      const b = makeBuilder()
      builders.push(b)
      b.single.mockResolvedValue({
        data: { id: 'row-1', friendly_name: 'Sales BR' },
        error: null,
      })
      return b
    })

    const res = await updateTwilioNumber('row-1', { friendly_name: 'Sales BR' } as never)
    expect(res.error).toBeUndefined()
    expect(res.data?.friendly_name).toBe('Sales BR')
  })
})
