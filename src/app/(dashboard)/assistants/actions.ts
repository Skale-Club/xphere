'use server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getCurrentOrgId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.rpc('get_current_org_id')
  return data as string | null
}

function normalizeAssistantName(name?: string) {
  const normalized = name?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

/**
 * Which agent's prompt this assistant speaks, or null for "whatever the org's
 * voice channel default is". Empty string from a <Select> means the same as
 * null — the form has no other way to say "unset".
 */
function normalizeEntryAgentId(entryAgentId?: string | null) {
  const normalized = entryAgentId?.trim()
  return normalized && normalized.length > 0 ? normalized : null
}

export async function createAssistantMapping(data: {
  vapi_assistant_id: string
  name?: string
  entry_agent_id?: string | null
}) {
  if (!data.vapi_assistant_id || data.vapi_assistant_id.trim() === '') {
    return { error: 'Vapi assistant ID is required.' }
  }
  const name = normalizeAssistantName(data.name)
  if (!name) return { error: 'Assistant name is required.' }
  const supabase = await createClient()
  const organization_id = await getCurrentOrgId(supabase)
  if (!organization_id) return { error: 'No organization found for current user.' }

  const { error } = await supabase
    .from('assistant_mappings')
    .insert({
      vapi_assistant_id: data.vapi_assistant_id.trim(),
      name,
      organization_id,
      entry_agent_id: normalizeEntryAgentId(data.entry_agent_id),
    })
  if (error) {
    if (error.code === '23505') return { error: 'This assistant ID is already mapped to an organization.' }
    if (error.code === '23503') return { error: 'That agent belongs to a different organization.' }
    return { error: error.message }
  }
  revalidatePath('/calls')
}

export async function updateAssistantMapping(
  id: string,
  data: { vapi_assistant_id: string; name?: string; entry_agent_id?: string | null }
) {
  const name = normalizeAssistantName(data.name)
  if (!name) return { error: 'Assistant name is required.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('assistant_mappings')
    .update({
      vapi_assistant_id: data.vapi_assistant_id.trim(),
      name,
      entry_agent_id: normalizeEntryAgentId(data.entry_agent_id),
    })
    .eq('id', id)
  if (error) {
    if (error.code === '23505') return { error: 'This assistant ID is already mapped to an organization.' }
    // The composite FK keeps a binding inside the mapping's own organization.
    if (error.code === '23503') return { error: 'That agent belongs to a different organization.' }
    return { error: error.message }
  }
  revalidatePath('/calls')
}

export async function toggleAssistantMappingStatus(id: string, is_active: boolean) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('assistant_mappings')
    .update({ is_active })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/calls')
}

export async function deleteAssistantMapping(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('assistant_mappings')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/calls')
}

export async function syncVapiAssistantsAction(): Promise<{
  ok: boolean
  imported?: number
  /** Assistants another org already routes through — left untouched. */
  skipped?: number
  error?: string
}> {
  const supabase = await createClient()
  const organization_id = await getCurrentOrgId(supabase)
  if (!organization_id) return { ok: false, error: 'No organization found for current user.' }

  const { syncVapiAssistants } = await import('@/lib/vapi/sync-assistants')
  const result = await syncVapiAssistants(supabase, organization_id)
  if (result.ok) revalidatePath('/calls')
  return result
}

/**
 * Outbound half: PATCHes the org's mesh (rendered prompt, function schemas,
 * per-tool spoken messages) onto a single mapped Vapi assistant. This is a
 * live write to a real Vapi assistant, which may be answering a real phone
 * number right now — it must only ever run from a deliberate operator click
 * on a specific mapping row, never on render, mount, or as a side effect of
 * loading the page. The RLS-scoped client (not the service-role client) is
 * used deliberately: this runs as the authenticated user and the mapping
 * lookup below is naturally scoped to organizations that user belongs to.
 */
export async function pushAssistantConfigAction(
  mappingId: string
): Promise<{ error?: string } | { ok: true; agentSource?: 'mapping' | 'channel_default' }> {
  if (!mappingId || mappingId.trim() === '') return { error: 'Mapping id is required.' }

  const supabase = await createClient()
  const organization_id = await getCurrentOrgId(supabase)
  if (!organization_id) return { error: 'No organization found for current user.' }

  const { data: mapping, error: mappingError } = await supabase
    .from('assistant_mappings')
    .select('id, organization_id, vapi_assistant_id')
    .eq('id', mappingId)
    .maybeSingle()

  if (mappingError) return { error: mappingError.message }
  if (!mapping) return { error: 'Assistant mapping not found.' }
  if (mapping.organization_id !== organization_id) {
    return { error: 'Assistant mapping not found.' }
  }

  const { pushAssistantConfig } = await import('@/lib/vapi/sync-assistant-config')
  const result = await pushAssistantConfig(supabase, organization_id, mapping.vapi_assistant_id)
  if (!result.ok) return { error: result.error ?? 'Push failed.' }

  revalidatePath('/calls')
  return { ok: true, agentSource: result.agentSource }
}
