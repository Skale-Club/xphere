import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  emptyCounts,
  type ChecklistItem,
  type InstallCounts,
  type InstallSummary,
  type OrgTemplateAssetGroup,
  type OrgTemplateSnapshot,
} from './types'

type Admin = SupabaseClient<Database>

const EMPTY_FLOW = { nodes: [], edges: [], variables: [], metadata: {} }

/**
 * Copy the STRUCTURAL assets of a template snapshot into a freshly-created
 * organization. Runs with a service-role client because the target org is not
 * the caller's active org.
 *
 * Safety rules baked in here:
 *  - Only the requested asset groups are copied.
 *  - Workflows are ALWAYS imported as drafts (is_active = false) and never
 *    overwrite a platform-default workflow already seeded into the new org.
 *  - Nothing else (contacts, conversations, credentials, phone numbers, …) is
 *    ever touched — the snapshot simply doesn't carry it.
 */
export async function installSnapshotIntoOrg(
  admin: Admin,
  targetOrgId: string,
  snapshot: OrgTemplateSnapshot,
  groups: OrgTemplateAssetGroup[],
  createdBy: string | null
): Promise<InstallSummary> {
  const counts = emptyCounts()
  const want = new Set(groups)

  if (want.has('pipelines') && snapshot.pipelines?.length) {
    await installPipelines(admin, targetOrgId, snapshot, counts)
  }

  if (want.has('custom_fields') && snapshot.custom_fields?.length) {
    await installCustomFields(admin, targetOrgId, snapshot, createdBy, counts)
  }

  if (want.has('tags') && snapshot.tags?.length) {
    await installTags(admin, targetOrgId, snapshot, createdBy, counts)
  }

  if (want.has('message_templates') && snapshot.message_templates?.length) {
    await installMessageTemplates(admin, targetOrgId, snapshot, createdBy, counts)
  }

  if (want.has('workflows') && snapshot.workflows?.length) {
    await installWorkflows(admin, targetOrgId, snapshot, createdBy, counts)
  }

  return { counts, checklist: buildChecklist(groups, counts) }
}

async function installPipelines(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  counts: InstallCounts
) {
  // A brand-new org is auto-seeded with a default "Sales" pipeline by a DB
  // trigger. Since the template defines its own pipelines and the new org has
  // no opportunities yet, clear those seeded pipelines so the template's
  // structure lands cleanly without leaving two competing defaults.
  await admin.from('pipelines').delete().eq('org_id', orgId)

  for (const p of snapshot.pipelines ?? []) {
    const { data: pipeline } = await admin
      .from('pipelines')
      .insert({
        org_id: orgId,
        name: p.name,
        is_default: p.is_default,
        position: p.position,
      })
      .select('id')
      .single()
    if (!pipeline) continue
    counts.pipelines += 1

    if (p.stages.length) {
      const { data: inserted } = await admin
        .from('pipeline_stages')
        .insert(
          p.stages.map((s) => ({
            pipeline_id: pipeline.id,
            org_id: orgId,
            name: s.name,
            position: s.position,
            color: s.color,
            is_won: s.is_won,
            is_lost: s.is_lost,
          }))
        )
        .select('id')
      counts.stages += inserted?.length ?? 0
    }
  }
}

async function installCustomFields(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  createdBy: string | null,
  counts: InstallCounts
) {
  const rows = (snapshot.custom_fields ?? []).map((f) => ({
    org_id: orgId,
    entity: f.entity,
    key: f.key,
    label: f.label,
    type: f.type as Database['public']['Tables']['custom_field_definitions']['Insert']['type'],
    required: f.required,
    unique_per_org: f.unique_per_org,
    position: f.position,
    group_name: f.group_name,
    help_text: f.help_text,
    default_value: f.default_value as Database['public']['Tables']['custom_field_definitions']['Insert']['default_value'],
    options: f.options as Database['public']['Tables']['custom_field_definitions']['Insert']['options'],
    validation: f.validation as Database['public']['Tables']['custom_field_definitions']['Insert']['validation'],
    visible_in_list: f.visible_in_list,
    filterable: f.filterable,
    created_by: createdBy,
  }))
  if (!rows.length) return
  // The target org is freshly created, so there are no pre-existing rows to
  // collide with — a single batch insert is safe and accurate.
  const { data, error } = await admin.from('custom_field_definitions').insert(rows).select('id')
  if (error) {
    console.warn('[org-templates] custom field import failed:', error.message)
    return
  }
  counts.custom_fields += data?.length ?? 0
}

async function installTags(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  createdBy: string | null,
  counts: InstallCounts
) {
  const rows = (snapshot.tags ?? []).map((t) => ({
    org_id: orgId,
    name: t.name,
    slug: t.slug,
    color: t.color,
    created_by: createdBy,
  }))
  if (!rows.length) return
  const { data, error } = await admin.from('tags').insert(rows).select('id')
  if (error) {
    console.warn('[org-templates] tag import failed:', error.message)
    return
  }
  counts.tags += data?.length ?? 0
}

async function installMessageTemplates(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  createdBy: string | null,
  counts: InstallCounts
) {
  const rows = (snapshot.message_templates ?? []).map((m) => ({
    org_id: orgId,
    name: m.name,
    description: m.description,
    subject_line: m.subject_line,
    preview_text: m.preview_text,
    ai_prompt: m.ai_prompt,
    // Imported templates start as drafts regardless of source status.
    status: 'draft',
    tags: m.tags,
    document: m.document as Database['public']['Tables']['email_templates']['Insert']['document'],
    html_snapshot: m.html_snapshot,
    plain_text_snapshot: m.plain_text_snapshot,
    created_by: createdBy,
  }))
  if (!rows.length) return
  const { data, error } = await admin.from('email_templates').insert(rows).select('id')
  if (error) {
    console.warn('[org-templates] message template import failed:', error.message)
    return
  }
  counts.message_templates += data?.length ?? 0
}

async function installWorkflows(
  admin: Admin,
  orgId: string,
  snapshot: OrgTemplateSnapshot,
  createdBy: string | null,
  counts: InstallCounts
) {
  // Slugs already present (e.g. freshly-seeded platform defaults) are left
  // untouched — we never overwrite them, and custom template workflows land as
  // drafts alongside.
  const { data: existing } = await admin
    .from('workflows')
    .select('slug')
    .eq('org_id', orgId)
  const taken = new Set((existing ?? []).map((w) => w.slug))

  for (const w of snapshot.workflows ?? []) {
    if (taken.has(w.slug)) continue

    const { data: workflow, error: wErr } = await admin
      .from('workflows')
      .insert({
        org_id: orgId,
        name: w.name,
        slug: w.slug,
        description: w.description,
        // NON-NEGOTIABLE: imported workflows never start active.
        is_active: false,
        kind: w.kind,
        tool_name: w.kind === 'tool' ? w.tool_name : null,
        trigger_type: w.trigger_type,
        trigger_config: w.trigger_config as Database['public']['Tables']['workflows']['Insert']['trigger_config'],
        created_by: createdBy,
      })
      .select('id')
      .single()
    if (wErr || !workflow) {
      if (wErr) console.warn(`[org-templates] workflow import failed (${w.slug}):`, wErr.message)
      continue
    }
    taken.add(w.slug)

    const definition = (w.definition ?? EMPTY_FLOW) as Database['public']['Tables']['workflow_versions']['Insert']['definition']
    const { data: version } = await admin
      .from('workflow_versions')
      .insert({
        workflow_id: workflow.id,
        version_number: 1,
        definition,
        notes: 'Imported from organization template (draft)',
        created_by: createdBy,
      })
      .select('id')
      .single()

    if (version) {
      await admin
        .from('workflows')
        .update({ current_version_id: version.id })
        .eq('id', workflow.id)
    }
    counts.workflows += 1
  }
}

function buildChecklist(
  groups: OrgTemplateAssetGroup[],
  counts: InstallCounts
): ChecklistItem[] {
  const want = new Set(groups)
  const items: ChecklistItem[] = [
    {
      id: 'integrations',
      label:
        'Connect required integrations (Vapi, GoHighLevel, Meta, Twilio, email, …) — none are copied from a template.',
      done: false,
    },
    {
      id: 'phone_numbers',
      label: 'Assign and configure phone number(s) for this organization.',
      done: false,
    },
  ]

  if (want.has('workflows') && counts.workflows > 0) {
    items.push({
      id: 'workflows',
      label: `Review and activate the ${counts.workflows} imported workflow(s) — they were imported as drafts and are inactive.`,
      done: false,
    })
  }
  if (want.has('pipelines') && counts.pipelines > 0) {
    items.push({
      id: 'pipelines',
      label: 'Confirm the default pipeline and stage ownership.',
      done: false,
    })
  }
  if (want.has('custom_fields') && counts.custom_fields > 0) {
    items.push({
      id: 'custom_fields',
      label: 'Verify custom field definitions and mappings.',
      done: false,
    })
  }

  items.push({
    id: 'team',
    label: 'Invite team members to the new organization.',
    done: false,
  })

  return items
}
