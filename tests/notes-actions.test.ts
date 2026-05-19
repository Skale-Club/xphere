// tests/notes-actions.test.ts
// Phase 79 — Vitest tests for notes server actions.
//
// Tier 1: module export smoke (always runs).
// Tier 2: vi.mock action-level unit tests — auth gate + zod validation + happy paths.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import {
  createNote,
  updateNote,
  deleteNote,
  getNotes,
  toggleNotePin,
} from '@/app/(dashboard)/notes/actions'

// ─── Tier 1 — module exports ──────────────────────────────────────────────────

describe('notes actions exports', () => {
  it('exposes the 5 server actions', () => {
    expect(typeof createNote).toBe('function')
    expect(typeof updateNote).toBe('function')
    expect(typeof deleteNote).toBe('function')
    expect(typeof getNotes).toBe('function')
    expect(typeof toggleNotePin).toBe('function')
  })
})

// ─── Tier 2 — mocked unit tests ───────────────────────────────────────────────

const mockGetUser = getUser as ReturnType<typeof vi.fn>
const mockCreateClient = createClient as ReturnType<typeof vi.fn>

function makeSupabase(overrides: Record<string, unknown> = {}) {
  const base = {
    rpc: vi.fn().mockResolvedValue({ data: 'org-1', error: null }),
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    ...overrides,
  }
  return base
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── createNote ───────────────────────────────────────────────────────────────

describe('createNote', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await createNote({ content: 'Test note' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('returns validation_error for empty content', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const result = await createNote({ content: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('validation_error')
  })

  it('returns no_active_org when RPC returns null', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await createNote({ content: 'Test note' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('no_active_org')
  })

  it('returns ok with note row on success', async () => {
    const noteRow = { id: 'note-1', content: 'Test note', pinned: false }
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ single: vi.fn().mockResolvedValue({ data: noteRow, error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await createNote({ content: 'Test note' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe('note-1')
  })

  it('returns error from supabase on DB failure', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ single: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await createNote({ content: 'Test note' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('db error')
  })
})

// ─── updateNote ───────────────────────────────────────────────────────────────

describe('updateNote', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await updateNote('note-1', { content: 'Updated' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('returns ok with updated row on success', async () => {
    const noteRow = { id: 'note-1', content: 'Updated', pinned: false }
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ single: vi.fn().mockResolvedValue({ data: noteRow, error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await updateNote('note-1', { content: 'Updated' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.content).toBe('Updated')
  })

  it('returns not_found when row is null', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ single: vi.fn().mockResolvedValue({ data: null, error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await updateNote('note-1', { content: 'Updated' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_found')
  })
})

// ─── deleteNote ───────────────────────────────────────────────────────────────

describe('deleteNote', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await deleteNote('note-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('returns ok on success', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ eq: vi.fn().mockResolvedValue({ error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await deleteNote('note-1')
    expect(result.ok).toBe(true)
  })

  it('returns error on DB failure', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ eq: vi.fn().mockResolvedValue({ error: { message: 'cannot delete' } }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await deleteNote('note-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('cannot delete')
  })
})

// ─── getNotes ─────────────────────────────────────────────────────────────────

describe('getNotes', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await getNotes()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('returns empty array when no notes', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const orderChain = { order: vi.fn() }
    orderChain.order.mockReturnValueOnce(orderChain).mockResolvedValueOnce({ data: [], error: null })
    const sb = makeSupabase({ order: orderChain.order })
    mockCreateClient.mockResolvedValue(sb)
    const result = await getNotes()
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.isArray(result.data)).toBe(true)
  })

  it('accepts entity filter params', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const orderChain = { order: vi.fn() }
    orderChain.order.mockReturnValueOnce(orderChain).mockResolvedValueOnce({ data: [], error: null })
    const sb = makeSupabase({ order: orderChain.order })
    mockCreateClient.mockResolvedValue(sb)
    const result = await getNotes({ entity_type: 'contact', entity_id: 'c-1' })
    expect(result.ok).toBe(true)
  })
})

// ─── toggleNotePin ────────────────────────────────────────────────────────────

describe('toggleNotePin', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await toggleNotePin('note-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('flips pinned false → true', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const currentRow = { pinned: false }
    const updatedRow = { id: 'note-1', pinned: true }
    let callCount = 0
    const singleMock = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: currentRow, error: null })
      return Promise.resolve({ data: updatedRow, error: null })
    })
    const sb = makeSupabase({ single: singleMock })
    mockCreateClient.mockResolvedValue(sb)
    const result = await toggleNotePin('note-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.pinned).toBe(true)
  })

  it('flips pinned true → false', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const currentRow = { pinned: true }
    const updatedRow = { id: 'note-1', pinned: false }
    let callCount = 0
    const singleMock = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: currentRow, error: null })
      return Promise.resolve({ data: updatedRow, error: null })
    })
    const sb = makeSupabase({ single: singleMock })
    mockCreateClient.mockResolvedValue(sb)
    const result = await toggleNotePin('note-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.pinned).toBe(false)
  })
})
