import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const state = vi.hoisted(() => ({
  inserted: null as Record<string, unknown> | null,
  selectResult: { data: null as unknown, error: null as unknown },
  gtArgs: null as unknown[] | null,
  updates: [] as Record<string, unknown>[],
  deletedHash: null as string | null,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        state.inserted = row
        return Promise.resolve({ error: null })
      },
      select: () => {
        const q = {
          eq: () => q,
          gt: (...args: unknown[]) => {
            state.gtArgs = args
            return q
          },
          maybeSingle: () => Promise.resolve(state.selectResult),
        }
        return q
      },
      update: (patch: Record<string, unknown>) => {
        state.updates.push(patch)
        return { eq: () => Promise.resolve({ error: null }) }
      },
      delete: () => ({
        lt: () => Promise.resolve({ error: null }),
        eq: (_col: string, value: string) => {
          state.deletedHash = value
          return Promise.resolve({ error: null })
        },
      }),
    }),
  }),
}))

import { createSession, destroySession, resolveSession, SESSION_TTL_MS } from '@/lib/auth/session'

const sha = (v: string) => createHash('sha256').update(v).digest('hex')

beforeEach(() => {
  state.inserted = null
  state.selectResult = { data: null, error: null }
  state.gtArgs = null
  state.updates = []
  state.deletedHash = null
})

const userRow = {
  id: 'u1',
  email: 'a@b.co',
  phone: '+15085550100',
  user_metadata: { full_name: 'Ana' },
  created_at: '2026-01-01T00:00:00Z',
  last_sign_in_at: null,
}

describe('createSession', () => {
  it('returns a random token and stores only its sha-256', async () => {
    const { token, expiresAt } = await createSession('u1', { userAgent: 'UA', ip: '1.2.3.4' })
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(state.inserted?.token_hash).toBe(sha(token))
    expect(JSON.stringify(state.inserted)).not.toContain(token)
    expect(state.inserted).toMatchObject({ user_id: 'u1', user_agent: 'UA', ip: '1.2.3.4' })
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(SESSION_TTL_MS - 5000)
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
    const second = await createSession('u1')
    expect(second.token).not.toBe(token)
  })
})

describe('resolveSession', () => {
  it('asks the database only for unexpired rows', async () => {
    const before = Date.now()
    await resolveSession('tok')
    expect(state.gtArgs?.[0]).toBe('expires_at')
    expect(new Date(state.gtArgs?.[1] as string).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('returns null for an unknown or expired token', async () => {
    expect(await resolveSession('nope')).toBeNull()
    expect(await resolveSession('')).toBeNull()
  })

  it('returns the user and leaves a recently seen session alone', async () => {
    state.selectResult = {
      data: { id: 's1', last_seen_at: new Date().toISOString(), expires_at: 'x', users: userRow },
      error: null,
    }
    const user = await resolveSession('tok')
    expect(user).toMatchObject({ id: 'u1', email: 'a@b.co', phone: '+15085550100', user_metadata: { full_name: 'Ana' } })
    expect(state.updates).toHaveLength(0)
  })

  it('rolls the expiry forward when last seen over an hour ago, without blocking the read', async () => {
    state.selectResult = {
      data: { id: 's1', last_seen_at: new Date(Date.now() - 2 * 3600_000).toISOString(), expires_at: 'x', users: userRow },
      error: null,
    }
    const user = await resolveSession('tok')
    expect(user?.id).toBe('u1')
    expect(state.updates).toHaveLength(1)
    expect(new Date(state.updates[0].expires_at as string).getTime() - Date.now()).toBeGreaterThan(SESSION_TTL_MS - 5000)
  })
})

describe('destroySession', () => {
  it('deletes by token hash', async () => {
    await destroySession('tok')
    expect(state.deletedHash).toBe(sha('tok'))
  })
})
