#!/usr/bin/env node
// One-off: re-theme the leftover Skleanings-branded workflows living in the
// Skale Club org (b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5) for Skale Club's real
// focus — sales/strategy meetings, not cleaning appointments. Same treatment
// as scripts/rename-fluenverse-workflows.ts. Also retires the leftover
// "Skleanings — Pedido de avaliação pós-serviço" workflow: Skale Club already
// has an active platform-default "post-meeting-review-request" workflow that
// fires on the exact same meeting.completed event, so keeping both would
// double-text every contact asking for a review.
import { createClient } from '@supabase/supabase-js'

const ORG_ID = 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'
const TEAM_ALERT_PHONE = '+15088018190'

type Json = Record<string, unknown>

function setSmsBody(nodes: Json[], nodeId: string, body: string): Json[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node
    const data = node.data as Json
    const config = data.config as Json
    return { ...node, data: { ...data, config: { ...config, body } } }
  })
}

function setCondition(nodes: Json[], nodeId: string, expression: string): Json[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node
    const data = node.data as Json
    return { ...node, data: { ...data, expression } }
  })
}

function setTaskFields(nodes: Json[], nodeId: string, fields: Json): Json[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node
    const data = node.data as Json
    const config = data.config as Json
    return { ...node, data: { ...data, config: { ...config, ...fields } } }
  })
}

type WorkflowUpdate = {
  id: string
  name: string
  slug: string
  description: string
  mutateDefinition: (def: Json) => Json
}

const updates: WorkflowUpdate[] = [
  {
    id: '28b5fb20-5acf-4d46-bce9-de850e1f554d',
    name: 'Skale Club — Proposta parada (dia 5 e dia 10)',
    slug: 'skaleclub-proposal-stalled',
    description:
      "Quando uma oportunidade Skale Club avança para 'Proposal' e o cliente\n" +
      'continua sem responder após o follow-up de 48h, envia mensagens adicionais\n' +
      'no dia 5 (reforço de valor) e dia 10 (encerramento + tarefa urgente).\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setCondition(nodes, 'check_pipeline', "{{pipeline.name}} == 'Sales'")
      nodes = setCondition(nodes, 'check_stage', "{{stage.to.name}} == 'Proposal'")
      nodes = setSmsBody(
        nodes,
        'sms_day5',
        "Hi {{contact.first_name}}, Skale Club here! Just wanted to check in — happy to walk you through exactly how we'd approach your goals, no strings attached. Still interested in moving forward? Reply anytime!"
      )
      nodes = setSmsBody(
        nodes,
        'sms_day10',
        "Hey {{contact.first_name}}, this is our last follow-up on your Skale Club proposal. No pressure at all — whenever you're ready to talk, we're here! Just reply to this message 😊"
      )
      nodes = setTaskFields(nodes, 'urgent_task', {
        description:
          'Proposta enviada há 10+ dias. Cliente silencioso após 3 tentativas (48h, dia 5 e dia 10). Ligar uma última vez para entender a objeção ou mover para perdido. Tel: {{contact.phone}}. Oportunidade: {{opportunity.title}}',
      })
      return { ...def, nodes }
    },
  },
  {
    id: 'bd33cf02-3cfa-4b57-af66-cb1f4f05c20e',
    name: 'Skale Club — Follow-up de proposta enviada',
    slug: 'skaleclub-proposal-followup',
    description:
      "Quando uma oportunidade do pipeline Skale Club avança para o stage\n" +
      "'Proposal', aguarda 48 horas, envia um SMS de acompanhamento ao contato\n" +
      'e cria uma tarefa de alta prioridade para ligar e fechar o contrato.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setCondition(nodes, 'check_pipeline', "{{pipeline.name}} == 'Sales'")
      nodes = setCondition(nodes, 'check_stage', "{{stage.to.name}} == 'Proposal'")
      nodes = setSmsBody(
        nodes,
        'followup_sms',
        "Hi {{contact.first_name}}, this is Skale Club following up on your proposal! Any questions about the scope or timeline? Happy to hop on a quick call to go over it — just reply here."
      )
      nodes = setTaskFields(nodes, 'create_call_task', {
        title: 'Ligar para {{contact.name}} — fechar proposta Skale Club',
        description:
          "Lead ainda no stage 'Proposal' após 48h. Ligar para tirar dúvidas, ajustar a proposta se necessário e fechar o contrato. Tel: {{contact.phone}}. Oportunidade: {{opportunity.title}}",
      })
      return { ...def, nodes }
    },
  },
  {
    id: 'a80a475c-c87a-4fbd-aad2-ddbe2791bd8d',
    name: 'Skale Club — Lembretes de reunião',
    slug: 'skaleclub-meeting-reminders',
    description:
      'On booking confirmed: waits until 24h before the meeting and sends a\n' +
      'confirmation SMS, waits until 1h before and sends a heads-up SMS, then\n' +
      "marks the booking as showed 2 hours after the meeting ends. (Review\n" +
      "request lives in the separate 'post-meeting-review-request' platform-\n" +
      "default workflow, so contacts aren't texted twice.)\n",
    mutateDefinition: (def) => {
      let nodes = (def.nodes as Json[]).filter(
        (n) => n.id !== 'wait_review' && n.id !== 'review_sms'
      )
      const edges = (def.edges as Json[]).filter(
        (e) => e.id !== 'e7' && e.id !== 'e8'
      )
      nodes = setSmsBody(
        nodes,
        'sms_24h',
        'Hi {{meeting.attendee_contact.first_name}}, just confirming our meeting tomorrow at {{meeting.starts_time}}. See you then!'
      )
      nodes = setSmsBody(
        nodes,
        'sms_1h',
        'Hey {{meeting.attendee_contact.first_name}}, our meeting starts in about an hour — see you soon!'
      )
      return { ...def, nodes, edges }
    },
  },
  {
    id: 'f9e3f0fa-675d-4c04-8d3f-38c5d771549a',
    name: 'Skale Club — Nutrição 90 dias — reengajamento',
    slug: 'skaleclub-90d-upsell',
    description:
      '90 dias após a conclusão de uma reunião Skale Club, envia um SMS de\n' +
      'reengajamento convidando o contato a revisitar o plano de crescimento\n' +
      'e agendar uma nova conversa.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setSmsBody(
        nodes,
        'upsell_sms',
        "Hi {{meeting.attendee_contact.first_name}}, it's been about 3 months since our last meeting! 😊 Ready to revisit your growth plan? We'd love to catch up and see how things have progressed — reply here to book a quick call!"
      )
      return { ...def, nodes }
    },
  },
  {
    id: '97684d26-e43d-4384-a4bc-90f535c8135b',
    name: 'Skale Club — Nutrição 30 dias pós-reunião',
    slug: 'skaleclub-30d-checkin',
    description:
      '30 dias após a conclusão de uma reunião Skale Club, envia um SMS de\n' +
      'acompanhamento perguntando como está o progresso do contato e convidando\n' +
      'a agendar a próxima conversa.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setSmsBody(
        nodes,
        'checkin_sms',
        "Hey {{meeting.attendee_contact.first_name}}! It's been about a month since our last meeting 📈 How are things progressing on your end? When you're ready to check back in, just reply here or book anytime."
      )
      return { ...def, nodes }
    },
  },
  {
    id: 'c644e19a-044d-40cd-949e-306ba01b01f9',
    name: 'Skale Club — Remarketing de leads perdidos',
    slug: 'skaleclub-lost-remarketing',
    description:
      'Quando uma oportunidade é marcada como perdida no pipeline Skale Club,\n' +
      'aguarda 5 meses, cria uma tarefa de follow-up ligada ao contato e envia\n' +
      'um SMS ao número da equipe para ligar novamente.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setCondition(nodes, 'check_pipeline', "{{pipeline.name}} == 'Sales'")
      nodes = setTaskFields(nodes, 'create_followup_task', {
        description:
          'Lead perdido há 5 meses. Ligar para reengajar sobre uma nova conversa. Tel: {{contact.phone}}. Oportunidade: {{opportunity.title}}',
      })
      nodes = nodes.map((node) => {
        if (node.id !== 'alert_sms') return node
        const data = node.data as Json
        const config = data.config as Json
        return {
          ...node,
          data: {
            ...data,
            config: {
              ...config,
              to: TEAM_ALERT_PHONE,
              body: 'Remarketing: {{contact.name}} ({{contact.phone}}) perdido há 5 meses na Skale Club. Hora de ligar!',
            },
          },
        }
      })
      return { ...def, nodes }
    },
  },
  {
    id: '270204b0-f112-4c94-ad72-4dfb153c9d12',
    name: 'Skale Club — No-show reengajamento (dia 2 e dia 7)',
    slug: 'skaleclub-noshow-reengagement',
    description:
      'Quando um contato não comparece à reunião Skale Club e não responde ao\n' +
      'SMS de recuperação inicial (1h), envia um segundo contato no dia 2\n' +
      '(empático, sem pressão) e uma última tentativa no dia 7 com tarefa manual.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setSmsBody(
        nodes,
        'sms_day2',
        "Hey {{meeting.attendee_contact.first_name}}, we know life gets busy sometimes! We totally understand you couldn't make it. We'd still love to connect — ready to reschedule? Just reply here or pick a new time: {{meeting.event_type.booking_url}} 🙂"
      )
      nodes = setSmsBody(
        nodes,
        'sms_day7',
        'Hi {{meeting.attendee_contact.first_name}}, Skale Club here one last time! We\'re still holding your spot whenever you\'re ready 📅 Just reply here or book a new time: {{meeting.event_type.booking_url}}. Hope to hear from you soon!'
      )
      nodes = setTaskFields(nodes, 'noshow_task', {
        description:
          'Cliente não apareceu e não respondeu a 3 tentativas de contato (1h, dia 2 e dia 7). Ligar diretamente para entender o motivo e tentar reagendar. Tel: {{meeting.attendee_contact.phone}}',
      })
      return { ...def, nodes }
    },
  },
]

const WORKFLOW_ID_TO_DELETE = 'f1e0ccd2-aada-4092-9b5c-d3ca4a98b619' // skleanings-post-service-review (dup of post-meeting-review-request)

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env')
    process.exit(1)
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  for (const update of updates) {
    console.log(`\n── ${update.id} ──`)

    const { data: wf, error: wfErr } = await sb
      .from('workflows')
      .select('org_id, current_version_id')
      .eq('id', update.id)
      .single()
    if (wfErr || !wf) {
      console.error('  workflow lookup failed:', wfErr?.message)
      process.exit(1)
    }
    if (wf.org_id !== ORG_ID) {
      console.error('  refusing to touch: org_id mismatch', wf.org_id)
      process.exit(1)
    }
    const versionId = wf.current_version_id
    if (!versionId) {
      console.error('  no current_version_id')
      process.exit(1)
    }

    const { data: ver, error: verErr } = await sb
      .from('workflow_versions')
      .select('definition')
      .eq('id', versionId)
      .single()
    if (verErr || !ver) {
      console.error('  version lookup failed:', verErr?.message)
      process.exit(1)
    }

    const newDef = update.mutateDefinition(ver.definition as Json)

    const { error: defErr } = await sb
      .from('workflow_versions')
      .update({ definition: newDef })
      .eq('id', versionId)
    if (defErr) {
      console.error('  definition update failed:', defErr.message)
      process.exit(1)
    }

    const { error: hdrErr } = await sb
      .from('workflows')
      .update({
        name: update.name,
        slug: update.slug,
        description: update.description,
        updated_at: new Date().toISOString(),
      })
      .eq('id', update.id)
    if (hdrErr) {
      console.error('  header update failed:', hdrErr.message)
      process.exit(1)
    }

    console.log(`  ✓ renamed to "${update.name}" (slug: ${update.slug})`)
  }

  console.log(`\n── delete ${WORKFLOW_ID_TO_DELETE} ──`)
  const { data: delWf, error: delLookupErr } = await sb
    .from('workflows')
    .select('org_id')
    .eq('id', WORKFLOW_ID_TO_DELETE)
    .single()
  if (delLookupErr || !delWf) {
    console.error('  lookup failed:', delLookupErr?.message)
    process.exit(1)
  }
  if (delWf.org_id !== ORG_ID) {
    console.error('  refusing to delete: org_id mismatch', delWf.org_id)
    process.exit(1)
  }
  const { error: delErr } = await sb.from('workflows').delete().eq('id', WORKFLOW_ID_TO_DELETE)
  if (delErr) {
    console.error('  delete failed:', delErr.message)
    process.exit(1)
  }
  console.log('  ✓ deleted (duplicate review-request workflow)')

  console.log('\n✓ Done — Skale Club workflows re-themed for meetings.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
