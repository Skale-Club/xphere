import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serviceClient, seedTestOrg, type TestOrgFixture } from './fixtures'

/**
 * Phase 36 — phase gate lifecycle test.
 *
 * End-to-end gate: full CRUD lifecycle on one test org. Mirrors what an admin
 * does through the UI, but operates directly against the DB to bypass the
 * Next.js request context for auth. Covers:
 *   - create agent (Specialist) with TOOL-03 deny-by-default
 *   - attach tool (simulates updateAgent + setAgentTools)
 *   - set channel default (whatsapp → Specialist)
 *   - soft-delete with reassignment (D-36-07): defaults move to Main Agent,
 *     is_active flips false, historical agent_tools still queryable (AGENT-10)
 *   - AGENT-02 column persistence + CHECK constraint enforcement
 */
describe('Phase 36 — phase gate lifecycle', () => {
  let fx: TestOrgFixture

  beforeAll(async () => {
    fx = await seedTestOrg('p36-gate')
  })

  afterAll(async () => {
    if (fx) await fx.cleanup()
  })

  it('runs the full create → attach → channel-default → soft-delete-with-reassignment lifecycle', async () => {
    const svc = serviceClient()

    // (1) Create a second agent (the "Specialist") via the same shape createAgent uses.
    const { data: specialist, error: createErr } = await svc
      .from('agents')
      .insert({
        organization_id: fx.orgId,
        name: 'Specialist',
        slug: 'specialist',
        description: 'Gate test specialist.',
        system_prompt: 'You are a specialist.',
        model: 'anthropic/claude-sonnet-4-6',
        fallback_message: 'I cannot help with that.',
        max_history: 15,
        temperature: 0.3,
        max_tokens: 1024,
        is_active: true,
        allowed_channels: ['whatsapp'],
        channel_overrides: {},
        // tool_ids intentionally NOT inserted — TOOL-03 deny-by-default
      })
      .select('id')
      .single()
    expect(createErr).toBeNull()
    expect(specialist).toBeTruthy()

    // (2) Verify zero agent_tools (TOOL-03).
    const { count: initialToolCount } = await svc
      .from('agent_tools')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', specialist!.id)
    expect(initialToolCount).toBe(0)

    // (3) Seed a tool_config and attach it to Specialist (simulates updateAgent + setAgentTools).
    const { data: integ, error: integErr } = await svc
      .from('integrations')
      .insert({
        organization_id: fx.orgId,
        provider: 'twilio',
        name: 'Gate',
        is_active: true,
        encrypted_api_key: 'test-key',
      })
      .select('id')
      .single()
    expect(integErr).toBeNull()

    const { data: tc, error: tcErr } = await svc
      .from('tool_configs')
      .insert({
        organization_id: fx.orgId,
        integration_id: integ!.id,
        tool_name: `gate_tool_${Date.now()}`,
        action_type: 'send_sms',
        config: {},
        fallback_message: 'fb',
        is_active: true,
      })
      .select('id')
      .single()
    expect(tcErr).toBeNull()

    const { error: attachErr } = await svc.from('agent_tools').insert({
      organization_id: fx.orgId,
      agent_id: specialist!.id,
      tool_config_id: tc!.id,
    })
    expect(attachErr).toBeNull()

    const { count: afterAttachCount } = await svc
      .from('agent_tools')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', specialist!.id)
    expect(afterAttachCount).toBe(1)

    // (4) Set channel default whatsapp → Specialist (UPSERT).
    await svc.from('agent_channel_defaults').upsert(
      { organization_id: fx.orgId, channel: 'whatsapp', agent_id: specialist!.id },
      { onConflict: 'organization_id,channel' }
    )
    const { data: cdBefore } = await svc
      .from('agent_channel_defaults')
      .select('agent_id')
      .eq('organization_id', fx.orgId)
      .eq('channel', 'whatsapp')
      .single()
    expect(cdBefore!.agent_id).toBe(specialist!.id)

    // (5) Simulate softDeleteAgent(Specialist):
    //     - find Main Agent (the action's lookup shape)
    const { data: mainAgent } = await svc
      .from('agents')
      .select('id')
      .eq('organization_id', fx.orgId)
      .eq('name', 'Main Agent')
      .eq('is_active', true)
      .single()
    expect(mainAgent!.id).toBe(fx.mainAgentId)
    //     - reassign channel defaults
    await svc
      .from('agent_channel_defaults')
      .update({ agent_id: mainAgent!.id })
      .eq('agent_id', specialist!.id)
    //     - soft-delete
    await svc
      .from('agents')
      .update({ is_active: false })
      .eq('id', specialist!.id)

    // (6) Verify final state.
    const { data: cdAfter } = await svc
      .from('agent_channel_defaults')
      .select('agent_id')
      .eq('organization_id', fx.orgId)
      .eq('channel', 'whatsapp')
      .single()
    expect(cdAfter!.agent_id).toBe(fx.mainAgentId)

    const { data: specAfter } = await svc
      .from('agents')
      .select('is_active')
      .eq('id', specialist!.id)
      .single()
    expect(specAfter!.is_active).toBe(false)

    // AGENT-10: historical agent_tools still queryable
    const { count: histToolCount } = await svc
      .from('agent_tools')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', specialist!.id)
    expect(histToolCount).toBe(1)
  })

  it('AGENT-02: temperature/max_tokens persist and respect bounds', async () => {
    const svc = serviceClient()
    const { data: a, error } = await svc
      .from('agents')
      .insert({
        organization_id: fx.orgId,
        name: 'Bounds Bot',
        slug: 'bounds-bot',
        system_prompt: 'x',
        model: 'anthropic/claude-sonnet-4-6',
        fallback_message: 'x',
        max_history: 20,
        temperature: 1.5,
        max_tokens: 4096,
        is_active: true,
      })
      .select('temperature, max_tokens, max_history')
      .single()
    expect(error).toBeNull()
    expect(Number(a!.temperature)).toBeCloseTo(1.5)
    expect(a!.max_tokens).toBe(4096)
    expect(a!.max_history).toBe(20)
  })

  it('AGENT-02: out-of-range temperature is rejected by CHECK constraint', async () => {
    const svc = serviceClient()
    const { error } = await svc
      .from('agents')
      .insert({
        organization_id: fx.orgId,
        name: 'Bad Bot',
        slug: 'bad-bot',
        system_prompt: 'x',
        model: 'anthropic/claude-sonnet-4-6',
        fallback_message: 'x',
        max_history: 10,
        temperature: 5.0,
        is_active: true,
      })
    expect(error).toBeTruthy()
  })
})
