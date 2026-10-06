import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createDataForSeoProvider,
  parseDataForSeoPostback,
  parseDfsItems,
} from '@/lib/local-seo/providers/dataforseo'
import { RankProviderError } from '@/lib/local-seo/providers/types'
import { cidFromDataId, createSerpApiProvider, parseSerpApiMaps } from '@/lib/local-seo/providers/serpapi'

// Shapes trimmed from real (anonymised) provider responses.
const SERPAPI_FIXTURE = {
  local_results: [
    {
      position: 1,
      title: 'Acme Barbers',
      place_id: 'ChIJ_acme',
      data_id: '0x89c25a1:0x1d0b3f2c4e5a6b7c',
      rating: 4.8,
      reviews: 512,
      type: 'Barber shop',
      address: '10 Main St',
      gps_coordinates: { latitude: 40.71, longitude: -74.0 },
    },
    { position: 2, title: 'Fade Lab', place_id: 'ChIJ_fade', data_cid: '1234', type: 'Barber shop' },
    { position: 21, title: 'Too Deep', place_id: 'ChIJ_deep' },
  ],
}

const DFS_TASK = {
  id: '10051234-1234-0066-0000-abcdef',
  status_code: 20000,
  status_message: 'Ok.',
  data: { tag: 'point-1' },
  result: [
    {
      items: [
        { type: 'maps_paid_item', title: 'Sponsored Cuts', rank_group: 1 },
        {
          type: 'maps_search',
          rank_group: 1,
          rank_absolute: 2,
          title: 'Acme Barbers',
          place_id: 'ChIJ_acme',
          cid: '2093884566',
          rating: { value: 4.8, votes_count: 512 },
          category: 'Barber shop',
          address: '10 Main St',
          latitude: 40.71,
          longitude: -74.0,
        },
        { type: 'maps_search', rank_group: 2, title: 'Fade Lab', place_id: 'ChIJ_fade' },
      ],
    },
  ],
}

afterEach(() => vi.unstubAllGlobals())

describe('SerpAPI provider', () => {
  it('parses local results, derives the CID and cuts at depth', () => {
    const out = parseSerpApiMaps(SERPAPI_FIXTURE, 20)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ position: 1, placeId: 'ChIJ_acme', rating: 4.8, reviews: 512, category: 'Barber shop' })
    expect(out[0].cid).toBe(BigInt('0x1d0b3f2c4e5a6b7c').toString())
    expect(out[1].cid).toBe('1234')
  })

  it('reads the primary category when place_results lists several (array type)', () => {
    const json = { place_results: { title: 'Skleanings', place_id: 'p', type: ['Carpet cleaning service', 'Cleaning service'] } }
    expect(parseSerpApiMaps(json, 20)).toMatchObject([{ category: 'Carpet cleaning service' }])
  })

  it('handles a single place_results answer', () => {
    expect(parseSerpApiMaps({ place_results: { title: 'Only One', place_id: 'x' } }, 20)).toMatchObject([{ position: 1, placeId: 'x' }])
  })

  it('reads the CID out of data_id', () => {
    expect(cidFromDataId('0x0:0xff')).toBe('255')
    expect(cidFromDataId('garbage')).toBeNull()
    expect(cidFromDataId(undefined)).toBeNull()
  })

  it('sends ll with the point and zoom', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(SERPAPI_FIXTURE), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const p = createSerpApiProvider('key')
    await p.fetchPoint({ pointId: 'p', keyword: 'barber', lat: 1.5, lng: -2.25, zoom: 13, depth: 20, language: 'en', country: 'us' })
    const url = new URL(fetchMock.mock.calls[0][0] as unknown as string)
    expect(url.searchParams.get('ll')).toBe('@1.5,-2.25,13z')
    expect(url.searchParams.get('engine')).toBe('google_maps')
    expect(url.searchParams.get('type')).toBe('search')
  })

  it('classifies errors', async () => {
    const p = createSerpApiProvider('key')
    const q = { pointId: 'p', keyword: 'k', lat: 0, lng: 0, zoom: 13, depth: 20, language: 'en', country: 'us' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    await expect(p.fetchPoint(q)).rejects.toMatchObject({ kind: 'auth' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Your account has run out of searches.' }), { status: 200 })))
    await expect(p.fetchPoint(q)).rejects.toMatchObject({ kind: 'quota' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: "Google hasn't returned any results for this query." }), { status: 200 })))
    await expect(p.fetchPoint(q)).resolves.toEqual([])
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    await expect(p.fetchPoint(q)).rejects.toMatchObject({ kind: 'transient' })
  })
})

describe('DataForSEO provider', () => {
  it('keeps organic map results only, ranked by rank_group', () => {
    const out = parseDfsItems(DFS_TASK, 20)
    expect(out.map((r) => r.title)).toEqual(['Acme Barbers', 'Fade Lab'])
    expect(out[0]).toMatchObject({ position: 1, cid: '2093884566', rating: 4.8, reviews: 512 })
  })

  it('submits one task per point tagged with the point id', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tag: string }[]
      return new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [
            { id: 't-2', status_code: 20100, data: { tag: body[1].tag } },
            { id: 't-1', status_code: 20100, data: { tag: body[0].tag } },
            { id: 't-3', status_code: 40501, status_message: 'Invalid Field', data: { tag: body[2].tag } },
          ],
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const p = createDataForSeoProvider('login', 'pw')
    const base = { keyword: 'barber', zoom: 13, depth: 20, language: 'en', country: 'us' }
    const out = await p.submit(
      [
        { ...base, pointId: 'a', lat: 1, lng: 2 },
        { ...base, pointId: 'b', lat: 3, lng: 4 },
        { ...base, pointId: 'c', lat: 5, lng: 6 },
      ],
      'https://xphere.app/postback?id=$id',
    )
    expect(out[0]).toEqual({ pointId: 'a', taskId: 't-1' })
    expect(out[1]).toEqual({ pointId: 'b', taskId: 't-2' })
    expect(out[2]).toMatchObject({ pointId: 'c', error: { kind: 'invalid' } })
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(sent[0]).toMatchObject({ location_coordinate: '1,2,13z', tag: 'a', postback_data: 'advanced' })
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('login:pw').toString('base64')}` })
  })

  it('maps account errors to permanent kinds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status_code: 40200, status_message: 'Payment Required.' }), { status: 200 })))
    const p = createDataForSeoProvider('l', 'p')
    await expect(p.getTask('x')).rejects.toBeInstanceOf(RankProviderError)
    await expect(p.getTask('x')).rejects.toMatchObject({ kind: 'quota' })
  })

  it('reads task status: pending, done, empty and failed', async () => {
    const p = createDataForSeoProvider('l', 'p')
    const respond = (task: object) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status_code: 20000, tasks: [task] }), { status: 200 })))
    respond({ id: 'x', status_code: 40602 })
    await expect(p.getTask('x')).resolves.toEqual({ status: 'pending' })
    respond(DFS_TASK)
    await expect(p.getTask('x')).resolves.toMatchObject({ status: 'done', results: [{ title: 'Acme Barbers' }, { title: 'Fade Lab' }] })
    respond({ id: 'x', status_code: 40102, status_message: 'No Search Results.' })
    await expect(p.getTask('x')).resolves.toEqual({ status: 'done', results: [] })
    respond({ id: 'x', status_code: 50000, status_message: 'Internal Error.' })
    await expect(p.getTask('x')).resolves.toMatchObject({ status: 'error', error: { kind: 'transient' } })
  })

  it('parses a postback envelope', () => {
    const out = parseDataForSeoPostback({ status_code: 20000, tasks: [DFS_TASK] })
    expect(out).toHaveLength(1)
    expect(out[0].taskId).toBe(DFS_TASK.id)
    expect(out[0].outcome).toMatchObject({ status: 'done' })
    expect(parseDataForSeoPostback(null)).toEqual([])
  })
})
