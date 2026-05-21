// SEED-036: executors for pipeline_* workflow action nodes.
//
// These functions are called by src/lib/action-engine/execute-action.ts when
// a workflow node of kind pipeline_move_opportunity / pipeline_update_opportunity /
// pipeline_mark_won / pipeline_mark_lost / pipeline_add_note / pipeline_assign_user /
// pipeline_create_opportunity is reached.
//
// They use ctx.supabase (RLS-scoped when called inside a user request, or
// service-role from the workflow runner) and ctx.organizationId. Each throws
// on failure with a descriptive message | the action runner catches and
// surfaces the message.

import type { ActionContext } from '@/lib/action-engine/execute-action'
import type { Database, OpportunityStatus } from '@/types/database'

type SupabaseClientT = ActionContext['supabase']

// ─── helpers ─────────────────────────────────────────────────────────────────

async function loadOpportunity(supabase: SupabaseClientT, opportunityId: string) {
  const { data, error } = await supabase
    .from('opportunities')
    .select('id, org_id, pipeline_id, stage_id, status, value')
    .eq('id', opportunityId)
    .maybeSingle()
  if (error || !data) {
    throw new Error(`opportunity not found: ${opportunityId}`)
  }
  return data
}

async function resolveStage(
  supabase: SupabaseClientT,
  pipelineId: string,
  { stage_id, stage_name }: { stage_id?: string; stage_name?: string },
): Promise<{ id: string; name: string; is_won: boolean; is_lost: boolean }> {
  if (stage_id) {
    const { data, error } = await supabase
      .from('pipeline_stages')
      .select('id, name, is_won, is_lost, pipeline_id')
      .eq('id', stage_id)
      .maybeSingle()
    if (error || !data) throw new Error(`stage not found: ${stage_id}`)
    return { id: data.id, name: data.name, is_won: data.is_won, is_lost: data.is_lost }
  }
  if (stage_name) {
    const { data, error } = await supabase
      .from('pipeline_stages')
      .select('id, name, is_won, is_lost')
      .eq('pipeline_id', pipelineId)
      .ilike('name', stage_name)
      .limit(1)
      .maybeSingle()
    if (error || !data) {
      throw new Error(`stage "${stage_name}" not found in pipeline ${pipelineId}`)
    }
    return { id: data.id, name: data.name, is_won: data.is_won, is_lost: data.is_lost }
  }
  throw new Error('stage_id or stage_name is required')
}

function requireOrgCtx(ctx?: ActionContext): asserts ctx is ActionContext {
  if (!ctx?.organizationId || !ctx?.supabase) {
    throw new Error('pipeline action requires ctx.organizationId and ctx.supabase')
  }
}

// ─── pipeline_move_opportunity ───────────────────────────────────────────────

export interface PipelineMoveOpportunityParams {
  opportunity_id: string
  stage_id?: string
  stage_name?: string
}

export async function executePipelineMoveOpportunity(
  params: PipelineMoveOpportunityParams,
  ctx?: ActionContext,
): Promise<string> {
  requireOrgCtx(ctx)
  const opp = await loadOpportunity(ctx.supabase, String(params.opportunity_id))
  const stage = await resolveStage(ctx.supabase, opp.pipeline_id as string, {
    stage_id: params.stage_id ? String(params.stage_id) : undefined,
    stage_name: params.stage_name ? String(params.stage_name) : undefined,
  })

  if (opp.stage_id === stage.id) {
    return `Opportunity ${opp.id} is already in stage ${stage.name}.`
  }

  let nextStatus: OpportunityStatus = (opp.status as OpportunityStatus) ?? 'open'
  if (stage.is_won) nextStatus = 'won'
  else if (stage.is_lost) nextStatus = 'lost'
  else if (nextStatus !== 'open') nextStatus = 'open'

  // Append to bottom of destination stage.
  const { data: maxRow } = await ctx.supabase
    .from('opportunities')
    .select('position')
    .eq('stage_id', stage.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = (maxRow?.position ?? -1) + 1

  const { error: updErr } = await ctx.supabase
    .from('opportunities')
    .update({ stage_id: stage.id, status: nextStatus, position: nextPos })
    .eq('id', opp.id)
  if (updErr) throw new Error(`failed to move opportunity: ${updErr.message}`)

  await ctx.supabase.from('opportunity_activities').insert({
    org_id: opp.org_id,
    opportunity_id: opp.id,
    type: stage.is_won ? 'won' : stage.is_lost ? 'lost' : 'stage_change',
    content: `Moved to ${stage.name} (workflow)`,
    metadata: {
      from_stage_id: opp.stage_id,
      to_stage_id: stage.id,
      to_stage_name: stage.name,
      source: 'workflow',
    },
  })

  return `Opportunity moved to ${stage.name}.`
}

// ─── pipeline_update_opportunity ─────────────────────────────────────────────

export interface PipelineUpdateOpportunityParams {
  opportunity_id: string
  title?: string
  value?: number
  expected_close_date?: string
  assigned_to?: string
  status?: OpportunityStatus
}

export async function executePipelineUpdateOpportunity(
  params: PipelineUpdateOpportunityParams,
  ctx?: ActionContext,
): Promise<string> {
  requireOrgCtx(ctx)
  const patch: Database['public']['Tables']['opportunities']['Update'] = {}
  if (params.title !== undefined) patch.title = String(params.title)
  if (params.value !== undefined) patch.value = Number(params.value)
  if (params.expected_close_date !== undefined)
    patch.expected_close_date = String(params.expected_close_date)
  if (params.assigned_to !== undefined) patch.assigned_to = String(params.assigned_to)
  if (params.status !== undefined) patch.status = params.status

  if (Object.keys(patch).length === 0) {
    return 'No fields to update.'
  }

  const { error } = await ctx.supabase
    .from('opportunities')
    .update(patch)
    .eq('id', String(params.opportunity_id))
  if (error) throw new Error(`failed to update opportunity: ${error.message}`)
  return `Opportunity updated (${Object.keys(patch).join(', ')}).`
}

// ─── pipeline_mark_won / pipeline_mark_lost ──────────────────────────────────

async function moveToTerminalStage(
  ctx: ActionContext,
  opportunityId: string,
  flag: 'is_won' | 'is_lost',
  reason?: string,
): Promise<string> {
  const opp = await loadOpportunity(ctx.supabase, opportunityId)
  const { data: stage, error } = await ctx.supabase
    .from('pipeline_stages')
    .select('id, name, is_won, is_lost')
    .eq('pipeline_id', opp.pipeline_id as string)
    .eq(flag, true)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !stage) {
    throw new Error(`no ${flag} stage configured for pipeline ${opp.pipeline_id}`)
  }

  await executePipelineMoveOpportunity(
    { opportunity_id: opportunityId, stage_id: stage.id },
    ctx,
  )

  if (reason) {
    await ctx.supabase.from('opportunity_activities').insert({
      org_id: opp.org_id,
      opportunity_id: opportunityId,
      type: 'note',
      content: `Reason: ${reason}`,
    })
  }

  return `Opportunity marked ${flag === 'is_won' ? 'won' : 'lost'}.`
}

export interface PipelineMarkWonParams {
  opportunity_id: string
}

export async function executePipelineMarkWon(
  params: PipelineMarkWonParams,
  ctx?: ActionContext,
): Promise<string> {
  requireOrgCtx(ctx)
  return moveToTerminalStage(ctx, String(params.opportunity_id), 'is_won')
}

export interface PipelineMarkLostParams {
  opportunity_id: string
  reason?: string
}

export async function executePipelineMarkLost(
  params: PipelineMarkLostParams,
  ctx?: ActionContext,
): Promise<string> {
  requireOrgCtx(ctx)
  return moveToTerminalStage(
    ctx,
    String(params.opportunity_id),
    'is_lost',
    params.reason ? String(params.reason) : undefined,
  )
}

// ─── pipeline_add_note ───────────────────────────────────────────────────────

export interface PipelineAddNoteParams {
  opportunity_id: string
  content: string
}

export async function executePipelineAddNote(
  params: PipelineAddNoteParams,
  ctx?: ActionContext,
): Promise<string> {
  requireOrgCtx(ctx)
  const content = String(params.content ?? '').trim()
  if (!content) throw new Error('content is required')
  const opp = await loadOpportunity(ctx.supabase, String(params.opportunity_id))
  const { error } = await ctx.supabase.from('opportunity_activities').insert({
    org_id: opp.org_id,
    opportunity_id: opp.id,
    type: 'note',
    content,
  })
  if (error) throw new Error(`failed to add note: ${error.message}`)
  return 'Note added.'
}

// ─── pipeline_assign_user ────────────────────────────────────────────────────

export interface PipelineAssignUserParams {
  opportunity_id: string
  user_id: string
}

export async function executePipelineAssignUser(
  params: PipelineAssignUserParams,
  ctx?: ActionContext,
): Promise<string> {
  requireOrgCtx(ctx)
  const userId = String(params.user_id ?? '').trim()
  if (!userId) throw new Error('user_id is required')
  const { error } = await ctx.supabase
    .from('opportunities')
    .update({ assigned_to: userId })
    .eq('id', String(params.opportunity_id))
  if (error) throw new Error(`failed to assign opportunity: ${error.message}`)
  return `Opportunity assigned to ${userId}.`
}

// ─── pipeline_create_opportunity ─────────────────────────────────────────────

export interface PipelineCreateOpportunityParams {
  title: string
  pipeline_id?: string
  stage_id?: string
  stage_name?: string
  contact_id?: string
  contact_phone?: string
  value?: number
  assigned_to?: string
}

export async function executePipelineCreateOpportunity(
  params: PipelineCreateOpportunityParams,
  ctx?: ActionContext,
): Promise<string> {
  requireOrgCtx(ctx)
  const title = String(params.title ?? '').trim()
  if (!title) throw new Error('title is required')

  // Resolve pipeline (defaults to is_default for the org).
  let pipelineId = params.pipeline_id ? String(params.pipeline_id) : undefined
  if (!pipelineId) {
    const { data: defaultPipe } = await ctx.supabase
      .from('pipelines')
      .select('id')
      .order('is_default', { ascending: false })
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!defaultPipe) throw new Error('no pipeline configured for org')
    pipelineId = defaultPipe.id as string
  }

  // Resolve stage (id, name, or first stage of pipeline).
  let stageId: string
  if (params.stage_id) {
    stageId = String(params.stage_id)
  } else if (params.stage_name) {
    const stage = await resolveStage(ctx.supabase, pipelineId, {
      stage_name: String(params.stage_name),
    })
    stageId = stage.id
  } else {
    const { data: firstStage } = await ctx.supabase
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!firstStage) throw new Error(`pipeline ${pipelineId} has no stages`)
    stageId = firstStage.id as string
  }

  // Resolve contact (id or phone lookup).
  let contactId: string | null = params.contact_id ? String(params.contact_id) : null
  if (!contactId && params.contact_phone) {
    const phone = String(params.contact_phone).trim()
    const { data: existing } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .maybeSingle()
    if (existing) {
      contactId = existing.id as string
    }
  }

  const { data: maxRow } = await ctx.supabase
    .from('opportunities')
    .select('position')
    .eq('stage_id', stageId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPos = (maxRow?.position ?? -1) + 1

  const insert: Database['public']['Tables']['opportunities']['Insert'] = {
    org_id: ctx.organizationId,
    pipeline_id: pipelineId,
    stage_id: stageId,
    title,
    contact_id: contactId,
    value: params.value !== undefined ? Number(params.value) : 0,
    assigned_to: params.assigned_to ? String(params.assigned_to) : null,
    position: nextPos,
  }

  const { data: inserted, error } = await ctx.supabase
    .from('opportunities')
    .insert(insert)
    .select('id')
    .single()
  if (error || !inserted) throw new Error(`failed to create opportunity: ${error?.message}`)

  await ctx.supabase.from('opportunity_activities').insert({
    org_id: ctx.organizationId,
    opportunity_id: inserted.id,
    type: 'created',
    content: `Opportunity created via workflow: ${title}`,
  })

  return `Opportunity created: ${inserted.id}`
}
