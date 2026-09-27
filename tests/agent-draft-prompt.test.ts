// A draft prompt can be rehearsed in the playground, and never reaches production traffic.

import { describe, it, expect } from 'vitest'
import { promptFor } from '@/lib/agent-runtime/run-agent'

describe('promptFor', () => {
  it('runs the draft in playground mode', () => {
    expect(promptFor({ draftSystemPrompt: 'draft v4' }, 'playground', 'published v3')).toBe('draft v4')
  })

  it('ignores the draft in production, and a blank draft anywhere', () => {
    expect(promptFor({ draftSystemPrompt: 'draft v4' }, 'production', 'published v3')).toBe('published v3')
    expect(promptFor({ draftSystemPrompt: '   ' }, 'playground', 'published v3')).toBe('published v3')
    expect(promptFor({}, 'playground', 'published v3')).toBe('published v3')
  })
})
