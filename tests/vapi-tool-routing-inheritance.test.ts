// Where a tool call goes when the assistant has never had a tool.
//
// The push refuses to ship a function with nowhere to send its calls — a mute
// robot that answers, decides to look something up, and drops the request into
// the void. That guard is right, but its only source of routing used to be
// ANOTHER tool: an assistant with none was refused the instant its agent was
// granted its first workflow, even though the assistant already carried a
// server block at assistant level holding the exact secret the tool needs.
//
// So a brand-new tenant hit a wall that only an existing tool could unlock.

import { describe, it, expect } from 'vitest'
import {
  TOOLS_SERVER_URL,
  assistantServerSecret,
  toolServerFromAssistantSecret,
} from '@/lib/vapi/sync-assistant-config'

describe('assistantServerSecret', () => {
  it('reads the secret field', () => {
    expect(assistantServerSecret({ url: 'https://x', secret: 's3cret' })).toBe('s3cret')
  })

  it('reads the x-vapi-secret header, which is how the other half of this account stores it', () => {
    expect(assistantServerSecret({ url: 'https://x', headers: { 'x-vapi-secret': 'h3ader' } })).toBe('h3ader')
  })

  it('prefers the explicit field when both are present', () => {
    expect(
      assistantServerSecret({ secret: 'field', headers: { 'x-vapi-secret': 'header' } }),
    ).toBe('field')
  })

  it('has nothing to say about an assistant with no server, or an empty secret', () => {
    expect(assistantServerSecret(undefined)).toBeUndefined()
    expect(assistantServerSecret(null)).toBeUndefined()
    expect(assistantServerSecret('https://x')).toBeUndefined()
    expect(assistantServerSecret({ url: 'https://x' })).toBeUndefined()
    expect(assistantServerSecret({ secret: '' })).toBeUndefined()
    expect(assistantServerSecret({ headers: { 'x-vapi-secret': '' } })).toBeUndefined()
  })
})

describe('toolServerFromAssistantSecret', () => {
  it('routes a first tool at the tools endpoint, never at the reports one', () => {
    expect(toolServerFromAssistantSecret('s3cret')).toEqual({
      url: TOOLS_SERVER_URL,
      secret: 's3cret',
      timeoutSeconds: 30,
    })
    expect(TOOLS_SERVER_URL).toBe('https://xphere.app/api/vapi/tools')
  })

  it('invents nothing when there is no secret to reuse', () => {
    // Without a secret the push must still refuse: a tool routed at an
    // endpoint that rejects it is worse than a tool that was never shipped,
    // because the assistant will call it and hear nothing back.
    expect(toolServerFromAssistantSecret(undefined)).toBeUndefined()
    expect(toolServerFromAssistantSecret('')).toBeUndefined()
  })
})
