import { describe, expect, it } from 'vitest'
import {
  isValidNiche,
  nicheAudienceTitle,
  nichesFromCustomFields,
  withMergedNiches,
} from '@/lib/prospects/niche'
import {
  backfilledCustomFields,
  looksLikeBarber,
  nicheForQuery,
  parseNicheRule,
  queryOfSource,
} from '@/lib/prospects/niche-backfill'

describe('isValidNiche', () => {
  it.each(['barbershop', 'nail_salon', 'hair_salon', 'ab', 'spa2'])('accepts %s', (value) => {
    expect(isValidNiche(value)).toBe(true)
  })

  it.each(['', 'a', 'a'.repeat(41), 'Barbershop', 'nail salon', 'nail-salon', '_x', 'x_', 'a__b', 7, null, undefined])(
    'rejects %j',
    (value) => {
      expect(isValidNiche(value)).toBe(false)
    },
  )
})

describe('nichesFromCustomFields', () => {
  it('reads the niches array and the single niche, de-duplicated, valid slugs only', () => {
    expect(nichesFromCustomFields({ niches: ['barbershop', 'Nail Salon', 'barbershop'], niche: 'nail_salon' }))
      .toEqual(['barbershop', 'nail_salon'])
  })

  it('falls back to the single niche when there is no array', () => {
    expect(nichesFromCustomFields({ niche: 'barbershop' })).toEqual(['barbershop'])
  })

  it.each([null, undefined, 'x', [], {}, { niches: 'barbershop' }])('is empty for %j', (value) => {
    expect(nichesFromCustomFields(value)).toEqual([])
  })
})

describe('withMergedNiches', () => {
  it('on insert: stores niche and a one-element niches array', () => {
    const incoming = { category: 'Barber shop', niche: 'barbershop' }
    expect(withMergedNiches({ ...incoming }, undefined, incoming)).toEqual({
      category: 'Barber shop',
      niche: 'barbershop',
      niches: ['barbershop'],
    })
  })

  it('on insert without a niche: leaves the blob untouched, no empty niches key', () => {
    const incoming = { category: 'Barber shop' }
    expect(withMergedNiches({ ...incoming }, undefined, incoming)).toEqual({ category: 'Barber shop' })
  })

  it('on update: unions the niches and never drops an existing one', () => {
    const existing = { niche: 'barbershop', niches: ['barbershop'] }
    const incoming = { niche: 'nail_salon' }
    const merged = withMergedNiches({ ...existing, ...incoming }, existing, incoming)
    expect(merged.niches).toEqual(['barbershop', 'nail_salon'])
    expect(merged.niche).toBe('nail_salon')
  })

  it('on re-push of the same niche: no duplicate', () => {
    const existing = { niche: 'barbershop', niches: ['barbershop'] }
    const merged = withMergedNiches({ ...existing }, existing, { niche: 'barbershop' })
    expect(merged.niches).toEqual(['barbershop'])
  })

  it('on a re-push without any niche: keeps what the account had', () => {
    const existing = { niche: 'barbershop', niches: ['barbershop', 'hair_salon'], category: 'Barber shop' }
    const incoming = { category: 'Barber shop' }
    const merged = withMergedNiches({ ...existing, ...incoming }, existing, incoming)
    expect(merged.niches).toEqual(['barbershop', 'hair_salon'])
    expect(merged.niche).toBe('barbershop')
  })

  it('promotes a legacy single niche (no array yet) into niches', () => {
    const existing = { niche: 'barbershop' }
    const incoming = { niche: 'nail_salon' }
    const merged = withMergedNiches({ ...existing, ...incoming }, existing, incoming)
    expect(merged.niches).toEqual(['barbershop', 'nail_salon'])
  })

  it('ignores an invalid incoming niche and does not let it linger', () => {
    const existing = { niche: 'barbershop', niches: ['barbershop'] }
    const incoming = { niche: 'Not A Slug', niches: ['also bad'] }
    const merged = withMergedNiches({ ...existing, ...incoming }, existing, incoming)
    expect(merged.niches).toEqual(['barbershop'])
    expect(merged.niche).toBe('barbershop')

    const insert = { niche: 'Not A Slug', niches: ['Bad Value'] }
    const stored = withMergedNiches({ ...insert }, undefined, insert)
    expect('niche' in stored).toBe(false)
    expect('niches' in stored).toBe(false)
  })
})

describe('nicheAudienceTitle', () => {
  it.each([
    ['barbershop', 'Barbershops'],
    ['nail_salon', 'Nail Salons'],
    ['hair_salon', 'Hair Salons'],
    ['spa', 'Spas'],
    ['dentistry', 'Dentistries'],
    ['boutique_gym', 'Boutique Gyms'],
    ['car_wash', 'Car Washes'],
    ['pets', 'Pets'],
  ])('%s -> %s', (niche, title) => {
    expect(nicheAudienceTitle(niche)).toBe(title)
  })
})

describe('niche backfill rules', () => {
  it.each(['barber shop', 'Barbershop Framingham', 'barbearia', 'BARBERS near me'])('maps "%s" to barbershop', (query) => {
    expect(nicheForQuery(query)).toBe('barbershop')
  })

  it.each(['nail salon', 'hair salon', '', null, undefined])('does not guess a niche for %j', (query) => {
    expect(nicheForQuery(query)).toBeNull()
  })

  it('uses extra rules, in order', () => {
    const rules = [parseNicheRule('nail=nail_salon'), parseNicheRule('barber=barbershop')]
    expect(nicheForQuery('nail bar', rules)).toBe('nail_salon')
    expect(nicheForQuery('barber', rules)).toBe('barbershop')
  })

  it('rejects a malformed or invalid-slug rule', () => {
    expect(() => parseNicheRule('nope')).toThrow()
    expect(() => parseNicheRule('nail=Nail Salon')).toThrow()
  })

  it('reads the query from metadata, else from the label', () => {
    expect(queryOfSource({ label: 'ignored — Boston, MA', metadata: { query: ' barber shop ' } })).toBe('barber shop')
    expect(queryOfSource({ label: 'barber shop — Boston, MA', metadata: {} })).toBe('barber shop')
    expect(queryOfSource({ label: null, metadata: null })).toBeNull()
  })

  it('tells barbers from neighbours', () => {
    expect(looksLikeBarber('Barber shop')).toBe(true)
    expect(looksLikeBarber("Men's hair salon")).toBe(true)
    expect(looksLikeBarber('Hair salon')).toBe(false)
    expect(looksLikeBarber('Nail salon')).toBe(false)
    expect(looksLikeBarber(null)).toBe(false)
  })

  it('backfills niches without dropping any, and reports no-change as null', () => {
    expect(backfilledCustomFields({ category: 'Barber shop' }, ['barbershop']))
      .toEqual({ category: 'Barber shop', niches: ['barbershop'], niche: 'barbershop' })
    expect(backfilledCustomFields({ niche: 'hair_salon', niches: ['hair_salon'] }, ['barbershop']))
      .toEqual({ niche: 'hair_salon', niches: ['hair_salon', 'barbershop'] })
    expect(backfilledCustomFields({ niche: 'barbershop', niches: ['barbershop'] }, ['barbershop'])).toBeNull()
    expect(backfilledCustomFields(null, ['barbershop'])).toEqual({ niches: ['barbershop'], niche: 'barbershop' })
  })
})
