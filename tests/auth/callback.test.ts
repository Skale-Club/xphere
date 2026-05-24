import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock next/server
vi.mock('next/server', () => ({
  NextResponse: {
    redirect: vi.fn((url: string) => ({ type: 'redirect', url, cookies: { set: vi.fn() } })),
  },
}))

// Mock Supabase server client
const mockSupabase = {
  auth: {
    exchangeCodeForSession: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
}))

import { GET } from '@/app/auth/callback/route'

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects to / when code param is absent', async () => {
    const req = new Request('http://localhost:4267/auth/callback')
    await GET(req)
    const { NextResponse } = await import('next/server')
    expect(NextResponse.redirect).toHaveBeenCalledWith('http://localhost:4267/')
  })

  it('redirects to / when exchangeCodeForSession fails', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid grant' },
    })
    const req = new Request('http://localhost:4267/auth/callback?code=bad-code')
    await GET(req)
    const { NextResponse } = await import('next/server')
    expect(NextResponse.redirect).toHaveBeenCalledWith('http://localhost:4267/')
  })

  it('redirects to / when email has no pending invite', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'stranger@example.com' } },
      error: null,
    })
    // org_invites query returns null (no invite)
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    const req = new Request('http://localhost:4267/auth/callback?code=valid-code')
    await GET(req)

    const { NextResponse } = await import('next/server')
    expect(NextResponse.redirect).toHaveBeenCalledWith('http://localhost:4267/')
  })

  it('creates org_members row and marks invite accepted when email has pending invite', async () => {
    const mockInvite = {
      id: 'invite-abc',
      org_id: 'org-xyz',
      role: 'member',
      accepted_at: null,
    }
    const mockOrg = { id: 'org-xyz', name: 'Acme Corp' }

    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-456', email: 'Alice@Example.COM' } }, // uppercase to test normalization
      error: null,
    })

    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const updateEqMock = vi.fn().mockResolvedValue({ error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'org_invites') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: mockInvite, error: null }),
          update: vi.fn(() => ({ eq: updateEqMock })),
        }
      }
      if (table === 'org_members') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          upsert: upsertMock,
        }
      }
      if (table === 'organizations') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockOrg }),
        }
      }
      return {}
    })

    const req = new Request('http://localhost:4267/auth/callback?code=valid-code')
    await GET(req)

    // Should NOT redirect to bare / (success path redirects to /dashboard)
    const { NextResponse } = await import('next/server')
    const redirectCall = (NextResponse.redirect as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string
    expect(redirectCall).toContain('/dashboard')

    // Should upsert org_members
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-456', organization_id: 'org-xyz', role: 'member' }),
      expect.any(Object)
    )
  })

  it('normalizes email to lowercase before invite lookup', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValue({
      data: { user: { id: 'user-789', email: 'Alice@Example.COM' } },
      error: null,
    })

    const eqSpy = vi.fn().mockReturnThis()
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: eqSpy,
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    const req = new Request('http://localhost:4267/auth/callback?code=valid-code')
    await GET(req)

    // The email passed to .eq() must be lowercased
    expect(eqSpy).toHaveBeenCalledWith('email', 'alice@example.com')
  })
})
