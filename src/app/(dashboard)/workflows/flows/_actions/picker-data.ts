'use server'

// Aggregates the option lists the flow editor's action fields need so raw IDs
// (template_id, stage, user, twilio number) can be picked by name instead of
// typed. One round-trip; reuses existing per-domain server actions.

import { listApprovedTemplates } from '@/app/(dashboard)/integrations/whatsapp/actions'
import {
  listTwilioNumbers,
  listOrgMembersForSelect,
} from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { getDefaultPipeline, getStages } from '@/app/(dashboard)/pipeline/actions'

export interface FlowPickerOption {
  value: string
  label: string
}

export interface FlowPickerData {
  templates: FlowPickerOption[]
  stages: FlowPickerOption[]
  members: FlowPickerOption[]
  numbers: FlowPickerOption[]
}

export async function getFlowPickerData(): Promise<FlowPickerData> {
  const [templates, numbers, members, pipeline] = await Promise.all([
    listApprovedTemplates(),
    listTwilioNumbers(),
    listOrgMembersForSelect(),
    getDefaultPipeline(),
  ])
  const stages = pipeline ? await getStages(pipeline.id) : []

  return {
    templates: templates.map((t) => ({ value: t.id, label: `${t.name} (${t.language})` })),
    // Stage value is the NAME — pipeline actions resolve stage_name within the
    // opportunity's pipeline; default-pipeline names are the common case.
    stages: stages.map((s) => ({ value: s.name, label: s.name })),
    members: members.map((m) => ({ value: m.user_id, label: m.display_name })),
    numbers: numbers.map((n) => ({
      value: n.id,
      label: n.inbox_label || n.friendly_name || n.e164 || n.id,
    })),
  }
}
