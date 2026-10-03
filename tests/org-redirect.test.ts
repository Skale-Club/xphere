import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ org: null as string | null }))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(state.org ? { 'x-xphere-org': state.org } : {}),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url })
  },
}))

import { orgRedirect } from '@/lib/org/redirect'

const A = '24552ef3-de77-4fba-a2c3-148cd58d8750'
const target = (p: Promise<never>) => p.catch((e: { url: string }) => e.url)

describe('orgRedirect', () => {
  beforeEach(() => {
    state.org = null
  })

  it('keeps the tab org prefix when the request carries one', async () => {
    state.org = A
    await expect(target(orgRedirect('/settings/profile'))).resolves.toBe(`/o/${A}/settings/profile`)
    await expect(target(orgRedirect('/calls?settings=numbers'))).resolves.toBe(`/o/${A}/calls?settings=numbers`)
  })

  it('redirects plainly without an org (or with a malformed one)', async () => {
    await expect(target(orgRedirect('/dashboard'))).resolves.toBe('/dashboard')
    state.org = 'not-a-uuid'
    await expect(target(orgRedirect('/dashboard'))).resolves.toBe('/dashboard')
  })
})
