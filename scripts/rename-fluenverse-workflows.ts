#!/usr/bin/env node
// One-off: re-theme the 8 leftover Skleanings-branded workflows living in the
// Fluenverse org (605b6134-ed3f-4448-bf6e-b73e2632b13d) — rename + reword for
// an English-lessons business, fix dead pipeline/stage conditions ('Skleanings'
// / 'Quote Sent' don't exist in Fluenverse's pipeline, which is 'Sales' with a
// 'Proposal' stage), strip Skleanings' hardcoded phone/review link, and merge
// the duplicate post-session review ask into a single workflow.
import { createClient } from '@supabase/supabase-js'

const ORG_ID = '605b6134-ed3f-4448-bf6e-b73e2632b13d'
const TEAM_ALERT_PHONE = '+15086567035'

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
    id: '1188201e-6e64-4525-92be-6a5b87ef544a',
    name: 'Fluenverse — Proposta parada (dia 5 e dia 10)',
    slug: 'fluenverse-proposal-stalled',
    description:
      "Quando uma oportunidade Fluenverse avança para 'Proposal' e o cliente\n" +
      'continua sem responder após o follow-up de 48h, envia mensagens adicionais\n' +
      'no dia 5 (reforço de valor) e dia 10 (encerramento + tarefa urgente).\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setCondition(nodes, 'check_pipeline', "{{pipeline.name}} == 'Sales'")
      nodes = setCondition(nodes, 'check_stage', "{{stage.to.name}} == 'Proposal'")
      nodes = setSmsBody(
        nodes,
        'sms_day5',
        "Hi {{contact.first_name}}, Fluenverse here! Just wanted to share — our sessions are personalized to your goals and pace, with a flexible schedule that fits your week. Still interested in getting started? Reply here anytime!"
      )
      nodes = setSmsBody(
        nodes,
        'sms_day10',
        "Hey {{contact.first_name}}, this is our last follow-up on your Fluenverse enrollment. No pressure at all — whenever you're ready to start improving your English, we're here! Just reply to this message 😊"
      )
      nodes = setTaskFields(nodes, 'urgent_task', {
        description:
          'Proposta enviada há 10+ dias. Cliente silencioso após 3 tentativas (48h, dia 5 e dia 10). Ligar uma última vez para entender a objeção ou mover para perdido. Tel: {{contact.phone}}. Oportunidade: {{opportunity.title}}',
      })
      return { ...def, nodes }
    },
  },
  {
    id: '0dec7061-3ec4-47e8-bd0d-190c8be836cd',
    name: 'Fluenverse — Follow-up de proposta enviada',
    slug: 'fluenverse-proposal-followup',
    description:
      "Quando uma oportunidade do pipeline Fluenverse avança para o stage\n" +
      "'Proposal', aguarda 48 horas, envia um SMS de acompanhamento ao contato\n" +
      'e cria uma tarefa de alta prioridade para ligar e fechar a matrícula.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setCondition(nodes, 'check_pipeline', "{{pipeline.name}} == 'Sales'")
      nodes = setCondition(nodes, 'check_stage', "{{stage.to.name}} == 'Proposal'")
      nodes = setSmsBody(
        nodes,
        'followup_sms',
        "Hi {{contact.first_name}}, this is Fluenverse following up on your enrollment proposal! Any questions about the program or schedule? Happy to walk you through everything — just reply here."
      )
      nodes = setTaskFields(nodes, 'create_call_task', {
        title: 'Ligar para {{contact.name}} — fechar proposta Fluenverse',
        description:
          "Lead ainda no stage 'Proposal' após 48h. Ligar para tirar dúvidas, ajustar a proposta se necessário e fechar a matrícula. Tel: {{contact.phone}}. Oportunidade: {{opportunity.title}}",
      })
      return { ...def, nodes }
    },
  },
  {
    id: '4410cbcd-81cd-46c5-a4b2-ac1127c1b176',
    name: 'Fluenverse — Pedido de avaliação pós-sessão',
    slug: 'fluenverse-post-session-review',
    description:
      '3 horas após a conclusão de uma sessão Fluenverse, envia um SMS\n' +
      'ao aluno pedindo uma avaliação no Google e abrindo a porta para\n' +
      'a próxima sessão. Único ponto de pedido de avaliação (o fluxo de\n' +
      "lembretes do dia da sessão não pede mais review, para evitar SMS duplicado).\n",
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setSmsBody(
        nodes,
        'review_sms',
        'Hi {{meeting.attendee_contact.first_name}}, the Fluenverse team here! We hope you enjoyed your English session ✨ Would you mind leaving us a quick Google review? Just search "Fluenverse" on Google — it takes 30 seconds and means a lot to us. Thank you so much!'
      )
      return { ...def, nodes }
    },
  },
  {
    id: '76637e7e-d90b-4457-a892-f3d7d17d2151',
    name: 'Fluenverse — Lembretes de sessão',
    slug: 'fluenverse-session-reminders',
    description:
      'On booking confirmed: waits until 24h before the session and sends a\n' +
      'confirmation SMS, waits until 1h before and sends a heads-up SMS, then\n' +
      'marks the booking as showed 2 hours after the session ends. (Review\n' +
      "request lives in the separate 'Fluenverse — Pedido de avaliação\n" +
      "pós-sessão' workflow, so students aren't texted twice.)\n",
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
        'Hi {{meeting.attendee_contact.first_name}}, just confirming your English session tomorrow at {{meeting.starts_time}}. See you then!'
      )
      nodes = setSmsBody(
        nodes,
        'sms_1h',
        'Hey {{meeting.attendee_contact.first_name}}, your session starts in about an hour — see you soon!'
      )
      return { ...def, nodes, edges }
    },
  },
  {
    id: 'a0321fca-4d9b-424b-9822-81048e1518e6',
    name: 'Fluenverse — Nutrição 90 dias — reengajamento + upsell',
    slug: 'fluenverse-90d-upsell',
    description:
      '90 dias após a conclusão de uma sessão Fluenverse, envia um SMS de\n' +
      'reengajamento incentivando o aluno a avançar para um módulo mais\n' +
      'avançado e a agendar a próxima sessão.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setSmsBody(
        nodes,
        'upsell_sms',
        "Hi {{meeting.attendee_contact.first_name}}, it's been about 3 months since your last Fluenverse session! 😊 Ready to keep building your English? Ask us about our advanced conversation modules — a great next step from where you are now. Reply here to book your next session!"
      )
      return { ...def, nodes }
    },
  },
  {
    id: 'ca980688-0b25-4ceb-9e36-4ca7f956d897',
    name: 'Fluenverse — Nutrição 30 dias pós-sessão',
    slug: 'fluenverse-30d-checkin',
    description:
      '30 dias após a conclusão de uma sessão Fluenverse, envia um SMS de\n' +
      'acompanhamento perguntando como está o progresso do aluno e convidando\n' +
      'a agendar a próxima sessão.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setSmsBody(
        nodes,
        'checkin_sms',
        "Hey {{meeting.attendee_contact.first_name}}! It's been about a month since your last Fluenverse session 📚 How's your English progress going? When you're ready for your next session, just reply here or book anytime. Hope to see you soon!"
      )
      return { ...def, nodes }
    },
  },
  {
    id: 'c0cd64a7-2062-44ff-80da-a9bc0e62987f',
    name: 'Fluenverse — Remarketing de leads perdidos',
    slug: 'fluenverse-lost-remarketing',
    description:
      'Quando uma oportunidade é marcada como perdida no pipeline Fluenverse,\n' +
      'aguarda 5 meses, cria uma tarefa de follow-up ligada ao contato e envia\n' +
      'um SMS ao número da equipe para ligar novamente.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setCondition(nodes, 'check_pipeline', "{{pipeline.name}} == 'Sales'")
      nodes = setTaskFields(nodes, 'create_followup_task', {
        description:
          'Lead perdido há 5 meses. Ligar para reengajar sobre as aulas de inglês. Tel: {{contact.phone}}. Oportunidade: {{opportunity.title}}',
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
              body: 'Remarketing: {{contact.name}} ({{contact.phone}}) perdido há 5 meses na Fluenverse. Hora de ligar!',
            },
          },
        }
      })
      return { ...def, nodes }
    },
  },
  {
    id: '8920b1e0-c34f-4490-86ec-522517957609',
    name: 'Fluenverse — No-show reengajamento (dia 2 e dia 7)',
    slug: 'fluenverse-noshow-reengagement',
    description:
      'Quando um aluno não comparece à sessão Fluenverse e não responde ao\n' +
      'SMS de recuperação inicial (1h), envia um segundo contato no dia 2\n' +
      '(empático, sem pressão) e uma última tentativa no dia 7 com tarefa manual.\n',
    mutateDefinition: (def) => {
      let nodes = def.nodes as Json[]
      nodes = setSmsBody(
        nodes,
        'sms_day2',
        "Hey {{meeting.attendee_contact.first_name}}, we know life gets busy sometimes! We totally understand you couldn't make it. We'd still love to help you keep progressing with your English — ready to reschedule? Just reply here or pick a new time: {{meeting.event_type.booking_url}} 🙂"
      )
      nodes = setSmsBody(
        nodes,
        'sms_day7',
        'Hi {{meeting.attendee_contact.first_name}}, Fluenverse here one last time! We\'re still holding your spot whenever you\'re ready 📚 Just reply here or book a new time: {{meeting.event_type.booking_url}}. Hope to hear from you soon!'
      )
      nodes = setTaskFields(nodes, 'noshow_task', {
        description:
          'Cliente não apareceu e não respondeu a 3 tentativas de contato (1h, dia 2 e dia 7). Ligar diretamente para entender o motivo e tentar reagendar. Tel: {{meeting.attendee_contact.phone}}',
      })
      return { ...def, nodes }
    },
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

  console.log('\n✓ Done — 8 Fluenverse workflows re-themed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
