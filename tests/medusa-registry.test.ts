// tests/medusa-registry.test.ts
// Phase 132 Plan 01 — MED-02: verifies the Medusa entry in INTEGRATION_REGISTRY
// has the correct shape (panelType, testable, and the 3 fields with correct
// keys/types/order) per INTEGRATION-CONTRACT.md §2.

import { describe, it, expect } from 'vitest'
import { INTEGRATION_REGISTRY } from '@/lib/integrations/registry'

describe('medusa registry entry', () => {
  const m = INTEGRATION_REGISTRY.find((d) => d.id === 'medusa')

  it('is defined', () => {
    expect(m).toBeDefined()
  })

  it('has panelType api_key and testable false', () => {
    expect(m?.panelType).toBe('api_key')
    expect(m?.testable).toBe(false)
  })

  it('has exactly the fields location_id, publishable_key, api_key in that order', () => {
    expect(m?.fields?.map((f) => f.key)).toEqual(['location_id', 'publishable_key', 'api_key'])
  })

  it('publishable_key field is required text', () => {
    const field = m?.fields?.find((f) => f.key === 'publishable_key')
    expect(field?.required).toBe(true)
    expect(field?.type).toBe('text')
  })

  it('api_key field is type password', () => {
    const field = m?.fields?.find((f) => f.key === 'api_key')
    expect(field?.type).toBe('password')
  })

  it('location_id field is type url', () => {
    const field = m?.fields?.find((f) => f.key === 'location_id')
    expect(field?.type).toBe('url')
  })
})
