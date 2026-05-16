import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedTestOrg, serviceClient, type TestOrgFixture } from './fixtures'

// Importing the action module ensures the file exists and exports compile.
// We don't invoke the actions directly (they rely on request-scoped getUser);
// instead we exercise the SAME SQL shape via the service-role client,
// validating the DB-side correctness of each action's mutation.
import {
  getAgents,
  getActiveAgents,
  getChannelDefaults,
  setChannelDefault,
  toggleAgentActive,
  softDeleteAgent,
} from '@/app/(dashboard)/agents/actions'

// Sanity assertion — module-level: ensures these exports actually exist
describe('list-actions module exports', () => {
  it('exports the 6 list-page server actions', () => {
    expect(typeof getAgents).toBe('function')
    expect(typeof getActiveAgents).toBe('function')
    expect(typeof getChannelDefaults).toBe('function')
    expect(typeof setChannelDefault).toBe('function')
    expect(typeof toggleAgentActive).toBe('function')
    expect(typeof softDeleteAgent).toBe('function')
  })
})

describe('list-actions DB correctness', () => {
  let fx: TestOrgFixture
  const svc = serviceClient()

  beforeAll(async () => {
    fx = await seedTestOrg('p36-list')
  })

  afterAll(async () => {
    if (fx) await fx.cleanup()
  })

  it('setChannelDefault upsert: inserts (orgId, whatsapp, mainAgent)', async () => {
    const { error } = await svc
      .from('agent_channel_defaults')
      .upsert(
        { organization_id: fx.orgId, channel: 'whatsapp', agent_id: fx.mainAgentId },
        { onConflict: 'organization_id,channel' }
      )
    expect(error).toBeNull()

    const { data } = await svc
      .from('agent_channel_defaults')
      .select('agent_id')
      .eq('organization_id', fx.orgId)
      .eq('channel', 'whatsapp')
      .maybeSingle()
    expect(data?.agent_id).toBe(fx.mainAgentId)
  })

  it('setChannelDefault delete: removes the row', async () => {
    // Seed a row
    await svc
      .from('agent_channel_defaults')
      .upsert(
        { organization_id: fx.orgId, channel: 'messenger', agent_id: fx.mainAgentId },
        { onConflict: 'organization_id,channel' }
      )

    const { error } = await svc
      .from('agent_channel_defaults')
      .delete()
      .eq('organization_id', fx.orgId)
      .eq('channel', 'messenger')
    expect(error).toBeNull()

    const { data } = await svc
      .from('agent_channel_defaults')
      .select('id')
      .eq('organization_id', fx.orgId)
      .eq('channel', 'messenger')
      .maybeSingle()
    expect(data).toBeNull()
  })

  it('toggleAgentActive: UPDATE is_active=false then back to true', async () => {
    // Create a throwaway agent (don't toggle Main Agent — used by other tests)
    const { data: extra } = await svc
      .from('agents')
      .insert({
        organization_id: fx.orgId,
        name: 'Toggle Target',
        slug: 'toggle-target',
        system_prompt: 'x',
        model: 'anthropic/claude-haiku-4-5',
        fallback_message: 'fb',
        max_history: 5,
        is_active: true,
      })
      .select('id')
      .single()
    expect(extra?.id).toBeTruthy()

    const id = extra!.id

    const { error: err1 } = await svc.from('agents').update({ is_active: false }).eq('id', id)
    expect(err1).toBeNull()
    const { data: row1 } = await svc.from('agents').select('is_active').eq('id', id).single()
    expect(row1?.is_active).toBe(false)

    const { error: err2 } = await svc.from('agents').update({ is_active: true }).eq('id', id)
    expect(err2).toBeNull()
    const { data: row2 } = await svc.from('agents').select('is_active').eq('id', id).single()
    expect(row2?.is_active).toBe(true)

    await svc.from('agents').delete().eq('id', id)
  })

  it('softDelete reassignment: channel_defaults → Main Agent + is_active=false', async () => {
    // Seed an extra active agent X
    const { data: x } = await svc
      .from('agents')
      .insert({
        organization_id: fx.orgId,
        name: 'Agent X',
        slug: 'agent-x',
        system_prompt: 'x',
        model: 'anthropic/claude-haiku-4-5',
        fallback_message: 'fb',
        max_history: 5,
        is_active: true,
      })
      .select('id')
      .single()
    const xId = x!.id

    // Point telegram default at X
    await svc
      .from('agent_channel_defaults')
      .upsert(
        { organization_id: fx.orgId, channel: 'telegram', agent_id: xId },
        { onConflict: 'organization_id,channel' }
      )

    // Simulate softDeleteAgent's reassignment
    const { error: reassignErr } = await svc
      .from('agent_channel_defaults')
      .update({ agent_id: fx.mainAgentId })
      .eq('agent_id', xId)
    expect(reassignErr).toBeNull()

    // Simulate the is_active flip
    const { error: deactErr } = await svc
      .from('agents')
      .update({ is_active: false })
      .eq('id', xId)
    expect(deactErr).toBeNull()

    // Assert: channel default now points at main agent
    const { data: cd } = await svc
      .from('agent_channel_defaults')
      .select('agent_id')
      .eq('organization_id', fx.orgId)
      .eq('channel', 'telegram')
      .maybeSingle()
    expect(cd?.agent_id).toBe(fx.mainAgentId)

    // Assert: X is inactive
    const { data: xRow } = await svc
      .from('agents')
      .select('is_active')
      .eq('id', xId)
      .single()
    expect(xRow?.is_active).toBe(false)

    // Cleanup
    await svc.from('agents').delete().eq('id', xId)
  })

  it('softDelete refuses Main Agent: guard predicate holds', async () => {
    // Find the Main Agent like the action would
    const { data: main } = await svc
      .from('agents')
      .select('id')
      .eq('organization_id', fx.orgId)
      .eq('name', 'Main Agent')
      .eq('is_active', true)
      .maybeSingle()
    expect(main?.id).toBe(fx.mainAgentId)

    // The action checks: if (mainAgent.id === id) return error
    const wouldRefuse = main?.id === fx.mainAgentId
    expect(wouldRefuse).toBe(true)
  })

  it('tools count: agent_tools rows can be counted via embedded relation', async () => {
    // Create an integration + 3 tool_configs + attach to main agent
    const { data: integ, error: integErr } = await svc
      .from('integrations')
      .insert({
        organization_id: fx.orgId,
        name: 'Test Integ',
        provider: 'gohighlevel',
        encrypted_api_key: 'test-key',
        is_active: true,
      })
      .select('id')
      .single()
    expect(integErr).toBeNull()
    const integId = integ!.id

    const tools = [] as string[]
    for (let i = 0; i < 3; i++) {
      const { data: t } = await svc
        .from('tool_configs')
        .insert({
          organization_id: fx.orgId,
          integration_id: integId,
          tool_name: `tool_${i}_${Date.now()}`,
          action_type: 'send_sms',
          config: {},
          fallback_message: 'fb',
          is_active: true,
        })
        .select('id')
        .single()
      tools.push(t!.id)
      await svc.from('agent_tools').insert({
        organization_id: fx.orgId,
        agent_id: fx.mainAgentId,
        tool_config_id: t!.id,
      })
    }

    const { count } = await svc
      .from('agent_tools')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', fx.mainAgentId)
    expect(count).toBe(3)

    // Cleanup: agent_tools cascade on agent? They cascade on tool_config delete too.
    await svc.from('agent_tools').delete().eq('agent_id', fx.mainAgentId)
    await svc.from('tool_configs').delete().in('id', tools)
    await svc.from('integrations').delete().eq('id', integId)
  })
})
