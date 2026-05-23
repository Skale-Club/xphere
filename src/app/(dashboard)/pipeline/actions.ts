'use server'

/**
 * Server actions for the Sales Pipeline (SEED-008 / v2.1).
 *
 * Mirrors the auth + RLS conventions from contacts/actions.ts:
 *   - getUser() for auth gating
 *   - createClient() (RLS-scoped) for all writes
 *   - get_current_org_id() RPC for explicit org-id injection on Insert
 *
 * Activity feed entries are mostly created by the DB trigger on call_logs and
 * by app-level inserts in moveOpportunity / addNote. We *never* write feed
 * entries from raw SQL inside the page components.
 */

import { revalidatePath } from 'next/cache'
import { createClient, getUser } from '@/lib/supabase/server'
import type { Database, OpportunityStatus } from '@/types/database'
import {
  pipelineSchema,
  stageSchema,
  opportunitySchema,
  noteSchema,
  opportunityFilterSchema,
  type PipelineFormInput,
  type StageFormInput,
  type OpportunityFormInput,
  type OpportunityFilters,
} from '@/lib/pipeline/zod-schemas'
import { validateCustomFields } from '@/lib/custom-fields'
import { emitOpportunityEvent } from '@/lib/pipeline/events'
import { getDefinitions } from '@/app/(dashboard)/settings/custom-fields/actions'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'
import type { CustomFieldType } from '@/types/database'

type PipelineRow = Database['public']['Tables']['pipelines']['Row']
type StageRow = Database['public']['Tables']['pipeline_stages']['Row']
type OpportunityRow = Database['public']['Tables']['opportunities']['Row']
type ActivityRow = Database['public']['Tables']['opportunity_activities']['Row']

// ─── Pipelines ───────────────────────────────────────────────────────────────

export async function getPipelines(): Promise<PipelineRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pipelines')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error || !data) return []
  return data
}

export async function getDefaultPipeline(): Promise<PipelineRow | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  // Prefer is_default=true; fall back to lowest position.
  const { data } = await supabase
    .from('pipelines')
    .select('*')
    .order('is_default', { ascending: false })
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

export async function createPipeline(
  input: PipelineFormInput,
): Promise<{ id?: string; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = pipelineSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  // If this is being marked default, demote others.
  if (parsed.data.is_default) {
    await supabase.from('pipelines').update({ is_default: false }).neq('id', '00000000-0000-0000-0000-000000000000')
  }

  // Position: max + 1
  const { data: maxRow } = await supabase
    .from('pipelines')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = (maxRow?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('pipelines')
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      is_default: parsed.data.is_default ?? false,
      position: nextPos,
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Insert failed' }
  revalidatePath('/pipeline')
  return { id: data.id }
}

export async function updatePipeline(
  id: string,
  input: PipelineFormInput,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = pipelineSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()

  if (parsed.data.is_default) {
    await supabase.from('pipelines').update({ is_default: false }).neq('id', id)
  }

  const { error } = await supabase
    .from('pipelines')
    .update({ name: parsed.data.name, is_default: parsed.data.is_default ?? false })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/pipeline')
}

export async function deletePipeline(
  id: string,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase.from('pipelines').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/pipeline')
}

export async function reorderPipelines(
  orderedIds: string[],
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('pipelines').update({ position: i }).eq('id', orderedIds[i])
    if (error) return { error: error.message }
  }
  revalidatePath('/pipeline')
}

// ─── Stages ──────────────────────────────────────────────────────────────────

export async function getStages(pipelineId: string): Promise<StageRow[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('pipeline_stages')
    .select('*')
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: true })
  return data ?? []
}

export async function createStage(
  pipelineId: string,
  input: StageFormInput,
): Promise<{ id?: string; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = stageSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data: maxRow } = await supabase
    .from('pipeline_stages')
    .select('position')
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = (maxRow?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('pipeline_stages')
    .insert({
      pipeline_id: pipelineId,
      org_id: orgId,
      name: parsed.data.name,
      color: parsed.data.color,
      is_won: parsed.data.is_won ?? false,
      is_lost: parsed.data.is_lost ?? false,
      position: nextPos,
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Insert failed' }
  revalidatePath('/pipeline')
  revalidatePath('/pipeline/settings')
  return { id: data.id }
}

export async function updateStage(
  id: string,
  input: StageFormInput,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = stageSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('pipeline_stages')
    .update({
      name: parsed.data.name,
      color: parsed.data.color,
      is_won: parsed.data.is_won ?? false,
      is_lost: parsed.data.is_lost ?? false,
    })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/pipeline')
  revalidatePath('/pipeline/settings')
}

export async function deleteStage(
  id: string,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  // Can't delete a stage that still has opportunities (RESTRICT) | caller
  // should move opportunities out first.
  const { count } = await supabase
    .from('opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', id)
  if ((count ?? 0) > 0) {
    return { error: 'Stage has opportunities | move them first.' }
  }
  const { error } = await supabase.from('pipeline_stages').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/pipeline')
  revalidatePath('/pipeline/settings')
}

export async function reorderStages(
  pipelineId: string,
  orderedIds: string[],
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('pipeline_stages')
      .update({ position: i })
      .eq('id', orderedIds[i])
      .eq('pipeline_id', pipelineId)
    if (error) return { error: error.message }
  }
  revalidatePath('/pipeline')
  revalidatePath('/pipeline/settings')
}

// ─── Opportunities ───────────────────────────────────────────────────────────

export interface OpportunityWithContact extends OpportunityRow {
  contact: {
    id: string
    first_name: string | null
    last_name: string | null
    name: string | null
    phone: string | null
    email: string | null
    company: string | null
  } | null
  stage: { id: string; name: string; color: string; is_won: boolean; is_lost: boolean } | null
}

export async function getOpportunities(
  filters: OpportunityFilters = {},
): Promise<OpportunityWithContact[]> {
  const user = await getUser()
  if (!user) return []
  const parsed = opportunityFilterSchema.safeParse(filters)
  if (!parsed.success) return []
  const f = parsed.data
  const supabase = await createClient()

  let query = supabase
    .from('opportunities')
    .select(
      `*,
       contact:contacts(id, first_name, last_name, name, phone, email, company),
       stage:pipeline_stages(id, name, color, is_won, is_lost)`,
    )
    .order('position', { ascending: true })
    .order('updated_at', { ascending: false })

  if (f.pipeline_id) query = query.eq('pipeline_id', f.pipeline_id)
  if (f.assigned_to) query = query.eq('assigned_to', f.assigned_to)
  if (f.status) query = query.eq('status', f.status)
  if (f.q) {
    const escaped = f.q.replace(/[%_]/g, (m) => `\\${m}`)
    query = query.ilike('title', `%${escaped}%`)
  }
  if (f.min_value !== undefined) query = query.gte('value', f.min_value)
  if (f.max_value !== undefined) query = query.lte('value', f.max_value)

  const { data, error } = await query
  if (error || !data) return []
  return data as unknown as OpportunityWithContact[]
}

export async function getOpportunity(
  id: string,
): Promise<OpportunityWithContact | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('opportunities')
    .select(
      `*,
       contact:contacts(id, first_name, last_name, name, phone, email, company),
       stage:pipeline_stages(id, name, color, is_won, is_lost)`,
    )
    .eq('id', id)
    .maybeSingle()
  return (data as unknown as OpportunityWithContact) ?? null
}

export async function createOpportunity(
  input: OpportunityFormInput,
): Promise<{ id?: string; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = opportunitySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const data = parsed.data
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  // Validate and persist custom fields (CF-07, Phase 71)
  const cfPayload = data.custom_fields ?? {}
  if (Object.keys(cfPayload).length > 0) {
    const cfResult = await validateCustomFields(orgId, 'opportunity', cfPayload)
    if (!cfResult.ok) return { error: 'custom_fields_invalid' }
  }

  // Position: append to the bottom of the stage.
  const { data: maxRow } = await supabase
    .from('opportunities')
    .select('position')
    .eq('stage_id', data.stage_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = (maxRow?.position ?? -1) + 1

  const { data: inserted, error } = await supabase
    .from('opportunities')
    .insert({
      org_id: orgId,
      contact_id: data.contact_id ?? null,
      pipeline_id: data.pipeline_id,
      stage_id: data.stage_id,
      title: data.title,
      value: data.value,
      currency: data.currency,
      status: data.status,
      expected_close_date: data.expected_close_date ?? null,
      assigned_to: data.assigned_to ?? user.id,
      position: nextPos,
      created_by: user.id,
      ...(Object.keys(cfPayload).length > 0 && { custom_fields: cfPayload }),
    })
    .select('id')
    .single()
  if (error || !inserted) return { error: error?.message ?? 'Insert failed' }

  // Seed the activity feed with a "created" entry.
  await supabase.from('opportunity_activities').insert({
    org_id: orgId,
    opportunity_id: inserted.id,
    type: 'created',
    content: `Opportunity created: ${data.title}`,
    created_by: user.id,
  })

  // SEED-036: fire opportunity.created event for any matching workflow.
  // Fire-and-forget so the user response isn't blocked by workflow execution.
  void emitOpportunityEvent(orgId, 'opportunity.created', {
    opportunity_id: inserted.id,
  })

  revalidatePath('/pipeline')
  revalidatePath('/pipeline/list')
  return { id: inserted.id }
}

export async function updateOpportunity(
  id: string,
  input: Partial<OpportunityFormInput>,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Validate and persist custom fields (CF-07, Phase 71)
  const cfPayloadUpdate = input.custom_fields ?? {}
  if (Object.keys(cfPayloadUpdate).length > 0) {
    const { data: orgIdForCf } = await supabase.rpc('get_current_org_id')
    if (orgIdForCf) {
      const cfResult = await validateCustomFields(orgIdForCf, 'opportunity', cfPayloadUpdate)
      if (!cfResult.ok) return { error: 'custom_fields_invalid' }
    }
  }

  const patch: Database['public']['Tables']['opportunities']['Update'] = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.value !== undefined) patch.value = Number(input.value)
  if (input.currency !== undefined) patch.currency = input.currency
  if (input.pipeline_id !== undefined) patch.pipeline_id = input.pipeline_id
  if (input.stage_id !== undefined) patch.stage_id = input.stage_id
  if (input.contact_id !== undefined) patch.contact_id = input.contact_id ?? null
  if (input.expected_close_date !== undefined) patch.expected_close_date = input.expected_close_date ?? null
  if (input.assigned_to !== undefined) patch.assigned_to = input.assigned_to ?? null
  if (input.status !== undefined) patch.status = input.status as OpportunityStatus
  if (Object.keys(cfPayloadUpdate).length > 0) patch.custom_fields = cfPayloadUpdate

  // Snapshot the row before the update so SEED-036 events can diff fields.
  const { data: before } = await supabase
    .from('opportunities')
    .select('id, org_id, title, value, assigned_to, status, expected_close_date')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase.from('opportunities').update(patch).eq('id', id)
  if (error) return { error: error.message }

  // SEED-036: compute changes and emit events.
  if (before) {
    const beforeRow = before as Record<string, unknown>
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      const beforeVal = beforeRow[key as string]
      const afterVal = patch[key]
      if (beforeVal !== afterVal) {
        changes[key as string] = { from: beforeVal ?? null, to: afterVal ?? null }
      }
    }
    if (Object.keys(changes).length > 0) {
      const orgId = before.org_id as string
      if ('assigned_to' in changes) {
        void emitOpportunityEvent(orgId, 'opportunity.assigned', {
          opportunity_id: id,
          changes: { assigned_to: changes.assigned_to },
        })
      }
      if ('value' in changes) {
        void emitOpportunityEvent(orgId, 'opportunity.value_changed', {
          opportunity_id: id,
          changes: { value: changes.value },
        })
      }
      void emitOpportunityEvent(orgId, 'opportunity.updated', {
        opportunity_id: id,
        changes,
      })
    }
  }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
}

/**
 * Link an opportunity to an account (account_id column).
 * Used by AddOpportunityDialog after createOpportunity, because createOpportunity
 * does not accept account_id in OpportunityFormInput (v2.4 compatibility).
 */
export async function setOpportunityAccount(
  opportunityId: string,
  accountId: string,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('opportunities')
    .update({ account_id: accountId })
    .eq('id', opportunityId)
  if (error) return { error: error.message }
  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${opportunityId}`)
}

export async function deleteOpportunity(
  id: string,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // SEED-036: snapshot before delete so workflows triggered by
  // opportunity.deleted can still read opportunity fields.
  const { data: snapshot } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase.from('opportunities').delete().eq('id', id)
  if (error) return { error: error.message }

  if (snapshot) {
    void emitOpportunityEvent(snapshot.org_id as string, 'opportunity.deleted', {
      opportunity_id: id,
      opportunity_snapshot: snapshot as unknown as Record<string, unknown>,
    })
  }

  revalidatePath('/pipeline')
}

/**
 * Persist the in-stage ordering after the user reorders cards within a
 * single column. `orderedIds` is the full list of opportunity IDs in that
 * stage in the new order; positions are written as the array index.
 */
export async function reorderOpportunities(
  stageId: string,
  orderedIds: string[],
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  if (orderedIds.length === 0) return
  const supabase = await createClient()
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from('opportunities')
      .update({ position: i })
      .eq('id', orderedIds[i])
      .eq('stage_id', stageId)
    if (error) return { error: error.message }
  }
  revalidatePath('/pipeline')
}

/**
 * Move an opportunity to a new stage. Creates a stage_change activity entry
 * and, if the new stage is marked won/lost, transitions the opportunity status.
 */
export async function moveOpportunity(
  id: string,
  stageId: string,
  position?: number,
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Snapshot the current stage for the activity log
  const { data: current } = await supabase
    .from('opportunities')
    .select('id, org_id, stage_id, status, stage:pipeline_stages(name, is_won, is_lost)')
    .eq('id', id)
    .maybeSingle()
  if (!current) return { error: 'Opportunity not found.' }

  // Resolve destination stage flags
  const { data: nextStage } = await supabase
    .from('pipeline_stages')
    .select('id, name, is_won, is_lost')
    .eq('id', stageId)
    .maybeSingle()
  if (!nextStage) return { error: 'Stage not found.' }

  let nextStatus: OpportunityStatus = (current.status as OpportunityStatus) ?? 'open'
  if (nextStage.is_won) nextStatus = 'won'
  else if (nextStage.is_lost) nextStatus = 'lost'
  else if (nextStatus !== 'open') nextStatus = 'open'

  // If position not provided, append to bottom of new stage.
  let nextPos = position
  if (nextPos === undefined) {
    const { data: maxRow } = await supabase
      .from('opportunities')
      .select('position')
      .eq('stage_id', stageId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    nextPos = (maxRow?.position ?? -1) + 1
  }

  const { error: updErr } = await supabase
    .from('opportunities')
    .update({ stage_id: stageId, status: nextStatus, position: nextPos })
    .eq('id', id)
  if (updErr) return { error: updErr.message }

  // Activity entry for the stage_change. Only insert when the stage actually
  // changed | drag-to-same-column reorders shouldn't pollute the feed.
  if (current.stage_id !== stageId) {
    const previousStageRel = current.stage as
      | { name?: string; is_won?: boolean; is_lost?: boolean }
      | { name?: string; is_won?: boolean; is_lost?: boolean }[]
      | null
    const prev = Array.isArray(previousStageRel) ? previousStageRel[0] : previousStageRel
    await supabase.from('opportunity_activities').insert({
      org_id: current.org_id,
      opportunity_id: id,
      type: nextStage.is_won ? 'won' : nextStage.is_lost ? 'lost' : 'stage_change',
      content: `${prev?.name ?? 'Previous stage'} → ${nextStage.name}`,
      metadata: {
        from_stage_id: current.stage_id,
        to_stage_id: stageId,
        from_stage_name: prev?.name ?? null,
        to_stage_name: nextStage.name,
      },
      created_by: user.id,
    })

    // SEED-036: fire the matching pipeline event. won/lost take precedence
    // over the generic stage_changed so workflows can react narrowly.
    const eventType = nextStage.is_won
      ? 'opportunity.won'
      : nextStage.is_lost
        ? 'opportunity.lost'
        : 'opportunity.stage_changed'
    void emitOpportunityEvent(current.org_id as string, eventType, {
      opportunity_id: id,
      from_stage_id: current.stage_id as string,
      to_stage_id: stageId,
    })
  }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
}

// ─── Activities ──────────────────────────────────────────────────────────────

export interface ActivityWithMeta extends ActivityRow {
  call_log?: {
    id: string
    direction: 'inbound' | 'outbound'
    duration_seconds: number | null
    status: string | null
    recording_url: string | null
    started_at: string | null
  } | null
  conversation?: {
    id: string
    channel: string
    last_message: string | null
  } | null
}

export async function getActivities(
  opportunityId: string,
): Promise<ActivityWithMeta[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from('opportunity_activities')
    .select(
      `*,
       call_log:call_logs(id, direction, duration_seconds, status, recording_url, started_at),
       conversation:conversations(id, channel, last_message)`,
    )
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: false })
    .limit(200)
  return (data as unknown as ActivityWithMeta[]) ?? []
}

export async function addNote(
  opportunityId: string,
  content: string,
): Promise<{ id?: string; error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const parsed = noteSchema.safeParse({ content })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid note' }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No organization found.' }

  const { data, error } = await supabase
    .from('opportunity_activities')
    .insert({
      org_id: orgId,
      opportunity_id: opportunityId,
      type: 'note',
      content: parsed.data.content,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !data) return { error: error?.message ?? 'Insert failed' }

  // SEED-036: fire opportunity.note_added so workflows can react to manual notes.
  void emitOpportunityEvent(orgId, 'opportunity.note_added', {
    opportunity_id: opportunityId,
    note: { content: parsed.data.content },
  })

  revalidatePath(`/pipeline/${opportunityId}`)
  return { id: data.id }
}

// ─── Metrics (home dashboard widget) ─────────────────────────────────────────

export interface PipelineMetrics {
  totalOpenValue: number
  wonThisMonth: { count: number; value: number }
  lostThisMonth: { count: number; value: number }
  conversionRate: number // 0..1
  perStage: Array<{ stage_id: string; name: string; color: string; count: number; value: number }>
}

export async function getPipelineMetrics(pipelineId?: string): Promise<PipelineMetrics> {
  const empty: PipelineMetrics = {
    totalOpenValue: 0,
    wonThisMonth: { count: 0, value: 0 },
    lostThisMonth: { count: 0, value: 0 },
    conversionRate: 0,
    perStage: [],
  }
  try {
    const user = await getUser()
    if (!user) return empty
    const supabase = await createClient()

    // Resolve a pipeline (defaults to is_default)
    let pipId = pipelineId
    if (!pipId) {
      const { data } = await supabase
        .from('pipelines')
        .select('id')
        .order('is_default', { ascending: false })
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle()
      pipId = data?.id
    }
    if (!pipId) return empty

    // Stages for the chart
    const { data: stages } = await supabase
      .from('pipeline_stages')
      .select('id, name, color, is_won, is_lost')
      .eq('pipeline_id', pipId)
      .order('position', { ascending: true })

    // Pull all opps in this pipeline | counts are small at the per-org scale we
    // optimise for (thousands not millions). Worth revisiting if this widget
    // ever lives in a high-traffic dashboard.
    const { data: opps } = await supabase
      .from('opportunities')
      .select('id, value, status, stage_id, created_at, updated_at')
      .eq('pipeline_id', pipId)

  const list = opps ?? []
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  let totalOpen = 0
  let wonCount = 0
  let wonValue = 0
  let lostCount = 0
  let lostValue = 0
  for (const o of list) {
    if (o.status === 'open') totalOpen += Number(o.value ?? 0)
    if (new Date(o.updated_at) >= monthStart) {
      if (o.status === 'won') {
        wonCount++
        wonValue += Number(o.value ?? 0)
      }
      if (o.status === 'lost') {
        lostCount++
        lostValue += Number(o.value ?? 0)
      }
    }
  }
  const closedThisMonth = wonCount + lostCount
  const conversionRate = closedThisMonth > 0 ? wonCount / closedThisMonth : 0

  const perStage: PipelineMetrics['perStage'] = (stages ?? []).map((s) => {
    const inStage = list.filter((o) => o.stage_id === s.id)
    return {
      stage_id: s.id,
      name: s.name,
      color: s.color,
      count: inStage.length,
      value: inStage.reduce((acc, o) => acc + Number(o.value ?? 0), 0),
    }
  })

    return {
      totalOpenValue: totalOpen,
      wonThisMonth: { count: wonCount, value: wonValue },
      lostThisMonth: { count: lostCount, value: lostValue },
      conversionRate,
      perStage,
    }
  } catch {
    // Pipeline tables missing / RLS error | render the empty state instead
    // of crashing the home dashboard.
    return empty
  }
}

// ─── Contact lookup for opportunity-create autocomplete ──────────────────────

export async function searchContactsForOpportunity(q: string): Promise<
  Array<{ id: string; first_name: string | null; last_name: string | null; name: string | null; phone: string | null; email: string | null }>
> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  let query = supabase.from('contacts').select('id, first_name, last_name, name, phone, email').limit(10)
  if (q && q.trim()) {
    const escaped = q.trim().replace(/[%_]/g, (m) => `\\${m}`)
    query = query.or(
      [
        `first_name.ilike.%${escaped}%`,
        `last_name.ilike.%${escaped}%`,
        `name.ilike.%${escaped}%`,
        `phone.ilike.%${escaped}%`,
        `email.ilike.%${escaped}%`,
      ].join(','),
    )
  } else {
    query = query.order('created_at', { ascending: false })
  }
  const { data } = await query
  return data ?? []
}

// ─── Export (CF-13) ──────────────────────────────────────────────────────────

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export async function exportOpportunitiesCsv(): Promise<{ error?: string; csv?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  const [{ data: opps }, defsResult] = await Promise.all([
    supabase
      .from('opportunities')
      .select('*, pipeline_stages(name)')
      .order('created_at', { ascending: false })
      .limit(5000),
    getDefinitions({ entity: 'opportunity', includeArchived: false }),
  ])
  if (!opps) return { error: 'Failed to fetch opportunities.' }
  const defs = defsResult.ok ? defsResult.data : []

  const stdHeaders = ['title', 'value', 'currency', 'status', 'stage', 'expected_close_date', 'created_at']
  const cfHeaders: string[] = []
  for (const def of defs) {
    if (def.type === 'currency') {
      cfHeaders.push(`${def.key}_amount`, `${def.key}_currency`)
    } else {
      cfHeaders.push(def.label)
    }
  }

  const lines: string[] = [[...stdHeaders, ...cfHeaders].map(csvEscape).join(',')]

  for (const o of opps) {
    const cf = (o.custom_fields ?? {}) as Record<string, unknown>
    const stage = (o as unknown as { pipeline_stages?: { name: string } | null }).pipeline_stages
    const row: string[] = [
      o.title ?? '',
      String(o.value ?? ''),
      o.currency ?? '',
      o.status ?? '',
      stage?.name ?? '',
      o.expected_close_date ?? '',
      o.created_at ?? '',
    ]
    for (const def of defs) {
      const val = cf[def.key]
      if (def.type === 'currency') {
        const curr = val as { amount?: number; currency?: string } | null | undefined
        row.push(String(curr?.amount ?? ''), curr?.currency ?? '')
      } else {
        const config = FIELD_RENDER_CONFIG[def.type as CustomFieldType]
        row.push(val !== undefined && val !== null ? config.displayFormatter(val) : '')
      }
    }
    lines.push(row.map(csvEscape).join(','))
  }

  return { csv: lines.join('\n') }
}

// ─── Card Layout ──────────────────────────────────────────────────────────────

export async function updatePipelineCardFields(
  pipelineId: string,
  fields: string[],
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('pipelines')
    .update({ card_fields: fields, updated_at: new Date().toISOString() })
    .eq('id', pipelineId)
  if (error) return { error: error.message }
  revalidatePath('/pipeline')
  revalidatePath('/pipeline/settings')
}
