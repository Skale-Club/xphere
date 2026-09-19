import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Covers /auth/callback — the OAuth landing route.
 *
 * The rule these tests exist to hold: NO failure path may bounce the user to a
 * bare "/". Production logs on 2026-09-09 showed an expired OAuth state doing
 * exactly that, after which the user signed in three times in twelve seconds
 * because nothing told them what had happened. Every failure now carries an
 * `auth_error` code the landing dialog renders.
 */

vi.mock('next/server', () => ({
  NextResponse: {
    redirect: vi.fn((url: string) => ({
      type: 'redirect',
      url,
      cookies: { set: vi.fn() },
    })),
  },
}))

const pendingInviteCookie = { value: undefined as string | undefined }

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      name === 'pending_invite_token' && pendingInviteCookie.value
        ? { value: pendingInviteCookie.value }
        : undefined,
  })),
}))

const acceptInviteByToken = vi.fn()
const acceptPendingInvite = vi.fn()

vi.mock('@/lib/invites/accept', () => ({
  acceptInviteByToken: (...args: unknown[]) => acceptInviteByToken(...args),
  acceptPendingInvite: (...args: unknown[]) => acceptPendingInvite(...args),
  PENDING_INVITE_COOKIE: 'pending_invite_token',
}))

/**
 * Table-driven Supabase stub. Each table returns whatever `tableResults` holds
 * for it, through a builder that accepts any chain of select/eq/limit and is
 * terminated by maybeSingle() or single().
 */
const tableResults: Record<string, { data: unknown; error?: unknown }> = {}

function builder(table: string) {
  const result = tableResults[table] ?? { data: null, error: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'limit', 'is', 'order']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => result)
  chain.single = vi.fn(async () => result)
  return chain
}

const mockSupabase = {
  auth: {
    exchangeCodeForSession: vi.fn(),
    getUser: vi.fn(async () => ({ data: { user: null } })),
  },
  from: vi.fn((table: string) => builder(table)),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

import { GET } from '@/app/auth/callback/route'

const ORIGIN = 'http://localhost:4267'

/** The URL the route redirected to on its (single) NextResponse.redirect call. */
async function redirectedTo(): Promise<string> {
  const { NextResponse } = await import('next/server')
  const calls = (NextResponse.redirect as ReturnType<typeof vi.fn>).mock.calls
  return String(calls[0]?.[0])
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    pendingInviteCookie.value = undefined
    for (const key of Object.keys(tableResults)) delete tableResults[key]
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('explains an expired OAuth state instead of silently returning to the landing page', async () => {
    const req = new Request(
      `${ORIGIN}/auth/callback?error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+state+has+expired`,
    )
    await GET(req)

    expect(await redirectedTo()).toBe(`${ORIGIN}/?auth_error=oauth_state_expired`)
    // The provider never issued a code, so no exchange should be attempted.
    expect(mockSupabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('reports a cancelled consent screen', async () => {
    const req = new Request(
      `${ORIGIN}/auth/callback?error=access_denied&error_description=User+denied+access`,
    )
    await GET(req)

    expect(await redirectedTo()).toBe(`${ORIGIN}/?auth_error=oauth_cancelled`)
  })

  it('reports a missing code rather than redirecting to a bare /', async () => {
    await GET(new Request(`${ORIGIN}/auth/callback`))

    expect(await redirectedTo()).toBe(`${ORIGIN}/?auth_error=oauth_failed`)
  })

  it('reports a failed code exchange when no session already exists', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid grant' },
    })

    await GET(new Request(`${ORIGIN}/auth/callback?code=bad-code`))

    expect(await redirectedTo()).toBe(`${ORIGIN}/?auth_error=exchange_failed`)
  })

  it('reuses an existing session when the code was already exchanged', async () => {
    // A duplicate callback hit: the code is spent, but the session it created
    // is valid. Bouncing here would force a pointless second login.
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'code already used' },
    })
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'alice@example.com' } },
    })
    tableResults.org_members = { data: { organization_id: 'org-1' }, error: null }
    tableResults.user_active_org = { data: null, error: null }
    tableResults.organizations = { data: { id: 'org-1', name: 'Acme' }, error: null }

    await GET(new Request(`${ORIGIN}/auth/callback?code=spent-code`))

    expect(await redirectedTo()).toBe(`${ORIGIN}/dashboard`)
  })

  it('sends an existing member to the org they last had active', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-2', email: 'Bob@Example.COM' } },
      error: null,
    })
    tableResults.org_members = { data: { organization_id: 'org-first' }, error: null }
    tableResults.user_active_org = { data: { organization_id: 'org-saved' }, error: null }
    tableResults.organizations = { data: { id: 'org-saved', name: 'Saved Org' }, error: null }

    await GET(new Request(`${ORIGIN}/auth/callback?code=good&next=/inbox`))

    expect(await redirectedTo()).toBe(`${ORIGIN}/inbox`)
    // Membership resolved locally — no invite lookup needed.
    expect(acceptPendingInvite).not.toHaveBeenCalled()
  })

  it('accepts a pending invite token stashed before login and lands in that org', async () => {
    pendingInviteCookie.value = 'invite-token-123'
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-3', email: 'Carol@Example.COM' } },
      error: null,
    })
    acceptInviteByToken.mockResolvedValue({
      status: 'accepted',
      orgId: 'org-invited',
      orgName: 'Invited Org',
    })

    await GET(new Request(`${ORIGIN}/auth/callback?code=good`))

    // The email must reach the invite layer normalized (matches idx_org_invites_email).
    expect(acceptInviteByToken).toHaveBeenCalledWith(
      'invite-token-123',
      'user-3',
      'carol@example.com',
    )
    expect(await redirectedTo()).toBe(`${ORIGIN}/dashboard?invite=joined`)
  })

  it('falls back to an email-matched invite when the user has no membership', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-4', email: 'Dave@Example.COM' } },
      error: null,
    })
    tableResults.org_members = { data: null, error: null }
    acceptPendingInvite.mockResolvedValue({
      status: 'accepted',
      orgId: 'org-email',
      orgName: 'Email Org',
    })

    await GET(new Request(`${ORIGIN}/auth/callback?code=good`))

    expect(acceptPendingInvite).toHaveBeenCalledWith('user-4', 'dave@example.com')
    expect(await redirectedTo()).toBe(`${ORIGIN}/dashboard`)
  })

  it('tells a user with no workspace why they cannot get in', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-5', email: 'stranger@example.com' } },
      error: null,
    })
    tableResults.org_members = { data: null, error: null }
    acceptPendingInvite.mockResolvedValue({ status: 'no-invite' })

    await GET(new Request(`${ORIGIN}/auth/callback?code=good`))

    expect(await redirectedTo()).toBe(`${ORIGIN}/?auth_error=no_org`)
  })
})
