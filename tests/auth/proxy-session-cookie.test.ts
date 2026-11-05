import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/security/bot-defense', () => ({
  banRemainingMs: () => 0,
  checkTrap: () => ({ trapped: false }),
  clientIpFromHeaders: () => '1.2.3.4',
}))

import { proxy } from '@/proxy'
import { SESSION_COOKIE } from '@/lib/auth/session-cookie'

function request(path: string, cookie?: string) {
  return new NextRequest(`https://xphere.app${path}`, {
    headers: cookie ? { cookie } : {},
  })
}

describe('proxy session cookie', () => {
  it('re-issues the same value with a fresh 30-day max-age on page requests', async () => {
    const res = await proxy(request('/dashboard', `${SESSION_COOKIE}=abc123`))
    const cookie = res.cookies.get(SESSION_COOKIE)
    expect(cookie?.value).toBe('abc123')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(cookie?.path).toBe('/')
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60)
  })

  it('sets nothing when there is no session cookie', async () => {
    const res = await proxy(request('/dashboard'))
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined()
  })

  it('leaves API paths alone', async () => {
    const res = await proxy(request('/api/chat/x', `${SESSION_COOKIE}=abc123`))
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined()
  })

  it('keeps the org pin: /o/<id>/route is rewritten and still gets the cookie', async () => {
    const org = '11111111-1111-4111-8111-111111111111'
    const res = await proxy(request(`/o/${org}/contacts`, `${SESSION_COOKIE}=abc123`))
    expect(res.headers.get('x-middleware-rewrite')).toContain('/contacts')
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBe('abc123')
  })
})
