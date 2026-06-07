// tests/mcp-multi-org.test.ts
// QA: per-user multi-org access — cross-org denial, member access, no parallel leak.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { assertUserInOrg, resolveEffectiveOrg } from '@/lib/mcp/membership'
import { organizationsTools } from '@/lib/mcp/tools/organizations'
import type { McpAuthContext } from '@/lib/mcp/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_A = '00000000-0000-0000-0000-000000000001'
const ORG_B = '00000000-0000-0000-0000-000000000002'
const USER_ID = 'user-0000-0000-0000-000000000001'

function makeOAuthAuth(orgId = ORG_A): McpAuthContext {
  return { kind: 'oauth', orgId, userId: USER_ID, actor: `oauth:client:${USER_ID.slice(0, 8)}`, scope: 'mcp:all' }
}

function makeLegacyAuth(): McpAuthContext {
  return { kind: 'legacy_token', orgId: ORG_A, userId: null, actor: 'mcp:xph_test123', scope: 'mcp:all' }
}

function mockOrgMembers(isMember: boolean) {
  const mockClient = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: isMember ? { id: 'row-1' } : null }),
          }),
        }),
      }),
    }),
  }
  vi.mocked(createServiceRoleClient).mockReturnValue(mockClient as never)
  return mockClient
}

// ---------------------------------------------------------------------------
// assertUserInOrg
// ---------------------------------------------------------------------------

describe('assertUserInOrg', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when org_members row exists', async () => {
    mockOrgMembers(true)
    expect(await assertUserInOrg(USER_ID, ORG_A)).toBe(true)
  })

  it('returns false when no org_members row', async () => {
    mockOrgMembers(false)
    expect(await assertUserInOrg(USER_ID, ORG_B)).toBe(false)
  })

  it('queries org_members with the correct user_id and organization_id', async () => {
    // Capture each chained mock so we can inspect the args later.
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: { id: 'row-1' } })
    const eq2Mock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock })
    const eq1Mock = vi.fn().mockReturnValue({ eq: eq2Mock })
    const selectMock = vi.fn().mockReturnValue({ eq: eq1Mock })
    const fromMock = vi.fn().mockReturnValue({ select: selectMock })
    vi.mocked(createServiceRoleClient).mockReturnValue({ from: fromMock } as never)

    await assertUserInOrg(USER_ID, ORG_A)

    expect(fromMock).toHaveBeenCalledWith('org_members')
    expect(eq1Mock).toHaveBeenCalledWith('user_id', USER_ID)
    expect(eq2Mock).toHaveBeenCalledWith('organization_id', ORG_A)
  })
})

// ---------------------------------------------------------------------------
// resolveEffectiveOrg
// ---------------------------------------------------------------------------

describe('resolveEffectiveOrg', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns auth unchanged when no org_id supplied', async () => {
    const auth = makeOAuthAuth(ORG_A)
    const { effectiveAuth, denial } = await resolveEffectiveOrg(auth, undefined)
    expect(denial).toBeUndefined()
    expect(effectiveAuth).toBe(auth) // same reference — no copy needed
  })

  it('denies non-member org_id for OAuth token', async () => {
    mockOrgMembers(false)
    const auth = makeOAuthAuth(ORG_A)
    const { effectiveAuth, denial } = await resolveEffectiveOrg(auth, ORG_B)
    expect(denial?.error).toBe('not_member')
    expect(effectiveAuth.orgId).toBe(ORG_A) // unchanged
  })

  it('allows member org_id and returns updated effectiveAuth', async () => {
    mockOrgMembers(true)
    const auth = makeOAuthAuth(ORG_A)
    const { effectiveAuth, denial } = await resolveEffectiveOrg(auth, ORG_B)
    expect(denial).toBeUndefined()
    expect(effectiveAuth.orgId).toBe(ORG_B)
  })

  it('does NOT mutate the original auth object', async () => {
    mockOrgMembers(true)
    const auth = makeOAuthAuth(ORG_A)
    const originalOrgId = auth.orgId
    await resolveEffectiveOrg(auth, ORG_B)
    expect(auth.orgId).toBe(originalOrgId) // auth is immutable
  })

  it('ignores org_id for legacy tokens (single-org only)', async () => {
    const auth = makeLegacyAuth()
    const { effectiveAuth, denial } = await resolveEffectiveOrg(auth, ORG_B)
    expect(denial).toBeUndefined()
    expect(effectiveAuth.orgId).toBe(ORG_A) // token's org unchanged
    // assertUserInOrg must NOT be called — no membership check for legacy tokens
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('concurrent calls with different org_ids do not cross-leak', async () => {
    // Simulate two concurrent calls: one for ORG_A (member), one for ORG_B (not member).
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn((col: string, val: string) => ({
              maybeSingle: vi.fn().mockResolvedValue({
                // member of ORG_A, not ORG_B
                data: val === ORG_A ? { id: 'row-1' } : null,
              }),
            })),
          }),
        }),
      }),
    }
    vi.mocked(createServiceRoleClient).mockReturnValue(mockClient as never)

    const auth = makeOAuthAuth(ORG_A)

    // Fire both resolutions in parallel
    const [resA, resB] = await Promise.all([
      resolveEffectiveOrg(auth, ORG_A),
      resolveEffectiveOrg(auth, ORG_B),
    ])

    // ORG_A: member → allowed
    expect(resA.denial).toBeUndefined()
    expect(resA.effectiveAuth.orgId).toBe(ORG_A)

    // ORG_B: non-member → denied
    expect(resB.denial?.error).toBe('not_member')
    expect(resB.effectiveAuth.orgId).toBe(ORG_A) // still the token's default

    // Neither call should have overwritten the other's effectiveAuth
    expect(resA.effectiveAuth).not.toBe(resB.effectiveAuth)
  })
})

// ---------------------------------------------------------------------------
// list_organizations tool handler
// ---------------------------------------------------------------------------

describe('list_organizations handler', () => {
  beforeEach(() => vi.clearAllMocks())

  const tool = organizationsTools.find((t) => t.name === 'list_organizations')!

  it('returns not_supported for legacy token (no userId)', async () => {
    const result = await tool.handler({}, { auth: makeLegacyAuth() })
    expect((result as { error: string }).error).toBe('not_supported')
  })

  it('returns organizations list for OAuth token', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                { organization_id: ORG_A, role: 'admin', organizations: { id: ORG_A, name: 'Org Alpha' } },
                { organization_id: ORG_B, role: 'member', organizations: { id: ORG_B, name: 'Org Beta' } },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }
    vi.mocked(createServiceRoleClient).mockReturnValue(mockClient as never)

    const result = await tool.handler({}, { auth: makeOAuthAuth() }) as { organizations: unknown[] }
    expect(result.organizations).toHaveLength(2)
    expect(result.organizations[0]).toEqual({ id: ORG_A, name: 'Org Alpha', role: 'admin' })
    expect(result.organizations[1]).toEqual({ id: ORG_B, name: 'Org Beta', role: 'member' })
  })

  it('returns empty list when user has no memberships', async () => {
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }),
    }
    vi.mocked(createServiceRoleClient).mockReturnValue(mockClient as never)

    const result = await tool.handler({}, { auth: makeOAuthAuth() }) as { organizations: unknown[] }
    expect(result.organizations).toEqual([])
  })
})
