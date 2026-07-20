// MIR-02 (2026-07 Xkedule<->Xphere integration audit): coverage for
// POST /api/v1/contacts's phone canonicalization + legacy-format
// reconciliation. This is the endpoint Xkedule's syncContactToXphere calls
// on every booking's contact.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))
vi.mock('@/lib/api-keys/verify', () => ({
  verifyApiKey: vi.fn(),
}))
vi.mock('@/lib/analytics/identify', () => ({
  linkVisitorToContact: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { verifyApiKey } from '@/lib/api-keys/verify'
import { POST } from '@/app/api/v1/contacts/route'

const ORG_ID = 'org-1'
const KEY_ID = 'key-1'
const CONTACT_ID = 'contact-1'

interface FakeResp {
  data?: unknown
  error?: { message: string } | null
}

function makeProxy(resolved: FakeResp): any {
  const proxy: any = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'update']) {
    proxy[m] = vi.fn(() => proxy)
  }
  proxy.single = vi.fn(() => Promise.resolve(resolved))
  proxy.maybeSingle = vi.fn(() => Promise.resolve(resolved))
  proxy.then = (resolve: (v: FakeResp) => void) => Promise.resolve(resolved).then(resolve)
  return proxy
}

function buildClient(opts: {
  phoneLookup?: FakeResp
  insertResult?: FakeResp
  updateResult?: FakeResp
}) {
  const insertMock = vi.fn(() => makeProxy(opts.insertResult ?? { data: { id: CONTACT_ID }, error: null }))
  const updateMock = vi.fn(() => makeProxy(opts.updateResult ?? { data: null, error: null }))

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'contacts') {
        const proxy: any = {}
        proxy.select = vi.fn(() => makeProxy(opts.phoneLookup ?? { data: [], error: null }))
        proxy.insert = insertMock
        proxy.update = updateMock
        return proxy
      }
      if (table === 'api_keys') {
        return makeProxy({ data: null, error: null })
      }
      return makeProxy({ data: null, error: null })
    }),
  }
  return { client, insertMock, updateMock }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/v1/contacts', {
    method: 'POST',
    headers: { authorization: 'Bearer xph_test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifyApiKey).mockResolvedValue({
    ok: true,
    key: { keyId: KEY_ID, orgId: ORG_ID, scopes: ['contacts:write'] },
  })
})

describe('POST /api/v1/contacts - MIR-02 phone canonicalization', () => {
  it('stores a caller-id-style +1 phone as real E.164', async () => {
    const { client, insertMock } = buildClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest({ name: 'Jane Doe', phone: '+1 (508) 205-8044' }))

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ phone: '+15082058044' }))
  })

  it('the dedup lookup uses .in() with multiple candidates, not a single .eq()', async () => {
    const { client } = buildClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest({ name: 'Jane Doe', phone: '+15082058044' }))

    const contactsCall = vi.mocked(client.from).mock.results.find(
      (_r, i) => vi.mocked(client.from).mock.calls[i][0] === 'contacts',
    )
    const selectProxy = contactsCall!.value.select.mock.results[0].value
    expect(selectProxy.in).toHaveBeenCalledWith('phone_e164', expect.arrayContaining(['+15082058044', '5082058044']))
  })

  it('finds an existing legacy contact (loose-normalized phone_e164) via the bare-national-digits candidate', async () => {
    const { client, insertMock, updateMock } = buildClient({
      phoneLookup: { data: [{ id: CONTACT_ID }], error: null },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest({ name: 'Jane Doe', phone: '+15082058044' }))
    const body = await res.json()

    expect(body).toEqual({ id: CONTACT_ID, action: 'updated' })
    expect(updateMock).toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('creates a new contact when no candidate matches', async () => {
    const { client, insertMock } = buildClient({ phoneLookup: { data: [], error: null } })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest({ name: 'New Person', phone: '+15551234567' }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.action).toBe('created')
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ phone: '+15551234567' }))
  })

  it('a bare national number with no country hint falls back to the pre-existing loose form (unchanged behavior)', async () => {
    const { client, insertMock } = buildClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest({ name: 'Jane Doe', phone: '5551234567' }))

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ phone: '5551234567' }))
  })
})
