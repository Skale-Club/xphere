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
import { createClient } from '@/lib/supabase/server'

export interface FlowPickerOption {
  value: string
  label: string
}

export interface FlowPickerData {
  templates: FlowPickerOption[]
  stages: FlowPickerOption[]
  members: FlowPickerOption[]
  numbers: FlowPickerOption[]
  flows: FlowPickerOption[]
}

export async function getFlowPickerData(): Promise<FlowPickerData> {
  const supabase = await createClient()
  const [templates, numbers, members, pipeline, workflowsRes] = await Promise.all([
    listApprovedTemplates(),
    listTwilioNumbers(),
    listOrgMembersForSelect(),
    getDefaultPipeline(),
    supabase
      .from('workflows')
      .select('id, name, tool_name, is_active')
      .order('name', { ascending: true }),
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
    flows: (workflowsRes.data ?? []).map((w) => ({
      value: w.id,
      label: (w.name as string) || (w.tool_name as string) || w.id,
    })),
  }
}
