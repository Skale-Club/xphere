import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock next/cache to avoid SSR store errors in tests
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

const mockUser = { id: 'user-test-001', email: 'test@example.com' }

const mockSelect = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockGte = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()
const mockIs = vi.fn()

const mockSupabase = {
  from: vi.fn(),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(mockSupabase)),
  getUser: vi.fn(() => Promise.resolve(mockUser)),
}))

import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationRow,
} from '@/app/(dashboard)/notifications/actions'

const makeNotification = (overrides: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'notif-001',
  org_id: 'org-001',
  user_id: 'user-test-001',
  type: 'missed_call',
  payload: { call_log_id: 'call-001' },
  read_at: null,
  created_at: new Date().toISOString(),
  ...overrides,
})

describe('Notification server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchNotifications', () => {
    it('returns notifications array when user is authenticated', async () => {
      const mockNotifications = [makeNotification(), makeNotification({ id: 'notif-002' })]

      mockLimit.mockResolvedValue({ data: mockNotifications, error: null })
      mockOrder.mockReturnValue({ limit: mockLimit })
      mockGte.mockReturnValue({ order: mockOrder })
      mockEq.mockReturnValue({ gte: mockGte })
      mockSelect.mockReturnValue({ eq: mockEq })
      mockSupabase.from.mockReturnValue({ select: mockSelect })

      const result = await fetchNotifications()
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('notif-001')
    })

    it('returns empty array when user is not authenticated', async () => {
      const { getUser } = await import('@/lib/supabase/server')
      vi.mocked(getUser).mockResolvedValueOnce(null as unknown as Awaited<ReturnType<typeof getUser>>)

      const result = await fetchNotifications()
      expect(result).toEqual([])
    })

    it('returns empty array on DB error', async () => {
      mockLimit.mockResolvedValue({ data: null, error: { message: 'DB error' } })
      mockOrder.mockReturnValue({ limit: mockLimit })
      mockGte.mockReturnValue({ order: mockOrder })
      mockEq.mockReturnValue({ gte: mockGte })
      mockSelect.mockReturnValue({ eq: mockEq })
      mockSupabase.from.mockReturnValue({ select: mockSelect })

      const result = await fetchNotifications()
      expect(result).toEqual([])
    })
  })

  describe('markNotificationRead', () => {
    it('calls update with read_at and correct id filter', async () => {
      mockIs.mockResolvedValue({ error: null })
      mockEq.mockReturnValue({ is: mockIs })
      const mockEqChain = vi.fn().mockReturnValue({ eq: mockEq })
      mockUpdate.mockReturnValue({ eq: mockEqChain })
      mockSupabase.from.mockReturnValue({ update: mockUpdate })

      await markNotificationRead('notif-123')

      expect(mockUpdate).toHaveBeenCalledWith({ read_at: expect.any(String) })
      expect(mockEqChain).toHaveBeenCalledWith('id', 'notif-123')
    })
  })

  describe('markAllNotificationsRead', () => {
    it('calls update for all unread notifications (is read_at null)', async () => {
      mockIs.mockResolvedValue({ error: null })
      mockEq.mockReturnValue({ is: mockIs })
      mockUpdate.mockReturnValue({ eq: mockEq })
      mockSupabase.from.mockReturnValue({ update: mockUpdate })

      await markAllNotificationsRead()

      expect(mockUpdate).toHaveBeenCalledWith({ read_at: expect.any(String) })
      expect(mockIs).toHaveBeenCalledWith('read_at', null)
    })
  })
})
