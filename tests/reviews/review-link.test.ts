import { afterEach, describe, expect, it, vi } from 'vitest'

import { expandShortUrl, resolveReviewLink } from '@/lib/reviews/resolve-review-link'
import {
  extractUrl,
  fallbackReviewUrl,
  isGoogleHost,
  parseMapsUrl,
  sharedInput,
  textWithoutUrl,
  writeReviewUrl,
} from '@/lib/reviews/review-link'

const DATA_ID = '0x94ce59c8da0aa315:0xd59f9431f2c9776a'
const CID = BigInt('0xd59f9431f2c9776a').toString(10)
const LONG_PLACE_URL =
  `https://www.google.com/maps/place/Padaria+S%C3%A3o+Jo%C3%A3o/@-23.5505,-46.6333,17z/data=!3m1!4b1!4m6!3m5!1s${DATA_ID}!8m2!3d-23.5507!4d-46.6331!16s%2Fg%2F11abc`

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

function serpResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('review link parsing', () => {
  it('pulls the URL out of Android share text', () => {
    const shared = 'Padaria São João\nhttps://maps.app.goo.gl/AbC123xyz.'
    expect(extractUrl(shared)).toBe('https://maps.app.goo.gl/AbC123xyz')
    expect(textWithoutUrl(shared)).toBe('Padaria São João')
  })

  it('only treats Google hosts as Maps links', () => {
    expect(isGoogleHost('maps.app.goo.gl')).toBe(true)
    expect(isGoogleHost('share.google')).toBe(true)
    expect(isGoogleHost('www.google.com.br')).toBe(true)
    expect(isGoogleHost('maps.google.co.uk')).toBe(true)
    expect(isGoogleHost('google.com.evil.io')).toBe(false)
    expect(isGoogleHost('evilgoogle.com')).toBe(false)
  })

  it('reads data id, CID, name and pin coordinates from a place URL', () => {
    const parsed = parseMapsUrl(LONG_PLACE_URL)
    expect(parsed).toEqual({
      placeId: null,
      cid: CID,
      dataId: DATA_ID,
      name: 'Padaria São João',
      lat: -23.5507,
      lng: -46.6331,
    })
  })

  it('reads a Place ID from the query forms Google uses', () => {
    expect(parseMapsUrl('https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJabc').placeId).toBe('ChIJabc')
    expect(parseMapsUrl('https://www.google.com/maps/place/?q=place_id:ChIJxyz').placeId).toBe('ChIJxyz')
    expect(parseMapsUrl('https://www.google.com/maps/place/?q=place_id:ChIJxyz').name).toBeNull()
  })

  it('reads cid and ftid links', () => {
    expect(parseMapsUrl('https://maps.google.com/?cid=123456789&entry=gps').cid).toBe('123456789')
    const ftid = parseMapsUrl(`https://www.google.com/maps?q=Padaria,+Rua+X&ftid=${DATA_ID}`)
    expect(ftid.dataId).toBe(DATA_ID)
    expect(ftid.name).toBe('Padaria, Rua X')
  })

  it('builds the review links', () => {
    expect(writeReviewUrl('ChIJ a')).toBe('https://search.google.com/local/writereview?placeid=ChIJ%20a')
    expect(fallbackReviewUrl(DATA_ID, 'Padaria')).toBe(`https://www.google.com/search?q=Padaria#lrd=${DATA_ID},3,,,`)
  })

  it('merges share target params without repeating the URL', () => {
    expect(sharedInput(['Padaria', 'Padaria https://maps.app.goo.gl/x', 'https://maps.app.goo.gl/x'])).toBe(
      'Padaria https://maps.app.goo.gl/x',
    )
    expect(sharedInput([undefined, ['Padaria'], 'https://maps.app.goo.gl/x'])).toBe('Padaria\nhttps://maps.app.goo.gl/x')
  })
})

describe('expandShortUrl', () => {
  it('follows redirects and unwraps the consent page', async () => {
    const fetchImpl = vi.fn(async () =>
      redirect(`https://consent.google.com/ml?continue=${encodeURIComponent(LONG_PLACE_URL)}`),
    ) as unknown as typeof fetch
    await expect(expandShortUrl('https://maps.app.goo.gl/AbC', fetchImpl)).resolves.toBe(LONG_PLACE_URL)
  })

  it('refuses to follow a redirect off Google', async () => {
    const fetchImpl = vi.fn(async () => redirect('http://169.254.169.254/latest')) as unknown as typeof fetch
    await expect(expandShortUrl('https://maps.app.goo.gl/AbC', fetchImpl)).resolves.toBeNull()
  })
})

describe('resolveReviewLink', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses a Place ID from the link without calling SerpAPI', async () => {
    const serp = vi.fn()
    vi.stubGlobal('fetch', serp)
    const res = await resolveReviewLink(
      { text: 'https://www.google.com/maps/search/?api=1&query=Padaria&query_place_id=ChIJabc' },
      { serpApiKey: 'key' },
    )
    expect(serp).not.toHaveBeenCalled()
    expect(res).toMatchObject({ kind: 'place', place: { placeId: 'ChIJabc', reviewUrl: writeReviewUrl('ChIJabc') } })
  })

  it('expands a short link and resolves its CID to a Place ID', async () => {
    const serp = vi.fn(async (url: string) => {
      expect(url).toContain(`data_cid=${CID}`)
      return serpResponse({ place_results: { title: 'Padaria São João', place_id: 'ChIJpadaria', rating: 4.7, reviews: 120 } })
    })
    vi.stubGlobal('fetch', serp)
    const fetchImpl = vi.fn(async () => redirect(LONG_PLACE_URL)) as unknown as typeof fetch

    const res = await resolveReviewLink({ text: 'Padaria\nhttps://maps.app.goo.gl/AbC' }, { serpApiKey: 'key', fetchImpl })
    expect(res).toEqual({
      kind: 'place',
      place: {
        placeId: 'ChIJpadaria',
        title: 'Padaria São João',
        address: null,
        rating: 4.7,
        reviews: 120,
        reviewUrl: writeReviewUrl('ChIJpadaria'),
      },
    })
  })

  it('falls back to the data-id link when there is no SerpAPI key', async () => {
    const fetchImpl = vi.fn(async () => redirect(LONG_PLACE_URL)) as unknown as typeof fetch
    const res = await resolveReviewLink({ text: 'https://maps.app.goo.gl/AbC' }, { serpApiKey: null, fetchImpl })
    expect(res).toMatchObject({
      kind: 'place',
      place: { placeId: null, reviewUrl: fallbackReviewUrl(DATA_ID, 'Padaria São João') },
    })
  })

  it('searches by name near the user and returns candidates', async () => {
    const serp = vi.fn(async (url: string) => {
      expect(url).toContain('ll=%40-23.5%2C-46.6%2C14z')
      return serpResponse({
        local_results: [
          { title: 'Padaria A', place_id: 'ChIJa', address: 'Rua A' },
          { title: 'Padaria B', place_id: 'ChIJb' },
          { title: 'No id' },
        ],
      })
    })
    vi.stubGlobal('fetch', serp)
    const res = await resolveReviewLink({ text: 'padaria', near: { lat: -23.5, lng: -46.6 } }, { serpApiKey: 'key' })
    expect(res.kind).toBe('candidates')
    if (res.kind === 'candidates') expect(res.candidates.map((c) => c.placeId)).toEqual(['ChIJa', 'ChIJb'])
  })

  it('asks for a link when a name search has no SerpAPI key', async () => {
    const res = await resolveReviewLink({ text: 'padaria' }, { serpApiKey: null })
    expect(res.kind).toBe('error')
  })
})

describe('resolveReviewLink lookup fallbacks', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tries the data blob when the CID lookup fails', async () => {
    const serp = vi.fn(async (url: string) => {
      if (url.includes('data_cid=')) return serpResponse({ error: 'Unsupported parameter' })
      expect(new URL(url).searchParams.get('data')).toBe(`!4m5!3m4!1s${DATA_ID}!8m2!3d-23.5507!4d-46.6331`)
      return serpResponse({ place_results: { title: 'Padaria São João', place_id: 'ChIJdata' } })
    })
    vi.stubGlobal('fetch', serp)
    const res = await resolveReviewLink({ text: LONG_PLACE_URL }, { serpApiKey: 'key' })
    expect(serp).toHaveBeenCalledTimes(2)
    expect(res).toMatchObject({ kind: 'place', place: { placeId: 'ChIJdata' } })
  })
})
