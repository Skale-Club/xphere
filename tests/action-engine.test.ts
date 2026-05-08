import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ---- Helpers for building mock Vapi webhook payloads ----
function makeVapiPayload(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      type: 'tool-calls',
      call: {
        id: 'call_abc',
        assistantId: 'asst_known',
      },
      toolCallList: [
        {
          id: 'tc_call_001',
          name: 'create_lead',
          arguments: { firstName: 'Jane', email: 'jane@example.com' },
        },
      ],
      ...overrides,
    },
  }
}

// ---- Helpers for building mock Supabase query chains ----
function makeSingleChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
  return chain
}

function makeInsertChain(result: { data: unknown; error: unknown }) {
  return {
    insert: vi.fn().mockResolvedValue(result),
  }
}

// ---- ACTN-01: Org resolution ----

describe('ACTN-01: Org resolution by assistant ID', () => {
  beforeEach(() => vi.resetModules())

  it('resolveOrg(assistantId) returns organization_id for a known active assistant mapping', async () => {
    const chain = makeSingleChain({ data: { organization_id: 'org_abc' }, error: null })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveOrg } = await import('@/lib/action-engine/resolve-org')
    const result = await resolveOrg('asst_known', supabase)

    expect(supabase.from).toHaveBeenCalledWith('assistant_mappings')
    expect(chain.select).toHaveBeenCalledWith('organization_id')
    expect(chain.eq).toHaveBeenCalledWith('vapi_assistant_id', 'asst_known')
    expect(chain.eq).toHaveBeenCalledWith('is_active', true)
    expect(result).toBe('org_abc')
  })

  it('resolveOrg(assistantId) returns null for unknown assistant ID', async () => {
    const chain = makeSingleChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveOrg } = await import('@/lib/action-engine/resolve-org')
    const result = await resolveOrg('asst_unknown', supabase)

    expect(result).toBeNull()
  })

  it('resolveOrg(assistantId) returns null for inactive assistant mapping (is_active=false)', async () => {
    // Inactive mapping: DB query filters is_active=true, so returns no rows → error
    const chain = makeSingleChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveOrg } = await import('@/lib/action-engine/resolve-org')
    const result = await resolveOrg('asst_inactive', supabase)

    expect(result).toBeNull()
  })
})

// ---- ACTN-02: Tool config routing ----

describe('ACTN-02: Tool config routing', () => {
  beforeEach(() => vi.resetModules())

  const mockToolConfig = {
    id: 'tc_001',
    organization_id: 'org_abc',
    integration_id: 'int_001',
    tool_name: 'create_lead',
    action_type: 'create_contact' as const,
    config: {},
    fallback_message: 'Sorry, I could not create the contact.',
    is_active: true,
    integrations: {
      id: 'int_001',
      encrypted_api_key: 'encrypted:abc',
      location_id: 'loc_xyz',
      provider: 'gohighlevel' as const,
      config: {},
    },
  }

  it('resolveTool(orgId, toolName) returns tool_config row with integration for a matching active config', async () => {
    const chain = makeSingleChain({ data: mockToolConfig, error: null })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveTool } = await import('@/lib/action-engine/resolve-tool')
    const result = await resolveTool('org_abc', 'create_lead', supabase)

    expect(supabase.from).toHaveBeenCalledWith('tool_configs')
    expect(chain.select).toHaveBeenCalledWith('*, integrations!inner(*)')
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org_abc')
    expect(chain.eq).toHaveBeenCalledWith('tool_name', 'create_lead')
    expect(chain.eq).toHaveBeenCalledWith('is_active', true)
    expect(result).toEqual(mockToolConfig)
    expect(result?.integrations.encrypted_api_key).toBe('encrypted:abc')
  })

  it('resolveTool(orgId, toolName) returns null for unknown tool name in that org', async () => {
    const chain = makeSingleChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveTool } = await import('@/lib/action-engine/resolve-tool')
    const result = await resolveTool('org_abc', 'unknown_tool', supabase)

    expect(result).toBeNull()
  })

  it('resolveTool(orgId, toolName) returns null for inactive tool config (is_active=false)', async () => {
    // Inactive config: DB query filters is_active=true, so returns no rows → error
    const chain = makeSingleChain({ data: null, error: { code: 'PGRST116', message: 'Not found' } })
    const supabase = { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>

    const { resolveTool } = await import('@/lib/action-engine/resolve-tool')
    const result = await resolveTool('org_abc', 'inactive_tool', supabase)

    expect(result).toBeNull()
  })
})

// ---- ACTN-11: executeAction dispatcher ----

describe('ACTN-11: executeAction dispatcher', () => {
  beforeEach(() => vi.resetModules())

  const credentials = { apiKey: 'decrypted-token', locationId: 'loc_xyz' }
  const params = { firstName: 'Jane', email: 'jane@example.com' }

  it('executeAction("create_contact", params, credentials) calls createContact and returns its string result', async () => {
    vi.doMock('@/lib/ghl/create-contact', () => ({
      createContact: vi.fn().mockResolvedValue('Contact created. ID: cid_123'),
    }))
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('create_contact', params, credentials)
    expect(result).toBe('Contact created. ID: cid_123')
  })

  it('executeAction("get_availability", params, credentials) calls getAvailability and returns its string result', async () => {
    vi.doMock('@/lib/ghl/get-availability', () => ({
      getAvailability: vi.fn().mockResolvedValue('Available slots: 09:00 AM, 10:00 AM'),
    }))
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('get_availability', { calendarId: 'cal_123', startDate: '2026-04-10', endDate: '2026-04-11' }, credentials)
    expect(result).toBe('Available slots: 09:00 AM, 10:00 AM')
  })

  it('executeAction("create_appointment", params, credentials) calls createAppointment and returns its string result', async () => {
    vi.doMock('@/lib/ghl/create-appointment', () => ({
      createAppointment: vi.fn().mockResolvedValue('Appointment confirmed. ID: appt_789'),
    }))
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    const result = await executeAction('create_appointment', { calendarId: 'cal_123', contactId: 'cid_456', startTime: '2026-04-10T09:00:00Z', endTime: '2026-04-10T09:30:00Z' }, credentials)
    expect(result).toBe('Appointment confirmed. ID: appt_789')
  })

  it('executeAction send_sms without ctx throws missing ctx error', async () => {
    const { executeAction } = await import('@/lib/action-engine/execute-action')
    // send_sms is now implemented — requires ctx with organizationId and supabase
    await expect(executeAction('send_sms', params, credentials)).rejects.toThrow('send_sms requires ctx.organizationId and ctx.supabase')
  })
})

// ---- ACTN-12: logAction ----

describe('ACTN-12: logAction writes action_logs and swallows errors', () => {
  beforeEach(() => vi.resetModules())

  const payload = {
    organization_id: 'org_abc',
    tool_config_id: 'tc_001',
    vapi_call_id: 'call_xyz',
    tool_name: 'create_lead',
    status: 'success' as const,
    execution_ms: 123,
    request_payload: { firstName: 'Jane' },
    response_payload: { result: 'Contact created. ID: cid_123' },
    error_detail: null,
  }

  it('logAction() calls supabase.from("action_logs").insert() with the provided payload', async () => {
    const insertChain = makeInsertChain({ data: null, error: null })
    const supabase = { from: vi.fn().mockReturnValue(insertChain) } as unknown as SupabaseClient<Database>

    const { logAction } = await import('@/lib/action-engine/log-action')
    await logAction(payload, supabase)

    expect(supabase.from).toHaveBeenCalledWith('action_logs')
    expect(insertChain.insert).toHaveBeenCalledWith(payload)
  })

  it('logAction() does not throw on Supabase insert error — swallows errors silently', async () => {
    const insertChain = {
      insert: vi.fn().mockRejectedValue(new Error('DB connection error')),
    }
    const supabase = { from: vi.fn().mockReturnValue(insertChain) } as unknown as SupabaseClient<Database>

    const { logAction } = await import('@/lib/action-engine/log-action')
    // Must resolve (not reject) even when DB throws — returns null on error
    await expect(logAction(payload, supabase)).resolves.toBeNull()
  })
})

// ---- ACTN-09 + ACTN-10: Vapi tools webhook route ----

describe('POST /api/vapi/tools — webhook route', () => {
  beforeEach(() => vi.resetModules())

  const mockToolConfig = {
    id: 'tc_001',
    organization_id: 'org_abc',
    integration_id: 'int_001',
    tool_name: 'create_lead',
    action_type: 'create_contact' as const,
    config: {},
    fallback_message: 'Sorry, unable to help right now.',
    is_active: true,
    integrations: {
      id: 'int_001',
      encrypted_api_key: 'aXY=:Y3Q=',  // fake base64 iv:ct
      location_id: 'loc_xyz',
      provider: 'gohighlevel' as const,
      config: {},
    },
  }

  function buildMockSupabase(
    assistantResult: { data: unknown; error: unknown },
    toolResult: { data: unknown; error: unknown }
  ) {
    let callCount = 0
    const fromFn = vi.fn().mockImplementation((table: string) => {
      if (table === 'assistant_mappings') {
        return makeSingleChain(assistantResult)
      }
      if (table === 'tool_configs') {
        return makeSingleChain(toolResult)
      }
      if (table === 'action_logs') {
        return makeInsertChain({ data: null, error: null })
      }
      callCount++
      return makeSingleChain({ data: null, error: { code: 'unknown', message: 'unexpected table' } })
    })
    return { from: fromFn } as unknown as SupabaseClient<Database>
  }

  it('Test 1: POST with valid assistantId + tool → returns 200 with results[0].result string', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: { organization_id: 'org_abc' }, error: null },
          { data: mockToolConfig, error: null }
        )
      ),
    }))
    vi.doMock('@/lib/crypto', () => ({
      decrypt: vi.fn().mockResolvedValue('decrypted-api-key'),
    }))
    vi.doMock('@/lib/action-engine/execute-action', () => ({
      executeAction: vi.fn().mockResolvedValue('Contact created. ID: cid_123'),
    }))
    vi.doMock('@/lib/action-engine/log-action', () => ({
      logAction: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results).toHaveLength(1)
    expect(body.results[0].toolCallId).toBe('tc_call_001')
    expect(typeof body.results[0].result).toBe('string')
    expect(body.results[0].result).toBe('Contact created. ID: cid_123')
  })

  it('Test 2: POST with unknown assistantId → returns 200 with result: "Service unavailable."', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: null, error: { code: 'PGRST116', message: 'Not found' } },
          { data: null, error: null }
        )
      ),
    }))
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results[0].result).toBe('Service unavailable.')
  })

  it('Test 3: POST with known assistantId but unconfigured tool → returns 200 with result: "Tool not configured."', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: { organization_id: 'org_abc' }, error: null },
          { data: null, error: { code: 'PGRST116', message: 'Not found' } }
        )
      ),
    }))
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results[0].result).toBe('Tool not configured.')
  })

  it('Test 4: POST where GHL executor throws → returns 200 with toolConfig.fallback_message', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: { organization_id: 'org_abc' }, error: null },
          { data: mockToolConfig, error: null }
        )
      ),
    }))
    vi.doMock('@/lib/crypto', () => ({
      decrypt: vi.fn().mockResolvedValue('decrypted-api-key'),
    }))
    vi.doMock('@/lib/action-engine/execute-action', () => ({
      executeAction: vi.fn().mockRejectedValue(new Error('GHL API error 500')),
    }))
    vi.doMock('@/lib/action-engine/log-action', () => ({
      logAction: vi.fn().mockResolvedValue(undefined),
    }))
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results[0].result).toBe(mockToolConfig.fallback_message)
  })

  it('Test 5: POST with invalid JSON body → returns 200 with results: []', async () => {
    vi.doMock('next/server', () => ({
      after: vi.fn(),
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: 'not-valid-json{{{',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results).toEqual([])
  })

  it('Test 6: logAction is called via after() — NOT awaited inline before the Response is returned', async () => {
    const afterMock = vi.fn()
    const logActionMock = vi.fn().mockResolvedValue(undefined)

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue(
        buildMockSupabase(
          { data: { organization_id: 'org_abc' }, error: null },
          { data: mockToolConfig, error: null }
        )
      ),
    }))
    vi.doMock('@/lib/crypto', () => ({
      decrypt: vi.fn().mockResolvedValue('decrypted-api-key'),
    }))
    vi.doMock('@/lib/action-engine/execute-action', () => ({
      executeAction: vi.fn().mockResolvedValue('Contact created.'),
    }))
    vi.doMock('@/lib/action-engine/log-action', () => ({
      logAction: logActionMock,
    }))
    vi.doMock('next/server', () => ({
      after: afterMock,
    }))

    const { POST } = await import('@/app/api/vapi/tools/route')
    const req = new Request('http://localhost/api/vapi/tools', {
      method: 'POST',
      body: JSON.stringify(makeVapiPayload()),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req)

    // after() must be called exactly once (to schedule async logging)
    expect(afterMock).toHaveBeenCalledTimes(1)
    // logAction must NOT have been directly awaited before the response
    // (it is passed as a callback to after(), so logAction itself is not called yet)
    expect(logActionMock).not.toHaveBeenCalled()
  })
})
