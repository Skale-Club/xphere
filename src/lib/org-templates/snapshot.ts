import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type {
  OrgTemplateAssetGroup,
  OrgTemplateSnapshot,
  SnapshotPipeline,
  SnapshotWorkflow,
} from './types'

type Client = SupabaseClient<Database>

/**
 * Capture a STRUCTURE-ONLY snapshot of the caller's current organization.
 *
 * `supabase` MUST be an RLS-scoped client (the authenticated server client), so
 * every read is automatically constrained to the active org — there is no way
 * to capture another tenant's rows. Only the requested asset groups are read.
 *
 * Never reads: contacts, conversations, messages, bookings, calls, logs,
 * credentials, phone numbers, or connected accounts.
 */
export async function captureOrgSnapshot(
  supabase: Client,
  groups: OrgTemplateAssetGroup[]
): Promise<OrgTemplateSnapshot> {
  const snapshot: OrgTemplateSnapshot = {}
  const want = new Set(groups)

  if (want.has('pipelines')) {
    snapshot.pipelines = await capturePipelines(supabase)
  }

  if (want.has('custom_fields')) {
    const { data } = await supabase
      .from('custom_field_definitions')
      .select(
        'entity, key, label, type, required, unique_per_org, position, group_name, help_text, default_value, options, validation, visible_in_list, filterable'
      )
      .eq('archived', false)
      .order('position')
    snapshot.custom_fields = (data ?? []).map((f) => ({
      entity: f.entity as 'contact' | 'opportunity' | 'account',
      key: f.key,
      label: f.label,
      type: f.type as string,
      required: f.required,
      unique_per_org: f.unique_per_org,
      position: f.position,
      group_name: f.group_name,
      help_text: f.help_text,
      default_value: f.default_value,
      options: f.options,
      validation: f.validation,
      visible_in_list: f.visible_in_list,
      filterable: f.filterable,
    }))
  }

  if (want.has('tags')) {
    const { data } = await supabase
      .from('tags')
      .select('name, slug, color')
      .order('name')
    snapshot.tags = (data ?? []).map((t) => ({
      name: t.name,
      slug: t.slug,
      color: t.color,
    }))
  }

  if (want.has('message_templates')) {
    const { data } = await supabase
      .from('email_templates')
      .select(
        'name, description, subject_line, preview_text, ai_prompt, status, tags, document, html_snapshot, plain_text_snapshot'
      )
      .order('name')
    snapshot.message_templates = (data ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      subject_line: t.subject_line,
      preview_text: t.preview_text,
      ai_prompt: t.ai_prompt,
      status: t.status,
      tags: t.tags ?? [],
      document: t.document,
      html_snapshot: t.html_snapshot,
      plain_text_snapshot: t.plain_text_snapshot,
    }))
  }

  if (want.has('workflows')) {
    snapshot.workflows = await captureWorkflows(supabase)
  }

  return snapshot
}

async function capturePipelines(supabase: Client): Promise<SnapshotPipeline[]> {
  const { data: pipelines } = await supabase
    .from('pipelines')
    .select('id, name, is_default, position')
    .order('position')
  if (!pipelines || pipelines.length === 0) return []

  const { data: stages } = await supabase
    .from('pipeline_stages')
    .select('pipeline_id, name, position, color, is_won, is_lost')
    .order('position')

  const stagesByPipeline = new Map<string, typeof stages>()
  for (const s of stages ?? []) {
    const list = stagesByPipeline.get(s.pipeline_id) ?? []
    list.push(s)
    stagesByPipeline.set(s.pipeline_id, list)
  }

  return pipelines.map((p) => ({
    name: p.name,
    is_default: p.is_default,
    position: p.position,
    stages: (stagesByPipeline.get(p.id) ?? []).map((s) => ({
      name: s.name,
      position: s.position,
      color: s.color,
      is_won: s.is_won,
      is_lost: s.is_lost,
    })),
  }))
}

async function captureWorkflows(supabase: Client): Promise<SnapshotWorkflow[]> {
  const { data: workflows } = await supabase
    .from('workflows')
    .select(
      'id, name, slug, description, kind, tool_name, trigger_type, trigger_config, current_version_id'
    )
    .order('name')
  if (!workflows || workflows.length === 0) return []

  const versionIds = workflows
    .map((w) => w.current_version_id)
    .filter((id): id is string => !!id)

  const definitions = new Map<string, unknown>()
  if (versionIds.length > 0) {
    const { data: versions } = await supabase
      .from('workflow_versions')
      .select('id, definition')
      .in('id', versionIds)
    for (const v of versions ?? []) definitions.set(v.id, v.definition)
  }

  return workflows.map((w) => ({
    name: w.name,
    slug: w.slug,
    description: w.description,
    kind: (w.kind as 'tool' | 'flow') ?? 'flow',
    tool_name: w.tool_name,
    trigger_type:
      (w.trigger_type as SnapshotWorkflow['trigger_type']) ?? 'manual',
    trigger_config: (w.trigger_config as Record<string, unknown>) ?? {},
    definition: w.current_version_id
      ? definitions.get(w.current_version_id) ?? null
      : null,
  }))
}
