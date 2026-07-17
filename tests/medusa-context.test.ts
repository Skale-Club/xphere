// tests/medusa-context.test.ts
// CTX-01/CTX-02: verifyCommerceContext (anti-IDOR HMAC verify) + writeCommerceContext
// (JSONB pinning). See .planning/research/INTEGRATION-CONTRACT.md §3 and
// .planning/workstreams/medusa-commerce/phases/133-signed-context-identity-pinning/133-01-PLAN.md.

import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyCommerceContext, writeCommerceContext, readCommerceContext, type CommerceClaims } from '@/lib/medusa/context'
import { loadPinnedContext } from '@/lib/medusa/pinned-context'
import type { MedusaExecCtx } from '@/lib/medusa/client'

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

// ---- CTX-02: writeCommerceContext / readCommerceContext pinning -----------
// Supabase mock idiom copied from tests/medusa-credentials.test.ts:
// chainable from().select().eq().eq().maybeSingle() / .update().eq().eq()
function buildSupabase(row: { memory: Record<string, unknown> | null } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
  const update = vi.fn().mockReturnThis()
  const eq = vi.fn().mockReturnThis()
  const select = vi.fn().mockReturnThis()
  const chain = { select, eq, maybeSingle, update }
  const from = vi.fn().mockReturnValue(chain)
  return { supabase: { from } as unknown as SupabaseClient, from, eq, maybeSingle, update }
}

const PIN_CLAIMS: CommerceClaims = basePayload({
  cart: 'cart_1',
  cus: 'cus_9',
  region_id: 'reg_1',
  country_code: 'dk',
  email: null,
  wishlist_ref: null,
})

describe('CTX-02: writeCommerceContext pinning', () => {
  it('merge preserves: keeps existing memory keys and pins the verbatim claim names', async () => {
    const { supabase, update, eq } = buildSupabase({ memory: { existingKey: 1 } })

    const result = await writeCommerceContext(supabase, 'conv-1', 'org-1', PIN_CLAIMS)

    expect(result).toBeNull()
    expect(update).toHaveBeenCalledTimes(1)
    const updateArg = update.mock.calls[0][0] as { memory: Record<string, unknown> }
    expect(updateArg.memory.existingKey).toBe(1)
    const commerce = updateArg.memory.commerce as Record<string, unknown>
    expect(commerce.cart).toBe('cart_1')
    expect(commerce.cus).toBe('cus_9')
    expect(commerce).not.toHaveProperty('cart_id')
    expect(commerce).not.toHaveProperty('customer_id')
    expect(typeof commerce.verified_at).toBe('string')
    expect(new Date(commerce.verified_at as string).toString()).not.toBe('Invalid Date')
    expect(eq).toHaveBeenCalledWith('id', 'conv-1')
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('repin: a different pinned cart is overwritten and repinnedFrom is reported', async () => {
    const { supabase, update } = buildSupabase({ memory: { commerce: { cart: 'cart_OLD' } } })
    const newClaims = basePayload({ cart: 'cart_NEW' })

    const result = await writeCommerceContext(supabase, 'conv-1', 'org-1', newClaims)

    expect(result).toEqual({ repinnedFrom: 'cart_OLD' })
    const updateArg = update.mock.calls[0][0] as { memory: Record<string, unknown> }
    expect((updateArg.memory.commerce as Record<string, unknown>).cart).toBe('cart_NEW')
  })

  it('repin: the same cart returns null (no repin reported)', async () => {
    const { supabase } = buildSupabase({ memory: { commerce: { cart: 'cart_SAME' } } })
    const sameClaims = basePayload({ cart: 'cart_SAME' })

    const result = await writeCommerceContext(supabase, 'conv-1', 'org-1', sameClaims)

    expect(result).toBeNull()
  })

  it('read-back: the pinned cart is reachable through the shipped loadPinnedContext reader', async () => {
    const { supabase, update } = buildSupabase({ memory: { existingKey: 1 } })
    await writeCommerceContext(supabase, 'conv-1', 'org-1', PIN_CLAIMS)
    const writtenMemory = (update.mock.calls[0][0] as { memory: Record<string, unknown> }).memory

    const freshMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { session_key: null, memory: writtenMemory }, error: null })
    const freshChain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: freshMaybeSingle }
    const freshSupabase = { from: vi.fn().mockReturnValue(freshChain) } as unknown as MedusaExecCtx['supabase']

    const { commerce } = await loadPinnedContext({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      supabase: freshSupabase,
    })

    expect(commerce.cart).toBe('cart_1')
  })

  it('readCommerceContext delegates to loadPinnedContext (no divergent second reader)', async () => {
    const freshMaybeSingle = vi.fn().mockResolvedValue({
      data: { session_key: null, memory: { commerce: { cart: 'cart_1' } } },
      error: null,
    })
    const freshChain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: freshMaybeSingle }
    const freshSupabase = { from: vi.fn().mockReturnValue(freshChain) } as unknown as MedusaExecCtx['supabase']

    const commerce = await readCommerceContext({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      supabase: freshSupabase,
    })

    expect(commerce.cart).toBe('cart_1')
  })
})
