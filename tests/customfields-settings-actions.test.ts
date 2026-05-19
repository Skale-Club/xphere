// tests/customfields-settings-actions.test.ts
// Phase 70-04 — Vitest unit tests for custom field definition server actions.
//
// Coverage: CF-01 (list), CF-02 (create/edit), CF-03 (archive), CF-04 (reorder).
//
// All tests run without a real DB (vi.mock replaces supabase/server).
// next/cache and next/navigation are no-ops to prevent SSR-context errors.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { getUser, createClient } from '@/lib/supabase/server'
import {
  getDefinitions,
  createDefinition,
  updateDefinition,
  archiveDefinition,
  reorderDefinitions,
} from '@/app/(dashboard)/settings/custom-fields/actions'

const mockUser = { id: 'user-1', email: 'test@test.com' }

const DEF_ID = '00000000-0000-0000-0000-000000000001'
const ORG_ID = '00000000-0000-0000-0000-000000000002'
const USER_ID = '00000000-0000-0000-0000-000000000003'
const DEF_A = '00000000-0000-0000-0000-000000000004'
const DEF_B = '00000000-0000-0000-0000-000000000005'
const DEF_C = '00000000-0000-0000-0000-000000000006'

const fakeDef = {
  id: DEF_ID,
  org_id: ORG_ID,
  entity: 'contact' as const,
  key: 'lead_score',
  label: 'Lead Score',
  type: 'number' as const,
  required: false,
  unique_per_org: false,
  visible_in_list: false,
  filterable: false,
  position: 1,
  group_name: null,
  help_text: null,
  default_value: null,
  options: null,
  validation: null,
  archived: false,
  created_by: USER_ID,
  created_at: '2026-05-18T00:00:00Z',
  updated_at: '2026-05-18T00:00:00Z',
}

// Build a thenable chain — .then() resolves to `result` by default
function thenableChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'insert', 'update', 'eq', 'order', 'limit']
  for (const m of methods) {
    chain[m] = vi.fn(() => chain)
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
  chain['single'] = vi.fn().mockResolvedValue(result)
  // Make the chain itself awaitable (for queries that don't end in .single())
  chain['then'] = (
    resolve: (v: typeof result) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject)

  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser)
})

// ─── getDefinitions ───────────────────────────────────────────────────────────

describe('getDefinitions', () => {
  it('returns definitions array for an entity', async () => {
    const chain = thenableChain({ data: [fakeDef], error: null })
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn().mockReturnValue(chain),
      rpc: vi.fn(),
    })

    const result = await getDefinitions({ entity: 'contact' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toHaveLength(1)
  })

  it('returns not_authenticated when user is null', async () => {
    ;(getUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const result = await getDefinitions({ entity: 'contact' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })
})

// ─── createDefinition ─────────────────────────────────────────────────────────

describe('createDefinition', () => {
  it('returns reserved_key without inserting when key is reserved', async () => {
    const insertSpy = vi.fn()
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn().mockReturnValue({ insert: insertSpy }),
      rpc: vi.fn().mockResolvedValue({ data: 'org-1', error: null }),
    })

    const result = await createDefinition({
      entity: 'contact',
      key: 'name', // reserved for contact
      label: 'Name',
      type: 'text',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('reserved_key')
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('inserts and returns new definition for valid input', async () => {
    const chain = thenableChain({ data: fakeDef, error: null })
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn().mockReturnValue(chain),
      rpc: vi.fn().mockResolvedValue({ data: 'org-1', error: null }),
    })

    const result = await createDefinition({
      entity: 'contact',
      key: 'lead_score',
      label: 'Lead Score',
      type: 'number',
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.key).toBe('lead_score')
  })

  it('returns not_authenticated when user is null', async () => {
    ;(getUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const result = await createDefinition({
      entity: 'contact',
      key: 'lead_score',
      label: 'Lead Score',
      type: 'number',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })
})

// ─── updateDefinition ─────────────────────────────────────────────────────────

describe('updateDefinition', () => {
  it('updates label and returns modified definition', async () => {
    const updated = { ...fakeDef, label: 'Updated Label' }
    // updateDefinition: .from().update().eq().select().single()
    const singleMock = vi.fn().mockResolvedValue({ data: updated, error: null })
    const selectMock = vi.fn().mockReturnValue({ single: singleMock })
    const eqMock = vi.fn().mockReturnValue({ select: selectMock })
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock })
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn().mockReturnValue({ update: updateMock }),
      rpc: vi.fn(),
    })

    const result = await updateDefinition({ id: DEF_ID, label: 'Updated Label' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.label).toBe('Updated Label')
  })

  it('returns not_authenticated when user is null', async () => {
    ;(getUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const result = await updateDefinition({ id: DEF_ID, label: 'X' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })
})

// ─── archiveDefinition ────────────────────────────────────────────────────────

describe('archiveDefinition', () => {
  it('calls update with archived=true and returns ok', async () => {
    const updateSpy = vi.fn()
    // archiveDefinition: .from().update({ archived: true }).eq(id)  — awaited directly
    const eqMock = vi.fn().mockResolvedValue({ data: null, error: null })
    updateSpy.mockReturnValue({ eq: eqMock })
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn().mockReturnValue({ update: updateSpy }),
      rpc: vi.fn(),
    })

    const result = await archiveDefinition({ id: DEF_ID })

    expect(result.ok).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ archived: true }))
  })

  it('returns not_authenticated when user is null', async () => {
    ;(getUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const result = await archiveDefinition({ id: DEF_ID })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })
})

// ─── reorderDefinitions ───────────────────────────────────────────────────────

describe('reorderDefinitions', () => {
  it('calls update position=index+1 for each id in orderedIds', async () => {
    const updateSpy = vi.fn()
    const eqMock = vi.fn().mockResolvedValue({ data: null, error: null })
    updateSpy.mockReturnValue({ eq: eqMock })
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      from: vi.fn().mockReturnValue({ update: updateSpy }),
      rpc: vi.fn(),
    })

    const result = await reorderDefinitions({
      entity: 'contact',
      orderedIds: [DEF_A, DEF_B, DEF_C],
    })

    expect(result.ok).toBe(true)
    expect(updateSpy).toHaveBeenCalledTimes(3)
    expect(updateSpy).toHaveBeenNthCalledWith(1, { position: 1 })
    expect(updateSpy).toHaveBeenNthCalledWith(2, { position: 2 })
    expect(updateSpy).toHaveBeenNthCalledWith(3, { position: 3 })
  })

  it('returns not_authenticated when user is null', async () => {
    ;(getUser as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const result = await reorderDefinitions({ entity: 'contact', orderedIds: [DEF_ID] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
  })
})
