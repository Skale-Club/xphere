import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────
// The legacy /api/ads/{google,meta}/campaigns routes are now thin wrappers over
// the Ads Command Engine (submitChange): they resolve the dashboard actor, map
// their old request shape onto a typed command, and hand the HTTP status back
// to engineResponse. Everything below the route boundary — policy, provider
// calls, the ledger — belongs to the engine's own tests; this file only
// protects the route's own decisions: the auth/permission gate, request
// validation, command mapping (including the legacy field names), and that
// engineResponse's status mapping is wired in correctly.

const dashboardActorMock = vi.fn()
const submitChangeMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/lib/ads/commands/actors', () => ({
  dashboardActor: () => dashboardActorMock(),
}))

vi.mock('@/lib/ads/commands/engine', () => ({
  submitChange: (...args: unknown[]) => submitChangeMock(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: (...args: unknown[]) => rpcMock(...args) }),
}))

const ACTOR = { type: 'user' as const, id: 'user-1', label: 'user:user-1', canManage: true, canApprove: true }

function succeeded(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    change: {
      id: 'change-1',
      status: 'succeeded',
      approval_required: false,
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dashboardActorMock.mockResolvedValue(ACTOR)
  rpcMock.mockResolvedValue({ data: 'org-1' })
  submitChangeMock.mockResolvedValue(succeeded())
})

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

// ─── Google route ─────────────────────────────────────────────────────────────

describe('POST /api/ads/google/campaigns — access control', () => {
  it('rejects an unauthenticated caller', async () => {
    dashboardActorMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/ads/google/campaigns/route')
    const res = await POST(
      jsonRequest('https://xphere.app/api/ads/google/campaigns', {
        action: 'set_status',
        customer_id: '1234567890',
        campaign_id: '111',
        status: 'PAUSED',
      }) as never,
    )
    expect(res.status).toBe(401)
    expect(submitChangeMock).not.toHaveBeenCalled()
  })

  it('rejects a signed-in user without ads.manage', async () => {
    dashboardActorMock.mockResolvedValue({ ...ACTOR, canManage: false })
    const { POST } = await import('@/app/api/ads/google/campaigns/route')
    const res = await POST(
      jsonRequest('https://xphere.app/api/ads/google/campaigns', {
        action: 'set_status',
        customer_id: '1234567890',
        campaign_id: '111',
        status: 'PAUSED',
      }) as never,
    )
    expect(res.status).toBe(403)
    expect(submitChangeMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/ads/google/campaigns — validation and mapping', () => {
  it('rejects a malformed customer id', async () => {
    const { POST } = await import('@/app/api/ads/google/campaigns/route')
    const res = await POST(
      jsonRequest('https://xphere.app/api/ads/google/campaigns', {
        action: 'set_status',
        customer_id: '123-456',
        campaign_id: '111',
        status: 'PAUSED',
      }) as never,
    )
    expect(res.status).toBe(400)
    expect(submitChangeMock).not.toHaveBeenCalled()
  })

  it('rejects a budget request with neither daily_budget nor daily_budget_usd', async () => {
    const { POST } = await import('@/app/api/ads/google/campaigns/route')
    const res = await POST(
      jsonRequest('https://xphere.app/api/ads/google/campaigns', {
        action: 'set_budget',
        customer_id: '1234567890',
        campaign_id: '111',
      }) as never,
    )
    expect(res.status).toBe(400)
    expect(submitChangeMock).not.toHaveBeenCalled()
  })

  it('maps set_status onto a google.campaign.set_status command with the resolved org', async () => {
    const { POST } = await import('@/app/api/ads/google/campaigns/route')
    await POST(
      jsonRequest('https://xphere.app/api/ads/google/campaigns', {
        action: 'set_status',
        customer_id: '1234567890',
        campaign_id: '111',
        status: 'ENABLED',
      }) as never,
    )
    expect(submitChangeMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      actor: ACTOR,
      command: {
        platform: 'google',
        ad_account_id: '1234567890',
        type: 'google.campaign.set_status',
        campaign_id: '111',
        status: 'ENABLED',
      },
    })
  })

  it('maps the legacy daily_budget_usd field onto daily_budget (major units, never actually USD-specific)', async () => {
    const { POST } = await import('@/app/api/ads/google/campaigns/route')
    await POST(
      jsonRequest('https://xphere.app/api/ads/google/campaigns', {
        action: 'set_budget',
        customer_id: '1234567890',
        campaign_id: '111',
        daily_budget_usd: 75,
      }) as never,
    )
    expect(submitChangeMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      actor: ACTOR,
      command: {
        platform: 'google',
        ad_account_id: '1234567890',
        type: 'google.campaign.set_daily_budget',
        campaign_id: '111',
        daily_budget: 75,
      },
    })
  })

  it('400s when there is no active org to resolve', async () => {
    rpcMock.mockResolvedValue({ data: null })
    const { POST } = await import('@/app/api/ads/google/campaigns/route')
    const res = await POST(
      jsonRequest('https://xphere.app/api/ads/google/campaigns', {
        action: 'set_status',
        customer_id: '1234567890',
        campaign_id: '111',
        status: 'PAUSED',
      }) as never,
    )
    expect(res.status).toBe(400)
  })
})

// ─── Meta route ───────────────────────────────────────────────────────────────

describe('POST /api/ads/meta/campaigns — access control', () => {
  it('rejects an unauthenticated caller', async () => {
    dashboardActorMock.mockResolvedValue(null)
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    const res = await POST(
      jsonRequest('https://xphere.app/api/ads/meta/campaigns', {
        action: 'set_status',
        campaign_id: '120200000000000',
        ad_account_id: 'act_123456789',
        status: 'PAUSED',
      }) as never,
    )
    expect(res.status).toBe(401)
    expect(submitChangeMock).not.toHaveBeenCalled()
  })

  it('rejects a signed-in user without ads.manage', async () => {
    dashboardActorMock.mockResolvedValue({ ...ACTOR, canManage: false })
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    const res = await POST(
      jsonRequest('https://xphere.app/api/ads/meta/campaigns', {
        action: 'set_status',
        campaign_id: '120200000000000',
        ad_account_id: 'act_123456789',
        status: 'PAUSED',
      }) as never,
    )
    expect(res.status).toBe(403)
    expect(submitChangeMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/ads/meta/campaigns — validation and mapping', () => {
  it('rejects a malformed ad account id', async () => {
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    const res = await POST(
      jsonRequest('https://xphere.app/api/ads/meta/campaigns', {
        action: 'set_status',
        campaign_id: '120200000000000',
        ad_account_id: '123456789',
        status: 'PAUSED',
      }) as never,
    )
    expect(res.status).toBe(400)
    expect(submitChangeMock).not.toHaveBeenCalled()
  })

  it('rejects a budget request with neither daily_budget nor daily_budget_cents', async () => {
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    const res = await POST(
      jsonRequest('https://xphere.app/api/ads/meta/campaigns', {
        action: 'set_daily_budget',
        campaign_id: '120200000000000',
        ad_account_id: 'act_123456789',
      }) as never,
    )
    expect(res.status).toBe(400)
    expect(submitChangeMock).not.toHaveBeenCalled()
  })

  it('maps set_status onto a meta.campaign.set_status command', async () => {
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    await POST(
      jsonRequest('https://xphere.app/api/ads/meta/campaigns', {
        action: 'set_status',
        campaign_id: '120200000000000',
        ad_account_id: 'act_123456789',
        status: 'ACTIVE',
      }) as never,
    )
    expect(submitChangeMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      actor: ACTOR,
      command: {
        platform: 'meta',
        ad_account_id: 'act_123456789',
        type: 'meta.campaign.set_status',
        campaign_id: '120200000000000',
        status: 'ACTIVE',
      },
    })
  })

  it('converts legacy daily_budget_cents (7500 -> 75.00 major units)', async () => {
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    await POST(
      jsonRequest('https://xphere.app/api/ads/meta/campaigns', {
        action: 'set_daily_budget',
        campaign_id: '120200000000000',
        ad_account_id: 'act_123456789',
        daily_budget_cents: 7500,
      }) as never,
    )
    expect(submitChangeMock).toHaveBeenCalledWith({
      orgId: 'org-1',
      actor: ACTOR,
      command: {
        platform: 'meta',
        ad_account_id: 'act_123456789',
        type: 'meta.campaign.set_daily_budget',
        campaign_id: '120200000000000',
        daily_budget: 75,
      },
    })
  })

  it('passes an explicit daily_budget through unchanged (already major units)', async () => {
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    await POST(
      jsonRequest('https://xphere.app/api/ads/meta/campaigns', {
        action: 'set_daily_budget',
        campaign_id: '120200000000000',
        ad_account_id: 'act_123456789',
        daily_budget: 80,
      }) as never,
    )
    expect(submitChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({ command: expect.objectContaining({ daily_budget: 80 }) }),
    )
  })
})

// ─── engineResponse status mapping, exercised through the route ────────────────

describe('engineResponse status mapping via the Meta route', () => {
  const body = { action: 'set_status', campaign_id: '120200000000000', ad_account_id: 'act_123456789', status: 'PAUSED' as const }

  it('maps a policy_blocked failure to 422', async () => {
    submitChangeMock.mockResolvedValue({ ok: false, code: 'policy_blocked', message: 'blocked', violations: [] })
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    const res = await POST(jsonRequest('https://xphere.app/api/ads/meta/campaigns', body) as never)
    expect(res.status).toBe(422)
  })

  it('maps an awaiting_approval change to 202', async () => {
    submitChangeMock.mockResolvedValue({
      ok: true,
      duplicate: false,
      confirmationToken: undefined,
      change: { id: 'c1', status: 'awaiting_approval', approval_required: true },
    })
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    const res = await POST(jsonRequest('https://xphere.app/api/ads/meta/campaigns', body) as never)
    expect(res.status).toBe(202)
    const json = await res.json()
    expect(json.pending_approval).toBe(true)
  })

  it('maps a succeeded change to 200', async () => {
    submitChangeMock.mockResolvedValue(succeeded())
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    const res = await POST(jsonRequest('https://xphere.app/api/ads/meta/campaigns', body) as never)
    expect(res.status).toBe(200)
  })

  it('maps a no_connection failure to 404', async () => {
    submitChangeMock.mockResolvedValue({ ok: false, code: 'no_connection', message: 'not connected' })
    const { POST } = await import('@/app/api/ads/meta/campaigns/route')
    const res = await POST(jsonRequest('https://xphere.app/api/ads/meta/campaigns', body) as never)
    expect(res.status).toBe(404)
  })
})
