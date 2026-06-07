'use server'

// Partner-agent delegation CRUD (agent_partners). Lets one agent be configured
// to call ("delegate to") other agents in the same org. The runtime already
// consumes agent_partners; this just exposes the config UI.

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'

export interface AgentPartnerListItem {
  id: string
  partner_agent_id: string
  partner_name: string
  partner_slug: string
  invocation_description: string
}

/** Partners this agent can delegate to, with the partner's name/slug joined. */
export async function listAgentPartners(
  agentId: string
): Promise<AgentPartnerListItem[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('agent_partners')
    .select(
      'id, partner_agent_id, invocation_description, partner:agents!agent_partners_partner_agent_id_fkey(name, slug)'
    )
    .eq('agent_id', agentId)
    .order('created_at', { ascending: true })

  if (error || !data) return []
  return data.map((r) => {
    const partner = (r as { partner: { name: string; slug: string } | null }).partner
    return {
      id: r.id,
      partner_agent_id: r.partner_agent_id,
      partner_name: partner?.name ?? '(unknown)',
      partner_slug: partner?.slug ?? '',
      invocation_description: r.invocation_description,
    }
  })
}

/** Adds a partner the agent may delegate to. */
export async function addAgentPartner(
  agentId: string,
  partnerAgentId: string,
  invocationDescription: string
): Promise<{ error?: string; id?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (agentId === partnerAgentId) {
    return { error: 'An agent cannot delegate to itself.' }
  }
  const description = invocationDescription.trim()
  if (!description) {
    return { error: 'Describe when this agent should delegate to the partner.' }
  }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data, error } = await supabase
    .from('agent_partners')
    .insert({
      organization_id: orgId,
      agent_id: agentId,
      partner_agent_id: partnerAgentId,
      invocation_description: description,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'This partner is already attached.' }
    }
    return { error: error.message }
  }

  revalidatePath(`/agents/${agentId}`)
  return { id: data.id }
}

/** Removes a partner link by its row id. */
export async function removeAgentPartner(
  id: string,
  agentId: string
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase.from('agent_partners').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(`/agents/${agentId}`)
}
