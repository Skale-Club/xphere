// tests/tasks-actions.test.ts
// Phase 77 — Vitest tests for task server actions.
//
// Tier 1: module export smoke (always runs).
// Tier 2: vi.mock action-level unit tests — auth gate + zod validation + happy paths.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

// RBAC permission gate is exercised elsewhere; keep it transparent here so these
// task-CRUD unit tests stay focused on validation + happy paths.
vi.mock('@/lib/rbac/server', () => ({
  requirePermission: vi.fn().mockResolvedValue({ ok: true, error: null }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import {
  createTask,
  updateTask,
  deleteTask,
  getTasks,
  toggleTaskDone,
} from '@/app/(dashboard)/tasks/actions'

// ─── Tier 1 — module exports ──────────────────────────────────────────────────

describe('tasks actions exports', () => {
  it('exposes the 5 server actions', () => {
    expect(typeof createTask).toBe('function')
    expect(typeof updateTask).toBe('function')
    expect(typeof deleteTask).toBe('function')
    expect(typeof getTasks).toBe('function')
    expect(typeof toggleTaskDone).toBe('function')
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
    order: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    ...overrides,
  }
  // Fluent chain: most methods return `this`
  return base
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── createTask ───────────────────────────────────────────────────────────────

describe('createTask', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await createTask({ title: 'Test', priority: 'medium', status: 'todo' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('returns validation_error for empty title', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const result = await createTask({ title: '', priority: 'medium', status: 'todo' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('validation_error')
  })

  it('returns no_active_org when RPC returns null', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await createTask({ title: 'Test task', priority: 'medium', status: 'todo' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('no_active_org')
  })

  it('returns ok with task row on success', async () => {
    const taskRow = { id: 'task-1', title: 'Test task', status: 'todo', priority: 'medium' }
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ single: vi.fn().mockResolvedValue({ data: taskRow, error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await createTask({ title: 'Test task', priority: 'medium', status: 'todo' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.id).toBe('task-1')
  })

  it('returns error from supabase on DB failure', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ single: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await createTask({ title: 'Test task', priority: 'medium', status: 'todo' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('db error')
  })
})

// ─── updateTask ───────────────────────────────────────────────────────────────

describe('updateTask', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await updateTask('task-1', { title: 'Updated' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('returns ok with updated row on success', async () => {
    const taskRow = { id: 'task-1', title: 'Updated', status: 'todo' }
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ single: vi.fn().mockResolvedValue({ data: taskRow, error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await updateTask('task-1', { title: 'Updated' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.title).toBe('Updated')
  })

  it('returns not_found when row is null', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ single: vi.fn().mockResolvedValue({ data: null, error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await updateTask('task-1', { title: 'Updated' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_found')
  })
})

// ─── deleteTask ───────────────────────────────────────────────────────────────

describe('deleteTask', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await deleteTask('task-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('returns ok on success', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ eq: vi.fn().mockResolvedValue({ error: null }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await deleteTask('task-1')
    expect(result.ok).toBe(true)
  })

  it('returns error on DB failure', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ eq: vi.fn().mockResolvedValue({ error: { message: 'cannot delete' } }) })
    mockCreateClient.mockResolvedValue(sb)
    const result = await deleteTask('task-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('cannot delete')
  })
})

// ─── getTasks ─────────────────────────────────────────────────────────────────

describe('getTasks', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await getTasks()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('returns empty array when no tasks', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ order: vi.fn().mockReturnThis() })
    // The final call in the chain returns data
    ;(sb.order as ReturnType<typeof vi.fn>).mockReturnValueOnce(sb).mockResolvedValueOnce({ data: [], error: null })
    mockCreateClient.mockResolvedValue(sb)
    const result = await getTasks()
    expect(result.ok).toBe(true)
    if (result.ok) expect(Array.isArray(result.data)).toBe(true)
  })

  it('accepts valid filter params', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const sb = makeSupabase({ order: vi.fn().mockReturnThis() })
    ;(sb.order as ReturnType<typeof vi.fn>).mockReturnValueOnce(sb).mockResolvedValueOnce({ data: [], error: null })
    mockCreateClient.mockResolvedValue(sb)
    const result = await getTasks({ status: 'todo', priority: 'high' })
    expect(result.ok).toBe(true)
  })
})

// ─── toggleTaskDone ───────────────────────────────────────────────────────────

describe('toggleTaskDone', () => {
  it('returns not_authenticated when user is null', async () => {
    mockGetUser.mockResolvedValue(null)
    const result = await toggleTaskDone('task-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })

  it('flips todo → done', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const currentRow = { status: 'todo' }
    const updatedRow = { id: 'task-1', status: 'done' }
    let callCount = 0
    const singleMock = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: currentRow, error: null })
      return Promise.resolve({ data: updatedRow, error: null })
    })
    const sb = makeSupabase({ single: singleMock })
    mockCreateClient.mockResolvedValue(sb)
    const result = await toggleTaskDone('task-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe('done')
  })

  it('flips done → todo', async () => {
    mockGetUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' })
    const currentRow = { status: 'done' }
    const updatedRow = { id: 'task-1', status: 'todo' }
    let callCount = 0
    const singleMock = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ data: currentRow, error: null })
      return Promise.resolve({ data: updatedRow, error: null })
    })
    const sb = makeSupabase({ single: singleMock })
    mockCreateClient.mockResolvedValue(sb)
    const result = await toggleTaskDone('task-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe('todo')
  })
})
