import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Fakes ────────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
  s3Configs: [] as unknown[],
  supabase: {
    upload: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
    getPublicUrl: vi.fn(),
    createSignedUrl: vi.fn(),
    createSignedUploadUrl: vi.fn(),
    list: vi.fn(),
    from: vi.fn(),
  },
}))

vi.mock('@aws-sdk/client-s3', () => {
  class Cmd {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  }
  return {
    S3Client: class {
      constructor(config: unknown) {
        h.s3Configs.push(config)
      }
      send = h.send
    },
    PutObjectCommand: class PutObjectCommand extends Cmd {},
    GetObjectCommand: class GetObjectCommand extends Cmd {},
    DeleteObjectsCommand: class DeleteObjectsCommand extends Cmd {},
    ListObjectsV2Command: class ListObjectsV2Command extends Cmd {},
  }
})

// Declared in package.json but not installed in every checkout.
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: h.getSignedUrl }))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({ storage: { from: h.supabase.from } }),
}))

import * as storage from '@/lib/storage'

const FULL_R2 = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'AKID',
  R2_SECRET_ACCESS_KEY: 'SECRET',
  R2_PUBLIC_BUCKET: 'xphere-assets',
  R2_PUBLIC_BASE_URL: 'https://media.xphere.app/',
  R2_PRIVATE_BUCKET: 'xphere-files',
}

function setEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.resetStorageClientsForTests()
  h.s3Configs.length = 0
  for (const k of [
    'STORAGE_R2_BUCKETS', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_ENDPOINT', 'R2_PUBLIC_BUCKET', 'R2_PUBLIC_BASE_URL', 'R2_PRIVATE_BUCKET',
  ]) vi.stubEnv(k, '')
  h.supabase.from.mockReturnValue(h.supabase)
  h.supabase.upload.mockResolvedValue({ data: {}, error: null })
  h.supabase.remove.mockResolvedValue({ data: [], error: null })
  h.supabase.getPublicUrl.mockImplementation((p: string) => ({
    data: { publicUrl: `https://sb.example/storage/v1/object/public/avatars/${p}` },
  }))
  h.supabase.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://sb.example/signed' }, error: null })
  h.send.mockResolvedValue({})
  h.getSignedUrl.mockResolvedValue('https://r2.example/signed?X-Amz-Signature=abc')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('no R2 env: Supabase exactly as before', () => {
  it('put goes to Supabase with only the options the caller gave', async () => {
    const body = Buffer.from('x')
    const res = await storage.put('avatars', 'u1/a.webp', body, { contentType: 'image/webp', upsert: false, cacheControl: '3600' })
    expect(res.error).toBeNull()
    expect(h.supabase.from).toHaveBeenCalledWith('avatars')
    expect(h.supabase.upload).toHaveBeenCalledWith('u1/a.webp', body, {
      contentType: 'image/webp',
      upsert: false,
      cacheControl: '3600',
    })
    expect(h.send).not.toHaveBeenCalled()
    expect(h.s3Configs).toHaveLength(0)
  })

  it('uses the caller-supplied client instead of the service role one', async () => {
    const own = { storage: { from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }) }) } }
    await storage.put('avatars', 'u1/a.webp', Buffer.from('x'), { client: own as never, contentType: 'image/webp' })
    expect(own.storage.from).toHaveBeenCalledWith('avatars')
    expect(h.supabase.from).not.toHaveBeenCalled()
  })

  it('surfaces a Supabase error as { error: { message } }', async () => {
    h.supabase.upload.mockResolvedValue({ data: null, error: { message: 'Bucket not found' } })
    const res = await storage.put('avatars', 'u1/a.webp', Buffer.from('x'))
    expect(res.error).toEqual({ message: 'Bucket not found' })
  })

  it('publicUrl, signedUrl, remove and get all use Supabase', async () => {
    expect(storage.publicUrl('avatars', 'u1/a.webp')).toBe('https://sb.example/storage/v1/object/public/avatars/u1/a.webp')
    expect(await storage.signedUrl('chat-media', 'o/c/m/f.jpg', 60)).toBe('https://sb.example/signed')
    expect(h.supabase.createSignedUrl).toHaveBeenCalledWith('o/c/m/f.jpg', 60)
    await storage.remove('avatars', ['u1/a.webp'])
    expect(h.supabase.remove).toHaveBeenCalledWith(['u1/a.webp'])
    h.supabase.download.mockResolvedValue({ data: new Blob(['hi']), error: null })
    const got = await storage.get('contact-imports', 'o/i/f.csv')
    expect(await got.data?.text()).toBe('hi')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('storedMediaUrl is the Supabase public URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
    expect(storage.storedMediaUrl('chat-media', 'o/c/m/1-0.jpg')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/chat-media/o/c/m/1-0.jpg',
    )
  })

  it('complete R2 config does nothing for a bucket that is not listed', async () => {
    setEnv({ ...FULL_R2, STORAGE_R2_BUCKETS: 'branding' })
    await storage.put('avatars', 'u1/a.webp', Buffer.from('x'))
    expect(h.supabase.upload).toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('incomplete R2 config does nothing while STORAGE_R2_BUCKETS is empty', async () => {
    setEnv({ R2_ACCESS_KEY_ID: 'AKID' })
    expect(storage.isR2Enabled('avatars')).toBe(false)
    await storage.put('avatars', 'u1/a.webp', Buffer.from('x'))
    expect(h.supabase.upload).toHaveBeenCalled()
  })
})

describe('a listed bucket with incomplete config fails loudly', () => {
  it('throws instead of falling back, naming what is missing', async () => {
    setEnv({ STORAGE_R2_BUCKETS: 'avatars', R2_ACCESS_KEY_ID: 'AKID' })
    await expect(storage.put('avatars', 'u1/a.webp', Buffer.from('x'))).rejects.toThrow(/R2_SECRET_ACCESS_KEY/)
    await expect(storage.put('avatars', 'u1/a.webp', Buffer.from('x'))).rejects.toBeInstanceOf(storage.StorageConfigError)
    expect(() => storage.publicUrl('avatars', 'u1/a.webp')).toThrow(/R2_PUBLIC_BUCKET/)
    expect(h.supabase.upload).not.toHaveBeenCalled()
  })

  it('needs the bucket that matches its kind', async () => {
    setEnv({ ...FULL_R2, R2_PRIVATE_BUCKET: '', STORAGE_R2_BUCKETS: 'chat-media,avatars' })
    await expect(storage.signedUrl('chat-media', 'o/a.jpg')).rejects.toThrow(/R2_PRIVATE_BUCKET/)
    expect(storage.isR2Enabled('avatars')).toBe(true)
  })

  it('needs the public base URL for a public bucket', () => {
    setEnv({ ...FULL_R2, R2_PUBLIC_BASE_URL: '', STORAGE_R2_BUCKETS: 'avatars' })
    expect(() => storage.isR2Enabled('avatars')).toThrow(/R2_PUBLIC_BASE_URL/)
  })

  it('rejects a bucket name it does not know', () => {
    setEnv({ ...FULL_R2, STORAGE_R2_BUCKETS: 'avatar' })
    expect(() => storage.isR2Enabled('avatars')).toThrow(/unknown bucket "avatar"/)
  })

  it('R2_ENDPOINT can stand in for R2_ACCOUNT_ID', async () => {
    setEnv({ ...FULL_R2, R2_ACCOUNT_ID: '', R2_ENDPOINT: 'https://custom.example/', STORAGE_R2_BUCKETS: 'avatars' })
    await storage.put('avatars', 'u1/a.webp', Buffer.from('x'))
    expect((h.s3Configs[0] as { endpoint: string }).endpoint).toBe('https://custom.example')
  })
})

describe('R2: keys, public vs private', () => {
  beforeEach(() => setEnv({ ...FULL_R2, STORAGE_R2_BUCKETS: 'avatars,chat-media,branding' }))

  it('builds "<logical-bucket>/<path>" in the public bucket for public logical buckets', async () => {
    const res = await storage.put('avatars', 'u1/accounts/a-1.webp', Buffer.from('x'), {
      contentType: 'image/webp',
      cacheControl: '3600',
    })
    expect(res.error).toBeNull()
    const cmd = h.send.mock.calls[0][0] as { input: Record<string, unknown> }
    expect(cmd.input).toMatchObject({
      Bucket: 'xphere-assets',
      Key: 'avatars/u1/accounts/a-1.webp',
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=3600',
    })
    expect(h.supabase.upload).not.toHaveBeenCalled()
  })

  it('puts private logical buckets in the private bucket', async () => {
    await storage.put('chat-media', 'org/conv/msg/1-0.jpg', Buffer.from('x'), { contentType: 'image/jpeg' })
    const cmd = h.send.mock.calls[0][0] as { input: Record<string, unknown> }
    expect(cmd.input).toMatchObject({ Bucket: 'xphere-files', Key: 'chat-media/org/conv/msg/1-0.jpg' })
  })

  it('creates the client with the path-style and timeout settings of upload-recording', async () => {
    await storage.put('avatars', 'u1/a.webp', Buffer.from('x'))
    expect(h.s3Configs[0]).toMatchObject({
      endpoint: 'https://acct123.r2.cloudflarestorage.com',
      region: 'auto',
      forcePathStyle: true,
      requestHandler: { connectionTimeout: 5000, requestTimeout: 30000, httpsAgent: { maxSockets: 200 } },
    })
  })

  it('refuses traversal and malformed paths before touching R2', async () => {
    for (const bad of ['../x.png', 'a/../b.png', '/abs.png', 'a//b.png', 'a\\b.png', '', 'a/./b']) {
      await expect(storage.put('avatars', bad, Buffer.from('x'))).rejects.toThrow(/Invalid storage path/)
    }
    expect(h.send).not.toHaveBeenCalled()
  })

  it('publicUrl is R2_PUBLIC_BASE_URL/<bucket>/<encoded path>', () => {
    expect(storage.publicUrl('avatars', 'u1/my file.webp')).toBe('https://media.xphere.app/avatars/u1/my%20file.webp')
  })

  it('a private bucket is only reachable by signed URL (presigned GET with the short TTL)', async () => {
    const url = await storage.signedUrl('chat-media', 'org/a.jpg', 300)
    expect(url).toBe('https://r2.example/signed?X-Amz-Signature=abc')
    const [, command, options] = h.getSignedUrl.mock.calls[0]
    expect((command as { input: unknown }).input).toEqual({ Bucket: 'xphere-files', Key: 'chat-media/org/a.jpg' })
    expect(options).toEqual({ expiresIn: 300 })
  })

  it('signedUploadUrl presigns a PUT without pinning the Content-Type', async () => {
    const res = await storage.signedUploadUrl('chat-media', 'org/imp/f.csv')
    expect(res).toEqual({ url: 'https://r2.example/signed?X-Amz-Signature=abc', token: null, path: 'org/imp/f.csv' })
    const command = h.getSignedUrl.mock.calls[0][1] as { input: Record<string, unknown> }
    expect(command.input).toEqual({ Bucket: 'xphere-files', Key: 'chat-media/org/imp/f.csv' })
  })

  it('storedMediaUrl becomes the /api/media app path once the bucket is on R2', () => {
    expect(storage.storedMediaUrl('chat-media', 'org/c/m/1-0.jpg')).toBe('/api/media/chat-media/org/c/m/1-0.jpg')
  })

  it('remove deletes from R2 and also from Supabase (rows written before the cut-over)', async () => {
    const res = await storage.remove('avatars', ['u1/a.webp'])
    expect(res.error).toBeNull()
    const cmd = h.send.mock.calls[0][0] as { input: { Bucket: string; Delete: { Objects: Array<{ Key: string }> } } }
    expect(cmd.input.Bucket).toBe('xphere-assets')
    expect(cmd.input.Delete.Objects).toEqual([{ Key: 'avatars/u1/a.webp' }])
    expect(h.supabase.remove).toHaveBeenCalledWith(['u1/a.webp'])
  })

  it('get falls back to Supabase when the object is not in R2', async () => {
    h.send.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NoSuchKey' }))
    h.supabase.download.mockResolvedValue({ data: new Blob(['legacy']), error: null })
    const res = await storage.get('chat-media', 'org/old.csv')
    expect(await res.data?.text()).toBe('legacy')
  })

  it('get returns the R2 body when it exists', async () => {
    h.send.mockResolvedValueOnce({
      ContentType: 'text/csv',
      Body: { transformToByteArray: async () => new TextEncoder().encode('a,b') },
    })
    const res = await storage.get('chat-media', 'org/new.csv')
    expect(await res.data?.text()).toBe('a,b')
    expect(h.supabase.download).not.toHaveBeenCalled()
  })

  it('list reads one level of R2 keys under "<bucket>/<prefix>/"', async () => {
    h.send.mockResolvedValueOnce({
      Contents: [
        { Key: 'avatars/org/', Size: 0 },
        { Key: 'avatars/org/a.png', Size: 10, LastModified: new Date('2026-01-01T00:00:00Z') },
      ],
      IsTruncated: false,
    })
    const res = await storage.list('avatars', 'org', { limit: 1000 })
    expect(res.data).toEqual([{ name: 'a.png', size: 10, createdAt: '2026-01-01T00:00:00.000Z' }])
    const cmd = h.send.mock.calls[0][0] as { input: Record<string, unknown> }
    expect(cmd.input).toMatchObject({ Bucket: 'xphere-assets', Prefix: 'avatars/org/', Delimiter: '/' })
  })
})

describe('app media paths', () => {
  beforeEach(() => setEnv({ ...FULL_R2, STORAGE_R2_BUCKETS: 'chat-media' }))

  it('mediaPath and parseMediaPath round-trip', () => {
    const p = storage.mediaPath('chat-media', 'org/a b/c.jpg')
    expect(p).toBe('/api/media/chat-media/org/a%20b/c.jpg')
    expect(storage.parseMediaPath(p)).toEqual({ bucket: 'chat-media', path: 'org/a b/c.jpg' })
    expect(storage.parseMediaPath('https://xphere.app' + p)).toEqual({ bucket: 'chat-media', path: 'org/a b/c.jpg' })
  })

  it('parseMediaPath rejects other URLs, public buckets and traversal', () => {
    expect(storage.parseMediaPath('https://x.supabase.co/storage/v1/object/public/chat-media/a.jpg')).toBeNull()
    expect(storage.parseMediaPath('/api/media/avatars/a.png')).toBeNull()
    expect(storage.parseMediaPath('/api/media/chat-media/..%2Fsecret')).toBeNull()
    expect(storage.parseMediaPath('/api/media/chat-media/')).toBeNull()
  })

  it('resolveExternalUrl signs an app path and leaves every other URL untouched', async () => {
    const supabaseUrl = 'https://proj.supabase.co/storage/v1/object/public/chat-media/o/a.jpg'
    expect(await storage.resolveExternalUrl(supabaseUrl)).toBe(supabaseUrl)
    expect(h.getSignedUrl).not.toHaveBeenCalled()

    const signed = await storage.resolveExternalUrl('/api/media/chat-media/o/a.jpg')
    expect(signed).toBe('https://r2.example/signed?X-Amz-Signature=abc')
    expect(h.getSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 3600 })
  })

  it('resolveMessageMediaUrls signs only app paths inside metadata.media', async () => {
    const plain = { id: 'm0', metadata: { foo: 1 } }
    const old = { id: 'm1', metadata: { media: [{ url: 'https://sb/old.jpg', mime_type: 'image/jpeg' }] } }
    const fresh = { id: 'm2', metadata: { media: [{ url: '/api/media/chat-media/o/a.jpg', mime_type: 'image/jpeg' }] } }
    const out = await storage.resolveMessageMediaUrls([plain, old, fresh])
    expect(out[0]).toBe(plain)
    expect(out[1]).toBe(old)
    expect((out[2].metadata as { media: Array<{ url: string }> }).media[0].url).toBe('https://r2.example/signed?X-Amz-Signature=abc')
  })

  it('pathFromPublicUrl reads both Supabase and R2 public URLs, dropping ?v=', () => {
    setEnv({ R2_PUBLIC_BASE_URL: 'https://media.xphere.app' })
    expect(storage.pathFromPublicUrl('branding', 'https://p.supabase.co/storage/v1/object/public/branding/landing/s-1.webp?v=9')).toBe('landing/s-1.webp')
    expect(storage.pathFromPublicUrl('branding', 'https://media.xphere.app/branding/landing/s-2.webp?v=9')).toBe('landing/s-2.webp')
    expect(storage.pathFromPublicUrl('branding', 'https://elsewhere.example/x.webp')).toBeNull()
  })
})
