import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeDb, writes, type FakeCall, type Reply } from './helpers/fake-db'
import { sendPushForNotification, buildPushData } from '@/lib/notifications/push-sender'
import { loadVapidConfig, resetVapidConfigCacheForTests } from '@/lib/push/vapid-config'
import { encrypt, decrypt } from '@/lib/crypto'
import { runsInApp } from '@/lib/edge-functions/switch'

const VAPID = { public_key: 'pub', private_key: 'priv', contact: 'mailto:ops@example.com' }

beforeEach(() => {
  resetVapidConfigCacheForTests()
})

describe('VAPID read order', () => {
  const ENV_BEFORE = process.env.ENCRYPTION_SECRET
  beforeEach(() => {
    process.env.ENCRYPTION_SECRET = 'b'.repeat(64)
  })
  afterEach(() => {
    if (ENV_BEFORE === undefined) delete process.env.ENCRYPTION_SECRET
    else process.env.ENCRYPTION_SECRET = ENV_BEFORE
  })

  it('reads the table first, decrypts the private key and never calls the RPC', async () => {
    const encrypted = await encrypt('table-private')
    const { db, calls } = fakeDb(
      (c) => (c.table === 'push_vapid_config'
        ? { data: { public_key: 'table-pub', private_key_encrypted: encrypted, contact: 'mailto:t@example.com' } }
        : undefined),
      () => ({ data: [VAPID] }),
    )
    const out = await loadVapidConfig(db)
    expect(out.source).toBe('table')
    expect(out.config).toEqual({ public_key: 'table-pub', private_key: 'table-private', contact: 'mailto:t@example.com' })
    expect(calls.some((c) => c.table.startsWith('rpc:'))).toBe(false)
    // The stored value is the encrypted form, and round-trips with the shared helper
    expect(encrypted).not.toContain('table-private')
    expect(await decrypt(encrypted)).toBe('table-private')
  })

  it('falls back to the Vault RPC when the table has no row', async () => {
    const { db, calls } = fakeDb(() => ({ data: null }), () => ({ data: [VAPID] }))
    const out = await loadVapidConfig(db)
    expect(out.source).toBe('rpc')
    expect(out.config).toEqual(VAPID)
    expect(calls.map((c) => c.table)).toEqual(['push_vapid_config', 'rpc:get_push_vapid_config'])
  })

  it('falls back to the RPC when the table does not exist yet', async () => {
    const { db } = fakeDb(() => ({ error: { message: 'relation "push_vapid_config" does not exist' } }), () => ({ data: VAPID }))
    expect((await loadVapidConfig(db)).source).toBe('rpc')
  })

  it('falls back to the RPC when the stored private key cannot be decrypted', async () => {
    const { db } = fakeDb(
      () => ({ data: { public_key: 'p', private_key_encrypted: 'not-valid', contact: 'c' } }),
      () => ({ data: [VAPID] }),
    )
    const out = await loadVapidConfig(db, { decrypt: async () => { throw new Error('bad key') } })
    expect(out.source).toBe('rpc')
  })

  it('throws when neither source has a complete config', async () => {
    const { db } = fakeDb(() => ({ data: null }), () => ({ data: [{ public_key: 'only-public' }] }))
    await expect(loadVapidConfig(db)).rejects.toThrow('Could not load VAPID config')
  })

  it('caches a successful read', async () => {
    const { db, calls } = fakeDb(() => ({ data: null }), () => ({ data: [VAPID] }))
    await loadVapidConfig(db)
    await loadVapidConfig(db)
    expect(calls.filter((c) => c.table === 'rpc:get_push_vapid_config')).toHaveLength(1)
  })
})

function sender(opts: { notif?: boolean; subs?: number } = {}) {
  const subs = Array.from({ length: opts.subs ?? 2 }, (_, i) => ({ id: `s${i}`, endpoint: `https://push.example/${i}`, p256dh: 'k', auth: 'a' }))
  const respond = (c: FakeCall): Reply | undefined => {
    if (c.table === 'notifications') {
      return opts.notif === false
        ? { error: { message: 'none' } }
        : { data: { id: 'n1', type: 'new_message', payload: { contact_name: 'Ada', message_preview: 'hello', conversation_id: 'c1' } } }
    }
    if (c.table === 'push_subscriptions' && c.op === 'select') return { data: subs }
    return undefined
  }
  const { db, calls } = fakeDb(respond)
  const send = vi.fn(async () => ({}))
  const loadVapid = vi.fn(async () => ({ config: VAPID }))
  return { db, calls, send, loadVapid, deps: { send, loadVapid } }
}

describe('push-sender in-app port', () => {
  it('sends one push per subscription with the built payload', async () => {
    const t = sender()
    const res = await sendPushForNotification(t.db, { user_id: 'u1', notification_id: 'n1' }, t.deps)
    expect(res).toEqual({ status: 200, body: 'ok' })
    expect(t.send).toHaveBeenCalledTimes(2)
    const [subscription, payload, vapid] = t.send.mock.calls[0] as unknown as [{ endpoint: string; keys: unknown }, string, unknown]
    expect(subscription).toEqual({ endpoint: 'https://push.example/0', keys: { p256dh: 'k', auth: 'a' } })
    expect(JSON.parse(payload)).toEqual({ title: 'Ada', body: 'hello', url: '/inbox?conversation=c1', tag: 'conv-c1' })
    expect(vapid).toEqual(VAPID)
  })

  it('deletes subscriptions that answer 410 or 404 and keeps the rest', async () => {
    const t = sender({ subs: 3 })
    t.send
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error('missing'), { statusCode: 404 }))
      .mockRejectedValueOnce(Object.assign(new Error('server'), { statusCode: 500 }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await sendPushForNotification(t.db, { user_id: 'u1', notification_id: 'n1' }, t.deps)
    err.mockRestore()
    expect(res.status).toBe(200)
    const del = writes(t.calls, 'push_subscriptions', 'delete')
    expect(del).toHaveLength(1)
    expect(del[0].filters).toEqual([['id', 'in', ['s0', 's1']]])
  })

  it('answers 400 for a missing user_id or notification_id and 404 for an unknown notification', async () => {
    const t = sender()
    expect((await sendPushForNotification(t.db, { user_id: 'u1' }, t.deps)).status).toBe(400)
    expect((await sendPushForNotification(t.db, { notification_id: 'n1' }, t.deps)).status).toBe(400)
    const missing = sender({ notif: false })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await sendPushForNotification(missing.db, { user_id: 'u1', notification_id: 'n1' }, missing.deps)).status).toBe(404)
    err.mockRestore()
  })

  it('does nothing and answers 200 when the user has no subscriptions', async () => {
    const t = sender({ subs: 0 })
    const res = await sendPushForNotification(t.db, { user_id: 'u1', notification_id: 'n1' }, t.deps)
    expect(res.status).toBe(200)
    expect(t.send).not.toHaveBeenCalled()
  })

  it('answers 500 and sends nothing when the VAPID config cannot be loaded', async () => {
    const t = sender()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await sendPushForNotification(t.db, { user_id: 'u1', notification_id: 'n1' }, {
      ...t.deps,
      loadVapid: async () => { throw new Error('no vapid') },
    })
    err.mockRestore()
    expect(res.status).toBe(500)
    expect(t.send).not.toHaveBeenCalled()
  })

  it('builds the same payloads as the Edge Function for each type', () => {
    expect(buildPushData('missed_call', { caller_number: '+1555', call_log_id: 'l1' })).toMatchObject({
      title: 'Missed call', body: '+1555', url: '/calls?highlight=l1', tag: 'call-l1',
    })
    expect(buildPushData('incoming_call', { caller_name: 'Bo', call_id: 'a b', timeout_seconds: 20 })).toMatchObject({
      url: '/calls?answer=a%20b', timeoutSeconds: 20,
    })
    expect(buildPushData('ads_connection_expiring', { platform: 'google', days_left: 1 }).title).toBe('Google Ads connection expires in 1 day')
    expect(buildPushData('weird', {})).toEqual({ title: 'New notification', body: '', url: '/inbox', tag: 'notif-weird' })
  })
})

// ── env switch, through the real caller ───────────────────────────────────────

const mockInsertSelect = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: () => ({ insert: () => ({ select: mockInsertSelect }) }),
  })),
}))

describe('EDGE_FUNCTIONS_IN_APP switch', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
    vi.unstubAllGlobals()
  })

  it('defaults to the Edge Function path: push goes to /functions/v1/push-sender', async () => {
    delete process.env.EDGE_FUNCTIONS_IN_APP
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    mockInsertSelect.mockResolvedValue({ data: [{ id: 'n1', user_id: 'u1' }], error: null })
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const { insertNotification } = await import('@/lib/notifications/insert')
    await insertNotification('org-1', 'new_message', {}, ['u1'], { waitForPush: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe('https://proj.supabase.test/functions/v1/push-sender')
  })

  it('runsInApp is false unless push-sender is listed', () => {
    expect(runsInApp('push-sender', {})).toBe(false)
    expect(runsInApp('push-sender', { EDGE_FUNCTIONS_IN_APP: 'process-imports' })).toBe(false)
    expect(runsInApp('push-sender', { EDGE_FUNCTIONS_IN_APP: 'process-imports,push-sender' })).toBe(true)
  })

  it('with push-sender listed, the Edge Function is not called', async () => {
    process.env.EDGE_FUNCTIONS_IN_APP = 'push-sender'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    mockInsertSelect.mockResolvedValue({ data: [{ id: 'n1', user_id: 'u1' }], error: null })
    const fetchMock = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { insertNotification } = await import('@/lib/notifications/insert')
    await insertNotification('org-1', 'new_message', {}, ['u1'], { waitForPush: true })
    err.mockRestore()

    // The in-app sender runs against the (fake) client; whatever it does, it never calls the Edge Function.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
