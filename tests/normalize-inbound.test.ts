import { describe, it, expect, vi } from 'vitest'
import { normalizeInbound, emitProspectReplyEvent } from '@/lib/messaging/normalize-inbound'

/** Flush the microtask queue — needed for assertions on the fire-and-forget
 * `void emitProspectReplyEvent(...)` call inside normalizeInbound, whose
 * internal chain (contacts select → event insert → contacts update) resolves
 * a few ticks after normalizeInbound itself has already returned. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

// Chainable Supabase mock supporting the queries normalizeInbound runs:
//   conversations: select…eq…[order]…limit…maybeSingle | update…eq | insert…select…single
//   conversation_messages: select…eq…contains…limit…maybeSingle | insert…select…single
function makeSupabase({
  existing = null as Record<string, unknown> | null,
  dup = null as Record<string, unknown> | null,
  createId = 'conv-new',
  createErr = null as { message: string } | null,
  msgId = 'msg-1',
  msgErr = null as { message: string } | null,
  // emitProspectReplyEvent fixtures — contacts.lifecycle_stage lookup +
  // prospect_engagement_events insert + contacts engagement_status update.
  contactLifecycle = null as string | null,
  contactSelectThrows = false,
} = {}) {
  const convUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const convUpdate = vi.fn(() => ({ eq: convUpdateEq }))

  const convInsertSingle = vi.fn().mockResolvedValue({
    data: createErr ? null : { id: createId },
    error: createErr,
  })
  const convInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: convInsertSingle })) }))

  const convMaybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null })
  const convSelectChain: Record<string, unknown> = {}
  convSelectChain.eq = vi.fn(() => convSelectChain)
  convSelectChain.order = vi.fn(() => convSelectChain)
  convSelectChain.limit = vi.fn(() => convSelectChain)
  convSelectChain.maybeSingle = convMaybeSingle
  const convSelect = vi.fn(() => convSelectChain)

  const msgMaybeSingle = vi.fn().mockResolvedValue({ data: dup, error: null })
  const msgSelectChain: Record<string, unknown> = {}
  msgSelectChain.eq = vi.fn(() => msgSelectChain)
  msgSelectChain.contains = vi.fn(() => msgSelectChain)
  msgSelectChain.limit = vi.fn(() => msgSelectChain)
  msgSelectChain.maybeSingle = msgMaybeSingle
  const msgSelect = vi.fn(() => msgSelectChain)

  const msgInsertSingle = vi.fn().mockResolvedValue({
    data: msgErr ? null : { id: msgId },
    error: msgErr,
  })
  const msgInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: msgInsertSingle })) }))

  // contacts: .select('lifecycle_stage').eq(...).eq(...).maybeSingle() +
  // .update({...}).eq(...).eq(...)
  const contactMaybeSingle = vi.fn(() =>
    contactSelectThrows
      ? Promise.reject(new Error('contacts select boom'))
      : Promise.resolve({ data: contactLifecycle ? { lifecycle_stage: contactLifecycle } : null, error: null }),
  )
  const contactSelectChain: Record<string, unknown> = {}
  contactSelectChain.eq = vi.fn(() => contactSelectChain)
  contactSelectChain.maybeSingle = contactMaybeSingle
  const contactSelect = vi.fn(() => contactSelectChain)

  // `.update(...).eq('id', ...).eq('org_id', ...)` is awaited bare (no
  // `.then`/destructure), so the chain just needs to support N chained `.eq()`
  // calls — awaiting a plain object resolves immediately to that object.
  const contactUpdateChain: Record<string, unknown> = {}
  contactUpdateChain.eq = vi.fn(() => contactUpdateChain)
  const contactUpdate = vi.fn(() => contactUpdateChain)

  // prospect_engagement_events: .insert({...}) — no further chaining.
  const prospectEventsInsert = vi.fn().mockResolvedValue({ data: null, error: null })

  const from = vi.fn((table: string) => {
    if (table === 'conversations') return { select: convSelect, update: convUpdate, insert: convInsert }
    if (table === 'conversation_messages') return { select: msgSelect, insert: msgInsert }
    if (table === 'contacts') return { select: contactSelect, update: contactUpdate }
    if (table === 'prospect_engagement_events') return { insert: prospectEventsInsert }
    return {}
  })

  return {
    from,
    convUpdate,
    convInsert,
    msgInsert,
    convSelectChain,
    msgSelectChain,
    contactSelect,
    contactUpdate,
    prospectEventsInsert,
  } as never
}

const baseMsg = { role: 'user', content: 'hi', message_type: 'text', metadata: { x: 1 } }

describe('normalizeInbound', () => {
  it('existing conversation: updates it, inserts the message, returns existing + messageId', async () => {
    const sb = makeSupabase({ existing: { id: 'conv-x', bot_status: 'active', contact_id: 'c1' } })
    const res = await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'sms',
      match: { by: 'visitor_phone', phone: '+15551234' },
      createPayload: { widget_token: '' },
      updatePayload: { last_message: 'hi' },
      message: baseMsg,
    })
    expect(res).toMatchObject({ conversationId: 'conv-x', isNew: false, duplicate: false, messageId: 'msg-1' })
    expect(res.existing?.bot_status).toBe('active')
    // @ts-expect-error test-only spy access
    expect(sb.convUpdate).toHaveBeenCalledWith({ last_message: 'hi' })
    // @ts-expect-error test-only spy access
    expect(sb.convInsert).not.toHaveBeenCalled()
    // @ts-expect-error test-only spy access
    expect(sb.msgInsert).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-1', conversation_id: 'conv-x', role: 'user', content: 'hi' }))
  })

  it('no existing conversation: creates one (org_id + channel merged) then inserts the message', async () => {
    const sb = makeSupabase({ existing: null, createId: 'conv-new' })
    const res = await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'sms',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: { widget_token: '', visitor_phone: '+1' },
      updatePayload: { last_message: 'hi' },
      message: baseMsg,
    })
    expect(res).toMatchObject({ conversationId: 'conv-new', isNew: true, duplicate: false, messageId: 'msg-1' })
    // @ts-expect-error test-only spy access
    expect(sb.convInsert).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-1', channel: 'sms', visitor_phone: '+1' }))
    // @ts-expect-error test-only spy access
    expect(sb.convUpdate).not.toHaveBeenCalled()
  })

  it('metadata match: applies an eq filter per channel_metadata key', async () => {
    const sb = makeSupabase({ existing: { id: 'conv-m', bot_status: null, contact_id: null } })
    await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'messenger',
      match: { by: 'metadata', keys: { sender_id: 's1', page_id: 'p1' } },
      createPayload: {},
      updatePayload: { last_message: 'x' },
      message: baseMsg,
    })
    // @ts-expect-error test-only spy access
    const eq = sb.convSelectChain.eq
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(eq).toHaveBeenCalledWith('channel', 'messenger')
    expect(eq).toHaveBeenCalledWith('channel_metadata->>sender_id', 's1')
    expect(eq).toHaveBeenCalledWith('channel_metadata->>page_id', 'p1')
  })

  it('contact_open match: filters by contact_id + status=open and orders by created_at', async () => {
    const sb = makeSupabase({ existing: null })
    await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'email',
      match: { by: 'contact_open', contactId: 'ct-1' },
      createPayload: { widget_token: 'uuid' },
      updatePayload: {},
      message: baseMsg,
    })
    // @ts-expect-error test-only spy access
    const chain = sb.convSelectChain
    expect(chain.eq).toHaveBeenCalledWith('contact_id', 'ct-1')
    expect(chain.eq).toHaveBeenCalledWith('status', 'open')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('idempotency: skips the message insert when a matching provider message exists', async () => {
    const sb = makeSupabase({ existing: { id: 'conv-x', bot_status: 'active', contact_id: null }, dup: { id: 'dup-1' } })
    const res = await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'sms',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: {},
      updatePayload: { last_message: 'hi' },
      message: baseMsg,
      idempotencyMetadata: { message_sid: 'SM1' },
    })
    expect(res).toMatchObject({ conversationId: 'conv-x', duplicate: true, messageId: null })
    // Conversation is still updated, but no message is inserted.
    // @ts-expect-error test-only spy access
    expect(sb.convUpdate).toHaveBeenCalled()
    // @ts-expect-error test-only spy access
    expect(sb.msgInsert).not.toHaveBeenCalled()
  })

  it('skipMessage: upsert-only — creates/updates conversation but inserts no message', async () => {
    const sbExisting = makeSupabase({ existing: { id: 'conv-x', bot_status: 'active', contact_id: null } })
    const res = await normalizeInbound({
      supabase: sbExisting,
      orgId: 'org-1',
      channel: 'messenger',
      match: { by: 'metadata', keys: { sender_id: 's1', page_id: 'p1' } },
      createPayload: {},
      updatePayload: { last_message: 'x' },
      message: baseMsg,
      idempotencyMetadata: { meta_mid: 'm1' },
      skipMessage: true,
    })
    expect(res).toMatchObject({ conversationId: 'conv-x', isNew: false, duplicate: false, messageId: null })
    // @ts-expect-error test-only spy access
    expect(sbExisting.convUpdate).toHaveBeenCalled()
    // @ts-expect-error test-only spy access
    expect(sbExisting.msgInsert).not.toHaveBeenCalled()
  })

  it('empty updatePayload: existing conversation is not touched during upsert', async () => {
    const sb = makeSupabase({ existing: { id: 'conv-x', bot_status: 'active', contact_id: null } })
    await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'telegram',
      match: { by: 'visitor_phone', phone: '123' },
      createPayload: {},
      updatePayload: {},
      message: baseMsg,
      skipMessage: true,
    })
    // @ts-expect-error test-only spy access
    expect(sb.convUpdate).not.toHaveBeenCalled()
  })

  it('idempotency guard: a missing (undefined) provider id skips dedup and still inserts the message', async () => {
    // dup row is present, but the guard must skip the dedup check because the
    // provider id is undefined (avoids the .contains({}) match-all that would
    // silently drop every inbound).
    const sb = makeSupabase({ existing: { id: 'conv-x', bot_status: 'active', contact_id: null }, dup: { id: 'would-dup' } })
    const res = await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'sms',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: {},
      updatePayload: { last_message: 'x' },
      message: baseMsg,
      idempotencyMetadata: { message_sid: undefined },
    })
    expect(res.duplicate).toBe(false)
    expect(res.messageId).toBe('msg-1')
  })

  it('conversation create failure: returns error, no message insert', async () => {
    const sb = makeSupabase({ existing: null, createErr: { message: 'insert boom' } })
    const res = await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'sms',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: {},
      updatePayload: {},
      message: baseMsg,
    })
    expect(res.error).toBe('insert boom')
    expect(res.messageId).toBeNull()
    // @ts-expect-error test-only spy access
    expect(sb.msgInsert).not.toHaveBeenCalled()
  })

  it('createPayload factory: invoked (awaited) only when creating a new conversation', async () => {
    const factory = vi.fn().mockResolvedValue({ widget_token: '', visitor_phone: '+1', contact_id: 'ct-9' })
    const sb = makeSupabase({ existing: null, createId: 'conv-new' })
    const res = await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'whatsapp',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: factory,
      updatePayload: {},
      message: baseMsg,
    })
    expect(res.isNew).toBe(true)
    expect(factory).toHaveBeenCalledTimes(1)
    // @ts-expect-error test-only spy access
    expect(sb.convInsert).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-1', channel: 'whatsapp', contact_id: 'ct-9' }))
  })

  it('createPayload factory: NOT invoked when an existing conversation is matched', async () => {
    const factory = vi.fn().mockResolvedValue({})
    const sb = makeSupabase({ existing: { id: 'conv-x', bot_status: 'active', contact_id: 'c1' } })
    await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'whatsapp',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: factory,
      updatePayload: { last_message: 'x' },
      message: baseMsg,
    })
    expect(factory).not.toHaveBeenCalled()
  })

  it('message insert failure: returns error with null messageId', async () => {
    const sb = makeSupabase({ existing: { id: 'conv-x', bot_status: 'active', contact_id: null }, msgErr: { message: 'msg boom' } })
    const res = await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'sms',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: {},
      updatePayload: {},
      message: baseMsg,
    })
    expect(res.error).toBe('msg boom')
    expect(res.messageId).toBeNull()
  })
})

describe('emitProspectReplyEvent', () => {
  it('prospect contact: inserts prospect_engagement_events (event_type=replied) and updates contacts', async () => {
    const sb = makeSupabase({ contactLifecycle: 'prospect' })
    await emitProspectReplyEvent(sb, 'org-1', 'contact-1', 'whatsapp')

    // @ts-expect-error test-only spy access
    expect(sb.prospectEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        entity_type: 'contact',
        entity_id: 'contact-1',
        event_type: 'replied',
        channel: 'whatsapp',
        source_platform: 'inbox',
      }),
    )
    // @ts-expect-error test-only spy access
    expect(sb.contactUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ engagement_status: 'replied' }),
    )
    // Never writes lifecycle_stage — a reply must not auto-promote.
    // @ts-expect-error test-only spy access
    const updateArg = sb.contactUpdate.mock.calls[0][0]
    expect(updateArg).not.toHaveProperty('lifecycle_stage')
  })

  it('non-prospect lifecycle_stage: no event, no contacts update', async () => {
    const sb = makeSupabase({ contactLifecycle: 'customer' })
    await emitProspectReplyEvent(sb, 'org-1', 'contact-1', 'sms')

    // @ts-expect-error test-only spy access
    expect(sb.prospectEventsInsert).not.toHaveBeenCalled()
    // @ts-expect-error test-only spy access
    expect(sb.contactUpdate).not.toHaveBeenCalled()
  })

  it('null contactId: no-op, never queries contacts', async () => {
    const sb = makeSupabase({ contactLifecycle: 'prospect' })
    await emitProspectReplyEvent(sb, 'org-1', null, 'sms')

    // @ts-expect-error test-only spy access
    expect(sb.contactSelect).not.toHaveBeenCalled()
    // @ts-expect-error test-only spy access
    expect(sb.prospectEventsInsert).not.toHaveBeenCalled()
  })

  it('undefined contactId: no-op (same as null)', async () => {
    const sb = makeSupabase({ contactLifecycle: 'prospect' })
    await emitProspectReplyEvent(sb, 'org-1', undefined, 'sms')

    // @ts-expect-error test-only spy access
    expect(sb.contactSelect).not.toHaveBeenCalled()
  })

  it('a thrown DB error inside the hook is caught and swallowed (never throws)', async () => {
    const sb = makeSupabase({ contactSelectThrows: true })
    await expect(emitProspectReplyEvent(sb, 'org-1', 'contact-1', 'sms')).resolves.toBeUndefined()

    // @ts-expect-error test-only spy access
    expect(sb.prospectEventsInsert).not.toHaveBeenCalled()
  })
})

describe('normalizeInbound + prospect reply hook integration', () => {
  it('full-mode insert for a prospect fires the hook off the shared choke point', async () => {
    const sb = makeSupabase({
      existing: { id: 'conv-x', bot_status: 'active', contact_id: 'contact-1' },
      contactLifecycle: 'prospect',
    })
    const res = await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'whatsapp',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: {},
      updatePayload: { last_message: 'hi' },
      message: baseMsg, // role: 'user'
    })
    expect(res.messageId).toBe('msg-1')
    await flush()

    // @ts-expect-error test-only spy access
    expect(sb.prospectEventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ entity_id: 'contact-1', event_type: 'replied', channel: 'whatsapp' }),
    )
  })

  it('a DB error inside the hook never surfaces on, or breaks, normalizeInbound\'s own result', async () => {
    const sb = makeSupabase({
      existing: { id: 'conv-x', bot_status: 'active', contact_id: 'contact-1' },
      contactSelectThrows: true,
    })
    const res = await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'whatsapp',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: {},
      updatePayload: {},
      message: baseMsg,
    })
    // normalizeInbound's own success is untouched by the hook's internal error.
    expect(res.error).toBeUndefined()
    expect(res.messageId).toBe('msg-1')
    await flush()
    // @ts-expect-error test-only spy access
    expect(sb.prospectEventsInsert).not.toHaveBeenCalled()
  })

  it('non-"user" role message never fires the hook (outbound/assistant writes through normalizeInbound)', async () => {
    const sb = makeSupabase({
      existing: { id: 'conv-x', bot_status: 'active', contact_id: 'contact-1' },
      contactLifecycle: 'prospect',
    })
    await normalizeInbound({
      supabase: sb,
      orgId: 'org-1',
      channel: 'whatsapp',
      match: { by: 'visitor_phone', phone: '+1' },
      createPayload: {},
      updatePayload: {},
      message: { role: 'assistant', content: 'hi', message_type: 'text', metadata: {} },
    })
    await flush()
    // @ts-expect-error test-only spy access
    expect(sb.contactSelect).not.toHaveBeenCalled()
    // @ts-expect-error test-only spy access
    expect(sb.prospectEventsInsert).not.toHaveBeenCalled()
  })
})
