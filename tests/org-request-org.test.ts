import { describe, expect, it } from 'vitest'

import {
  isOrgId,
  orgFromReferer,
  orgPath,
  resolveRequestOrgId,
  splitOrgPath,
  stripOrgPrefix,
} from '@/lib/org/request-org'

const A = '24552ef3-de77-4fba-a2c3-148cd58d8750'
const B = '61a5dfb8-6eb0-4304-84ff-22e0d77afc2c'

describe('per-tab org URL helpers', () => {
  it('validates org ids', () => {
    expect(isOrgId(A)).toBe(true)
    expect(isOrgId(A.toUpperCase())).toBe(true)
    expect(isOrgId('nope')).toBe(false)
    expect(isOrgId(`${A}x`)).toBe(false)
    expect(isOrgId(null)).toBe(false)
  })

  it('splits the /o/<id> prefix off a pathname', () => {
    expect(splitOrgPath(`/o/${A}/contacts/123`)).toEqual({ orgId: A, rest: '/contacts/123' })
    expect(splitOrgPath(`/o/${A}`)).toEqual({ orgId: A, rest: '' })
    expect(splitOrgPath(`/o/${A.toUpperCase()}/x`)?.orgId).toBe(A)
    expect(splitOrgPath(`/o/${A}contacts`)).toBeNull()
    expect(splitOrgPath('/o/not-a-uuid/contacts')).toBeNull()
    expect(splitOrgPath('/contacts')).toBeNull()
  })

  it('strips the prefix for route checks', () => {
    expect(stripOrgPrefix(`/o/${A}/settings/general`)).toBe('/settings/general')
    expect(stripOrgPrefix(`/o/${A}`)).toBe('/')
    expect(stripOrgPrefix('/settings')).toBe('/settings')
  })

  it('builds org-pinned paths, replacing an existing prefix and keeping query/hash', () => {
    expect(orgPath(A, '/contacts')).toBe(`/o/${A}/contacts`)
    expect(orgPath(A, 'contacts?x=1#h')).toBe(`/o/${A}/contacts?x=1#h`)
    expect(orgPath(A, `/o/${B}/inbox?c=2`)).toBe(`/o/${A}/inbox?c=2`)
    expect(orgPath(A, '/')).toBe(`/o/${A}`)
  })

  it('reads the org from a same-origin Referer only', () => {
    expect(orgFromReferer(`https://xphere.app/o/${A}/contacts`, 'xphere.app')).toBe(A)
    expect(orgFromReferer(`https://evil.example/o/${A}/contacts`, 'xphere.app')).toBeNull()
    expect(orgFromReferer('https://xphere.app/contacts', 'xphere.app')).toBeNull()
    expect(orgFromReferer('not a url', 'xphere.app')).toBeNull()
    expect(orgFromReferer(null, 'xphere.app')).toBeNull()
  })

  it('resolves header > referer, ignoring malformed values', () => {
    const referer = `https://xphere.app/o/${B}/inbox`
    expect(resolveRequestOrgId({ header: A, referer, host: 'xphere.app' })).toBe(A)
    expect(resolveRequestOrgId({ header: 'garbage', referer, host: 'xphere.app' })).toBe(B)
    expect(resolveRequestOrgId({ header: null, referer: null })).toBeNull()
    expect(resolveRequestOrgId({})).toBeNull()
  })
})
