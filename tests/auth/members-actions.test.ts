import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock next/cache to avoid "static generation store missing" error in tests
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

const mockUser = { id: 'user-admin-001', email: 'admin@example.com' }
const mockOrgId = 'org-test-001'

// Mock admin org_members row
const mockAdminMembership = { role: 'admin' }

const mockSupabase = {
  rpc: vi.fn(),
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  getUser: vi.fn(() => Promise.resolve(mockUser)),
}))

// Helper to mock requireAdmin path (admin user)
function mockAdminContext() {
  mockSupabase.rpc.mockResolvedValue({ data: mockOrgId, error: null })
  mockSupabase.from.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockAdminMembership, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  })
}

import { inviteMember, revokeInvite, removeMember, listMembers, listInvites } from '@/app/(dashboard)/members/actions'

describe('Members server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('inviteMember', () => {
    it('returns error for invalid email', async () => {
      mockAdminContext()
      const fd = new FormData()
      fd.set('email', 'not-an-email')
      fd.set('role', 'member')
      const result = await inviteMember(fd)
      expect(result.error).toBeTruthy()
    })

    it('normalizes email to lowercase before inserting', async () => {
      const insertSpy = vi.fn().mockResolvedValue({ error: null })
      mockSupabase.rpc.mockResolvedValue({ data: mockOrgId, error: null })
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'org_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
          }
        }
        if (table === 'org_invites') {
          return { insert: insertSpy }
        }
        return {}
      })

      const fd = new FormData()
      fd.set('email', 'Alice@Example.COM')
      fd.set('role', 'member')
      await inviteMember(fd)

      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'alice@example.com' })
      )
    })

    it('returns error when role is not admin or member', async () => {
      mockAdminContext()
      const fd = new FormData()
      fd.set('email', 'valid@example.com')
      fd.set('role', 'superuser') // invalid role
      const result = await inviteMember(fd)
      expect(result.error).toBeTruthy()
    })
  })

  describe('removeMember', () => {
    it('prevents admin from removing themselves', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockOrgId, error: null })

      // requireAdmin creates its own supabase client. removeMember creates another.
      // Both use mockSupabase.from. We track call count to differentiate.
      let orgMembersCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'org_members') {
          orgMembersCallCount++
          if (orgMembersCallCount === 1) {
            // requireAdmin: role check
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
            }
          } else {
            // removeMember: target member check (user_id matches current user → self-removal)
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: { user_id: mockUser.id }, error: null }),
              delete: vi.fn().mockReturnThis(),
            }
          }
        }
        return {}
      })

      const result = await removeMember('member-self-id')
      expect(result.error).toBeTruthy()
      expect(typeof result.error).toBe('string')
      expect((result.error as string).toLowerCase()).toContain('cannot remove yourself')
    })
  })

  describe('listInvites', () => {
    it('returns invites for admin user', async () => {
      const mockInvites = [
        { id: 'i1', email: 'alice@example.com', role: 'member', invited_at: new Date().toISOString(), accepted_at: null },
      ]
      mockSupabase.rpc.mockResolvedValue({ data: mockOrgId, error: null })
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'org_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
          }
        }
        if (table === 'org_invites') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: mockInvites, error: null }),
          }
        }
        return {}
      })

      const result = await listInvites()
      expect(result.error).toBeNull()
      expect(result.invites).toHaveLength(1)
      expect(result.invites[0].email).toBe('alice@example.com')
    })
  })

  describe('listMembers', () => {
    it('returns empty array for admin with no members', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockOrgId, error: null })
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'org_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
        }
        return {}
      })

      const result = await listMembers()
      expect(result.error).toBeNull()
      expect(result.members).toEqual([])
    })
  })
})
