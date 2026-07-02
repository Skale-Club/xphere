#!/usr/bin/env node
// Follow-up to rename-skaleclub-workflows.ts: the 7 re-themed workflows no
// longer belong in the "🧹 Skleanings (exemplo — revisar)" folder (now
// misleading since they're proper Skale Club workflows), so file them into
// the real topical folders created by group-skaleclub-workflows.ts. Creates
// a nurture folder (didn't exist yet) and removes the now-empty leftover one.
import { createClient } from '@supabase/supabase-js'

const ORG_ID = 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'
const OLD_FOLDER_ID = 'b5d96fa2-6094-48f6-b1f9-660f9c17b244' // 🧹 Skleanings (exemplo — revisar)

const PIPELINE_FOLDER_ID = '228780ce-c7a1-42c8-bc0e-210be7641dc5' // 📈 Pipeline de Vendas
const MEETINGS_FOLDER_ID = '0da3a31f-7fa6-4269-ae26-53328cdc087e' // 📅 Reuniões — Confirmação e Lembretes
const RECOVERY_FOLDER_ID = 'c65f1111-a3d4-430c-8511-2b32892ad3e7' // 🔁 Recuperação de Reunião

const MOVES: Array<{ folderId: string; workflowIds: string[] }> = [
  {
    folderId: PIPELINE_FOLDER_ID,
    workflowIds: [
      '28b5fb20-5acf-4d46-bce9-de850e1f554d', // skaleclub-proposal-stalled
      'bd33cf02-3cfa-4b57-af66-cb1f4f05c20e', // skaleclub-proposal-followup
      'c644e19a-044d-40cd-949e-306ba01b01f9', // skaleclub-lost-remarketing
    ],
  },
  {
    folderId: MEETINGS_FOLDER_ID,
    workflowIds: [
      'a80a475c-c87a-4fbd-aad2-ddbe2791bd8d', // skaleclub-meeting-reminders
    ],
  },
  {
    folderId: RECOVERY_FOLDER_ID,
    workflowIds: [
      '270204b0-f112-4c94-ad72-4dfb153c9d12', // skaleclub-noshow-reengagement
    ],
  },
]

const NURTURE_WORKFLOW_IDS = [
  'f9e3f0fa-675d-4c04-8d3f-38c5d771549a', // skaleclub-90d-upsell
  '97684d26-e43d-4384-a4bc-90f535c8135b', // skaleclub-30d-checkin
]

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // Sanity: all referenced workflows belong to this org.
  const allIds = [...MOVES.flatMap((m) => m.workflowIds), ...NURTURE_WORKFLOW_IDS]
  const { data: existing, error: checkErr } = await sb
    .from('workflows')
    .select('id, org_id')
    .in('id', allIds)
  if (checkErr) {
    console.error('Lookup failed:', checkErr.message)
    process.exit(1)
  }
  const wrongOrg = (existing ?? []).filter((w) => w.org_id !== ORG_ID)
  if (wrongOrg.length > 0) {
    console.error('Refusing to touch workflows outside target org:', wrongOrg)
    process.exit(1)
  }

  // Create the nurture folder.
  const { data: nurtureFolder, error: nfErr } = await sb
    .from('workflow_folders')
    .insert({ org_id: ORG_ID, name: '🌱 Nutrição de Contatos', position: 7 })
    .select('id')
    .single()
  if (nfErr || !nurtureFolder) {
    console.error('Nurture folder create failed:', nfErr?.message)
    process.exit(1)
  }
  console.log(`✓ folder "🌱 Nutrição de Contatos" → ${nurtureFolder.id}`)

  for (const move of MOVES) {
    let wPosition = 0
    for (const workflowId of move.workflowIds) {
      const { error } = await sb
        .from('workflows')
        .update({ folder_id: move.folderId, position: wPosition++ })
        .eq('id', workflowId)
      if (error) {
        console.error(`  move failed (${workflowId}):`, error.message)
        process.exit(1)
      }
    }
    console.log(`✓ moved ${move.workflowIds.length} workflow(s) into folder ${move.folderId}`)
  }

  let nurturePosition = 0
  for (const workflowId of NURTURE_WORKFLOW_IDS) {
    const { error } = await sb
      .from('workflows')
      .update({ folder_id: nurtureFolder.id, position: nurturePosition++ })
      .eq('id', workflowId)
    if (error) {
      console.error(`  move failed (${workflowId}):`, error.message)
      process.exit(1)
    }
  }
  console.log(`✓ moved ${NURTURE_WORKFLOW_IDS.length} workflow(s) into 🌱 Nutrição de Contatos`)

  // Confirm the old folder is now empty, then delete it.
  const { data: remaining } = await sb
    .from('workflows')
    .select('id')
    .eq('folder_id', OLD_FOLDER_ID)
  if (remaining && remaining.length > 0) {
    console.error('Old folder still has workflows, refusing to delete:', remaining)
    process.exit(1)
  }
  const { error: delErr } = await sb.from('workflow_folders').delete().eq('id', OLD_FOLDER_ID)
  if (delErr) {
    console.error('Old folder delete failed:', delErr.message)
    process.exit(1)
  }
  console.log('✓ removed empty "🧹 Skleanings (exemplo — revisar)" folder')

  const { data: unfoldered } = await sb
    .from('workflows')
    .select('id, name')
    .eq('org_id', ORG_ID)
    .is('folder_id', null)
    .is('deleted_at', null)
  console.log(`\nUnfoldered workflows remaining: ${unfoldered?.length ?? 0}`)
  if (unfoldered && unfoldered.length > 0) console.log(unfoldered)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
