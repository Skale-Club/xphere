import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoist vi.mock declarations before imports
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import {
  createCampaign,
  getCampaignMetrics,
  getCampaigns,
  pauseCampaign,
} from '@/app/(dashboard)/campaigns/actions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSupabase(overrides: Record<string, unknown> = {}) {
  const rpcMock = vi.fn().mockResolvedValue({ data: 'org-uuid', error: null })
  const selectMock = vi.fn()
  const insertMock = vi.fn()
  const updateMock = vi.fn()

  const chain = {
    from: vi.fn().mockReturnThis(),
    select: selectMock.mockReturnThis(),
    insert: insertMock.mockReturnThis(),
    update: updateMock.mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
    rpc: rpcMock,
    ...overrides,
  }

  return chain
}

// ─── createCampaign ───────────────────────────────────────────────────────────

describe('createCampaign server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a campaign row with status=draft and returns the new id', async () => {
    const mockId = 'campaign-uuid-001'
    const supabase = makeSupabase()
    ;(supabase.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { id: mockId },
      error: null,
    })
    vi.mocked(getUser).mockResolvedValue({ id: 'user-uuid' } as never)
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const result = await createCampaign({
      name: 'Test Campaign',
      channel: 'calls',
      vapi_assistant_id: 'asst-uuid',
      vapi_phone_number_id: 'phone-uuid',
    })

    expect(result.id).toBe(mockId)

    // Verify insert was called with status=draft
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Campaign',
        channel: 'calls',
        status: 'draft',
        organization_id: 'org-uuid',
      })
    )
  })

  it('stores created_by from the authenticated user', async () => {
    const supabase = makeSupabase()
    ;(supabase.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { id: 'new-id' },
      error: null,
    })
    vi.mocked(getUser).mockResolvedValue({ id: 'user-001' } as never)
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    await createCampaign({ name: 'My Campaign', channel: 'sms' })

    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: 'user-001' })
    )
  })

  it('throws Unauthorized when user is not logged in', async () => {
    vi.mocked(getUser).mockResolvedValue(null as never)

    await expect(createCampaign({ name: 'X', channel: 'calls' })).rejects.toThrow('Unauthorized')
  })

  it('stores sms_body in template_config for sms campaigns', async () => {
    const supabase = makeSupabase()
    ;(supabase.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { id: 'sms-campaign-id' },
      error: null,
    })
    vi.mocked(getUser).mockResolvedValue({ id: 'user-uuid' } as never)
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    await createCampaign({
      name: 'SMS Campaign',
      channel: 'sms',
      sms_body: 'Hello {{name}}, check this out!',
    })

    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        template_config: { sms_body: 'Hello {{name}}, check this out!' },
      })
    )
  })

  it('stores scheduled_start_at when provided', async () => {
    const supabase = makeSupabase()
    ;(supabase.single as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { id: 'scheduled-id' },
      error: null,
    })
    vi.mocked(getUser).mockResolvedValue({ id: 'user-uuid' } as never)
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const scheduledAt = '2026-06-01T09:00:00.000Z'
    await createCampaign({
      name: 'Scheduled Campaign',
      channel: 'calls',
      scheduled_start_at: scheduledAt,
    })

    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ scheduled_start_at: scheduledAt })
    )
  })
})

// ─── getCampaignMetrics ────────────────────────────────────────────────────────

describe('getCampaignMetrics server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns correct voice call metrics from campaign_contacts', async () => {
    const mockContacts = [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'failed' },
      { status: 'no_answer' },
      { status: 'pending' },
      { status: 'calling' },
    ]

    const supabase = {
      from: vi.fn(),
    }

    // First call to .from() = 'campaign_contacts', second = 'campaign_recipients'
    let callCount = 0
    supabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockContacts, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    })

    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const metrics = await getCampaignMetrics('campaign-uuid')

    expect(metrics.total).toBe(6)
    expect(metrics.completed_calls).toBe(2)
    expect(metrics.failed).toBe(1)
    expect(metrics.no_answer).toBe(1)
    expect(metrics.pending).toBe(1)
    expect(metrics.calling).toBe(1)
  })

  it('returns zero metrics for an empty campaign', async () => {
    const supabase = {
      from: vi.fn(),
    }
    let callCount = 0
    supabase.from.mockImplementation(() => {
      callCount++
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    })

    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const metrics = await getCampaignMetrics('empty-campaign')

    expect(metrics.total).toBe(0)
    expect(metrics.completed_calls).toBe(0)
    expect(metrics.failed).toBe(0)
    expect(metrics.pending).toBe(0)
  })

  it('combines voice and recipient metrics for total', async () => {
    const mockContacts = [{ status: 'completed' }, { status: 'pending' }]
    const mockRecipients = [{ status: 'sent' }, { status: 'failed' }]

    const supabase = { from: vi.fn() }
    let callCount = 0
    supabase.from.mockImplementation(() => {
      callCount++
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: callCount === 1 ? mockContacts : mockRecipients,
          error: null,
        }),
      }
    })

    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const metrics = await getCampaignMetrics('mixed-campaign')

    // Total = 2 contacts + 2 recipients
    expect(metrics.total).toBe(4)
  })
})

// ─── getCampaigns ─────────────────────────────────────────────────────────────

describe('getCampaigns server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all campaigns when no channel filter applied', async () => {
    const mockCampaigns = [
      { id: 'c1', name: 'Campaign 1', channel: 'calls', campaign_type: 'one_time', description: null, status: 'draft', started_at: null, completed_at: null, scheduled_start_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', organization_id: 'org-uuid' },
      { id: 'c2', name: 'Campaign 2', channel: 'sms', campaign_type: 'one_time', description: null, status: 'draft', started_at: null, completed_at: null, scheduled_start_at: null, created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', organization_id: 'org-uuid' },
    ]

    const supabase = { from: vi.fn() }
    let callCount = 0
    supabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: mockCampaigns, error: null }),
        }
      }
      return {
        select: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    })

    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const campaigns = await getCampaigns()

    expect(campaigns).toHaveLength(2)
    expect(campaigns[0].channel).toBe('calls')
    expect(campaigns[1].channel).toBe('sms')
  })
})

// ─── pauseCampaign ────────────────────────────────────────────────────────────

describe('pauseCampaign server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates status to paused only for in_progress or running campaigns', async () => {
    const supabase = {
      from: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: null, error: null }),
    }

    vi.mocked(getUser).mockResolvedValue({ id: 'user-uuid' } as never)
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    await pauseCampaign('campaign-uuid')

    expect(supabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paused' })
    )
    expect(supabase.in).toHaveBeenCalledWith('status', ['in_progress', 'running'])
  })

  it('throws Unauthorized when user is not logged in', async () => {
    vi.mocked(getUser).mockResolvedValue(null as never)

    await expect(pauseCampaign('campaign-uuid')).rejects.toThrow('Unauthorized')
  })
})
