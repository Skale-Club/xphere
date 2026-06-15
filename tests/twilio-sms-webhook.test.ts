// tests/twilio-sms-webhook.test.ts
// SEED-005 — Twilio Inbound SMS webhook tests.
//
// Coverage:
//   SMS-IN-01: HMAC-SHA1 signature validation (valid → 200 TwiML, invalid → 403)
//   SMS-IN-02: Conversation upsert (new + existing)
//   SMS-IN-03: Duplicate MessageSid is not re-inserted
//   SMS-IN-04: When an SMS agent is configured, runAgent is invoked and send_sms fires
//
// All HTTP-level paths return 200 except a genuine signature failure (403).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

// ---- Mock next/server — capture the async callback so tests can await it ----
//
// after() in production fires-and-forgets the callback. In tests we need to
// observe the side-effects, so we collect the pending promises into a queue
// and expose a `flushAfterCallbacks()` helper that awaits them all.
const pendingAfterCallbacks: Array<Promise<unknown>> = []
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => unknown) => {
    const result = fn()
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      pendingAfterCallbacks.push(result as Promise<unknown>)
    }
  }),
}))

async function flushAfterCallbacks(): Promise<void> {
  while (pendingAfterCallbacks.length > 0) {
    const next = pendingAfterCallbacks.shift()
    if (next) await next
  }
}

// ---- Mock createServiceRoleClient ----
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

// ---- Mock decrypt — returns a JSON blob with account_sid + auth_token ----
const TEST_AUTH_TOKEN = 'test-twilio-auth-token'
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue(
    JSON.stringify({ account_sid: 'AC_test_sid', auth_token: TEST_AUTH_TOKEN })
  ),
}))

// ---- Mock runAgent + sendSms so we can assert auto-reply path ----
vi.mock('@/lib/agent-runtime/run-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    text: 'Hello from the agent',
    usage: { tokensIn: 10, tokensOut: 5 },
    invocationId: 'inv-1',
    traceId: 'trace-1',
    status: 'success',
  }),
}))
vi.mock('@/lib/twilio/send-sms', () => ({
  sendSms: vi.fn().mockResolvedValue('SMS sent. SID: SM_reply_1'),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { sendSms } from '@/lib/twilio/send-sms'

// ---- Helpers ----

const TEST_URL = 'http://localhost/api/twilio/sms'

/**
 * Compute Twilio's X-Twilio-Signature for a given URL + form params + token.
 * Mirrors the verification logic in src/app/api/twilio/sms/route.ts.
 */
function computeTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string
): string {
  const sortedKeys = Object.keys(params).sort()
  let canonical = url
  for (const key of sortedKeys) {
    canonical += key + params[key]
  }
  return createHmac('sha1', authToken).update(canonical, 'utf8').digest('base64')
}

function makeFormBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

function makePost(body: string, signature: string | null, url = TEST_URL): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (signature !== null) headers['x-twilio-signature'] = signature
  return new Request(url, { method: 'POST', body, headers })
}

// ---- Supabase mock builder ----
type ExistingConv = {
  id: string
  bot_status: string
} | null

interface MockOptions {
  existingConversation?: ExistingConv
  /** Existing conversation_messages row with the same message_sid (de-dup) */
  duplicateMessage?: boolean
  /** agent_channel_defaults row for channel='sms' — { agent_id } or null */
  smsAgentDefault?: { agent_id: string } | null
  /** integrations row match — null forces the "no integration" branch */
  integration?: { organization_id: string; encrypted_api_key: string } | null
}

function buildMockSupabase(opts: MockOptions = {}) {
  const insertConversationSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'conv-new' }, error: null }),
  })
  const updateConversationSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
  const insertMessageSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'msg-new' }, error: null }),
  })

  const integration =
    opts.integration === undefined
      ? { organization_id: 'org-1', encrypted_api_key: 'ENC' }
      : opts.integration

  const fromMock = vi.fn((table: string) => {
    if (table === 'integrations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: integration, error: null }),
      }
    }

    if (table === 'twilio_phone_numbers') {
      // resolveTwilioOrgByToNumber selects ALL active rows for an e164 and awaits
      // the builder directly (array); resolveTwilioCredentialsForOrg's
      // default-number lookup uses .maybeSingle(). Support both.
      const row = integration
        ? {
            id: 'phone-number-1',
            organization_id: integration.organization_id,
            e164: '+15553334444',
            is_active: true,
            capability_sms: true,
          }
        : null
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: row ? [row] : [], error: null }),
      }
    }

    if (table === 'contacts') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }

    if (table === 'workflows') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    }

    if (table === 'event_dispatches') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'dispatch-1' }, error: null }),
        }),
      }
    }

    if (table === 'conversations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.existingConversation ?? null,
          error: null,
        }),
        insert: insertConversationSpy,
        update: updateConversationSpy,
      }
    }

    if (table === 'conversation_messages') {
      // SELECT path returns dup or null; INSERT path is spied
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.duplicateMessage ? { id: 'msg-dup' } : null,
          error: null,
        }),
        insert: insertMessageSpy,
      }
    }

    if (table === 'agent_channel_defaults') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.smsAgentDefault ?? null,
          error: null,
        }),
      }
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return {
    from: fromMock,
    insertConversationSpy,
    updateConversationSpy,
    insertMessageSpy,
  }
}

// ---- Tests ----

describe('SMS-IN-01: HMAC-SHA1 signature validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 + empty TwiML when signature is valid', async () => {
    const mockDb = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'Hi there',
      MessageSid: 'SM_abc_001',
      AccountSid: 'AC_test_sid',
    }
    const body = makeFormBody(params)
    const sig = computeTwilioSignature(TEST_URL, params, TEST_AUTH_TOKEN)

    const { POST } = await import('@/app/api/twilio/sms/route')
    const response = await POST(makePost(body, sig))
    await flushAfterCallbacks()

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('<Response>')
    expect(response.headers.get('content-type')).toContain('text/xml')
  })

  it('returns 403 when X-Twilio-Signature does not match', async () => {
    const mockDb = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'Tampered',
      MessageSid: 'SM_abc_002',
    }
    const body = makeFormBody(params)
    // Compute signature with the WRONG token
    const badSig = computeTwilioSignature(TEST_URL, params, 'wrong-token')

    const { POST } = await import('@/app/api/twilio/sms/route')
    const response = await POST(makePost(body, badSig))
    await flushAfterCallbacks()

    expect(response.status).toBe(403)
  })

  it('returns 200 + TwiML (does not throw) when no Twilio integration matches the To number', async () => {
    // No integration → cannot validate signature → ack and drop (Twilio retries non-200)
    const mockDb = buildMockSupabase({ integration: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15559999999',
      Body: 'No match',
      MessageSid: 'SM_abc_003',
    }
    const body = makeFormBody(params)
    const sig = computeTwilioSignature(TEST_URL, params, TEST_AUTH_TOKEN)

    const { POST } = await import('@/app/api/twilio/sms/route')
    const response = await POST(makePost(body, sig))
    await flushAfterCallbacks()

    expect(response.status).toBe(200)
  })

  it('returns 403 when X-Twilio-Signature header is missing entirely', async () => {
    const mockDb = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'Missing sig',
      MessageSid: 'SM_abc_004',
    }
    const body = makeFormBody(params)

    const { POST } = await import('@/app/api/twilio/sms/route')
    const response = await POST(makePost(body, null))
    await flushAfterCallbacks()

    expect(response.status).toBe(403)
  })
})

describe('SMS-IN-02: Conversation upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new conversation with channel="sms" and visitor_phone=From', async () => {
    const mockDb = buildMockSupabase({ existingConversation: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'Hello SMS',
      MessageSid: 'SM_new_001',
    }
    const body = makeFormBody(params)
    const sig = computeTwilioSignature(TEST_URL, params, TEST_AUTH_TOKEN)

    const { POST } = await import('@/app/api/twilio/sms/route')
    await POST(makePost(body, sig))
    await flushAfterCallbacks()

    expect(mockDb.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'sms',
        visitor_phone: '+15551112222',
        org_id: 'org-1',
        widget_token: '',
        last_message: 'Hello SMS',
      })
    )
  })

  it('appends message to existing conversation instead of inserting a duplicate', async () => {
    const mockDb = buildMockSupabase({
      existingConversation: { id: 'conv-existing', bot_status: 'active' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'Second message',
      MessageSid: 'SM_existing_001',
    }
    const body = makeFormBody(params)
    const sig = computeTwilioSignature(TEST_URL, params, TEST_AUTH_TOKEN)

    const { POST } = await import('@/app/api/twilio/sms/route')
    await POST(makePost(body, sig))

    await flushAfterCallbacks()

    expect(mockDb.insertConversationSpy).not.toHaveBeenCalled()
    expect(mockDb.updateConversationSpy).toHaveBeenCalled()
    expect(mockDb.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-existing',
        role: 'user',
        content: 'Second message',
      })
    )
  })
})

describe('SMS-IN-03: Duplicate MessageSid deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not insert a second conversation_message when MessageSid already exists', async () => {
    const mockDb = buildMockSupabase({
      existingConversation: { id: 'conv-existing', bot_status: 'active' },
      duplicateMessage: true,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'Retry of same SMS',
      MessageSid: 'SM_dup_001',
    }
    const body = makeFormBody(params)
    const sig = computeTwilioSignature(TEST_URL, params, TEST_AUTH_TOKEN)

    const { POST } = await import('@/app/api/twilio/sms/route')
    await POST(makePost(body, sig))

    await flushAfterCallbacks()

    // Duplicate retries must not move the conversation preview backwards.
    expect(mockDb.updateConversationSpy).not.toHaveBeenCalled()
    // But NO new message insert
    expect(mockDb.insertMessageSpy).not.toHaveBeenCalled()
    // And no agent run
    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
  })
})

describe('SMS-IN-04: Agent invocation + send_sms reply', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invokes runAgent with channel="sms" when agent_channel_defaults has an SMS agent', async () => {
    const mockDb = buildMockSupabase({
      existingConversation: null,
      smsAgentDefault: { agent_id: 'agent-sms-1' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'Tell me a joke',
      MessageSid: 'SM_agent_001',
    }
    const body = makeFormBody(params)
    const sig = computeTwilioSignature(TEST_URL, params, TEST_AUTH_TOKEN)

    const { POST } = await import('@/app/api/twilio/sms/route')
    await POST(makePost(body, sig))

    await flushAfterCallbacks()

    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        agentId: 'agent-sms-1',
        channel: 'sms',
        userMessage: 'Tell me a joke',
        stream: false,
      })
    )
  })

  it('calls sendSms with the agent reply text targeting the original sender', async () => {
    const mockDb = buildMockSupabase({
      existingConversation: null,
      smsAgentDefault: { agent_id: 'agent-sms-1' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'Tell me a joke',
      MessageSid: 'SM_agent_002',
    }
    const body = makeFormBody(params)
    const sig = computeTwilioSignature(TEST_URL, params, TEST_AUTH_TOKEN)

    const { POST } = await import('@/app/api/twilio/sms/route')
    await POST(makePost(body, sig))

    await flushAfterCallbacks()

    expect(vi.mocked(sendSms)).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15551112222',
        body: 'Hello from the agent',
      }),
      expect.objectContaining({
        organizationId: 'org-1',
      })
    )
  })

  it('skips runAgent when no agent_channel_defaults row exists for SMS', async () => {
    const mockDb = buildMockSupabase({
      existingConversation: null,
      smsAgentDefault: null,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'No agent here',
      MessageSid: 'SM_no_agent_001',
    }
    const body = makeFormBody(params)
    const sig = computeTwilioSignature(TEST_URL, params, TEST_AUTH_TOKEN)

    const { POST } = await import('@/app/api/twilio/sms/route')
    await POST(makePost(body, sig))

    await flushAfterCallbacks()

    // User message still inserted
    expect(mockDb.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'No agent here' })
    )
    // But no agent run + no auto-reply
    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
    expect(vi.mocked(sendSms)).not.toHaveBeenCalled()
  })

  it('skips auto-reply when conversation bot_status is paused', async () => {
    const mockDb = buildMockSupabase({
      existingConversation: { id: 'conv-paused', bot_status: 'paused' },
      smsAgentDefault: { agent_id: 'agent-sms-1' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const params = {
      From: '+15551112222',
      To: '+15553334444',
      Body: 'Human handling this',
      MessageSid: 'SM_paused_001',
    }
    const body = makeFormBody(params)
    const sig = computeTwilioSignature(TEST_URL, params, TEST_AUTH_TOKEN)

    const { POST } = await import('@/app/api/twilio/sms/route')
    await POST(makePost(body, sig))

    await flushAfterCallbacks()

    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
    expect(vi.mocked(sendSms)).not.toHaveBeenCalled()
  })
})
