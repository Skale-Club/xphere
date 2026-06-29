#!/usr/bin/env node
// Creates "Job Confirmed" pipeline stage + updates SKleanings workflow with all 3 steps.
import { createClient } from '@supabase/supabase-js'

const ORG_ID = '24552ef3-de77-4fba-a2c3-148cd58d8750'
const PIPELINE_ID = '9581fe76-82ce-4e74-91ec-4a9a6b9ad7a7'
const WORKFLOW_ID = '0f80c7fe-a2e7-43b5-9c0f-0c907ac93062'

const SMS_BODY = `Hey {{meeting.attendee_contact.first_name}}!

Your cleaning is confirmed

📅 Date: {{meeting.starts_date}}
⏰ Time: {{meeting.starts_time}} {{meeting.timezone}}
🏠 Location: {{meeting.location.address}}

Add to Google Calendar
{{meeting.google_calendar_url}}

Skleanings`

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  ) as any

  // ── 1. Create "Job Confirmed" stage if it doesn't exist ───────────────────
  console.log('── Step 1: Job Confirmed stage ──')
  const { data: existingStage } = await sb
    .from('pipeline_stages')
    .select('id, name')
    .eq('pipeline_id', PIPELINE_ID)
    .eq('name', 'Job Confirmed')
    .maybeSingle()

  let jobConfirmedStageId: string
  if (existingStage) {
    jobConfirmedStageId = existingStage.id
    console.log('  already exists:', jobConfirmedStageId)
  } else {
    const { data: created, error } = await sb
      .from('pipeline_stages')
      .insert({ org_id: ORG_ID, pipeline_id: PIPELINE_ID, name: 'Job Confirmed', position: 1, color: '#8B5CF6' })
      .select('id').single()
    if (error || !created) { console.error('  stage create failed:', error?.message); process.exit(1) }
    jobConfirmedStageId = created.id
    console.log('  created:', jobConfirmedStageId)
  }

  // ── 2. Build updated FlowDefinition with 3 nodes ──────────────────────────
  console.log('\n── Step 2: update workflow definition ──')
  const { data: wf } = await sb.from('workflows').select('current_version_id').eq('id', WORKFLOW_ID).single()
  const versionId = wf?.current_version_id
  if (!versionId) { console.error('No current_version_id'); process.exit(1) }

  const { data: ver } = await sb.from('workflow_versions').select('definition').eq('id', versionId).single()
  const def = ver?.definition as Record<string, unknown>

  // Build the 3-node flow definition
  const newDef = {
    ...def,
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        position: { x: 300, y: 50 },
        data: { kind: 'trigger', label: 'Booking Confirmed', event_type: 'meeting.confirmed' },
      },
      {
        id: 'update_customer',
        type: 'action',
        position: { x: 300, y: 180 },
        data: {
          kind: 'action',
          label: 'Update Customer',
          action_type: 'update_contact',
          config: {
            contact_phone: '{{meeting.attendee_contact.phone}}',
            lifecycle_stage: 'customer',
          },
        },
      },
      {
        id: 'criar_oportunidade',
        type: 'action',
        position: { x: 300, y: 310 },
        data: {
          kind: 'action',
          label: 'Create Opportunity',
          action_type: 'pipeline_create_opportunity',
          config: {
            title: '{{meeting.attendee_contact.first_name}} | {{meeting.event_type.name}}',
            contact_phone: '{{meeting.attendee_contact.phone}}',
            stage_name: 'Job Confirmed',
          },
        },
      },
      {
        id: 'sms_confirmacao',
        type: 'action',
        position: { x: 300, y: 440 },
        data: {
          kind: 'action',
          label: 'Confirmation SMS',
          action_type: 'send_sms',
          config: {
            to: '{{meeting.attendee_contact.phone}}',
            body: SMS_BODY,
            integration: 'twilio',
          },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'update_customer' },
      { id: 'e2', source: 'update_customer', target: 'criar_oportunidade' },
      { id: 'e3', source: 'criar_oportunidade', target: 'sms_confirmacao' },
    ],
  }

  const { error: updateErr } = await sb
    .from('workflow_versions')
    .update({ definition: newDef })
    .eq('id', versionId)
  if (updateErr) { console.error('  update failed:', updateErr.message); process.exit(1) }
  console.log('  ✓ workflow_version', versionId, 'updated with 3 nodes')

  console.log('\n✓ Done! Workflow now has:')
  console.log('  1. Update contact → lifecycle_stage: customer')
  console.log('  2. Create opportunity → stage: "Job Confirmed"')
  console.log('  3. Send SMS → English confirmation message')
}

main().catch((e) => { console.error(e); process.exit(1) })
