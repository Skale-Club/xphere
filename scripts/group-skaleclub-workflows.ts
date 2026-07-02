#!/usr/bin/env node
// One-off: create workflow folders for the Skale Club org and file every
// existing workflow into one, so nothing is left unfoldered in the UI.
//
// Note: 8 of these workflows are still leftover "Skleanings" (cleaning
// service) example content that doesn't fit Skale Club's business — filed
// into a dedicated "revisar" folder instead of guessing a rename, since
// unlike Fluenverse there's no obvious 1:1 mapping to Skale Club's domain.
import { createClient } from '@supabase/supabase-js'

const ORG_ID = 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'

const FOLDERS = [
  {
    name: '📅 Reuniões — Confirmação e Lembretes',
    workflowIds: [
      '21e6f11f-3123-49d3-8168-06d8d46e9ff5', // booking-confirmation
      '9315b0ac-4161-40bd-afa7-6de15713c5ec', // skaleclub-meeting-confirmation
      '3e8686cb-ae2d-4528-b8ed-73fc6e8e937b', // meeting-reminders (24h+5min)
      'f52524e5-54d2-4721-9e8c-f908375efc30', // pre-meeting-5min-reminder
      'df4f622a-a711-4174-b803-f82aca4f1cc6', // pre-meeting-24h-reminder
    ],
  },
  {
    name: '🔁 Recuperação de Reunião',
    workflowIds: [
      'e7e70e4d-b535-438f-a816-005c30acb5f6', // no-show-recovery (generic)
      'd192f529-dbe0-4b45-bc85-aac317d6ac0e', // cancellation-acknowledgement
      '8820ae7b-b906-405e-9296-74c9e8e055c5', // skaleclub-no-show-followup
      '5ede3ce8-c81d-45eb-b8f3-75c81f23b1dd', // skaleclub-cancellation-followup
    ],
  },
  {
    name: '⭐ Avaliações',
    workflowIds: [
      'd5569053-23e1-4c49-a0ba-b4136e43dc7f', // post-meeting-review-request
    ],
  },
  {
    name: '📈 Pipeline de Vendas',
    workflowIds: [
      '1ff57cee-9e68-4e7e-b46d-08feaefb9247', // skaleclub-new-lead
      '7d0e4591-70c6-4849-afe4-24bc3b2a8a22', // skaleclub-lead-not-booked-followup
      'e521112c-cf3e-4333-8938-ef3edbc483c0', // skaleclub-stale-opportunity-nudge
      '50a4a61b-1373-420a-96a9-54d305c94528', // pipeline-won-telegram
      'a04c8f50-b160-407f-bde8-9044b9137295', // pipeline-stage-changed-log
    ],
  },
  {
    name: '🔔 Notificações Internas',
    workflowIds: [
      '2bf01d10-1235-4b7f-847a-1c1b0ebb94e8', // notify-new-lead-telegram
      'c1c0bb02-c83e-4f37-b824-06948b03a0e5', // notify-workflow-failed-telegram
    ],
  },
  {
    name: '⚙️ Integrações',
    workflowIds: [
      '8ba7635e-9ce5-440e-ac21-7b3b7194eaeb', // sync-new-contact-to-google
    ],
  },
  {
    name: '🧹 Skleanings (exemplo — revisar)',
    workflowIds: [
      '97684d26-e43d-4384-a4bc-90f535c8135b', // skleanings-30d-checkin
      '28b5fb20-5acf-4d46-bce9-de850e1f554d', // skleanings-quote-parado
      'c644e19a-044d-40cd-949e-306ba01b01f9', // skleanings-lost-remarketing
      'bd33cf02-3cfa-4b57-af66-cb1f4f05c20e', // skleanings-quote-followup
      'f1e0ccd2-aada-4092-9b5c-d3ca4a98b619', // skleanings-post-service-review
      '270204b0-f112-4c94-ad72-4dfb153c9d12', // skleanings-noshow-reengajamento
      'f9e3f0fa-675d-4c04-8d3f-38c5d771549a', // skleanings-90d-upsell
      'a80a475c-c87a-4fbd-aad2-ddbe2791bd8d', // cleaning-service-reminders (Reminder)
    ],
  },
]

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const allIds = FOLDERS.flatMap((f) => f.workflowIds)
  const { data: existing, error: checkErr } = await sb
    .from('workflows')
    .select('id, org_id')
    .in('id', allIds)
  if (checkErr) {
    console.error('Lookup failed:', checkErr.message)
    process.exit(1)
  }
  const foundIds = new Set((existing ?? []).map((w) => w.id))
  const missing = allIds.filter((id) => !foundIds.has(id))
  const wrongOrg = (existing ?? []).filter((w) => w.org_id !== ORG_ID)
  if (missing.length > 0) {
    console.error('Missing workflow ids:', missing)
    process.exit(1)
  }
  if (wrongOrg.length > 0) {
    console.error('Refusing to touch workflows outside target org:', wrongOrg)
    process.exit(1)
  }

  let position = 0
  for (const folder of FOLDERS) {
    const { data: created, error: fErr } = await sb
      .from('workflow_folders')
      .insert({ org_id: ORG_ID, name: folder.name, position: position++ })
      .select('id')
      .single()
    if (fErr || !created) {
      console.error(`  folder create failed (${folder.name}):`, fErr?.message)
      process.exit(1)
    }
    console.log(`✓ folder "${folder.name}" → ${created.id}`)

    let wPosition = 0
    for (const workflowId of folder.workflowIds) {
      const { error: wErr } = await sb
        .from('workflows')
        .update({ folder_id: created.id, position: wPosition++ })
        .eq('id', workflowId)
      if (wErr) {
        console.error(`    assign failed (${workflowId}):`, wErr.message)
        process.exit(1)
      }
    }
    console.log(`  ✓ ${folder.workflowIds.length} workflow(s) filed`)
  }

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
