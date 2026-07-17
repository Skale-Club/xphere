// tests/medusa-context.test.ts
// CTX-01/CTX-02: verifyCommerceContext (anti-IDOR HMAC verify) + writeCommerceContext
// (JSONB pinning). See .planning/research/INTEGRATION-CONTRACT.md §3 and
// .planning/workstreams/medusa-commerce/phases/133-signed-context-identity-pinning/133-01-PLAN.md.

import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyCommerceContext, type CommerceClaims } from '@/lib/medusa/context'

// ---- node:crypto mint helper — stuscle-identical mint (contract §3) --------
// token = base64url(payloadJson) + "." + base64url(HMAC_SHA256(secret, base64url(payloadJson)))
function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function mint(payload: object, secret: string): string {
  const p = b64url(Buffer.from(JSON.stringify(payload)))
  return `${p}.${b64url(createHmac('sha256', secret).update(p).digest())}`
}

const SECRET = 'xph_test_connection_token_abc123'
const ORG = 'org_11111111-1111-1111-1111-111111111111'

function basePayload(overrides: Partial<CommerceClaims> = {}): CommerceClaims {
  const now = Math.floor(Date.now() / 1000)
  return {
    v: 1,
    org: ORG,
    cart: 'cart_01ABC',
    cus: null,
    email: null,
    wishlist_ref: null,
    country_code: 'dk',
    region_id: 'reg_01DK',
    iat: now,
    exp: now + 900,
    ...overrides,
  }
}

describe('CTX-01: verifyCommerceContext', () => {
  it('valid: returns claims deep-equal to a payload minted with the node:crypto helper', async () => {
    const payload = basePayload()
    const token = mint(payload, SECRET)
    const result = await verifyCommerceContext(token, SECRET, ORG)
    expect(result).toEqual(payload)
  })

  it('cross-repo vector: verifies a committed literal token minted stuscle-identically', async () => {
    // Byte-verified cross-repo vector — DO NOT alter these literals. Minted with
    // node:crypto createHmac('sha256', VECTOR_SECRET).update(base64urlPayload).digest(),
    // key = raw UTF-8 bytes of VECTOR_SECRET (no hex decode). See 133-01-PLAN.md.
    const VECTOR_SECRET = 'xph_test_connection_token_abc123'
    const VECTOR_TOKEN =
      'eyJ2IjoxLCJvcmciOiJvcmdfMTExMTExMTEtMTExMS0xMTExLTExMTEtMTExMTExMTExMTExIiwiY2FydCI6ImNhcnRfMDFBQkMiLCJjdXMiOm51bGwsImVtYWlsIjpudWxsLCJ3aXNobGlzdF9yZWYiOm51bGwsImNvdW50cnlfY29kZSI6ImRrIiwicmVnaW9uX2lkIjoicmVnXzAxREsiLCJpYXQiOjE3NTAwMDAwMDAsImV4cCI6NDEwMjQ0NDgwMH0.0eybqLBPWVvuuCus7n_00_3BrNZFGxEA2PIoZBrqeDA'
    const VECTOR_ORG = 'org_11111111-1111-1111-1111-111111111111'

    const result = await verifyCommerceContext(VECTOR_TOKEN, VECTOR_SECRET, VECTOR_ORG)

    expect(result).toEqual({
      v: 1,
      org: VECTOR_ORG,
      cart: 'cart_01ABC',
      cus: null,
      email: null,
      wishlist_ref: null,
      country_code: 'dk',
      region_id: 'reg_01DK',
      iat: 1750000000,
      exp: 4102444800,
    })
  })

  it('expired: exp in the past (unix seconds) returns null', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = mint(basePayload({ exp: now - 10 }), SECRET)
    expect(await verifyCommerceContext(token, SECRET, ORG)).toBeNull()
  })

  it('bad sig: a tampered signature returns null', async () => {
    const token = mint(basePayload(), SECRET)
    const [payloadB64, sigB64] = token.split('.')
    const lastChar = sigB64.at(-1)
    const flipped = lastChar === 'A' ? 'B' : 'A'
    const tampered = `${payloadB64}.${sigB64.slice(0, -1)}${flipped}`
    expect(await verifyCommerceContext(tampered, SECRET, ORG)).toBeNull()
  })

  it('wrong org: claims.org !== expectedOrg returns null (cross-org replay barrier)', async () => {
    const token = mint(basePayload({ org: 'org_A' }), SECRET)
    expect(await verifyCommerceContext(token, SECRET, 'org_B')).toBeNull()
  })

  it('malformed: never throws for any invalid shape, always returns null', async () => {
    await expect(verifyCommerceContext('no-dot-here', SECRET, ORG)).resolves.toBeNull()
    await expect(verifyCommerceContext('', SECRET, ORG)).resolves.toBeNull()

    // non-base64 payload — signature can't match either way, fails safely
    const valid = mint(basePayload(), SECRET)
    const [, validSig] = valid.split('.')
    await expect(verifyCommerceContext(`not@@base64$$.${validSig}`, SECRET, ORG)).resolves.toBeNull()

    // valid base64url payload that decodes to non-JSON content
    const nonJsonPayload = b64url(Buffer.from('not-json-at-all'))
    const nonJsonSig = b64url(createHmac('sha256', SECRET).update(nonJsonPayload).digest())
    await expect(verifyCommerceContext(`${nonJsonPayload}.${nonJsonSig}`, SECRET, ORG)).resolves.toBeNull()

    // v !== 1
    const v2Token = mint(basePayload({ v: 2 }), SECRET)
    await expect(verifyCommerceContext(v2Token, SECRET, ORG)).resolves.toBeNull()
  })

  it('null-tolerant: a guest token (cart/cus/email/wishlist_ref/region_id all null) verifies fine', async () => {
    const payload = basePayload({ cart: null, cus: null, email: null, wishlist_ref: null, region_id: null })
    const token = mint(payload, SECRET)
    expect(await verifyCommerceContext(token, SECRET, ORG)).toEqual(payload)
  })
})
