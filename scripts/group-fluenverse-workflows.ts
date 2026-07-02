#!/usr/bin/env node
// One-off: create workflow folders for the Fluenverse org and file every
// existing workflow into one, so nothing is left unfoldered in the UI.
import { createClient } from '@supabase/supabase-js'

const ORG_ID = '605b6134-ed3f-4448-bf6e-b73e2632b13d'

const FOLDERS = [
  {
    name: '📅 Sessões — Confirmação e Lembretes',
    workflowIds: [
      '53233684-a7ef-46f4-964d-fbd1eb99e0e7', // booking-confirmation
      '80619d91-dc19-43e3-9038-6e4e42e34900', // fluenverse-session-confirmation
      '76637e7e-d90b-4457-a892-f3d7d17d2151', // fluenverse-session-reminders
      'ee654f88-6927-44d1-ae72-6fc7ef683cb3', // pre-meeting-5min-reminder
      'bcf4873d-9145-4df0-98b7-a16a82c03371', // pre-meeting-24h-reminder
    ],
  },
  {
    name: '🔁 Recuperação de Sessão',
    workflowIds: [
      'bf291d01-ded9-436d-98d5-e0a6090a030a', // no-show-recovery (generic)
      '5849b9a5-4196-44d5-8a2c-1142347e8cbb', // cancellation-acknowledgement
      '2a3a188e-7621-44fe-af96-49e0aad8c86f', // fluenverse-no-show-recovery
      '3fd25d22-2d27-47ee-a709-6bf8e807f0c9', // fluenverse-cancellation-recovery
      '8920b1e0-c34f-4490-86ec-522517957609', // fluenverse-noshow-reengagement
    ],
  },
  {
    name: '⭐ Avaliações',
    workflowIds: [
      '53a3d8eb-54a7-4caf-9a15-caf8501f4593', // post-meeting-review-request
      '4410cbcd-81cd-46c5-a4b2-ac1127c1b176', // fluenverse-post-session-review
    ],
  },
  {
    name: '📈 Pipeline de Vendas',
    workflowIds: [
      '34433756-72d7-4765-9217-3fb1a256e69a', // fluenverse-new-lead
      '79b37bd9-9720-4ae9-8bd8-6c024a2260ab', // fluenverse-lead-not-booked-followup
      'fdef7163-53fb-44ba-b062-52f042a93677', // fluenverse-stale-opportunity-nudge
      '0dec7061-3ec4-47e8-bd0d-190c8be836cd', // fluenverse-proposal-followup
      '1188201e-6e64-4525-92be-6a5b87ef544a', // fluenverse-proposal-stalled
      'c0cd64a7-2062-44ff-80da-a9bc0e62987f', // fluenverse-lost-remarketing
      'f71be82d-5043-44af-8e6a-731c729d98b3', // pipeline-won-telegram
      '0f3767ed-3889-4419-ba54-e3b9c869260b', // pipeline-stage-changed-log
    ],
  },
  {
    name: '🌱 Nutrição de Alunos',
    workflowIds: [
      'ca980688-0b25-4ceb-9e36-4ca7f956d897', // fluenverse-30d-checkin
      'a0321fca-4d9b-424b-9822-81048e1518e6', // fluenverse-90d-upsell
    ],
  },
  {
    name: '🔔 Notificações Internas',
    workflowIds: [
      'ff41d750-810a-44d9-a593-c70a38ba5d03', // notify-new-lead-telegram
      '7d864b1a-d67b-4f37-bf2c-d1aabd28f482', // notify-workflow-failed-telegram
    ],
  },
  {
    name: '⚙️ Integrações',
    workflowIds: [
      '3959f530-858c-4cff-8852-497fa92635c2', // sync-new-contact-to-google
    ],
  },
  {
    name: '🗄️ Inativos',
    workflowIds: [
      '1d1015a8-7e07-4683-b12f-c16b32f4b687', // follow-up (inactive)
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

  // Sanity check: every referenced workflow must belong to this org.
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
