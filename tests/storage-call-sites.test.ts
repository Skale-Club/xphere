import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  send: vi.fn(),
  updateUserMetadata: vi.fn(),
  callLogUpdate: vi.fn(),
  callLog: { id: 'cl-1', org_id: 'org-1', recording_url: null } as unknown,
}))

vi.mock('@/lib/supabase/server', () => ({
  getUser: h.getUser,
  createClient: async () => ({ rpc: h.rpc }),
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
      send = h.send
    },
    PutObjectCommand: class extends Cmd {},
    GetObjectCommand: class extends Cmd {},
    DeleteObjectsCommand: class extends Cmd {},
    ListObjectsV2Command: class extends Cmd {},
  }
})
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }))
vi.mock('@/lib/auth/users', () => ({ updateUserMetadata: h.updateUserMetadata }))
vi.mock('@/lib/org/active-org', () => ({ getActiveOrg: vi.fn() }))
vi.mock('@/lib/notifications/insert', () => ({ insertNotification: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const R2_ENV = {
  STORAGE_R2_BUCKETS: 'recordings',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'AKID',
  R2_SECRET_ACCESS_KEY: 'SECRET',
  R2_PRIVATE_BUCKET: 'xphere-files',
}

/** Service-role client double: storage for the Supabase path, a call_logs table for the recording route. */
function mockAdmin(upload: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ error: null })) {
  vi.doMock('@/lib/supabase/admin', () => {
    const select = { eq: () => select, maybeSingle: async () => ({ data: h.callLog, error: null }) }
    return {
      createServiceRoleClient: () => ({
        storage: {
          from: () => ({
            upload,
            getPublicUrl: (p: string) => ({ data: { publicUrl: `https://sb.example/public/avatars/${p}` } }),
          }),
        },
        from: () => ({
          select: () => select,
          update: (patch: unknown) => ({ eq: async () => h.callLogUpdate(patch) }),
        }),
      }),
    }
  })
  return upload
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  for (const k of [
    'STORAGE_R2_BUCKETS', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT',
    'R2_PUBLIC_BUCKET', 'R2_PUBLIC_BASE_URL', 'R2_PRIVATE_BUCKET',
    'HETZNER_S3_ENDPOINT', 'HETZNER_S3_ACCESS_KEY', 'HETZNER_S3_SECRET_KEY', 'HETZNER_S3_BUCKET',
  ]) vi.stubEnv(k, '')
  h.getUser.mockResolvedValue({ id: 'user-9' })
  h.rpc.mockResolvedValue({ data: 'org-1' })
  h.callLog = { id: 'cl-1', org_id: 'org-1', recording_url: null }
  h.callLogUpdate.mockResolvedValue({ error: null })
  h.send.mockResolvedValue({})
  h.updateUserMetadata.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('uploadProfileAvatar (was a browser-side upload)', () => {
  function form(file: File, extra: Record<string, string> = {}) {
    const fd = new FormData()
    fd.set('file', file)
    for (const [k, v] of Object.entries(extra)) fd.set(k, v)
    return fd
  }

  async function run(fd: FormData) {
    const upload = mockAdmin()
    const { uploadProfileAvatar } = await import('@/app/(dashboard)/settings/profile/actions')
    const res = await uploadProfileAvatar(fd)
    return { res, upload }
  }

  it('prefixes the path with the SESSION user id and saves the URL on the profile', async () => {
    const { res, upload } = await run(form(new File([new Uint8Array(10)], 'me.PNG', { type: 'image/png' })))
    expect(res.ok).toBe(true)
    const [path, , options] = upload.mock.calls[0]
    expect(path).toMatch(/^user-9\/avatar-\d+\.png$/)
    expect(options).toMatchObject({ contentType: 'image/png', upsert: false, cacheControl: '3600' })
    expect(h.updateUserMetadata).toHaveBeenCalledWith('user-9', {
      avatar_url: expect.stringContaining('user-9/avatar-'),
    })
  })

  it('ignores any path or user id the client sends', async () => {
    const { upload } = await run(
      form(new File([new Uint8Array(10)], '../../evil.png', { type: 'image/png' }), {
        path: 'someone-else/avatar.png',
        userId: 'someone-else',
      }),
    )
    const [path] = upload.mock.calls[0]
    expect(path.startsWith('user-9/')).toBe(true)
    expect(path).not.toContain('..')
    expect(path).not.toContain('someone-else')
  })

  it('keeps the old size and type checks', async () => {
    const bad = await run(form(new File([new Uint8Array(10)], 'x.svg', { type: 'image/svg+xml' })))
    expect(bad.res).toEqual({ ok: false, error: 'Use PNG, JPEG, WEBP or GIF' })
    const big = await run(form(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'x.png', { type: 'image/png' })))
    expect(big.res).toEqual({ ok: false, error: 'Image must be smaller than 5 MB' })
    expect(bad.upload).not.toHaveBeenCalled()
    expect(big.upload).not.toHaveBeenCalled()
  })

  it('requires a session', async () => {
    h.getUser.mockResolvedValue(null)
    const { res, upload } = await run(form(new File([new Uint8Array(10)], 'x.png', { type: 'image/png' })))
    expect(res).toEqual({ ok: false, error: 'Not authenticated' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('goes to R2 under avatars/<user id>/... when avatars is switched', async () => {
    for (const [k, v] of Object.entries({
      ...R2_ENV,
      STORAGE_R2_BUCKETS: 'avatars',
      R2_PUBLIC_BUCKET: 'xphere-assets',
      R2_PUBLIC_BASE_URL: 'https://media.xphere.app',
    })) vi.stubEnv(k, v)
    const { res, upload } = await run(form(new File([new Uint8Array(10)], 'me.png', { type: 'image/png' })))
    expect(upload).not.toHaveBeenCalled()
    const cmd = h.send.mock.calls[0][0] as { input: Record<string, unknown> }
    expect(String(cmd.input.Key)).toMatch(/^avatars\/user-9\/avatar-\d+\.png$/)
    expect(res.ok && res.url).toMatch(/^https:\/\/media\.xphere\.app\/avatars\/user-9\/avatar-\d+\.png$/)
  })
})

describe('POST /api/recording/upload tells the truth', () => {
  async function post() {
    mockAdmin()
    const { POST } = await import('@/app/api/recording/upload/route')
    const fd = new FormData()
    fd.set('audio', new Blob([new Uint8Array(32)], { type: 'audio/webm' }), 'recording.webm')
    fd.set('callSid', 'CA123')
    return POST(new Request('http://localhost/api/recording/upload', { method: 'POST', body: fd }))
  }

  it('no store configured: non-ok status, nothing written', async () => {
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, uploaded: false })
    expect(h.send).not.toHaveBeenCalled()
    expect(h.callLogUpdate).not.toHaveBeenCalled()
  })

  it('R2 on: stores the audio privately and keeps the /api/media path', async () => {
    for (const [k, v] of Object.entries(R2_ENV)) vi.stubEnv(k, v)
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, uploaded: true })
    const cmd = h.send.mock.calls[0][0] as { input: Record<string, unknown> }
    expect(cmd.input).toMatchObject({ Bucket: 'xphere-files', Key: 'recordings/org-1/CA123/browser_recording.webm' })
    expect(h.callLogUpdate).toHaveBeenCalledWith({
      recording_url: '/api/media/recordings/org-1/CA123/browser_recording.webm',
    })
  })

  it('R2 on but the upload fails: 502, row untouched', async () => {
    for (const [k, v] of Object.entries(R2_ENV)) vi.stubEnv(k, v)
    h.send.mockRejectedValue(new Error('R2 down'))
    const res = await post()
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ ok: false })
    expect(h.callLogUpdate).not.toHaveBeenCalled()
  })

  it('still rejects a call that is not in the active org', async () => {
    h.callLog = null
    const res = await post()
    expect(res.status).toBe(404)
  })
})
