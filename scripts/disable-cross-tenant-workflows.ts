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
// TWO CLASSES, AND ONLY ONE GETS SWITCHED OFF.
//
// A full sweep of every active workflow found two more with the wrong brand in
// them, and these must NOT be disabled — they belong to their own org and only
// the wording is wrong:
//
//   O Bigode Português · "Booking confirmation" — the booking confirmation
//       EMAIL reads "Thank you for choosing Skleanings!" to a Portuguese
//       barbershop's customers. Disabling it would stop their confirmations.
//   Fluenverse · "Remarketing de leads perdidos" — a Telegram alert to the
//       org's own chat that says "perdido há 5 meses no Skleanings".
//
// Those need the text corrected, not the workflow stopped. --fix-text does that
// separately: it rewrites the brand inside the copy and leaves everything else
// alone.
//
//   npx tsx --env-file=.env.local scripts/disable-cross-tenant-workflows.ts           # dry run
//   npx tsx --env-file=.env.local scripts/disable-cross-tenant-workflows.ts --apply
//   npx tsx --env-file=.env.local scripts/disable-cross-tenant-workflows.ts --revert
//   npx tsx --env-file=.env.local scripts/disable-cross-tenant-workflows.ts --fix-text [--apply]

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const OWNER_ORG = '24552ef3-de77-4fba-a2c3-148cd58d8750' // Skleanings
const NAME_PREFIX = 'Skleanings'
const RECORD = 'scripts/.disabled-cross-tenant-workflows.json'

/** Workflows that belong to their org but carry another org's brand in the copy. */
const TEXT_FIXES: { org: string; orgName: string; workflow: string }[] = [
  { org: 'b5bd24d8-aed0-4983-9750-d02d88a6b161', orgName: 'O Bigode Português', workflow: 'Booking confirmation' },
  {
    org: '605b6134-ed3f-4448-bf6e-b73e2632b13d',
    orgName: 'Fluenverse',
    workflow: 'Fluenverse — Remarketing de leads perdidos',
  },
]

/** Rewrite the wrong brand wherever it appears in a workflow's copy. */
async function fixText(sb: ReturnType<typeof createServiceRoleClient>, apply: boolean) {
  for (const target of TEXT_FIXES) {
    const { data: wf } = await sb
      .from('workflows')
      .select('id, name, current_version_id')
      .eq('org_id', target.org)
      .eq('name', target.workflow)
      .maybeSingle()
    if (!wf) {
      console.log(`${target.orgName}: "${target.workflow}" not found`)
      continue
    }
    const { data: version } = await sb
      .from('workflow_versions')
      .select('definition, version_number')
      .eq('id', wf.current_version_id!)
      .single()

    const before = JSON.stringify(version!.definition)
    const occurrences = (before.match(/Skleanings/gi) ?? []).length
    const after = before.replace(/Skleanings/gi, target.orgName)
    console.log(`${target.orgName}: "${wf.name}" — ${occurrences} mention(s) of the wrong brand`)
    if (occurrences === 0 || !apply) continue

    const { data: newVersion, error: vErr } = await sb
      .from('workflow_versions')
      .insert({
        workflow_id: wf.id,
        version_number: (version!.version_number ?? 0) + 1,
        definition: JSON.parse(after) as never,
        notes: `brand corrected to ${target.orgName} ${new Date().toISOString()}`,
      })
      .select('id')
      .single()
    if (vErr) throw vErr
    const { error } = await sb.from('workflows').update({ current_version_id: newVersion.id }).eq('id', wf.id)
    if (error) throw error
    console.log('   published')
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const revert = process.argv.includes('--revert')
  const sb = createServiceRoleClient()

  if (process.argv.includes('--fix-text')) {
    await fixText(sb, apply)
    console.log(apply ? '\napplied.' : '\nDRY RUN — add --apply.')
    return
  }

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
