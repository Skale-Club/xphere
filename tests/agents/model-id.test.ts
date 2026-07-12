import { describe, expect, it } from 'vitest'
import { AVAILABLE_MODELS, anthropicApiModelId } from '@/lib/agents/models'

describe('anthropicApiModelId', () => {
  it('strips the anthropic/ routing prefix', () => {
    expect(anthropicApiModelId('anthropic/claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
    expect(anthropicApiModelId('anthropic/claude-opus-4-7')).toBe('claude-opus-4-7')
    expect(anthropicApiModelId('anthropic/claude-haiku-4-5')).toBe('claude-haiku-4-5')
  })

  it('passes through an id that has no prefix', () => {
    expect(anthropicApiModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })

  it('produces a bare id (no slash) for every AVAILABLE_MODELS entry', () => {
    expect(AVAILABLE_MODELS.length).toBeGreaterThan(0)
    for (const model of AVAILABLE_MODELS) {
      const apiId = anthropicApiModelId(model)
      expect(apiId).not.toContain('/')
    }
  })
})
