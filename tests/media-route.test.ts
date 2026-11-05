import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  eqs: [] as Array<[string, unknown]>,
  getSignedUrl: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ getUser: h.getUser }))

vi.mock('@/lib/supabase/admin', () => {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = (col: string, val: unknown) => {
    h.eqs.push([col, val])
    return chain
  }
  chain.maybeSingle = h.maybeSingle
  return { createServiceRoleClient: () => ({ from: () => chain }) }
})

vi.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  return {
    S3Client: class {
      send = h.send
    },
    PutObjectCommand: class extends Cmd {},
    GetObjectCommand: class extends Cmd {},
    DeleteObjectsCommand: class extends Cmd {},
    ListObjectsV2Command: class extends Cmd {},
  }
})
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: h.getSignedUrl }))

import { GET } from '@/app/api/media/[...key]/route'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'

function call(...segments: string[]) {
  return GET(new Request('http://localhost/api/media/' + segments.join('/')), {
    params: Promise.resolve({ key: segments }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.eqs.length = 0
  for (const [k, v] of Object.entries({
    STORAGE_R2_BUCKETS: 'chat-media,recordings,contact-imports,global-knowledge,avatars',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'AKID',
    R2_SECRET_ACCESS_KEY: 'SECRET',
    R2_PUBLIC_BUCKET: 'xphere-assets',
    R2_PUBLIC_BASE_URL: 'https://media.xphere.app',
    R2_PRIVATE_BUCKET: 'xphere-files',
  })) vi.stubEnv(k, v)
  h.getUser.mockResolvedValue({ id: 'user-1' })
  h.maybeSingle.mockResolvedValue({ data: { organization_id: ORG }, error: null })
  h.getSignedUrl.mockResolvedValue('https://r2.example/signed?sig=1')
})

afterEach(() => vi.unstubAllEnvs())

describe('GET /api/media/[...key]', () => {
  it('401 without a session, and never signs', async () => {
    h.getUser.mockResolvedValue(null)
    const res = await call('chat-media', ORG, 'c', 'm', 'a.jpg')
    expect(res.status).toBe(401)
    expect(h.getSignedUrl).not.toHaveBeenCalled()
  })

  it('redirects a member of the org to a short-lived signed URL', async () => {
    const res = await call('chat-media', ORG, 'conv', 'msg', '1-0.jpg')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://r2.example/signed?sig=1')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const [, command, options] = h.getSignedUrl.mock.calls[0]
    expect((command as { input: unknown }).input).toEqual({
      Bucket: 'xphere-files',
      Key: `chat-media/${ORG}/conv/msg/1-0.jpg`,
    })
    expect((options as { expiresIn: number }).expiresIn).toBeLessThanOrEqual(300)
  })

  it('checks membership of the org named in the path for the session user', async () => {
    await call('recordings', ORG, 'CA1', 'x.mp3')
    expect(h.eqs).toContainEqual(['user_id', 'user-1'])
    expect(h.eqs).toContainEqual(['organization_id', ORG])
  })

  it('404 for a member of ANOTHER org (not a member of the path org)', async () => {
    h.maybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await call('chat-media', OTHER_ORG, 'conv', 'msg', 'a.jpg')
    expect(res.status).toBe(404)
    expect(h.eqs).toContainEqual(['organization_id', OTHER_ORG])
    expect(h.getSignedUrl).not.toHaveBeenCalled()
  })

  it.each([
    ['dot-dot segment', ['chat-media', ORG, '..', 'secret']],
    ['slash inside a decoded segment (was %2F)', ['chat-media', ORG, '../other', 'x']],
    ['backslash', ['chat-media', ORG, '..\\x', 'a.jpg']],
    ['empty segment', ['chat-media', ORG, '', 'a.jpg']],
    ['dot segment', ['chat-media', ORG, '.', 'a.jpg']],
  ])('404 on traversal: %s', async (_name, segs) => {
    const res = await call(...segs)
    expect(res.status).toBe(404)
    expect(h.maybeSingle).not.toHaveBeenCalled()
    expect(h.getSignedUrl).not.toHaveBeenCalled()
  })

  it.each([
    ['too short', ['chat-media', ORG]],
    ['org segment is not a uuid', ['chat-media', 'not-a-uuid', 'a.jpg']],
    ['unknown bucket', ['secrets', ORG, 'a.jpg']],
    ['public bucket', ['avatars', ORG, 'a.png']],
    ['platform-wide bucket (not org scoped)', ['global-knowledge', ORG, 'a.txt']],
  ])('404 on a malformed key: %s', async (_name, segs) => {
    const res = await call(...segs)
    expect(res.status).toBe(404)
    expect(h.getSignedUrl).not.toHaveBeenCalled()
  })

  it('502, not a crash, when signing fails', async () => {
    h.getSignedUrl.mockRejectedValue(new Error('boom'))
    const res = await call('chat-media', ORG, 'c', 'm', 'a.jpg')
    expect(res.status).toBe(502)
  })

  it('also serves contact-imports and recordings', async () => {
    expect((await call('contact-imports', ORG, 'imp', 'f.csv')).status).toBe(302)
    expect((await call('recordings', ORG, 'CA1', 'r.mp3')).status).toBe(302)
  })
})
