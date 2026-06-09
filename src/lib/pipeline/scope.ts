// SEED-036: builds the {{opportunity.*}} / {{contact.*}} / {{stage.*}} /
// {{pipeline.*}} variable scope consumed by pipeline-triggered workflows.
// Mirrors src/lib/calendar/scope.ts (buildMeetingScope).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface OpportunityScopeOpportunity {
  id: string
  title: string | null
  value: number | null
  currency: string | null
  status: string | null
  expected_close_date: string | null
  assigned_to: string | null
  pipeline_id: string | null
  stage_id: string | null
  contact_id: string | null
  account_id: string | null
  created_at: string | null
  updated_at: string | null
  custom_fields: Record<string, unknown>
}

export interface OpportunityScopeContact {
  id: string | null
  name: string | null
  phone: string | null
  email: string | null
  company: string | null
}

export interface OpportunityScopeStage {
  id: string | null
  name: string | null
  color: string | null
  is_won: boolean
  is_lost: boolean
  from?: { id: string | null; name: string | null } | null
  to?: { id: string | null; name: string | null } | null
}

export interface OpportunityScopePipeline {
  id: string | null
  name: string | null
}

export interface OpportunityScope {
  opportunity: OpportunityScopeOpportunity
  contact: OpportunityScopeContact
  stage: OpportunityScopeStage
  pipeline: OpportunityScopePipeline
}

export interface BuildOpportunityScopeArgs {
  opportunityId: string
  eventType: string
  /** Pre-fetched snapshot used when the row no longer exists (e.g. deleted). */
  snapshot?: Record<string, unknown>
  /** Optional explicit stage transition (overrides current_stage for stage.from/to). */
  fromStageId?: string | null
  toStageId?: string | null
}

const EMPTY_CONTACT: OpportunityScopeContact = {
  id: null,
  name: null,
  phone: null,
  email: null,
  company: null,
}

const EMPTY_STAGE: OpportunityScopeStage = {
  id: null,
  name: null,
  color: null,
  is_won: false,
  is_lost: false,
}

const EMPTY_PIPELINE: OpportunityScopePipeline = { id: null, name: null }

export async function buildOpportunityScope(
  supabase: SupabaseClient<Database>,
  args: BuildOpportunityScopeArgs,
): Promise<OpportunityScope> {
  const { opportunityId, snapshot, fromStageId, toStageId } = args

  let oppRow: Record<string, unknown> | null = null

  const { data } = await supabase
    .from('opportunities')
    .select(
      'id, title, value, currency, status, expected_close_date, assigned_to, pipeline_id, stage_id, contact_id, account_id, created_at, updated_at, custom_fields',
    )
    .eq('id', opportunityId)
    .maybeSingle()

  if (data) {
    oppRow = data as unknown as Record<string, unknown>
  } else if (snapshot) {
    oppRow = snapshot
  }

  if (!oppRow) {
    return {
      opportunity: {
        id: opportunityId,
        title: null,
        value: null,
        currency: null,
        status: null,
        expected_close_date: null,
        assigned_to: null,
        pipeline_id: null,
        stage_id: null,
        contact_id: null,
        account_id: null,
        created_at: null,
        updated_at: null,
        custom_fields: {},
      },
      contact: { ...EMPTY_CONTACT },
      stage: { ...EMPTY_STAGE },
      pipeline: { ...EMPTY_PIPELINE },
    }
  }

  const opportunity: OpportunityScopeOpportunity = {
    id: (oppRow.id as string) ?? opportunityId,
    title: (oppRow.title as string | null) ?? null,
    value: typeof oppRow.value === 'number' ? oppRow.value : Number(oppRow.value ?? 0),
    currency: (oppRow.currency as string | null) ?? null,
    status: (oppRow.status as string | null) ?? null,
    expected_close_date: (oppRow.expected_close_date as string | null) ?? null,
    assigned_to: (oppRow.assigned_to as string | null) ?? null,
    pipeline_id: (oppRow.pipeline_id as string | null) ?? null,
    stage_id: (oppRow.stage_id as string | null) ?? null,
    contact_id: (oppRow.contact_id as string | null) ?? null,
    account_id: (oppRow.account_id as string | null) ?? null,
    created_at: (oppRow.created_at as string | null) ?? null,
    updated_at: (oppRow.updated_at as string | null) ?? null,
    custom_fields: (oppRow.custom_fields as Record<string, unknown>) ?? {},
  }

  // Parallel hydration of contact + stage + pipeline (+ stage.from when given).
  const [contactRes, stageRes, pipelineRes, fromStageRes, toStageRes] = await Promise.all([
    opportunity.contact_id
      ? supabase
          .from('contacts')
          .select('id, name, phone, email, company')
          .eq('id', opportunity.contact_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    opportunity.stage_id
      ? supabase
          .from('pipeline_stages')
          .select('id, name, color, is_won, is_lost')
          .eq('id', opportunity.stage_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    opportunity.pipeline_id
      ? supabase
          .from('pipelines')
          .select('id, name')
          .eq('id', opportunity.pipeline_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    fromStageId
      ? supabase
          .from('pipeline_stages')
          .select('id, name')
          .eq('id', fromStageId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    toStageId
      ? supabase
          .from('pipeline_stages')
          .select('id, name')
          .eq('id', toStageId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const contactData = (contactRes as { data: OpportunityScopeContact | null }).data
  const stageData = (stageRes as {
    data: { id: string; name: string; color: string; is_won: boolean; is_lost: boolean } | null
  }).data
  const pipelineData = (pipelineRes as { data: { id: string; name: string } | null }).data
  const fromStageData = (fromStageRes as { data: { id: string; name: string } | null }).data
  const toStageData = (toStageRes as { data: { id: string; name: string } | null }).data

  const stage: OpportunityScopeStage = stageData
    ? {
        id: stageData.id,
        name: stageData.name,
        color: stageData.color,
        is_won: stageData.is_won,
        is_lost: stageData.is_lost,
      }
    : { ...EMPTY_STAGE }

  if (fromStageData) {
    stage.from = { id: fromStageData.id, name: fromStageData.name }
  }
  if (toStageData) {
    stage.to = { id: toStageData.id, name: toStageData.name }
  }

  const pipeline: OpportunityScopePipeline = pipelineData
    ? { id: pipelineData.id, name: pipelineData.name }
    : { ...EMPTY_PIPELINE }

  const contact: OpportunityScopeContact = contactData
    ? {
        id: contactData.id ?? null,
        name: contactData.name ?? null,
        phone: contactData.phone ?? null,
        email: contactData.email ?? null,
        company: contactData.company ?? null,
      }
    : { ...EMPTY_CONTACT }

  return { opportunity, contact, stage, pipeline }
}
