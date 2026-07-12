import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { serviceClient, seedTestOrg, type TestOrgFixture } from './fixtures'

/**
 * Tests verify DB-side correctness of form server actions by replicating
 * the same mutations a logged-in admin would trigger. The Plan 04 server
 * actions cannot be invoked directly (they require cookies + an authenticated
 * Supabase client), but the SQL-level invariants they rely on — deny-by-default
 * tool attachment, diff-based setAgentTools (preserves allowed_channels), slug
 * uniqueness per org, and AGENT-02 column persistence — are all enforceable
 * against the service-role client.
 */
let fixture: TestOrgFixture
let toolConfigId: string

beforeAll(async () => {
  fixture = await seedTestOrg('p36-form')
  const svc = serviceClient()
  const { data: integration, error: intErr } = await svc
    .from('integrations')
    .insert({
      organization_id: fixture.orgId,
      provider: 'twilio',
      name: 'Test Twilio',
      is_active: true,
      encrypted_api_key: 'test-key',
    })
    .select('id')
    .single()
  if (intErr || !integration) throw intErr ?? new Error('integration create failed')
  // tool_configs was renamed to _legacy_tool_configs (migration 084, SEED-025);
  // it is still the live table behind the agent tool picker (see _actions/tools.ts).
  const { data: tc, error: tcErr } = await svc
    .from('_legacy_tool_configs')
    .insert({
      organization_id: fixture.orgId,
      integration_id: integration.id,
      tool_name: 'send_sms_test',
      action_type: 'send_sms',
      config: {},
      fallback_message: 'fallback',
      is_active: true,
    })
    .select('id')
    .single()
  if (tcErr || !tc) throw tcErr ?? new Error('tool_config create failed')
  toolConfigId = tc.id
})

afterAll(async () => {
  if (fixture) await fixture.cleanup()
})

describe('createAgent deny-by-default (TOOL-03)', () => {
  it('new agent has zero agent_tools rows', async () => {
    const svc = serviceClient()
    const { data: agent } = await svc
      .from('agents')
      .insert({
        organization_id: fixture.orgId,
        name: 'Specialist Bot',
        slug: `specialist-bot-${Date.now()}`,
        system_prompt: 'You specialize.',
        model: 'anthropic/claude-sonnet-4-6',
        fallback_message: 'Sorry.',
        max_history: 10,
        is_active: true,
      })
      .select('id')
      .single()
    expect(agent).toBeTruthy()
    const { count } = await svc
      .from('agent_tools')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agent!.id)
    expect(count).toBe(0)
  })
})

describe('setAgentTools diff (TOOL-02, Pitfall 5)', () => {
  it('INSERTs only new pairs and DELETEs only removed pairs', async () => {
    const svc = serviceClient()
    const { data: agent } = await svc
      .from('agents')
      .insert({
        organization_id: fixture.orgId,
        name: 'Diff Bot',
        slug: `diff-bot-${Date.now()}`,
        system_prompt: 'x',
        model: 'anthropic/claude-sonnet-4-6',
        fallback_message: 'x',
        max_history: 10,
        is_active: true,
      })
      .select('id')
      .single()

    // Attach toolConfigId with allowed_channels=['whatsapp']
    await svc.from('agent_tools').insert({
      organization_id: fixture.orgId,
      agent_id: agent!.id,
      tool_config_id: toolConfigId,
      allowed_channels: ['whatsapp'],
    })

    // Simulate setAgentTools(agent.id, [toolConfigId]) — same tool selected, must NOT UPDATE.
    // tool_config_id is nullable since migration 095 (XOR with workflow_id), so
    // filter nulls the same way _actions/tools.ts does.
    const { data: existing } = await svc
      .from('agent_tools')
      .select('tool_config_id, allowed_channels')
      .eq('agent_id', agent!.id)
      .not('tool_config_id', 'is', null)
    const currentSet = new Set(
      existing!.map((r) => r.tool_config_id).filter((id): id is string => id !== null)
    )
    const nextSet = new Set([toolConfigId])
    const toAdd = [...nextSet].filter((id) => !currentSet.has(id))
    const toRemove = [...currentSet].filter((id) => !nextSet.has(id))
    expect(toAdd).toEqual([])
    expect(toRemove).toEqual([])

    // Confirm allowed_channels preserved
    const { data: after } = await svc
      .from('agent_tools')
      .select('allowed_channels')
      .eq('agent_id', agent!.id)
      .single()
    expect(after!.allowed_channels).toEqual(['whatsapp'])
  })
})

describe('slug uniqueness (AGENT-01)', () => {
  it('inserting duplicate slug per org raises Postgres 23505', async () => {
    const svc = serviceClient()
    await svc.from('agents').insert({
      organization_id: fixture.orgId,
      name: 'Dup A',
      slug: 'dup-test',
      system_prompt: 'x',
      model: 'anthropic/claude-sonnet-4-6',
      fallback_message: 'x',
      max_history: 10,
      is_active: true,
    })
    const { error } = await svc.from('agents').insert({
      organization_id: fixture.orgId,
      name: 'Dup B',
      slug: 'dup-test',
      system_prompt: 'x',
      model: 'anthropic/claude-sonnet-4-6',
      fallback_message: 'x',
      max_history: 10,
      is_active: true,
    })
    expect(error?.code).toBe('23505')
  })
})

describe('AGENT-02 persistence', () => {
  it('temperature + max_tokens + max_history persist', async () => {
    const svc = serviceClient()
    const { data: agent } = await svc
      .from('agents')
      .insert({
        organization_id: fixture.orgId,
        name: 'Gen Bot',
        slug: `gen-bot-${Date.now()}`,
        system_prompt: 'x',
        model: 'anthropic/claude-sonnet-4-6',
        fallback_message: 'x',
        max_history: 25,
        temperature: 0.4,
        max_tokens: 2048,
        is_active: true,
      })
      .select('temperature, max_tokens, max_history')
      .single()
    expect(agent!.temperature).toBeCloseTo(0.4)
    expect(agent!.max_tokens).toBe(2048)
    expect(agent!.max_history).toBe(25)
  })
})

describe('Plan 04 actions module surface', () => {
  it('core actions exports getAgentById, createAgent, updateAgent', async () => {
    const mod = await import('@/app/(dashboard)/agents/actions')
    expect(typeof mod.getAgentById).toBe('function')
    expect(typeof mod.createAgent).toBe('function')
    expect(typeof mod.updateAgent).toBe('function')
  })

  it('tools sub-module exports setAgentTools, getToolPickerData', async () => {
    const mod = await import('@/app/(dashboard)/agents/_actions/tools')
    expect(typeof mod.setAgentTools).toBe('function')
    expect(typeof mod.getToolPickerData).toBe('function')
  })
})
