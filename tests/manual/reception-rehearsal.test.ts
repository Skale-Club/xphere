// Desk rehearsal for whoever answers the org's phone.
//
// Reads the LIVE assistant — prompt, model, tools, exactly as Vapi holds it —
// and runs a set of callers past it through the same model, in both languages.
// Nothing is dialled. Read-only tools ARE executed, against the real ingress in
// production, so the assistant sees the same answer a caller would produce;
// writes are simulated, with book_meeting replaying the spoken-consent gate
// rather than putting a meeting in anybody's calendar. See answerTool().
//
// This exists because the expensive way to discover that a receptionist quotes
// a price it should not, or offers a meeting time it cannot keep, is a
// customer hearing it.
//
// The model is not deterministic: two runs of the same scenario differ in
// wording, and occasionally in whether a tool is called at all. Write the
// expectations as rules a good receptionist always follows, never as one
// transcript — and read a single failure as "look at what it said", not
// "the prompt is broken".
//
//   VOICE_REHEARSAL_ORG_ID=… VOICE_REHEARSAL_ASSISTANT_ID=… \
//     npx vitest run --config vitest.manual.config.ts tests/manual/reception-rehearsal.test.ts
//
// Costs a few cents of OpenRouter credit per run (the platform key).

import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { assistantServerSecret } from '@/lib/vapi/sync-assistant-config'

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
    mustSay: [/\b89\b|eighty[- ]nine|oitenta e nove/i],
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
    mustNotSay: [/\$\s?\d{3,}/, /\b(mil|dois mil|1\.?\d{3})\s*(d[óo]lares|reais)/i],
  },
  {
    name: 'EN — asks for a meeting at a specific time',
    turns: [
      'Can I book a meeting with someone tomorrow at 3pm?',
      "Sure — I'm John, from Bella Pizza. We want help with Google Ads.",
    ],
    // It can book now — so it must LOOK before it answers. The failure mode
    // this guards is agreeing to the time the caller proposed without ever
    // checking whether it is open.
    mustCall: ['check_meeting_times'],
    mustNotCall: ['book_meeting'], // no email yet, and no read-back
    mustNotSay: [/\b(you're booked|i have you down|all set for)\b/i],
  },
  {
    name: 'PT — cliente com problema',
    turns: ['Meu site que vocês fizeram saiu do ar hoje de manhã.', 'Tá, meu nome é Marcos, da Pizzaria Bella.'],
    mustCall: ['save_caller_message'],
    // Asking what they see on screen is the job — it is what the team needs.
    // Telling them to go do something, or naming a cause, is not: this
    // receptionist cannot see the site and would be guessing out loud.
    mustNotSay: [
      /\b(reinicie|reinicia|limpe|limpa) (o |a )?(cache|roteador|servidor)/i,
      /\b(tente|tenta) (de novo|novamente|abrir em)/i,
      /\b(o problema|a causa) (é|deve ser|foi)/i,
      /\bdeve ser (o|a|um|uma) (DNS|hospedagem|servidor|certificado)/i,
    ],
  },
  {
    name: 'EN — books the intro call',
    turns: [
      'Hi, can I talk to someone about running ads for my restaurant?',
      "I'm John from Bella Pizza. Next Tuesday works.",
      'The morning one is good.',
      'john at bellapizza dot com.',
      "Yes, that's right.",
    ],
    // The booking subagent, end to end: look at the calendar, then actually
    // book. Until the harness answered tools honestly this scenario passed
    // without ever booking — the stub made it impossible, so a green run
    // proved nothing about the one path the whole feature exists for.
    //
    // book_meeting appears twice on a good run: refused the first time by the
    // spoken-consent gate, accepted after the read-back.
    mustCall: ['check_meeting_times', 'book_meeting'],
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

/**
 * What a tool call gets back.
 *
 * This used to answer every tool with the same string — "Saved. The team will
 * see this message." — whatever was called. So when the assistant asked
 * check_meeting_times for open slots, it was handed a save confirmation, drew
 * the only sensible conclusion ("I can't see the calendar"), and improvised.
 * The booking scenarios passed WITHOUT EVER BOOKING, because the harness made
 * booking impossible. A green rehearsal meant nothing for the one path that
 * matters most.
 *
 * Read-only tools now go to the real ingress in production, so the assistant
 * sees the real answer. Writes are simulated, but honestly: book_meeting
 * replays the spoken-consent gate — refuse first with a read-back, accept on
 * the second call — so the rehearsal exercises the confirmation flow without
 * putting a meeting in anybody's calendar.
 */
const TOOLS_URL = process.env.REHEARSAL_TOOLS_URL ?? 'https://xphere.app/api/vapi/tools'
const bookingAttempts = new Map<string, number>()

async function answerTool(name: string, rawArgs: string, secret: string): Promise<string> {
  if (name === 'book_meeting') {
    const seen = (bookingAttempts.get(name) ?? 0) + 1
    bookingAttempts.set(name, seen)
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(rawArgs || '{}')
    } catch {
      /* the model's problem, and the executor would say so too */
    }
    if (seen === 1) {
      return (
        'NOT BOOKED YET. Read the details back to the caller and get a clear yes first: ' +
        `${args.name ?? 'the caller'}, ${args.date ?? '(no date)'} at ${args.time ?? '(no time)'}, ` +
        `invite to ${args.email ?? '(no email)'}. Then call book_meeting again with confirmed: true ` +
        'and confirmationToken: rehearsal-token, details unchanged.'
      )
    }
    if (!args.confirmed) {
      return 'NOT BOOKED. The caller has not agreed yet. Read the details back and wait for a yes.'
    }
    return `Booked: Conversa inicial, ${args.date} at ${args.time} (America/New_York). A confirmation with the video link is on its way to ${args.email}.`
  }

  if (name === 'check_meeting_times') {
    const res = await fetch(TOOLS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vapi-secret': secret },
      body: JSON.stringify({
        message: {
          type: 'tool-calls',
          call: { id: `rehearsal-${Date.now()}`, assistantId: ASSISTANT_ID },
          toolCallList: [
            { id: 'rehearsal-tool-call', type: 'function', function: { name, arguments: rawArgs || '{}' } },
          ],
        },
      }),
    })
    const body = (await res.json()) as { results?: { result: string }[] }
    return body.results?.[0]?.result ?? 'The calendar did not answer.'
  }

  return 'Saved. The team will see this message.'
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
      server?: unknown
      model?: {
        model?: string
        messages?: { role: string; content: string }[]
        tools?: { server?: unknown; function?: { name?: string; description?: string; parameters?: unknown } }[]
      }
    }

    // The secret the read-only tools are called with, so the rehearsal sees the
    // same answers a real call would.
    const secret =
      assistantServerSecret(assistant.server) ??
      (assistant.model?.tools ?? []).map((t) => assistantServerSecret(t.server)).find(Boolean)
    expect(secret, 'no webhook secret on this assistant').toBeTruthy()

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
      // Each caller arrives with a clean slate, so the consent gate starts
      // closed for every one of them.
      bookingAttempts.clear()

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
              const answer = await answerTool(call.function.name, call.function.arguments, secret as string)
              messages.push({ role: 'tool', tool_call_id: call.id, content: answer })
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
