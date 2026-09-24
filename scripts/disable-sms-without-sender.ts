// Switch off SMS-only workflows in organizations that have no number to send from.
//
// The platform seeds SMS workflows into every org — reminders, no-show recovery,
// cancellation acknowledgement, review requests. In an org with no default
// sender number every one of those runs fails at the first node and has failed
// since the day it was seeded. A workflow that has never once succeeded and
// cannot succeed is not a feature; it is an error generator.
//
// Only workflows whose EVERY action is send_sms are touched. Anything that also
// emails, creates a task or updates a booking is left alone — that half works.
//
// Reversible: is_active=false, ids recorded, --revert restores exactly those.
// If an org later gets a number, --revert (or the seeder) brings these back.
//
//   npx tsx --env-file=.env.local scripts/disable-sms-without-sender.ts --org=<uuid> [--apply]
//   npx tsx --env-file=.env.local scripts/disable-sms-without-sender.ts --revert

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const RECORD = 'scripts/.disabled-sms-without-sender.json'

async function main() {
  const apply = process.argv.includes('--apply')
  const revert = process.argv.includes('--revert')
  const onlyOrg = process.argv.find((a) => a.startsWith('--org='))?.split('=')[1]
  const sb = createServiceRoleClient()

  if (revert) {
    if (!existsSync(RECORD)) throw new Error(`no record at ${RECORD}`)
    const ids = JSON.parse(readFileSync(RECORD, 'utf8')) as { id: string }[]
    for (const row of ids) {
      const { error } = await sb.from('workflows').update({ is_active: true }).eq('id', row.id)
      if (error) throw error
    }
    console.log(`re-enabled ${ids.length}`)
    return
  }
  if (!onlyOrg) throw new Error('pass --org=<uuid>; this runs one organization at a time')

  const { data: org } = await sb.from('organizations').select('name').eq('id', onlyOrg).single()
  const { data: sender } = await sb
    .from('twilio_phone_numbers')
    .select('e164')
    .eq('organization_id', onlyOrg)
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle()
  if (sender) {
    console.log(`${org!.name} has a default sender (${sender.e164}) — nothing to do`)
    return
  }

  const { data: workflows } = await sb
    .from('workflows')
    .select('id, name, current_version_id')
    .eq('org_id', onlyOrg)
    .eq('is_active', true)
    .is('deleted_at', null)

  const targets: { id: string; name: string }[] = []
  for (const w of workflows ?? []) {
    if (!w.current_version_id) continue
    const { data: v } = await sb.from('workflow_versions').select('definition').eq('id', w.current_version_id).single()
    const actions = ((v?.definition as { nodes?: { type: string; data?: { action_type?: string } }[] })?.nodes ?? [])
      .filter((n) => n.type === 'action')
      .map((n) => n.data?.action_type)
    if (actions.length > 0 && actions.every((a) => a === 'send_sms')) targets.push({ id: w.id, name: w.name })
  }

  console.log(`${org!.name}: no sender number; ${targets.length} SMS-only workflow(s) active`)
  for (const t of targets) console.log(`   ${t.name}`)
  if (!apply) {
    console.log('DRY RUN — add --apply.')
    return
  }

  const previous = existsSync(RECORD) ? (JSON.parse(readFileSync(RECORD, 'utf8')) as { id: string; name: string }[]) : []
  writeFileSync(RECORD, JSON.stringify([...previous, ...targets.filter((t) => !previous.some((p) => p.id === t.id))], null, 1), 'utf8')
  for (const t of targets) {
    const { error } = await sb.from('workflows').update({ is_active: false }).eq('id', t.id)
    if (error) throw error
  }
  console.log(`disabled ${targets.length}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
