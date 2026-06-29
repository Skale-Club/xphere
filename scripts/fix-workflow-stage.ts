#!/usr/bin/env node
// Fix pipeline_create_opportunity stage_name from "Agendado" → "Lead"
// in the SKleanings appointment-confirmation workflow definition.
import { createClient } from '@supabase/supabase-js'

const WORKFLOW_ID = '0f80c7fe-a2e7-43b5-9c0f-0c907ac93062'

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

  // Patch: replace "Agendado" with "Lead" in any node data
  const defStr = JSON.stringify(def).replace(/"Agendado"/g, '"Lead"')
  const patched = JSON.parse(defStr)

  const { error } = await sb.from('workflow_versions').update({ definition: patched }).eq('id', versionId)
  if (error) { console.error('Update failed:', error.message); process.exit(1) }

  console.log('✓ workflow_version', versionId, '→ stage_name patched to "Lead"')
}

main().catch((e) => { console.error(e); process.exit(1) })
