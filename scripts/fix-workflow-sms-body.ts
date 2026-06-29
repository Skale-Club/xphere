#!/usr/bin/env node
// Patch SMS body in SKleanings appointment-confirmation workflow to English.
import { createClient } from '@supabase/supabase-js'

const WORKFLOW_ID = '0f80c7fe-a2e7-43b5-9c0f-0c907ac93062'
const NEW_BODY = `Hey {{meeting.attendee_contact.first_name}}!

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

  const { data: wf } = await sb.from('workflows').select('current_version_id').eq('id', WORKFLOW_ID).single()
  const versionId = wf?.current_version_id
  if (!versionId) { console.error('No current_version_id'); process.exit(1) }

  const { data: ver } = await sb.from('workflow_versions').select('definition').eq('id', versionId).single()
  const def = ver?.definition as Record<string, unknown>
  if (!def) { console.error('No definition'); process.exit(1) }

  // Patch: find the send_sms action node and update its body
  const nodes = (def.nodes as Array<Record<string, unknown>>).map((node) => {
    const data = node.data as Record<string, unknown>
    if (data?.action_type === 'send_sms') {
      const config = data.config as Record<string, unknown>
      return { ...node, data: { ...data, config: { ...config, body: NEW_BODY } } }
    }
    return node
  })

  const patched = { ...def, nodes }
  const { error } = await sb.from('workflow_versions').update({ definition: patched }).eq('id', versionId)
  if (error) { console.error('Update failed:', error.message); process.exit(1) }

  console.log('✓ SMS body updated to English in version', versionId)
  console.log('  New body:', NEW_BODY)
}

main().catch((e) => { console.error(e); process.exit(1) })
