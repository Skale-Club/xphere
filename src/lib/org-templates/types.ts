// Template Organizations — shared types.
//
// A template captures the STRUCTURE of an organization (the "way of working"),
// never its live data. The snapshot shapes below only ever describe pipelines,
// custom field definitions, tags, message (email) templates, and workflow
// definitions. They intentionally contain no contacts, conversations, bookings,
// logs, credentials, phone numbers, or connected-account data.

export type OrgTemplateStatus = 'draft' | 'active' | 'archived'

export const ASSET_GROUPS = [
  'pipelines',
  'custom_fields',
  'tags',
  'message_templates',
  'workflows',
] as const

export type OrgTemplateAssetGroup = (typeof ASSET_GROUPS)[number]

export const ASSET_GROUP_LABELS: Record<OrgTemplateAssetGroup, string> = {
  pipelines: 'Pipelines & stages',
  custom_fields: 'Custom fields',
  tags: 'Tags',
  message_templates: 'Message templates',
  workflows: 'Workflows (imported as drafts)',
}

// ─── Snapshot payload shapes (structure only) ────────────────────────────────

export interface SnapshotPipelineStage {
  name: string
  position: number
  color: string
  is_won: boolean
  is_lost: boolean
}

export interface SnapshotPipeline {
  name: string
  is_default: boolean
  position: number
  stages: SnapshotPipelineStage[]
}

export interface SnapshotCustomField {
  entity: 'contact' | 'opportunity' | 'account'
  key: string
  label: string
  type: string
  required: boolean
  unique_per_org: boolean
  position: number
  group_name: string | null
  help_text: string | null
  default_value: unknown
  options: unknown
  validation: unknown
  visible_in_list: boolean
  filterable: boolean
}

export interface SnapshotTag {
  name: string
  slug: string
  color: string
}

export interface SnapshotMessageTemplate {
  name: string
  description: string | null
  subject_line: string
  preview_text: string
  ai_prompt: string | null
  status: string
  tags: string[]
  document: unknown
  html_snapshot: string | null
  plain_text_snapshot: string | null
}

export interface SnapshotWorkflow {
  name: string
  slug: string
  description: string | null
  kind: 'tool' | 'flow'
  tool_name: string | null
  trigger_type: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
  trigger_config: Record<string, unknown>
  definition: unknown
}

export interface OrgTemplateSnapshot {
  pipelines?: SnapshotPipeline[]
  custom_fields?: SnapshotCustomField[]
  tags?: SnapshotTag[]
  message_templates?: SnapshotMessageTemplate[]
  workflows?: SnapshotWorkflow[]
}

// ─── Install result ──────────────────────────────────────────────────────────

export interface InstallCounts {
  pipelines: number
  stages: number
  custom_fields: number
  tags: number
  message_templates: number
  workflows: number
}

export interface ChecklistItem {
  id: string
  label: string
  done: boolean
}

export interface InstallSummary {
  counts: InstallCounts
  checklist: ChecklistItem[]
}

export function emptyCounts(): InstallCounts {
  return {
    pipelines: 0,
    stages: 0,
    custom_fields: 0,
    tags: 0,
    message_templates: 0,
    workflows: 0,
  }
}
