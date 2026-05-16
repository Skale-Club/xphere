import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Service-role client for test setup/teardown (bypasses RLS).
 * Uses SUPABASE_SERVICE_ROLE_KEY from .env.local via tests/setup/load-env.ts.
 */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Service-role env missing — load-env.ts ran?')
  return createClient<Database>(url, key, { auth: { persistSession: false } })
}

export interface TestOrgFixture {
  orgId: string
  userId: string
  mainAgentId: string
  cleanup: () => Promise<void>
}

/**
 * Creates an isolated test org with a seeded Main Agent.
 * Tests should call cleanup() in afterAll.
 */
export async function seedTestOrg(prefix = 'p36'): Promise<TestOrgFixture> {
  const svc = serviceClient()
  const orgName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const { data: org, error: orgErr } = await svc
    .from('organizations')
    .insert({
      name: orgName,
      slug: orgName,
      widget_token: `wt-${Math.random().toString(36).slice(2, 12)}`,
    })
    .select('id')
    .single()
  if (orgErr || !org) throw orgErr ?? new Error('org create failed')

  const { data: agent, error: agErr } = await svc
    .from('agents')
    .insert({
      organization_id: org.id,
      name: 'Main Agent',
      slug: 'main-agent',
      system_prompt: 'Test main agent.',
      model: 'anthropic/claude-haiku-4-5',
      fallback_message: 'Test fallback.',
      max_history: 10,
      is_active: true,
    })
    .select('id')
    .single()
  if (agErr || !agent) throw agErr ?? new Error('main agent create failed')

  return {
    orgId: org.id,
    userId: '00000000-0000-0000-0000-000000000000', // service role context — no auth user
    mainAgentId: agent.id,
    cleanup: async () => {
      await svc.from('organizations').delete().eq('id', org.id) // cascade clears children
    },
  }
}
