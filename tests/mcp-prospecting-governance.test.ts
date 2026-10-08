import { describe, expect, it } from 'vitest'
import { ALL_MCP_TOOLS } from '@/lib/mcp/registry'
import * as xmailClient from '@/lib/xmail/client'

describe('Hermes prospecting governance surface', () => {
  it('does not expose an immediate direct-message tool', () => {
    expect(ALL_MCP_TOOLS.some((tool) => tool.name === 'prospect_send_message')).toBe(false)
  })

  it('does not ship a service-key campaign activation client', () => {
    expect('xmailActivateCampaign' in xmailClient).toBe(false)
  })

  it('describes campaign enrolment as inactive staging that cannot send', () => {
    const tool = ALL_MCP_TOOLS.find((candidate) => candidate.name === 'prospects_enroll_in_campaign')
    expect(tool).toBeDefined()
    expect(tool?.description).toContain('never activates a campaign and never sends email')
    expect(tool?.description).toContain('formal campaign activation request')
  })
})
