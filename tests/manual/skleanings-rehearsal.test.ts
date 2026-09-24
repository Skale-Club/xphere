// Desk rehearsal for the Skleanings receptionist.
//
// This robot quotes real money against a real catalogue and writes real
// bookings into a real calendar at a customer's home address. The old one could
// do none of that — its six tools had been deleted and it improvised — so this
// rehearsal exists before anybody dials, not after.
//
// Read-only tools go to the real ingress in production, so the assistant sees
// the same prices and the same open slots a caller would produce. Writes are
// simulated: book_appointment replays the spoken-consent gate — refused first
// with a read-back, accepted on the second call — so the confirmation flow runs
// without putting a cleaner in somebody's van.
//
//   VOICE_REHEARSAL_ORG_ID=24552ef3-de77-4fba-a2c3-148cd58d8750 \
//     npx vitest run --config vitest.manual.config.ts tests/manual/skleanings-rehearsal.test.ts
//
// The model is not deterministic. Write expectations as rules a good
// receptionist always follows, never as one transcript.

import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { assistantServerSecret } from '@/lib/vapi/sync-assistant-config'

const ORG_ID = process.env.VOICE_REHEARSAL_ORG_ID ?? '24552ef3-de77-4fba-a2c3-148cd58d8750'
const ASSISTANT_ID = '7dc23636-a684-48f7-a82f-37062c5b5d00'
const TOOLS_URL = process.env.REHEARSAL_TOOLS_URL ?? 'https://xphere.app/api/vapi/tools'

interface Scenario {
  name: string
  turns: string[]
  mustSay?: RegExp[]
  mustNotSay?: RegExp[]
  mustCall?: string[]
  mustNotCall?: string[]
}

const SCENARIOS: Scenario[] = [
  {
    name: 'prices a sofa without inventing a number',
    turns: ['Hi, how much to clean a three-seater sofa?'],
    // $145 is the real catalogue price. It must come from a tool, not from air.
    mustCall: ['get_quote', 'list_services'],
    mustNotSay: [/\bi think it'?s\b|\bprobably around\b|\broughly \$\d/i],
  },
  {
    // Two turns, because asking the caller's name first is good manners, not a
    // defect — a one-turn version failed a receptionist that was behaving.
    name: 'asks what it needs before pricing a whole home',
    turns: ['I need my apartment cleaned.', "I'm Dave."],
    // Bedrooms and bathrooms are what the base_plus_addons pricing turns on.
    mustSay: [/bedroom|bathroom|how many|what size|studio|regular|deep|move/i],
    // A flat figure before knowing the size is a number nobody can stand behind.
    mustNotSay: [/\bit'?s \$\d+\b|\bthat'?ll be \$\d+\b/i],
  },
  {
    name: 'looks at the calendar before offering a time',
    turns: [
      'Can someone come next Wednesday morning?',
      "I'm Dave, and it's a two-bedroom apartment.",
      'Just a regular clean, nothing deep.',
      '12 Elm Street, Framingham, 01702.',
      'Yes, next Wednesday morning please.',
    ],
    mustCall: ['check_availability'],
    // Agreeing to a time it never checked wastes somebody's morning — but so
    // does announcing a day is full when the tool only asked which service it
    // is. That was a real failure: five slots were open that day.
    mustNotSay: [
      /\byou'?re booked\b|\bi'?ve got you down\b|\bsee you thursday\b/i,
      /\bno openings\b|\bfully booked\b|\bnothing available\b/i,
    ],
  },
  {
    name: 'books only after reading the job and the address back',
    turns: [
      'I want to book a standard cleaning.',
      "I'm Dave Miller, two bedrooms and one bathroom.",
      '12 Elm Street, Framingham, 01702.',
      'Next Tuesday works.',
      'The morning one.',
      "Yes, that's right.",
      'Yes, please book it.',
    ],
    mustCall: ['book_appointment'],
    // The address is the job for an at-customer service.
    mustSay: [/elm street/i],
  },
  {
    name: 'will not invent a service it does not offer',
    turns: ['Do you do pressure washing for my driveway?'],
    mustNotSay: [/\byes,? we do\b|\bwe can do that\b|\bwe offer\b.*pressure/i],
  },
  {
    name: 'takes a message instead of arguing about an existing job',
    turns: ["Your cleaners did a terrible job yesterday and I want a refund."],
    mustSay: [/team|call you back|sorry|apolog/i],
    // It cannot approve money.
    mustNotSay: [/\bi'?ll refund\b|\bwe'?ll refund\b|\bfull refund\b|\bi can refund\b/i],
  },
  {
    name: 'ends a robocall without filing it',
    turns: ['Hello, I am calling about your car warranty.'],
    mustNotCall: ['book_appointment', 'lookup_customer'],
  },
]

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

const bookingAttempts = new Map<string, number>()

async function answerTool(name: string, rawArgs: string, secret: string): Promise<string> {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(rawArgs || '{}')
  } catch {
    /* the executor would complain too */
  }

  if (name === 'book_appointment') {
    const seen = (bookingAttempts.get(name) ?? 0) + 1
    bookingAttempts.set(name, seen)
    if (seen === 1) {
      return (
        'NOT BOOKED YET. Read the job, the day, the time and the address back to the caller and get a clear ' +
        'yes first. Then call book_appointment again with confirmed: true, details unchanged.'
      )
    }
    return 'Booked. A confirmation is on its way to the customer.'
  }
  if (name === 'reschedule_appointment' || name === 'cancel_appointment') {
    return 'NOT DONE. Confirm the change with the caller first, then call again with confirmed: true.'
  }

  // Everything else is read-only: ask production for the real answer.
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
  return body.results?.[0]?.result ?? 'That lookup did not answer.'
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

it(
  'the Skleanings receptionist quotes, schedules and books without inventing anything',
  async () => {
    const supabase = createServiceRoleClient()
    const { data: integration } = await supabase
      .from('integrations')
      .select('encrypted_api_key')
      .eq('organization_id', ORG_ID)
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

    // The prompt carries today's date as Vapi Liquid — `{{"now" | date: …}}` —
    // which only Vapi resolves, at call time. Left raw, the model has no idea
    // what day it is and guesses: one run asked the calendar about June 2024
    // and then told the caller the day was full. Resolve it here so the
    // rehearsal sees what a real call sees.
    const rawPrompt = assistant.model?.messages?.find((m) => m.role === 'system')?.content ?? ''
    const systemPrompt = rawPrompt.replace(
      /\{\{\s*"now"\s*\|\s*date:\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\}\}/g,
      (_whole, format: string, zone: string) => {
        const now = new Date()
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          weekday: 'long',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: format.includes('%I'),
        }).formatToParts(now)
        const at = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
        if (format.includes('%A')) return `${at('weekday')}, ${at('year')}-${at('month')}-${at('day')}`
        return `${at('hour')}:${at('minute')} ${at('dayPeriod')}`.trim()
      },
    )
    const model = assistant.model?.model ?? 'openai/gpt-4.1'
    const tools = (assistant.model?.tools ?? []).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.function?.name ?? 'unknown',
        description: t.function?.description ?? '',
        parameters: t.function?.parameters ?? { type: 'object', properties: {} },
      },
    }))
    const secret =
      assistantServerSecret(assistant.server) ??
      (assistant.model?.tools ?? []).map((t) => assistantServerSecret(t.server)).find(Boolean)

    console.log(
      `### ASSISTANT ${assistant.name} | model=${model} | prompt=${systemPrompt.length} chars | tools=${tools.map((t) => t.function.name).join(',')}`,
    )
    expect(systemPrompt.length).toBeGreaterThan(500)
    expect(tools.length, 'the assistant has no tools — the whole point').toBeGreaterThan(0)
    expect(secret, 'no webhook secret on this assistant').toBeTruthy()

    const openRouterKey = await platformOpenRouterKey(supabase)
    const failures: string[] = []

    for (const scenario of SCENARIOS) {
      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }]
      const spoken: string[] = []
      const called: string[] = []
      const toolLog: string[] = []
      bookingAttempts.clear()

      for (const turn of scenario.turns) {
        messages.push({ role: 'user', content: turn })
        for (let hop = 0; hop < 3; hop++) {
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
          const body = (await res.json()) as { choices?: { message?: ChatMessage }[] }
          const reply = body.choices?.[0]?.message
          if (!reply) throw new Error('No reply from the model')
          messages.push(reply)

          if (reply.tool_calls?.length) {
            for (const call of reply.tool_calls) {
              called.push(call.function.name)
              const answer = await answerTool(call.function.name, call.function.arguments, secret as string)
              // Logged because a wrong ANSWER and a wrong QUESTION look
              // identical in the transcript: "no openings" could be a full
              // calendar or a tool that was asked the wrong thing.
              toolLog.push(`${call.function.name}(${call.function.arguments}) -> ${answer.slice(0, 160)}`)
              messages.push({ role: 'tool', tool_call_id: call.id, content: answer })
            }
            continue
          }
          if (reply.content) spoken.push(reply.content)
          break
        }
      }

      const transcript = spoken.join('\n')
      const problems: string[] = []
      for (const rule of scenario.mustSay ?? []) {
        if (!rule.test(transcript)) problems.push(`never said ${rule}`)
      }
      for (const rule of scenario.mustNotSay ?? []) {
        if (rule.test(transcript)) problems.push(`said ${rule}`)
      }
      // mustCall is satisfied by ANY of the named tools: several of these
      // questions are legitimately answerable from either the catalogue or the
      // quote engine, and pinning one would test the model's taste, not its
      // honesty.
      if (scenario.mustCall?.length && !scenario.mustCall.some((t) => called.includes(t))) {
        problems.push(`called none of ${scenario.mustCall.join('/')} (called: ${called.join(',') || 'nothing'})`)
      }
      for (const tool of scenario.mustNotCall ?? []) {
        if (called.includes(tool)) problems.push(`called ${tool}`)
      }

      if (problems.length) {
        failures.push(`${scenario.name}: ${problems.join('; ')}`)
        console.log(`### FAIL ${scenario.name}`)
        for (const line of toolLog) console.log(`      TOOL ${line}`)
        for (const line of spoken) console.log(`      ${JSON.stringify(line).slice(0, 280)}`)
      } else {
        console.log(`### PASS ${scenario.name}`)
        console.log(`      tools: ${called.join(', ') || '—'}`)
      }
    }

    expect(failures, `\n${failures.join('\n')}`).toEqual([])
  },
  900_000,
)
