// Executor for the update_contact workflow action node.
// Resolves a contact by id or phone and updates mutable CRM fields.

import type { ActionContext } from '@/lib/action-engine/execute-action'
import type { CrmLifecycleStage } from '@/types/database'

type SupabaseClientT = ActionContext['supabase']

async function resolveContactId(
  supabase: SupabaseClientT,
  orgId: string,
  params: Record<string, unknown>,
): Promise<string> {
  if (typeof params.contact_id === 'string' && params.contact_id) {
    return params.contact_id
  }
  if (typeof params.contact_phone === 'string' && params.contact_phone) {
    const { data } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone_e164', params.contact_phone)
      .neq('identity_status', 'archived_duplicate')
      .maybeSingle()
    if (!data) throw new Error(`contact not found for phone ${params.contact_phone}`)
    return data.id
  }
  throw new Error('update_contact requires contact_id or contact_phone')
}

export async function executeUpdateContact(
  params: Record<string, unknown>,
  ctx: ActionContext,
): Promise<string> {
  const { supabase, organizationId: orgId } = ctx

  const contactId = await resolveContactId(supabase, orgId, params)

  const patch: Record<string, unknown> = {}

  if (params.lifecycle_stage) {
    patch.lifecycle_stage = params.lifecycle_stage as CrmLifecycleStage
  }
  if (params.name !== undefined) patch.name = params.name
  if (params.email !== undefined) patch.email = params.email
  if (params.company !== undefined) patch.company = params.company
  if (params.notes !== undefined) patch.notes = params.notes
  if (params.assigned_to !== undefined) patch.assigned_to = params.assigned_to

  if (Object.keys(patch).length === 0) {
    return 'update_contact: nothing to update'
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('org_id', orgId)

  if (error) throw new Error(`update_contact failed: ${error.message}`)

  return `contact ${contactId} updated: ${Object.keys(patch).join(', ')}`
}
