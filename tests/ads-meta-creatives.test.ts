// Coverage for the Meta creatives CommandHandler (src/lib/ads/providers/meta/creatives.ts):
// media uploads (image/video), ads built from an inline creative, editing an
// existing creative (including carousel cards), boosting an organic post, and
// setting a click-to-message welcome message.
//
// Same mocking style as tests/ads-meta-create.test.ts: only the transport
// (getObject / updateObject / createObject / getAdAccountInfo) is faked;
// MetaAdsError stays real. safe-fetch is mocked the same way so its own SSRF
// logic isn't re-tested here (see tests/ads-round4-foundations.test.ts for
// that) — only that this module calls it correctly and reacts to it.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const getObjectMock = vi.fn()
const updateObjectMock = vi.fn()
const createObjectMock = vi.fn()
const getAdAccountInfoMock = vi.fn()

const getEdgeSpy = vi.hoisted(() => vi.fn((_path: string, _params: Record<string, string>, _token: string): unknown => undefined))

vi.mock('@/lib/ads/meta-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/meta-api')>('@/lib/ads/meta-api')
  return {
    ...actual,
    getObject: (...args: unknown[]) => getObjectMock(...args),
    // The image-by-hash lookup goes through getEdge; route it into the same
    // getObject fake (keyed by the adimages path) so fixtures stay in one place.
    getEdge: (path: string, params: Record<string, string>, token: string) =>
      getEdgeSpy(path, params, token) ??
      getObjectMock(`${path}?hashes=${encodeURIComponent(params.hashes ?? '')}`, params.fields, token),
    updateObject: (...args: unknown[]) => updateObjectMock(...args),
    createObject: (...args: unknown[]) => createObjectMock(...args),
    getAdAccountInfo: (...args: unknown[]) => getAdAccountInfoMock(...args),
  }
})

const safeFetchBytesMock = vi.fn()
const assertPublicHttpsUrlMock = vi.fn()

vi.mock('@/lib/ads/safe-fetch', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ads/safe-fetch')>('@/lib/ads/safe-fetch')
  return {
    ...actual,
    safeFetchBytes: (...args: unknown[]) => safeFetchBytesMock(...args),
    assertPublicHttpsUrl: (...args: unknown[]) => assertPublicHttpsUrlMock(...args),
  }
})

import { creativesHandler, pollVideoReady } from '@/lib/ads/providers/meta/creatives'
import type { AdapterContext } from '@/lib/ads/providers/types'
import { MetaAdsError } from '@/lib/ads/meta-api'
import { SafeFetchError } from '@/lib/ads/safe-fetch'
import { AdsValidationError } from '@/lib/ads/validation'
import type { AdsCommand } from '@/lib/ads/commands/catalog'

const ctx: AdapterContext = { orgId: 'org-1', adAccountId: 'act_123456789', credential: 'token' }

beforeEach(() => {
  vi.clearAllMocks()
  getAdAccountInfoMock.mockResolvedValue({ id: 'act_123456789', name: 'Acme', currency: 'USD', account_status: 1 })
  assertPublicHttpsUrlMock.mockResolvedValue(undefined)
})

describe('creativesHandler.types', () => {
  it('advertises all creative and media commands', () => {
    expect([...creativesHandler.types].sort()).toEqual(
      [
        'meta.ad.create_from_spec',
        'meta.ad.create_with_creative',
        'meta.ad.set_welcome_message',
        'meta.ad.update_creative',
        'meta.media.upload_image',
        'meta.media.upload_images',
        'meta.media.upload_video',
        'meta.post.boost',
      ].sort(),
    )
  })
})

// ─── meta.media.upload_image ────────────────────────────────────────────────

describe('meta.media.upload_image', () => {
  const cmd = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.media.upload_image' as const,
    image_url: 'https://cdn.example.com/pic.jpg',
    name: 'Hero image',
  }

  it('validate() runs safeFetchBytes with the size cap and content-type allowlist', async () => {
    safeFetchBytesMock.mockResolvedValueOnce({ bytes: Buffer.from('x'), contentType: 'image/png', finalUrl: cmd.image_url })
    const before = await creativesHandler.snapshot(ctx, cmd)
    await creativesHandler.validate(ctx, cmd, before!)
    expect(safeFetchBytesMock).toHaveBeenCalledWith(cmd.image_url, expect.objectContaining({ maxBytes: 30 * 1024 * 1024 }))
    const [, opts] = safeFetchBytesMock.mock.calls[0] as [string, { accept: RegExp }]
    expect(opts.accept.test('image/jpeg')).toBe(true)
    expect(opts.accept.test('image/png')).toBe(true)
    expect(opts.accept.test('image/gif')).toBe(true)
    expect(opts.accept.test('application/pdf')).toBe(false)
    expect(createObjectMock).not.toHaveBeenCalled()
  })

  it('SSRF refusal passes through: a SafeFetchError from safe-fetch rejects validate() as AdsValidationError', async () => {
    safeFetchBytesMock.mockRejectedValueOnce(new SafeFetchError('cdn.example.com resolves to a non-public address'))
    const before = await creativesHandler.snapshot(ctx, cmd)
    let caught: unknown
    try {
      await creativesHandler.validate(ctx, cmd, before!)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AdsValidationError)
    expect((caught as Error).message).toMatch(/non-public/)
  })

  it('a too-large or wrong-content-type file rejects validate() the same way', async () => {
    safeFetchBytesMock.mockRejectedValueOnce(new SafeFetchError('File is larger than 30 MB'))
    const before = await creativesHandler.snapshot(ctx, cmd)
    await expect(creativesHandler.validate(ctx, cmd, before!)).rejects.toThrow(/larger/)
  })

  it('execute() base64-encodes the fetched bytes and uploads to act_x/adimages', async () => {
    safeFetchBytesMock.mockResolvedValueOnce({ bytes: Buffer.from('hello'), contentType: 'image/png', finalUrl: cmd.image_url })
    createObjectMock.mockResolvedValueOnce({ images: { hero: { hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', url: 'https://fb/hero.png' } } })
    const before = await creativesHandler.snapshot(ctx, cmd)
    const result = await creativesHandler.execute(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith('act_123456789/adimages', { bytes: Buffer.from('hello').toString('base64'), name: 'Hero image' }, 'token')
    expect(result.providerRef).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')
  })

  it('execute() re-fetches independently of validate() rather than reusing cached bytes', async () => {
    safeFetchBytesMock.mockResolvedValueOnce({ bytes: Buffer.from('v1'), contentType: 'image/png', finalUrl: cmd.image_url })
    const before = await creativesHandler.snapshot(ctx, cmd)
    await creativesHandler.validate(ctx, cmd, before!)
    safeFetchBytesMock.mockResolvedValueOnce({ bytes: Buffer.from('v2'), contentType: 'image/png', finalUrl: cmd.image_url })
    createObjectMock.mockResolvedValueOnce({ images: { hero: { hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' } } })
    await creativesHandler.execute(ctx, cmd, before!)
    expect(safeFetchBytesMock).toHaveBeenCalledTimes(2)
    const [, body] = createObjectMock.mock.calls[0] as [string, { bytes: string }]
    expect(body.bytes).toBe(Buffer.from('v2').toString('base64'))
  })

  it('throws when Meta returns no image hash', async () => {
    safeFetchBytesMock.mockResolvedValueOnce({ bytes: Buffer.from('x'), contentType: 'image/png', finalUrl: cmd.image_url })
    createObjectMock.mockResolvedValueOnce({})
    const before = await creativesHandler.snapshot(ctx, cmd)
    await expect(creativesHandler.execute(ctx, cmd, before!)).rejects.toThrow(MetaAdsError)
  })

  it('verify() reports ACTIVE as ok', async () => {
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: 'h1', status: 'ACTIVE' }] })
    const result = await creativesHandler.verify(ctx, cmd, {}, 'h1')
    expect(result.ok).toBe(true)
  })

  it('verify() reports a non-ACTIVE status as a mismatch', async () => {
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: 'h1', status: 'ERROR' }] })
    const result = await creativesHandler.verify(ctx, cmd, {}, 'h1')
    expect(result.ok).toBe(false)
    expect(result.mismatches.some((m) => m.field === 'status')).toBe(true)
  })

  it('verify() is lenient (ok) when the read-back fails — the upload already succeeded per execute()', async () => {
    getObjectMock.mockRejectedValueOnce(new MetaAdsError('boom'))
    const result = await creativesHandler.verify(ctx, cmd, {}, 'h1')
    expect(result.ok).toBe(true)
  })

  it('verify() fails with no providerRef', async () => {
    const result = await creativesHandler.verify(ctx, cmd, {}, null)
    expect(result.ok).toBe(false)
    expect(getObjectMock).not.toHaveBeenCalled()
  })

  it('buildRollback returns null — a library upload has no inverse', async () => {
    const before = await creativesHandler.snapshot(ctx, cmd)
    expect(creativesHandler.buildRollback(cmd, before!, 'h1')).toBeNull()
  })
})

// ─── meta.media.upload_images ───────────────────────────────────────────────

describe('meta.media.upload_images', () => {
  const cmd = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.media.upload_images' as const,
    images: [
      { image_url: 'https://cdn.example.com/a.png', name: 'A' },
      { image_url: 'https://cdn.example.com/b.png', name: 'B' },
    ],
  }

  it('validates every image and enforces the aggregate batch cap', async () => {
    safeFetchBytesMock
      .mockResolvedValueOnce({ bytes: { byteLength: 60 * 1024 * 1024 }, contentType: 'image/png', finalUrl: cmd.images[0].image_url })
      .mockResolvedValueOnce({ bytes: { byteLength: 41 * 1024 * 1024 }, contentType: 'image/png', finalUrl: cmd.images[1].image_url })
    const before = await creativesHandler.snapshot(ctx, cmd)
    await expect(creativesHandler.validate(ctx, cmd, before!)).rejects.toThrow(/100 MB/)
  })

  it('uploads every image and returns all hashes', async () => {
    safeFetchBytesMock
      .mockResolvedValueOnce({ bytes: Buffer.from('a'), contentType: 'image/png', finalUrl: cmd.images[0].image_url })
      .mockResolvedValueOnce({ bytes: Buffer.from('b'), contentType: 'image/png', finalUrl: cmd.images[1].image_url })
    createObjectMock
      .mockResolvedValueOnce({ images: { a: { hash: 'hash-a' } } })
      .mockResolvedValueOnce({ images: { b: { hash: 'hash-b' } } })
    const before = await creativesHandler.snapshot(ctx, cmd)
    const result = await creativesHandler.execute(ctx, cmd, before!)
    expect(result.providerRef).toBe('hash-a,hash-b')
    expect(result.raw).toEqual({ hashes: ['hash-a', 'hash-b'] })
  })
})

// ─── meta.media.upload_video ─────────────────────────────────────────────────

describe('meta.media.upload_video', () => {
  const cmd = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.media.upload_video' as const,
    video_url: 'https://cdn.example.com/promo.mp4',
    name: 'Promo video',
  }

  it('validate() only resolves the URL (Meta fetches the file itself) — no bytes are downloaded', async () => {
    const before = await creativesHandler.snapshot(ctx, cmd)
    await creativesHandler.validate(ctx, cmd, before!)
    expect(assertPublicHttpsUrlMock).toHaveBeenCalledWith(cmd.video_url)
    expect(safeFetchBytesMock).not.toHaveBeenCalled()
  })

  it('SSRF refusal passes through validate()', async () => {
    assertPublicHttpsUrlMock.mockRejectedValueOnce(new SafeFetchError('Only https URLs are accepted'))
    const before = await creativesHandler.snapshot(ctx, cmd)
    await expect(creativesHandler.validate(ctx, cmd, before!)).rejects.toThrow(AdsValidationError)
  })

  it('execute() posts file_url to act_x/advideos and polls until ready', async () => {
    createObjectMock.mockResolvedValueOnce({ id: 'v1' })
    getObjectMock.mockResolvedValueOnce({ status: { video_status: 'ready' } })
    const before = await creativesHandler.snapshot(ctx, cmd)
    const result = await creativesHandler.execute(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith('act_123456789/advideos', { file_url: cmd.video_url, name: cmd.name }, 'token')
    expect(result.providerRef).toBe('v1')
    expect((result.raw as { still_processing: boolean }).still_processing).toBe(false)
  })

  it('throws when Meta returns no id for the uploaded video', async () => {
    createObjectMock.mockResolvedValueOnce({})
    const before = await creativesHandler.snapshot(ctx, cmd)
    await expect(creativesHandler.execute(ctx, cmd, before!)).rejects.toThrow(MetaAdsError)
  })

  it('verify() is ok and notes when the video is still processing', async () => {
    getObjectMock.mockResolvedValueOnce({ status: { video_status: 'processing' } })
    const result = await creativesHandler.verify(ctx, cmd, {}, 'v1')
    expect(result.ok).toBe(true)
    expect((result.observed as { note?: string }).note).toMatch(/still processing/)
  })

  it('verify() is ok with no note once ready', async () => {
    getObjectMock.mockResolvedValueOnce({ status: { video_status: 'ready' } })
    const result = await creativesHandler.verify(ctx, cmd, {}, 'v1')
    expect(result.ok).toBe(true)
    expect((result.observed as { note?: string }).note).toBeUndefined()
  })

  it('buildRollback returns null', async () => {
    const before = await creativesHandler.snapshot(ctx, cmd)
    expect(creativesHandler.buildRollback(cmd, before!, 'v1')).toBeNull()
  })

  describe('pollVideoReady (overridable interval, so this never waits the real 3s/90s)', () => {
    it('returns ready as soon as the status flips', async () => {
      getObjectMock.mockResolvedValueOnce({ status: { video_status: 'ready' } })
      const result = await pollVideoReady(ctx, 'v1', { intervalMs: 5, maxMs: 1000 })
      expect(result).toEqual({ ready: true, status: 'ready' })
    })

    it('retries on "processing" and eventually returns ready', async () => {
      getObjectMock.mockResolvedValueOnce({ status: { video_status: 'processing' } }).mockResolvedValueOnce({ status: { video_status: 'ready' } })
      const result = await pollVideoReady(ctx, 'v1', { intervalMs: 5, maxMs: 1000 })
      expect(result).toEqual({ ready: true, status: 'ready' })
      expect(getObjectMock).toHaveBeenCalledTimes(2)
    })

    it('gives up after maxMs and reports still processing', async () => {
      getObjectMock.mockResolvedValue({ status: { video_status: 'processing' } })
      const result = await pollVideoReady(ctx, 'v1', { intervalMs: 5, maxMs: 15 })
      expect(result.ready).toBe(false)
      expect(result.status).toBe('processing')
    })
  })
})

// ─── meta.ad.create_with_creative ────────────────────────────────────────────

describe('meta.ad.create_with_creative', () => {
  const adset = { id: 'as1', name: 'AdSet', status: 'ACTIVE', account_id: 'act_123456789', campaign_id: 'c1' }
  const page = { id: 'pg1', name: 'My Page' }
  const linkCmd = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.ad.create_with_creative' as const,
    adset_id: 'as1',
    name: 'New Ad',
    page_id: 'pg1',
    link: 'https://example.com/landing',
    message: 'Check this out',
    headline: 'Great deal',
    description: 'Limited time',
    image_hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    call_to_action_type: 'LEARN_MORE',
  }

  it('snapshot returns null when the ad set belongs to a different account', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, account_id: 'act_999999999' })
    const before = await creativesHandler.snapshot(ctx, linkCmd)
    expect(before).toBeNull()
  })

  it('rejects when the ad set is ARCHIVED', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adset, status: 'ARCHIVED' })
    getObjectMock.mockResolvedValueOnce(page)
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: linkCmd.image_hash, status: 'ACTIVE' }] })
    const before = await creativesHandler.snapshot(ctx, linkCmd)
    const plan = creativesHandler.plan(linkCmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_archived')
  })

  it('rejects when the page does not exist', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockRejectedValueOnce(new MetaAdsError('Object does not exist', 100, 33))
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: linkCmd.image_hash, status: 'ACTIVE' }] })
    const before = await creativesHandler.snapshot(ctx, linkCmd)
    const plan = creativesHandler.plan(linkCmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('page_not_found')
  })

  it('builds a link ad object_story_spec and diffs name/adset/creative/status', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(page)
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: linkCmd.image_hash, status: 'ACTIVE' }] })
    const before = await creativesHandler.snapshot(ctx, linkCmd)
    const plan = creativesHandler.plan(linkCmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      const spec = plan.intended.object_story_spec as { page_id: string; link_data: Record<string, unknown> }
      expect(spec.page_id).toBe('pg1')
      expect(spec.link_data).toMatchObject({
        link: linkCmd.link,
        message: linkCmd.message,
        name: linkCmd.headline,
        description: linkCmd.description,
        image_hash: linkCmd.image_hash,
        call_to_action: { type: 'LEARN_MORE', value: { link: linkCmd.link } },
      })
      expect(plan.diff.some((d) => d.field === 'status' && d.after === 'PAUSED')).toBe(true)
    }
  })

  it('builds a video ad object_story_spec (video_data, title/link_description)', async () => {
    const videoCmd = { ...linkCmd, video_id: 'v1' }
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(page)
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: linkCmd.image_hash, status: 'ACTIVE' }] })
    getObjectMock.mockResolvedValueOnce({ id: 'v1', status: { video_status: 'ready' } })
    const before = await creativesHandler.snapshot(ctx, videoCmd)
    const plan = creativesHandler.plan(videoCmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      const spec = plan.intended.object_story_spec as { video_data: Record<string, unknown> }
      expect(spec.video_data).toMatchObject({
        video_id: 'v1',
        image_hash: linkCmd.image_hash,
        title: linkCmd.headline,
        link_description: linkCmd.description,
      })
    }
  })

  it('rejects an unknown video_id', async () => {
    const videoCmd = { ...linkCmd, video_id: 'v_missing' }
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(page)
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: linkCmd.image_hash, status: 'ACTIVE' }] })
    getObjectMock.mockRejectedValueOnce(new MetaAdsError('Object does not exist', 100, 33))
    const before = await creativesHandler.snapshot(ctx, videoCmd)
    const plan = creativesHandler.plan(videoCmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('video_not_found')
  })

  it('builds a click-to-message spec from messaging_destination, defaulting the call_to_action type', async () => {
    const messagingCmd = {
      platform: 'meta' as const,
      ad_account_id: 'act_123456789',
      type: 'meta.ad.create_with_creative' as const,
      adset_id: 'as1',
      name: 'Chat Ad',
      page_id: 'pg1',
      message: 'Hi there',
      messaging_destination: 'WHATSAPP' as const,
    }
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(page)
    const before = await creativesHandler.snapshot(ctx, messagingCmd)
    // No image_hash/video_id on this command, so no adimages/advideos lookup happens.
    expect(getObjectMock).toHaveBeenCalledTimes(2)
    const plan = creativesHandler.plan(messagingCmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      const spec = plan.intended.object_story_spec as { link_data: { call_to_action: Record<string, unknown> } }
      expect(spec.link_data.call_to_action).toEqual({ type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } })
    }
  })

  it('validate() validate_onlys the creative call only (the ad call needs a real creative id)', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(page)
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: linkCmd.image_hash, status: 'ACTIVE' }] })
    const before = await creativesHandler.snapshot(ctx, linkCmd)
    await creativesHandler.validate(ctx, linkCmd, before!)
    expect(createObjectMock).toHaveBeenCalledTimes(1)
    expect(createObjectMock).toHaveBeenCalledWith('act_123456789/adcreatives', expect.objectContaining({ name: 'New Ad' }), 'token', { validateOnly: true })
  })

  it('execute() creates the creative then the ad, PAUSED, and returns the ad id', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(page)
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: linkCmd.image_hash, status: 'ACTIVE' }] })
    const before = await creativesHandler.snapshot(ctx, linkCmd)
    createObjectMock.mockResolvedValueOnce({ id: 'cr_new' }).mockResolvedValueOnce({ id: 'ad_new' })
    const result = await creativesHandler.execute(ctx, linkCmd, before!)
    expect(createObjectMock).toHaveBeenNthCalledWith(1, 'act_123456789/adcreatives', expect.objectContaining({ name: 'New Ad' }), 'token')
    expect(createObjectMock).toHaveBeenNthCalledWith(
      2,
      'act_123456789/ads',
      { name: 'New Ad', adset_id: 'as1', creative: { creative_id: 'cr_new' }, status: 'PAUSED' },
      'token',
    )
    expect(result.providerRef).toBe('ad_new')
  })

  it('throws an error naming the orphan creative id when the ad call fails after the creative was created', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(page)
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: linkCmd.image_hash, status: 'ACTIVE' }] })
    const before = await creativesHandler.snapshot(ctx, linkCmd)
    createObjectMock.mockResolvedValueOnce({ id: 'cr_orphan' }).mockRejectedValueOnce(new MetaAdsError('ad set is paused'))
    await expect(creativesHandler.execute(ctx, linkCmd, before!)).rejects.toThrow(/cr_orphan/)
  })

  it('verify() confirms PAUSED, creative set, and same account', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'ad_new', name: 'New Ad', status: 'PAUSED', account_id: 'act_123456789', creative: { id: 'cr_new' } })
    const result = await creativesHandler.verify(ctx, linkCmd, {}, 'ad_new')
    expect(result.ok).toBe(true)
  })

  it('verify() fails when the ad has no creative attached', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'ad_new', name: 'New Ad', status: 'PAUSED', account_id: 'act_123456789' })
    const result = await creativesHandler.verify(ctx, linkCmd, {}, 'ad_new')
    expect(result.ok).toBe(false)
    expect(result.mismatches.some((m) => m.field === 'creative_id')).toBe(true)
  })

  it('buildRollback returns null — a create has no automatic inverse', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    getObjectMock.mockResolvedValueOnce(page)
    getObjectMock.mockResolvedValueOnce({ data: [{ hash: linkCmd.image_hash, status: 'ACTIVE' }] })
    const before = await creativesHandler.snapshot(ctx, linkCmd)
    expect(creativesHandler.buildRollback(linkCmd, before!, 'ad_new')).toBeNull()
  })
})

// ─── meta.ad.create_from_spec ───────────────────────────────────────────────

describe('meta.ad.create_from_spec', () => {
  const cmd = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.ad.create_from_spec' as const,
    adset_id: 'as1',
    name: 'Advanced Ad',
    creative: { creative_id: 'cr-existing', degrees_of_freedom_spec: { creative_features_spec: {} } },
  }
  const adset = { id: 'as1', name: 'AdSet', status: 'ACTIVE', account_id: 'act_123456789', campaign_id: 'c1' }

  it('validate() sends the full spec to Meta as a paused ad', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    const before = await creativesHandler.snapshot(ctx, cmd)
    await creativesHandler.validate(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/ads',
      { name: 'Advanced Ad', adset_id: 'as1', creative: cmd.creative, status: 'PAUSED' },
      'token',
      { validateOnly: true },
    )
  })

  it('execute() creates the ad PAUSED and returns its id', async () => {
    getObjectMock.mockResolvedValueOnce(adset)
    createObjectMock.mockResolvedValueOnce({ id: 'ad-new' })
    const before = await creativesHandler.snapshot(ctx, cmd)
    const result = await creativesHandler.execute(ctx, cmd, before!)
    expect(result.providerRef).toBe('ad-new')
    expect(creativesHandler.buildRollback(cmd, before!, 'ad-new')).toBeNull()
  })
})

// ─── meta.ad.update_creative ─────────────────────────────────────────────────

describe('meta.ad.update_creative', () => {
  const adWithLinkCreative = {
    id: 'ad1',
    name: 'Ad One',
    status: 'ACTIVE',
    account_id: 'act_123456789',
    campaign_id: 'c1',
    creative: {
      id: 'cr_old',
      name: 'Old Creative',
      object_story_spec: {
        page_id: 'pg1',
        link_data: {
          link: 'https://old.example.com',
          message: 'Old msg',
          name: 'Old headline',
          description: 'Old desc',
          image_hash: 'old0old0old0old0old0old0old0old0',
          call_to_action: { type: 'LEARN_MORE', value: { link: 'https://old.example.com' } },
        },
      },
      url_tags: 'utm_source=old',
    },
  }
  const adWithCarousel = {
    id: 'ad2',
    name: 'Carousel Ad',
    status: 'ACTIVE',
    account_id: 'act_123456789',
    campaign_id: 'c1',
    creative: {
      id: 'cr_car',
      name: 'Carousel Creative',
      object_story_spec: {
        page_id: 'pg1',
        link_data: {
          link: 'https://example.com',
          message: 'Shared caption',
          child_attachments: [
            { link: 'https://example.com/1', name: 'Card 1', description: 'Desc 1', image_hash: 'card1card1card1card1card1card1c1' },
            { link: 'https://example.com/2', name: 'Card 2', description: 'Desc 2', image_hash: 'card2card2card2card2card2card2c2' },
          ],
        },
      },
    },
  }
  const adBoostedPost = {
    id: 'ad3',
    name: 'Boosted',
    status: 'ACTIVE',
    account_id: 'act_123456789',
    campaign_id: 'c1',
    creative: { id: 'cr_boost', name: 'Boost Creative', object_story_id: '111_222' },
  }
  const adDynamic = {
    id: 'ad4',
    name: 'Dynamic',
    status: 'ACTIVE',
    account_id: 'act_123456789',
    campaign_id: 'c1',
    creative: { id: 'cr_dyn', name: 'Dynamic Creative', asset_feed_spec: { bodies: [] } },
  }
  const adNoCreative = { id: 'ad6', name: 'No Creative Ad', status: 'ACTIVE', account_id: 'act_123456789', campaign_id: 'c1' }
  const adUnsupportedShape = {
    id: 'ad7',
    name: 'Weird',
    status: 'ACTIVE',
    account_id: 'act_123456789',
    campaign_id: 'c1',
    creative: { id: 'cr_weird', name: 'Weird Creative', object_story_spec: { page_id: 'pg1' } },
  }

  const baseCmd = { platform: 'meta' as const, ad_account_id: 'act_123456789', type: 'meta.ad.update_creative' as const }

  it('rejects an ad with no creative', async () => {
    getObjectMock.mockResolvedValueOnce(adNoCreative)
    const before = await creativesHandler.snapshot(ctx, { ...baseCmd, ad_id: 'ad6', headline: 'X' })
    const plan = creativesHandler.plan({ ...baseCmd, ad_id: 'ad6', headline: 'X' }, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_creative')
  })

  it('refuses to edit content fields on a dynamic/Advantage+ creative', async () => {
    getObjectMock.mockResolvedValueOnce(adDynamic)
    const cmd = { ...baseCmd, ad_id: 'ad4', headline: 'Nope' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('dynamic_creative')
  })

  it('still allows url_tags on a dynamic creative', async () => {
    getObjectMock.mockResolvedValueOnce(adDynamic)
    const cmd = { ...baseCmd, ad_id: 'ad4', url_tags: 'utm_source=new' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
  })

  it('passes degrees_of_freedom_spec through to the replacement creative', async () => {
    getObjectMock.mockResolvedValueOnce(adWithLinkCreative)
    const degrees = { creative_features_spec: { standard_enhancements: { enroll_status: 'OPT_OUT' } } }
    const cmd = { ...baseCmd, ad_id: 'ad1', degrees_of_freedom_spec: degrees }
    const before = await creativesHandler.snapshot(ctx, cmd)
    await creativesHandler.validate(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/adcreatives',
      expect.objectContaining({ degrees_of_freedom_spec: degrees }),
      'token',
      { validateOnly: true },
    )
  })

  it('refuses to edit content fields on a boosted-post creative (object_story_id)', async () => {
    getObjectMock.mockResolvedValueOnce(adBoostedPost)
    const cmd = { ...baseCmd, ad_id: 'ad3', headline: 'Nope' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('boosted_post_creative')
  })

  it('still allows url_tags on a boosted-post creative', async () => {
    getObjectMock.mockResolvedValueOnce(adBoostedPost)
    const cmd = { ...baseCmd, ad_id: 'ad3', url_tags: 'utm_x=1' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.diff.some((d) => d.field === 'url_tags')).toBe(true)
  })

  it('rejects a creative with neither link_data nor video_data', async () => {
    getObjectMock.mockResolvedValueOnce(adUnsupportedShape)
    const cmd = { ...baseCmd, ad_id: 'ad7', headline: 'X' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('unsupported_creative_shape')
  })

  it('is a no-op when the requested value already matches', async () => {
    getObjectMock.mockResolvedValueOnce(adWithLinkCreative)
    const cmd = { ...baseCmd, ad_id: 'ad1', headline: 'Old headline' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('no_op')
  })

  it('diffs headline and link, and carries over the previous url_tags on write', async () => {
    getObjectMock.mockResolvedValueOnce(adWithLinkCreative)
    const cmd = { ...baseCmd, ad_id: 'ad1', headline: 'New headline', link: 'https://new.example.com' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.diff.some((d) => d.field === 'headline' && d.before === 'Old headline' && d.after === 'New headline')).toBe(true)
      expect(plan.diff.some((d) => d.field === 'link' && d.after === 'https://new.example.com')).toBe(true)
      const spec = plan.intended.object_story_spec as { link_data: Record<string, unknown> }
      expect(spec.link_data.name).toBe('New headline')
      expect(spec.link_data.link).toBe('https://new.example.com')
      // Untouched fields survive the copy.
      expect(spec.link_data.message).toBe('Old msg')
    }
  })

  it('edits a specific carousel card via card_index without touching the others', async () => {
    getObjectMock.mockResolvedValueOnce(adWithCarousel)
    const cmd = { ...baseCmd, ad_id: 'ad2', card_index: 1, headline: 'Card 2 updated' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      const spec = plan.intended.object_story_spec as { link_data: { child_attachments: Array<Record<string, unknown>> } }
      expect(spec.link_data.child_attachments[1].name).toBe('Card 2 updated')
      expect(spec.link_data.child_attachments[0].name).toBe('Card 1')
    }
  })

  it('rejects an out-of-range card_index', async () => {
    getObjectMock.mockResolvedValueOnce(adWithCarousel)
    const cmd = { ...baseCmd, ad_id: 'ad2', card_index: 5, headline: 'X' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('card_not_found')
  })

  it('validate() validate_onlys the new creative body, carrying the new url_tags when given', async () => {
    getObjectMock.mockResolvedValueOnce(adWithLinkCreative)
    const cmd = { ...baseCmd, ad_id: 'ad1', headline: 'New headline', url_tags: 'utm_source=new' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    await creativesHandler.validate(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith('act_123456789/adcreatives', expect.objectContaining({ url_tags: 'utm_source=new' }), 'token', { validateOnly: true })
    expect(updateObjectMock).not.toHaveBeenCalled()
  })

  it('execute() creates a new creative and repoints the ad at it', async () => {
    getObjectMock.mockResolvedValueOnce(adWithLinkCreative)
    const cmd = { ...baseCmd, ad_id: 'ad1', headline: 'New headline' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    createObjectMock.mockResolvedValueOnce({ id: 'cr_new' })
    updateObjectMock.mockResolvedValueOnce({ success: true })
    const result = await creativesHandler.execute(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/adcreatives',
      expect.objectContaining({ name: 'Old Creative', url_tags: 'utm_source=old' }),
      'token',
    )
    expect(updateObjectMock).toHaveBeenCalledWith('ad1', { creative: { creative_id: 'cr_new' } }, 'token')
    expect(result.providerRef).toBe('cr_new')
  })

  it('verify() confirms the ad now points at the new creative', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adWithLinkCreative, creative: { ...adWithLinkCreative.creative, id: 'cr_new' } })
    const cmd = { ...baseCmd, ad_id: 'ad1', headline: 'New headline' }
    const result = await creativesHandler.verify(ctx, cmd, {}, 'cr_new')
    expect(result.ok).toBe(true)
  })

  it('verify() reports a mismatch when the ad still points at the old creative', async () => {
    getObjectMock.mockResolvedValueOnce(adWithLinkCreative)
    const cmd = { ...baseCmd, ad_id: 'ad1', headline: 'New headline' }
    const result = await creativesHandler.verify(ctx, cmd, {}, 'cr_new')
    expect(result.ok).toBe(false)
    expect(result.mismatches.some((m) => m.field === 'creative_id')).toBe(true)
  })

  it('buildRollback repoints the ad at the previous creative via meta.ad.set_creative', async () => {
    getObjectMock.mockResolvedValueOnce(adWithLinkCreative)
    const cmd = { ...baseCmd, ad_id: 'ad1', headline: 'New headline' }
    const before = await creativesHandler.snapshot(ctx, cmd)
    const rollback = creativesHandler.buildRollback(cmd, before!, 'cr_new')
    expect(rollback).toEqual({ platform: 'meta', ad_account_id: 'act_123456789', type: 'meta.ad.set_creative', ad_id: 'ad1', creative_id: 'cr_old' })
  })
})

// ─── meta.post.boost ──────────────────────────────────────────────────────────

describe('meta.post.boost', () => {
  const adsetEngagement = {
    id: 'as2',
    name: 'Engage AdSet',
    status: 'ACTIVE',
    account_id: 'act_123456789',
    campaign_id: 'c2',
    promoted_object: { page_id: '111' },
    campaign: { id: 'c2', objective: 'OUTCOME_ENGAGEMENT' },
  }
  const cmd = {
    platform: 'meta' as const,
    ad_account_id: 'act_123456789',
    type: 'meta.post.boost' as const,
    adset_id: 'as2',
    post_id: '111_222',
    name: 'Boosted Post Ad',
    call_to_action_type: 'LIKE_PAGE',
  }

  it('rejects when the campaign objective is not OUTCOME_ENGAGEMENT', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adsetEngagement, campaign: { id: 'c2', objective: 'OUTCOME_SALES' } })
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('wrong_objective')
  })

  it('rejects when the post belongs to a different page than the ad set promotes', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adsetEngagement, promoted_object: { page_id: '999' } })
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('page_mismatch')
  })

  it('warns (but allows) when the ad set has no promoted_object.page_id to check against', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adsetEngagement, promoted_object: undefined })
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.warnings.length).toBeGreaterThan(0)
  })

  it('rejects a DELETED/ARCHIVED ad set', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adsetEngagement, status: 'ARCHIVED' })
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('resource_archived')
  })

  it('wires an inline creative with object_story_id and PAUSED status', async () => {
    getObjectMock.mockResolvedValueOnce(adsetEngagement)
    const before = await creativesHandler.snapshot(ctx, cmd)
    createObjectMock.mockResolvedValueOnce({ id: 'ad_boost' })
    const result = await creativesHandler.execute(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith(
      'act_123456789/ads',
      { name: 'Boosted Post Ad', adset_id: 'as2', status: 'PAUSED', creative: { object_story_id: '111_222', call_to_action: { type: 'LIKE_PAGE' } } },
      'token',
    )
    expect(result.providerRef).toBe('ad_boost')
  })

  it('validate() sends validate_only', async () => {
    getObjectMock.mockResolvedValueOnce(adsetEngagement)
    const before = await creativesHandler.snapshot(ctx, cmd)
    await creativesHandler.validate(ctx, cmd, before!)
    expect(createObjectMock).toHaveBeenCalledWith('act_123456789/ads', expect.any(Object), 'token', { validateOnly: true })
  })

  it('verify() confirms PAUSED and the boosted post id', async () => {
    getObjectMock.mockResolvedValueOnce({ id: 'ad_boost', name: 'Boosted Post Ad', status: 'PAUSED', account_id: 'act_123456789', creative: { id: 'cr1', object_story_id: '111_222' } })
    const result = await creativesHandler.verify(ctx, cmd, {}, 'ad_boost')
    expect(result.ok).toBe(true)
  })

  it('buildRollback returns null — a boost has no automatic inverse', async () => {
    getObjectMock.mockResolvedValueOnce(adsetEngagement)
    const before = await creativesHandler.snapshot(ctx, cmd)
    expect(creativesHandler.buildRollback(cmd, before!, 'ad_boost')).toBeNull()
  })
})

// ─── meta.ad.set_welcome_message ─────────────────────────────────────────────

describe('meta.ad.set_welcome_message', () => {
  const adClickToMessage = {
    id: 'ad5',
    name: 'CTM Ad',
    status: 'ACTIVE',
    account_id: 'act_123456789',
    campaign_id: 'c1',
    creative: {
      id: 'cr_ctm',
      name: 'CTM Creative',
      object_story_spec: {
        page_id: 'pg1',
        link_data: { link: 'https://example.com', message: 'Hi', call_to_action: { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } } },
      },
    },
  }
  const adNotClickToMessage = {
    id: 'ad1',
    name: 'Ad One',
    status: 'ACTIVE',
    account_id: 'act_123456789',
    campaign_id: 'c1',
    creative: {
      id: 'cr_old',
      name: 'Old Creative',
      object_story_spec: { page_id: 'pg1', link_data: { link: 'https://old.example.com', call_to_action: { type: 'LEARN_MORE', value: { link: 'https://old.example.com' } } } },
    },
  }
  const cmd = { platform: 'meta' as const, ad_account_id: 'act_123456789', type: 'meta.ad.set_welcome_message' as const, ad_id: 'ad5', welcome_message: 'Hi! How can we help?' }

  it('refuses an ad that is not click-to-message', async () => {
    getObjectMock.mockResolvedValueOnce(adNotClickToMessage)
    const notCtm = { ...cmd, ad_id: 'ad1' }
    const before = await creativesHandler.snapshot(ctx, notCtm)
    const plan = creativesHandler.plan(notCtm, before!)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('not_click_to_message')
  })

  it('builds a page_welcome_message JSON payload on the link_data', async () => {
    getObjectMock.mockResolvedValueOnce(adClickToMessage)
    const before = await creativesHandler.snapshot(ctx, cmd)
    const plan = creativesHandler.plan(cmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      const spec = plan.intended.object_story_spec as { link_data: { page_welcome_message: string } }
      const payload = JSON.parse(spec.link_data.page_welcome_message)
      expect(payload.text_format.message.text).toBe('Hi! How can we help?')
    }
  })

  it('accepts a complete welcome_message_spec without rewriting it', async () => {
    getObjectMock.mockResolvedValueOnce(adClickToMessage)
    const welcomeSpec = { type: 'VISUAL_EDITOR', version: 2, text_format: { customer_action_type: 'quick_replies', message: { text: 'Choose', quick_replies: ['Sales'] } } }
    const richCmd = { ...cmd, welcome_message: undefined, welcome_message_spec: welcomeSpec }
    const before = await creativesHandler.snapshot(ctx, richCmd)
    const plan = creativesHandler.plan(richCmd, before!)
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      const spec = plan.intended.object_story_spec as { link_data: { page_welcome_message: string } }
      expect(JSON.parse(spec.link_data.page_welcome_message)).toEqual(welcomeSpec)
    }
  })

  it('execute() creates a new creative and repoints the ad', async () => {
    getObjectMock.mockResolvedValueOnce(adClickToMessage)
    const before = await creativesHandler.snapshot(ctx, cmd)
    createObjectMock.mockResolvedValueOnce({ id: 'cr_new' })
    updateObjectMock.mockResolvedValueOnce({ success: true })
    const result = await creativesHandler.execute(ctx, cmd, before!)
    expect(updateObjectMock).toHaveBeenCalledWith('ad5', { creative: { creative_id: 'cr_new' } }, 'token')
    expect(result.providerRef).toBe('cr_new')
  })

  it('buildRollback repoints the ad at the previous creative', async () => {
    getObjectMock.mockResolvedValueOnce(adClickToMessage)
    const before = await creativesHandler.snapshot(ctx, cmd)
    const rollback = creativesHandler.buildRollback(cmd, before!, 'cr_new')
    expect(rollback).toEqual({ platform: 'meta', ad_account_id: 'act_123456789', type: 'meta.ad.set_creative', ad_id: 'ad5', creative_id: 'cr_ctm' })
  })

  it('verify() confirms the ad now points at the new creative', async () => {
    getObjectMock.mockResolvedValueOnce({ ...adClickToMessage, creative: { ...adClickToMessage.creative, id: 'cr_new' } })
    const result = await creativesHandler.verify(ctx, cmd, {}, 'cr_new')
    expect(result.ok).toBe(true)
  })
})

// ─── generic dispatch fallback (defensive; withHandlers never actually routes
// an unregistered type here, but the switch defaults must still behave) ──────

describe('unhandled command types', () => {
  const bogus = { type: 'google.campaign.rename' } as unknown as AdsCommand

  it('snapshot/validate/execute/verify throw AdsValidationError', async () => {
    await expect(creativesHandler.snapshot(ctx, bogus)).rejects.toThrow(AdsValidationError)
    await expect(creativesHandler.validate(ctx, bogus, {} as never)).rejects.toThrow(AdsValidationError)
    await expect(creativesHandler.execute(ctx, bogus, {} as never)).rejects.toThrow(AdsValidationError)
    await expect(creativesHandler.verify(ctx, bogus, {}, null)).rejects.toThrow(AdsValidationError)
  })

  it('plan() returns unsupported_command', () => {
    const plan = creativesHandler.plan(bogus, {} as never)
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('unsupported_command')
  })

  it('buildRollback returns null', () => {
    expect(creativesHandler.buildRollback(bogus, {} as never, null)).toBeNull()
  })
})

describe('adimages lookup', () => {
  it('sends hashes and fields as separate query params (not a second "?" glued onto the id)', async () => {
    getEdgeSpy.mockClear()
    const before = await creativesHandler.snapshot(ctx, {
      platform: 'meta', ad_account_id: 'act_123456789', type: 'meta.media.upload_image', image_url: 'https://cdn.example.com/a.png',
    } as never)
    createObjectMock.mockResolvedValueOnce({ images: { a: { hash: 'abc123', url: 'https://x' } } })
    await creativesHandler.verify(ctx, { platform: 'meta', ad_account_id: 'act_123456789', type: 'meta.media.upload_image', image_url: 'https://cdn.example.com/a.png' } as never, {}, 'abc123')
    expect(before).not.toBeNull()
    expect(getEdgeSpy).toHaveBeenCalledWith('act_123456789/adimages', { hashes: '["abc123"]', fields: 'hash,status' }, 'token')
  })
})

describe('sanitizeStorySpecForCreate', () => {
  it('keeps the image hash and drops the URL Meta derived from it (video, link and carousel cards)', async () => {
    const { sanitizeStorySpecForCreate } = await import('@/lib/ads/providers/meta/creatives')
    const spec = sanitizeStorySpecForCreate({
      page_id: '1',
      video_data: { video_id: '9', image_hash: 'h1', image_url: 'https://derived' },
      link_data: { image_hash: 'h2', picture: 'https://derived', child_attachments: [{ image_hash: 'h3', picture: 'https://derived' }, { picture: 'https://only-url' }] },
    } as never) as Record<string, Record<string, unknown>>
    expect(spec.video_data).toEqual({ video_id: '9', image_hash: 'h1' })
    expect(spec.link_data.picture).toBeUndefined()
    const cards = spec.link_data.child_attachments as Array<Record<string, unknown>>
    expect(cards[0]).toEqual({ image_hash: 'h3' })
    // A card that only has a URL keeps it — there is no hash to prefer.
    expect(cards[1]).toEqual({ picture: 'https://only-url' })
  })
})
