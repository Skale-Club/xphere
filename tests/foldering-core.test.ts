import { describe, it, expect } from 'vitest'

// Signature/behavior smoke for the universal foldering core (Phase 114, UFE-02).
//
// Pure unit test — NO network, NO real Supabase. The `folders` table does not
// yet exist in the remote DB (migration 1225 committed but unapplied), so we
// prove the module's exported surface + entity_type scoping against a fluent
// in-memory stub rather than a live database.

import * as core from '@/lib/foldering/core'
import type { FolderingContext } from '@/lib/foldering/core'

// ─── Fluent Supabase stub ──────────────────────────────────────────────────────
//
// Every builder method returns the same chain and records `{ method, args }`.
// Terminal awaits resolve to `{ data: [], error: null }`. This lets us assert
// which table was queried and which `.eq(...)` filters were applied without a
// real backend.

function makeStub() {
  const calls: { method: string; args: unknown[] }[] = []

  const chain: Record<string, unknown> = {
    then: undefined, // not a thenable itself; terminal awaits use resolved value
  }

  const record = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
      return chain
    }

  for (const method of [
    'from',
    'select',
    'insert',
    'update',
    'delete',
    'eq',
    'order',
    'in',
    'is',
    'limit',
  ]) {
    chain[method] = record(method)
  }

  // `single()` and awaiting the chain both resolve to an empty success result.
  chain.single = () => Promise.resolve({ data: null, error: null })
  // Make the chain awaitable → resolves to { data: [], error: null }.
  chain.then = (resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null })

  const supabase = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] })
      return chain
    },
    rpc: (name: string) => {
      calls.push({ method: 'rpc', args: [name] })
      return Promise.resolve({ data: 'org-1', error: null })
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: 'u-1' } }, error: null }),
    },
  }

  return { supabase, calls }
}

function makeCtx() {
  const { supabase, calls } = makeStub()
  const ctx: FolderingContext = {
    supabase: supabase as never,
    entityType: 'workflow',
    itemTable: 'workflows',
  }
  return { ctx, calls }
}

// ─── Test 1: exported surface ──────────────────────────────────────────────────

describe('foldering/core exported surface', () => {
  const expected = [
    'listFolders',
    'createFolder',
    'renameFolder',
    'updateFolderMeta',
    'reorderFolders',
    'moveFolder',
    'archiveFolder',
    'deleteFolder',
    'moveItemToFolder',
    'reorderItemsInFolder',
  ] as const

  it('exposes all ten functions as callable functions', () => {
    for (const name of expected) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe('function')
    }
  })
})

// ─── Test 2: listFolders scopes by entity_type ────────────────────────────────

describe('listFolders', () => {
  it("queries from('folders') and filters by entity_type", async () => {
    const { ctx, calls } = makeCtx()

    const result = await core.listFolders(ctx)
    expect(result.ok).toBe(true)

    const fromCall = calls.find((c) => c.method === 'from')
    expect(fromCall?.args[0]).toBe('folders')

    const entityEq = calls.find(
      (c) =>
        c.method === 'eq' &&
        c.args[0] === 'entity_type' &&
        c.args[1] === 'workflow',
    )
    expect(entityEq).toBeDefined()
  })
})

// ─── Test 3: createFolder guards empty name ───────────────────────────────────

describe('createFolder', () => {
  it('rejects a whitespace-only name with name_required (no DB call)', async () => {
    const { ctx } = makeCtx()

    const result = await core.createFolder(ctx, { name: '   ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('name_required')
  })
})
