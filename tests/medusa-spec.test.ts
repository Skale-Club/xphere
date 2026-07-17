// tests/medusa-spec.test.ts
//
// MED-04 (spec half) — verifies the three medusa read-tool NodeSpec entries
// in src/lib/workflows/spec.ts:
// 1. Exist, are kind='action', gated on integration_required: ['medusa']
// 2. Contain no visitor-scoped id in params_schema (anti-IDOR — contract §3:
//    cart/customer/order identity must never be an LLM-suppliable parameter)
// 3. Are filtered out of the org-facing spec when medusa isn't a connected
//    integration, and included when it is — replicating getWorkflowSpec's
//    own predicate locally (a static test, no supabase/health mocking
//    needed to prove the filtering behavior for these 3 nodes).
//
// Phase 134 (CRT-03) extends this with the two cart-write NodeSpec entries
// (medusa_add_to_cart, medusa_update_cart_item) — same shape, same anti-IDOR
// requirement, plus their own params must stay id-free
// (product_id/variant_id/item_title_or_variant/quantity only).

import { describe, it, expect } from 'vitest'
import { NODES, type NodeSpec } from '@/lib/workflows/spec'

const MEDUSA_TYPES = ['medusa_search_products', 'medusa_get_product', 'medusa_get_cart']
const MEDUSA_WRITE_TYPES = ['medusa_add_to_cart', 'medusa_update_cart_item']
const MEDUSA_WISHLIST_TYPES = ['medusa_wishlist_add', 'medusa_wishlist_remove', 'medusa_wishlist_list']
const MEDUSA_ORDER_STATUS_TYPES = ['medusa_get_order_status']
const FORBIDDEN_PARAM_KEYS = ['cart_id', 'customer_id', 'email', 'order_id', 'guest_ref']

function filterByAvailableProviders(nodes: NodeSpec[], available: Set<string>): NodeSpec[] {
  // Mirrors getWorkflowSpec's predicate (src/lib/workflows/spec.ts):
  // a node with no integration_required is always visible; otherwise at
  // least one of its required providers must be connected.
  return nodes.filter((n) => {
    if (!n.integration_required || n.integration_required.length === 0) return true
    return n.integration_required.some((p) => available.has(p))
  })
}

describe('MED-04: workflows/spec.ts medusa read-tool NODES', () => {
  const medusaNodes = NODES.filter((n) => MEDUSA_TYPES.includes(n.type))

  it('Test 1: exactly 3 medusa nodes exist, each kind=action with integration_required=[medusa]', () => {
    expect(medusaNodes).toHaveLength(3)
    for (const type of MEDUSA_TYPES) {
      const node = medusaNodes.find((n) => n.type === type)
      expect(node, `expected NODES to contain a ${type} entry`).toBeDefined()
      expect(node!.kind).toBe('action')
      expect(node!.integration_required).toEqual(['medusa'])
    }
  })

  it('Test 2: anti-IDOR — no medusa node exposes cart_id/customer_id/email/order_id in params_schema', () => {
    for (const node of medusaNodes) {
      const schemaJson = JSON.stringify(node.params_schema ?? {})
      for (const forbidden of FORBIDDEN_PARAM_KEYS) {
        expect(
          schemaJson.includes(forbidden),
          `${node.type}.params_schema unexpectedly contains "${forbidden}": ${schemaJson}`,
        ).toBe(false)
      }
    }
  })

  it('Test 3: medusa nodes are hidden when medusa is not a connected integration', () => {
    const available = new Set<string>()
    const filtered = filterByAvailableProviders(NODES, available)
    for (const type of MEDUSA_TYPES) {
      expect(filtered.some((n) => n.type === type)).toBe(false)
    }
  })

  it('Test 4: medusa nodes are shown when medusa is a connected integration', () => {
    const available = new Set(['medusa'])
    const filtered = filterByAvailableProviders(NODES, available)
    for (const type of MEDUSA_TYPES) {
      expect(filtered.some((n) => n.type === type)).toBe(true)
    }
  })
})

describe('CRT-03: workflows/spec.ts medusa cart-write NODES', () => {
  const writeNodes = NODES.filter((n) => MEDUSA_WRITE_TYPES.includes(n.type))
  // Only these keys are allowed in either write node's params_schema —
  // anything else (especially cart_id/customer_id/email) is an IDOR risk.
  const ALLOWED_WRITE_PARAM_KEYS = new Set(['product_id', 'variant_id', 'item_title_or_variant', 'quantity'])

  it('Test 1: exactly 2 medusa write nodes exist, each kind=action with integration_required=[medusa]', () => {
    expect(writeNodes).toHaveLength(2)
    for (const type of MEDUSA_WRITE_TYPES) {
      const node = writeNodes.find((n) => n.type === type)
      expect(node, `expected NODES to contain a ${type} entry`).toBeDefined()
      expect(node!.kind).toBe('action')
      expect(node!.integration_required).toEqual(['medusa'])
    }
  })

  it('Test 2: anti-IDOR — no write node exposes cart_id/customer_id/email/order_id in params_schema', () => {
    for (const node of writeNodes) {
      const schemaJson = JSON.stringify(node.params_schema ?? {})
      for (const forbidden of FORBIDDEN_PARAM_KEYS) {
        expect(
          schemaJson.includes(forbidden),
          `${node.type}.params_schema unexpectedly contains "${forbidden}": ${schemaJson}`,
        ).toBe(false)
      }
    }
  })

  it('Test 3: write node params_schema only contains the allow-listed visitor-safe keys', () => {
    for (const node of writeNodes) {
      const properties = (node.params_schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
      for (const key of Object.keys(properties)) {
        expect(
          ALLOWED_WRITE_PARAM_KEYS.has(key),
          `${node.type}.params_schema has unexpected param "${key}"`,
        ).toBe(true)
      }
    }
  })

  it('Test 4: write nodes are hidden when medusa is not a connected integration, shown when it is', () => {
    const hidden = filterByAvailableProviders(NODES, new Set<string>())
    for (const type of MEDUSA_WRITE_TYPES) {
      expect(hidden.some((n) => n.type === type)).toBe(false)
    }
    const shown = filterByAvailableProviders(NODES, new Set(['medusa']))
    for (const type of MEDUSA_WRITE_TYPES) {
      expect(shown.some((n) => n.type === type)).toBe(true)
    }
  })
})

describe('WSL-01: workflows/spec.ts wishlist NODES', () => {
  const wishlistNodes = NODES.filter((n) => MEDUSA_WISHLIST_TYPES.includes(n.type))
  // add/remove carry only product_id/variant_id; list carries none — no
  // customer_id/guest_ref/cart_id/email param anywhere (anti-IDOR, contract §3).
  const ALLOWED_WISHLIST_PARAM_KEYS = new Set(['product_id', 'variant_id'])

  it('Test 1: exactly 3 wishlist nodes exist, each kind=action with integration_required=[medusa]', () => {
    expect(wishlistNodes).toHaveLength(3)
    for (const type of MEDUSA_WISHLIST_TYPES) {
      const node = wishlistNodes.find((n) => n.type === type)
      expect(node, `expected NODES to contain a ${type} entry`).toBeDefined()
      expect(node!.kind).toBe('action')
      expect(node!.integration_required).toEqual(['medusa'])
    }
  })

  it('Test 2: anti-IDOR — no wishlist node exposes cart_id/customer_id/email/order_id/guest_ref in params_schema', () => {
    for (const node of wishlistNodes) {
      const schemaJson = JSON.stringify(node.params_schema ?? {})
      for (const forbidden of FORBIDDEN_PARAM_KEYS) {
        expect(
          schemaJson.includes(forbidden),
          `${node.type}.params_schema unexpectedly contains "${forbidden}": ${schemaJson}`,
        ).toBe(false)
      }
    }
  })

  it('Test 3: add/remove params_schema properties are a subset of {product_id, variant_id}; list has none', () => {
    for (const type of ['medusa_wishlist_add', 'medusa_wishlist_remove']) {
      const node = wishlistNodes.find((n) => n.type === type)!
      const properties = (node.params_schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
      for (const key of Object.keys(properties)) {
        expect(
          ALLOWED_WISHLIST_PARAM_KEYS.has(key),
          `${node.type}.params_schema has unexpected param "${key}"`,
        ).toBe(true)
      }
    }
    const listNode = wishlistNodes.find((n) => n.type === 'medusa_wishlist_list')!
    const listProperties = (listNode.params_schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
    expect(Object.keys(listProperties)).toHaveLength(0)
  })

  it('Test 4: wishlist nodes are hidden when medusa is not a connected integration, shown when it is', () => {
    const hidden = filterByAvailableProviders(NODES, new Set<string>())
    for (const type of MEDUSA_WISHLIST_TYPES) {
      expect(hidden.some((n) => n.type === type)).toBe(false)
    }
    const shown = filterByAvailableProviders(NODES, new Set(['medusa']))
    for (const type of MEDUSA_WISHLIST_TYPES) {
      expect(shown.some((n) => n.type === type)).toBe(true)
    }
  })
})

describe('UIX-02: workflows/spec.ts medusa_get_order_status NODE', () => {
  const orderStatusNodes = NODES.filter((n) => MEDUSA_ORDER_STATUS_TYPES.includes(n.type))
  // display_id is the ONLY allowed param -- no customer_id/email/order_id
  // (anti-IDOR; display_id alone is useless without the pinned cus).
  const ALLOWED_ORDER_STATUS_PARAM_KEYS = new Set(['display_id'])

  it('Test 1: exactly 1 medusa_get_order_status node exists, kind=action with integration_required=[medusa]', () => {
    expect(orderStatusNodes).toHaveLength(1)
    const node = orderStatusNodes.find((n) => n.type === 'medusa_get_order_status')
    expect(node, 'expected NODES to contain a medusa_get_order_status entry').toBeDefined()
    expect(node!.kind).toBe('action')
    expect(node!.integration_required).toEqual(['medusa'])
  })

  it('Test 2: anti-IDOR — no order-status node exposes cart_id/customer_id/email/order_id/guest_ref in params_schema', () => {
    for (const node of orderStatusNodes) {
      const schemaJson = JSON.stringify(node.params_schema ?? {})
      for (const forbidden of FORBIDDEN_PARAM_KEYS) {
        expect(
          schemaJson.includes(forbidden),
          `${node.type}.params_schema unexpectedly contains "${forbidden}": ${schemaJson}`,
        ).toBe(false)
      }
    }
  })

  it('Test 3: params_schema properties are a subset of {display_id}', () => {
    const node = orderStatusNodes.find((n) => n.type === 'medusa_get_order_status')!
    const properties = (node.params_schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
    for (const key of Object.keys(properties)) {
      expect(
        ALLOWED_ORDER_STATUS_PARAM_KEYS.has(key),
        `${node.type}.params_schema has unexpected param "${key}"`,
      ).toBe(true)
    }
  })

  it('Test 4: order-status node is hidden when medusa is not a connected integration, shown when it is', () => {
    const hidden = filterByAvailableProviders(NODES, new Set<string>())
    for (const type of MEDUSA_ORDER_STATUS_TYPES) {
      expect(hidden.some((n) => n.type === type)).toBe(false)
    }
    const shown = filterByAvailableProviders(NODES, new Set(['medusa']))
    for (const type of MEDUSA_ORDER_STATUS_TYPES) {
      expect(shown.some((n) => n.type === type)).toBe(true)
    }
  })
})
