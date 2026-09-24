// One tenant's playbook was copied into other tenants and left running.
//
// 56 workflows named "Skleanings — …" are active in eight organizations that
// are NOT Skleanings: WG Construction, Xareable, Xtimator, Xphere Demo,
// VitaCell MedSpa, XmartMenu, Xkedule and GT Home Improvement. They are not
// dormant templates — they send:
//
//   - SMS to the ORG'S OWN CONTACTS saying things like "since your Skleanings
//     service", so a VitaCell or GT Home Improvement customer is messaged about
//     a cleaning company they have never used;
//   - SMS to a single hardcoded number (+1 857 228-0830) carrying the contact's
//     name and phone — so one person receives lead details belonging to eight
//     different businesses.
//
// That is a tenant boundary being crossed by configuration, so this switches
// them off. Nothing is deleted: `is_active = false` is reversible, the rows and
// their version history stay, and --revert turns back on exactly what this
// turned off (the ids are written to a file).
//
// Skleanings' own copies are untouched.
//
//   npx tsx --env-file=.env.local scripts/disable-cross-tenant-workflows.ts           # dry run
//   npx tsx --env-file=.env.local scripts/disable-cross-tenant-workflows.ts --apply
//   npx tsx --env-file=.env.local scripts/disable-cross-tenant-workflows.ts --revert

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const OWNER_ORG = '24552ef3-de77-4fba-a2c3-148cd58d8750' // Skleanings
const NAME_PREFIX = 'Skleanings'
const RECORD = 'scripts/.disabled-cross-tenant-workflows.json'

async function main() {
  const apply = process.argv.includes('--apply')
  const revert = process.argv.includes('--revert')
  const sb = createServiceRoleClient()

  if (revert) {
    if (!existsSync(RECORD)) throw new Error(`no record at ${RECORD} — nothing to revert`)
    const ids = JSON.parse(readFileSync(RECORD, 'utf8')) as { id: string; name: string }[]
    for (const row of ids) {
      const { error } = await sb.from('workflows').update({ is_active: true }).eq('id', row.id)
      if (error) throw error
    }
    console.log(`re-enabled ${ids.length} workflow(s)`)
    return
  }

  const { data: orgs } = await sb.from('organizations').select('id, name')
  const orgName = Object.fromEntries((orgs ?? []).map((o) => [o.id, o.name]))

  const { data: workflows } = await sb
    .from('workflows')
    .select('id, name, org_id, is_active')
    .like('name', `${NAME_PREFIX}%`)

  const targets = (workflows ?? []).filter((w) => w.org_id !== OWNER_ORG && w.is_active)

  const byOrg: Record<string, number> = {}
  for (const w of targets) byOrg[orgName[w.org_id] ?? w.org_id] = (byOrg[orgName[w.org_id] ?? w.org_id] ?? 0) + 1
  console.log(`${targets.length} active "${NAME_PREFIX} …" workflow(s) outside ${orgName[OWNER_ORG]}:`)
  for (const [org, count] of Object.entries(byOrg)) console.log(`   ${org.padEnd(28)} ${count}`)

  if (!apply) {
    console.log('\nDRY RUN — pass --apply.')
    return
  }

  writeFileSync(RECORD, JSON.stringify(targets.map((w) => ({ id: w.id, name: w.name })), null, 1), 'utf8')

  let done = 0
  for (const w of targets) {
    const { error } = await sb.from('workflows').update({ is_active: false }).eq('id', w.id)
    if (error) throw error
    done++
  }
  console.log(`\ndisabled ${done}. Record written to ${RECORD} — --revert undoes exactly these.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
