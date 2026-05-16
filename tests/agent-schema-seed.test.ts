// tests/agent-schema-seed.test.ts
// Phase 33 Plan 01 — Wave 1 RED scaffold, FLIPPED GREEN by Plan 07 Wave 4.
// Pins the seed-completeness contract for AGENT-09 + TOOL-01 + GATE-07 prerequisites.
//
// NOTE (Phase 36 Plan 05): the global "every org has X" assertions race against
// transient test-fixture orgs created by tests/agents/fixtures.ts (`seedTestOrg`),
// which deliberately seed only a minimal Main Agent. We exclude any org whose
// name matches the test-fixture prefix pattern `p\d+-<timestamp>-<rand>` so the
// invariant continues to apply ONLY to real seeded orgs. (Cleanup of fixture
// orgs cascades from organizations.id, so leakage is bounded to in-flight runs.)

import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Matches transient test-fixture org names. Two patterns coexist in the suite:
//   1. seedTestOrg (tests/agents/fixtures.ts): `p\d+...-<timestamp>-<rand5>`
//      e.g. `p36-rls-a-1778974271234-abc12`
//   2. rls-isolation.test.ts: `RLS A <rand8>` / `RLS B <rand8>`
// Real seeded orgs have human-readable names without trailing random suffixes.
const TEST_FIXTURE_NAME =
  /^(p\d+[a-z0-9-]*-\d{10,}-[a-z0-9]+|RLS [AB] [a-z0-9]{6,})$/i

let admin: SupabaseClient<Database>

beforeAll(() => {
  admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
})

async function getRealOrgs() {
  const { data, error } = await admin
    .from('organizations')
    .select('id, name')
  expect(error).toBeNull()
  return (data ?? []).filter((o) => !o.name || !TEST_FIXTURE_NAME.test(o.name))
}

describe('AGENT-09 + TOOL-01 + GATE-07 prerequisites: Main Agent seed', () => {
  it("every organization has exactly one row in agents WHERE name = 'Main Agent'", async () => {
    const realOrgs = await getRealOrgs()
    const orgIds = realOrgs.map((o) => o.id)

    const { count: agentCount, error: agentErr } = await admin
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .eq('name', 'Main Agent')
      .in('organization_id', orgIds)
    expect(agentErr).toBeNull()

    expect(agentCount).toBe(realOrgs.length)
  })

  it('every Main Agent has agent_tools rows for every active tool_config in its org', async () => {
    const orgs = await getRealOrgs()

    for (const org of orgs) {
      const { count: toolConfigCount } = await admin
        .from('tool_configs')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.id)
        .eq('is_active', true)

      const { count: agentToolCount } = await admin
        .from('agent_tools')
        .select('*, agents!inner(organization_id, name)', { count: 'exact', head: true })
        .eq('agents.organization_id', org.id)
        .eq('agents.name', 'Main Agent')

      expect(agentToolCount).toBe(toolConfigCount)
    }
  })

  it('every Main Agent has an agent_channel_defaults row for web_widget (D-33-09)', async () => {
    const orgs = await getRealOrgs()

    for (const org of orgs) {
      const { count } = await admin
        .from('agent_channel_defaults')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.id)
        .eq('channel', 'web_widget')

      expect(count).toBe(1)
    }
  })

  it('every Main Agent has agents.active_prompt_version_id pointing at agent_prompt_versions.version=1', async () => {
    const realOrgs = await getRealOrgs()
    const orgIds = realOrgs.map((o) => o.id)

    const { data: agents, error } = await admin
      .from('agents')
      .select('id, active_prompt_version_id')
      .eq('name', 'Main Agent')
      .in('organization_id', orgIds)
    expect(error).toBeNull()

    for (const agent of agents ?? []) {
      expect(agent.active_prompt_version_id).not.toBeNull()

      const { data: version, error: vErr } = await admin
        .from('agent_prompt_versions')
        .select('version')
        .eq('id', agent.active_prompt_version_id!)
        .single()
      expect(vErr).toBeNull()
      expect(version!.version).toBe(1)
    }
  })
})
