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

import { describe, it, expect } from 'vitest'
import { NODES, type NodeSpec } from '@/lib/workflows/spec'

const MEDUSA_TYPES = ['medusa_search_products', 'medusa_get_product', 'medusa_get_cart']
const FORBIDDEN_PARAM_KEYS = ['cart_id', 'customer_id', 'email', 'order_id']

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
