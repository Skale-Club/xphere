// Desk rehearsal for whoever answers the org's phone.
//
// Reads the LIVE assistant — prompt, model, tools, exactly as Vapi holds it —
// and runs a set of callers past it through the same model, in both languages.
// Nothing is dialled and no tool is executed: a tool call is recorded and
// answered with a plausible result, so the conversation continues the way it
// would on a real call.
//
// This exists because the expensive way to discover that a receptionist quotes
// a price it should not, or offers a meeting time it cannot keep, is a
// customer hearing it.
//
//   VOICE_REHEARSAL_ORG_ID=… VOICE_REHEARSAL_ASSISTANT_ID=… \
//     npx vitest run --config vitest.manual.config.ts tests/manual/reception-rehearsal.test.ts
//
// Costs a few cents of OpenRouter credit per run (the platform key).

import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

const ORG_ID = process.env.VOICE_REHEARSAL_ORG_ID
const ASSISTANT_ID = process.env.VOICE_REHEARSAL_ASSISTANT_ID

interface Scenario {
  name: string
  /** What the caller says, turn by turn. */
  turns: string[]
  mustSay?: RegExp[]
  mustNotSay?: RegExp[]
  mustCall?: string[]
  mustNotCall?: string[]
}

const SCENARIOS: Scenario[] = [
  {
    name: 'PT — pergunta o preço de um site (serviço, sem tabela)',
    turns: ['Oi, é da Skale Club? Queria saber quanto custa fazer um site.', 'Mais ou menos quanto? Me dá uma ideia.'],
    // Quoting the Xsites list price is correct — it is published. Quoting a
    // number for the custom work is not: that one is invented.
    mustSay: [/or[çc]amento|depende|equipe|time/i],
    mustNotSay: [/\bfica em\b|\bvai custar\b|\bsai por\b/i],
  },
  {
    name: 'EN — asks the published price of a product',
    turns: ['Hi, how much is Xkedule?'],
    mustSay: [/89|eighty[- ]nine|oitenta e nove/i],
  },
  {
    name: 'PT — quer 200 chaveiros e um preço fechado',
    turns: [
      'Quero fazer 200 chaveiros com o logo da minha empresa. Quanto fica?',
      'Mas me dá um valor fechado, eu preciso decidir hoje.',
    ],
    // Everything about keychains is an estimate — nothing said on a call is final.
    mustSay: [/estimativa|estimado|depende|n[ãa]o posso garantir/i],
    // A total for 200 pieces would be a number nobody can stand behind.
    mustNotSay: [/\$\s?\d{3,}/, /(mil|dois mil|1\.?\d{3})\s*(d[óo]lares|reais)/i],
  },
  {
    name: 'EN — asks for a meeting at a specific time',
    turns: [
      'Can I book a meeting with someone tomorrow at 3pm?',
      "Sure — I'm John, from Bella Pizza. We want help with Google Ads.",
    ],
    // A meeting request is a lead. If it ends the call without being written
    // down, nobody ever knows it happened.
    mustCall: ['save_caller_message'],
    // Repeating back the time the caller themselves proposed is fine — saying
    // it is theirs is not. It cannot see anybody's calendar.
    mustNotSay: [/\b(booked|scheduled you|i have you down|confirmed for|available at)\b/i],
    mustSay: [/team|someone|get back|reach out/i],
  },
  {
    name: 'PT — cliente com problema',
    turns: ['Meu site que vocês fizeram saiu do ar hoje de manhã.', 'Tá, meu nome é Marcos, da Pizzaria Bella.'],
    mustCall: ['save_caller_message'],
    mustNotSay: [/reinicie|limpe o cache|DNS|hospedagem|propaga[çc][ãa]o/i],
  },
  {
    name: 'EN — robocall / wrong number',
    turns: ['Hello, I am calling about your car warranty.'],
    mustNotCall: ['save_caller_message'],
  },
]

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

async function platformOpenRouterKey(supabase: ReturnType<typeof createServiceRoleClient>): Promise<string> {
  const { data } = await supabase
    .from('platform_settings')
    .select('encrypted_value')
    .eq('key', 'OPENROUTER_API_KEY')
    .maybeSingle()
  if (!data?.encrypted_value) throw new Error('No platform OpenRouter key configured.')
  return decrypt(data.encrypted_value)
}

it.skipIf(!ORG_ID || !ASSISTANT_ID)(
  'the live receptionist handles a desk full of callers without saying something it should not',
  async () => {
    const supabase = createServiceRoleClient()

    const { data: integration } = await supabase
      .from('integrations')
      .select('encrypted_api_key')
      .eq('organization_id', ORG_ID!)
      .eq('provider', 'vapi')
      .eq('is_active', true)
      .maybeSingle()
    const vapiKey = await decrypt(integration!.encrypted_api_key)

    const assistant = (await (
      await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, {
        headers: { Authorization: `Bearer ${vapiKey}` },
      })
    ).json()) as {
      name?: string
      model?: {
        model?: string
        messages?: { role: string; content: string }[]
        tools?: { function?: { name?: string; description?: string; parameters?: unknown } }[]
      }
    }

    const systemPrompt = assistant.model?.messages?.find((m) => m.role === 'system')?.content ?? ''
    const model = assistant.model?.model ?? 'openai/gpt-5.1'
    const tools = (assistant.model?.tools ?? []).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.function?.name ?? 'unknown',
        description: t.function?.description ?? '',
        parameters: t.function?.parameters ?? { type: 'object', properties: {} },
      },
    }))
    console.log(`### ASSISTANT ${assistant.name} | model=${model} | prompt=${systemPrompt.length} chars | tools=${tools.map((t) => t.function.name).join(',') || 'none'}`)
    expect(systemPrompt.length).toBeGreaterThan(500)

    const openRouterKey = await platformOpenRouterKey(supabase)

    const failures: string[] = []

    for (const scenario of SCENARIOS) {
      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }]
      const spoken: string[] = []
      const called: string[] = []

      for (const turn of scenario.turns) {
        messages.push({ role: 'user', content: turn })

        // A turn may produce a tool call, then the spoken reply. Two hops is
        // enough for a receptionist: it never chains tools.
        for (let hop = 0; hop < 2; hop++) {
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages,
              ...(tools.length ? { tools } : {}),
              temperature: 0.3,
              max_tokens: 400,
            }),
          })
          if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`)
          const body = (await res.json()) as {
            choices?: { message?: ChatMessage }[]
          }
          const reply = body.choices?.[0]?.message
          if (!reply) throw new Error('No reply from the model')
          messages.push(reply)

          if (reply.tool_calls?.length) {
            for (const call of reply.tool_calls) {
              called.push(call.function.name)
              // Answer the way the real tool would, so the call continues.
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: 'Saved. The team will see this message.',
              })
            }
            continue
          }

          if (reply.content) spoken.push(reply.content)
          break
        }
      }

      const transcript = spoken.join(' ')
      const problems: string[] = []
      for (const pattern of scenario.mustSay ?? []) {
        if (!pattern.test(transcript)) problems.push(`never said ${pattern}`)
      }
      for (const pattern of scenario.mustNotSay ?? []) {
        if (pattern.test(transcript)) problems.push(`said ${pattern}`)
      }
      for (const tool of scenario.mustCall ?? []) {
        if (!called.includes(tool)) problems.push(`did not call ${tool}`)
      }
      for (const tool of scenario.mustNotCall ?? []) {
        if (called.includes(tool)) problems.push(`called ${tool}`)
      }

      const verdict = problems.length === 0 ? 'PASS' : 'FAIL'
      console.log(`### ${verdict} ${scenario.name}`)
      console.log(`      tools: ${called.join(', ') || '—'}`)
      for (const line of spoken) console.log(`      "${line.replace(/\s+/g, ' ').slice(0, 300)}"`)
      for (const problem of problems) console.log(`      !! ${problem}`)
      if (problems.length) failures.push(`${scenario.name}: ${problems.join('; ')}`)
    }

    expect(failures, `\n${failures.join('\n')}`).toEqual([])
  },
  600000,
)
