// tests/agent-schema-prompt-byte-equal.test.ts
// Phase 33 Plan 01 — Wave 1 RED scaffold, FLIPPED GREEN by Plan 07 Wave 4.
// Pins the byte-equal v1.4 prompt contract per D-33-04.
//
// SOURCE OF TRUTH for the template literal: src/lib/chat/stream.ts:107
//   `You are a helpful assistant for ${orgName}. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so.${kb_context_runtime_suffix}`
//
// The seed must reproduce the template byte-for-byte after ${orgName} substitution
// AND with the runtime kb_context suffix REMOVED (it is appended at LLM call time
// per D-33-03, never stored in agents.system_prompt).

import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

let admin: SupabaseClient<Database>

beforeAll(() => {
  admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
})

/**
 * Verbatim copy of the v1.4 system prompt template from src/lib/chat/stream.ts:107
 * with the runtime KB-context suffix removed (per D-33-03 the suffix is appended
 * at runtime, NOT stored in agents.system_prompt).
 *
 * If the v1.4 template ever changes upstream, this constant must be updated in
 * lockstep — that is the byte-equal contract this file pins.
 */
const v14Template = (orgName: string) =>
  `You are a helpful assistant for ${orgName}. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so.`

// Phase 36 Plan 05: exclude transient test-fixture orgs (seedTestOrg naming
// + rls-isolation.test.ts naming) from this global invariant so the assertion
// only runs against real seeded orgs.
const TEST_FIXTURE_NAME =
  /^(p\d+[a-z0-9-]*-\d{10,}-[a-z0-9]+|RLS [AB] [a-z0-9]{6,})$/i

describe('D-33-04 byte-equal v1.4 prompt: seeded Main Agent.system_prompt', () => {
  it('every Main Agent system_prompt equals v14Template(org.name) byte-for-byte', async () => {
    const { data: orgs, error: orgsErr } = await admin
      .from('organizations')
      .select('id, name')
    expect(orgsErr).toBeNull()

    const realOrgs = (orgs ?? []).filter(
      (o) => !o.name || !TEST_FIXTURE_NAME.test(o.name),
    )

    for (const org of realOrgs) {
      const { data: agent, error } = await admin
        .from('agents')
        .select('system_prompt')
        .eq('organization_id', org.id)
        .eq('name', 'Main Agent')
        .single()
      expect(error).toBeNull()

      const orgName = org.name && org.name.length > 0 ? org.name : 'your team'
      const expected = v14Template(orgName)
      expect(agent!.system_prompt).toBe(expected)
    }
  })

  it('orgs with NULL or empty name use the literal fallback "your team" (D-33-05)', async () => {
    const { data: orgs, error: orgsErr } = await admin
      .from('organizations')
      .select('id, name')
      .or('name.is.null,name.eq.')
    expect(orgsErr).toBeNull()

    // If no nameless orgs exist in this DB, the test passes vacuously — but the
    // assertion MUST be present so the contract holds for future inserts.
    if ((orgs ?? []).length === 0) {
      expect(orgs).toHaveLength(0)
      return
    }

    for (const org of orgs!) {
      const { data: agent, error } = await admin
        .from('agents')
        .select('system_prompt')
        .eq('organization_id', org.id)
        .eq('name', 'Main Agent')
        .single()
      expect(error).toBeNull()

      expect(agent!.system_prompt).toBe(v14Template('your team'))
    }
  })

  it('NO seeded prompt contains unresolved template interpolation tokens (substitution complete)', async () => {
    const { data: agents, error } = await admin
      .from('agents')
      .select('system_prompt')
      .eq('name', 'Main Agent')
    expect(error).toBeNull()

    for (const agent of agents ?? []) {
      const prompt = agent.system_prompt as string
      // Reject any unresolved JS template-literal interpolation marker.
      // The literal two-character sequence "$" + "{" must NOT appear in seeded prompts.
      const interpMarker = '$' + '{'
      expect(prompt.includes(interpMarker)).toBe(false)
      // Also reject the literal identifier name to be doubly safe.
      expect(prompt.toLowerCase().includes('kbcontext')).toBe(false)
      expect(prompt.includes('orgName')).toBe(false)
    }
  })
})
