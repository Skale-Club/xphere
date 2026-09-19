import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Contract tests for the email/password sign-in actions.
 *
 * THE REGRESSION THESE GUARD: `signInWithEmail` used to end with
 * `redirect('/dashboard')`. A redirect inside a Server Action makes the Next
 * router REJECT the action's promise on the client (NEXT_REDIRECT). In the
 * login dialog that rejection unwound react-hook-form's submit state, the
 * "Sign in" button went live again while /dashboard was still rendering, and a
 * second click opened a second session — the "I had to log in twice" bug.
 *
 * The action must therefore RESOLVE with `hasSession: true` and let the client
 * navigate while holding its own lock.
 */

const cookieJar = { set: vi.fn() }

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieJar),
}))

const mockSupabase = {
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
  },
  rpc: vi.fn(),
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

import { signInWithEmail, signUpWithEmail } from '@/actions/auth'

/** `.from('organizations').select().eq().single()` */
function organizationsStub(org: { id: string; name: string } | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: org, error: null }),
  }
}

describe('AUTH-01: Sign-in with email and password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.rpc.mockResolvedValue({ data: 'org-1' })
    mockSupabase.from.mockReturnValue(organizationsStub({ id: 'org-1', name: 'Acme' }))
  })

  it('resolves with hasSession instead of throwing a redirect when credentials are valid', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'token' } },
      error: null,
    })

    const result = await signInWithEmail({ email: 'a@example.com', password: 'secret123' })

    expect(result).toEqual({ ok: true, hasSession: true })
  })

  it('seeds the active-org cookie so the first dashboard render has org context', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'token' } },
      error: null,
    })

    await signInWithEmail({ email: 'a@example.com', password: 'secret123' })

    expect(cookieJar.set).toHaveBeenCalledWith(
      'vo_active_org',
      JSON.stringify({ id: 'org-1', name: 'Acme' }),
      expect.objectContaining({ path: '/' }),
    )
  })

  it('returns a friendly error when credentials are invalid', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    })

    const result = await signInWithEmail({ email: 'a@example.com', password: 'wrong' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorMessage).toContain('Invalid email or password')
    }
    expect(cookieJar.set).not.toHaveBeenCalled()
  })

  it('does not fail the sign-in when the user has no resolvable org', async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'token' } },
      error: null,
    })
    mockSupabase.rpc.mockResolvedValue({ data: null })

    const result = await signInWithEmail({ email: 'a@example.com', password: 'secret123' })

    expect(result).toEqual({ ok: true, hasSession: true })
    expect(cookieJar.set).not.toHaveBeenCalled()
  })
})

describe('AUTH-02: Sign-up with email and password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabase.rpc.mockResolvedValue({ data: 'org-1' })
    mockSupabase.from.mockReturnValue(organizationsStub({ id: 'org-1', name: 'Acme' }))
  })

  it('reports hasSession false when the account still needs email confirmation', async () => {
    mockSupabase.auth.signUp.mockResolvedValue({
      data: { session: null, user: { id: 'u1' } },
      error: null,
    })

    const result = await signUpWithEmail({ email: 'new@example.com', password: 'secret123' })

    expect(result).toEqual({ ok: true, hasSession: false })
  })

  it('resolves with hasSession when confirmations are disabled', async () => {
    mockSupabase.auth.signUp.mockResolvedValue({
      data: { session: { access_token: 'token' }, user: { id: 'u1' } },
      error: null,
    })

    const result = await signUpWithEmail({ email: 'new@example.com', password: 'secret123' })

    expect(result).toEqual({ ok: true, hasSession: true })
  })
})

describe('AUTH-03: Sign-out from any page', () => {
  it.todo('clears the session and redirects to /')
})

describe('AUTH-05: User account linked to organization and role', () => {
  it.todo('newly created user has a corresponding org_members record')
  it.todo('user role is admin or member — no other values allowed')
})
