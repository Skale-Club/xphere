// src/lib/agent-runtime/builtin-tools.ts
// Built-in primitive agent tools | always available to every agent with no
// configuration, no per-agent attachment and no integration credentials.
// These are pure utilities with no side effects, so they need no idempotency,
// authorization gating or demo-org guard.
//
//   calculator | safe arithmetic evaluation (recursive descent | NO eval / Function)
//   think      | a no-op reasoning scratchpad (Anthropic "think tool" pattern)
//
// Injected into the ToolSet from both runAgentBlocking and runAgentStreaming,
// right next to the workflow and partner tools.

import { dynamicTool, jsonSchema } from 'ai'
import type { Json, Database } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Safe math expression evaluator (recursive descent | NO eval, NO Function)
// ---------------------------------------------------------------------------
// Mirrors the codebase's deliberate avoidance of arbitrary code execution
// (see src/lib/flows/interpolate.ts). Supports + - * / % ^, parentheses,
// unary +/-, named constants and a fixed set of math functions.

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: string }
  | { type: 'id'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  const re = /\s+|(\d*\.?\d+(?:[eE][+-]?\d+)?)|([a-zA-Z_]\w*)|([+\-*/%^(),])/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    if (m.index !== lastIndex) {
      throw new Error(`unexpected character "${input[lastIndex]}"`)
    }
    lastIndex = re.lastIndex
    if (m[1] !== undefined) {
      const n = Number(m[1])
      if (!Number.isFinite(n)) throw new Error(`invalid number "${m[1]}"`)
      tokens.push({ type: 'num', value: n })
    } else if (m[2] !== undefined) {
      tokens.push({ type: 'id', value: m[2].toLowerCase() })
    } else if (m[3] !== undefined) {
      const ch = m[3]
      if (ch === '(') tokens.push({ type: 'lparen' })
      else if (ch === ')') tokens.push({ type: 'rparen' })
      else if (ch === ',') tokens.push({ type: 'comma' })
      else tokens.push({ type: 'op', value: ch })
    }
    // group 0 (whitespace) → skip
  }
  if (lastIndex !== input.length) {
    throw new Error(`unexpected character "${input[lastIndex]}"`)
  }
  return tokens
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
}

function one(a: number[], name: string): number {
  if (a.length !== 1) throw new Error(`${name}() expects 1 argument`)
  return a[0]
}
function two(a: number[], name: string): [number, number] {
  if (a.length !== 2) throw new Error(`${name}() expects 2 arguments`)
  return [a[0], a[1]]
}
function atLeastOne(a: number[], name: string): number[] {
  if (a.length < 1) throw new Error(`${name}() expects at least 1 argument`)
  return a
}

const FUNCTIONS: Record<string, (a: number[]) => number> = {
  sqrt: (a) => Math.sqrt(one(a, 'sqrt')),
  cbrt: (a) => Math.cbrt(one(a, 'cbrt')),
  abs: (a) => Math.abs(one(a, 'abs')),
  round: (a) => Math.round(one(a, 'round')),
  floor: (a) => Math.floor(one(a, 'floor')),
  ceil: (a) => Math.ceil(one(a, 'ceil')),
  trunc: (a) => Math.trunc(one(a, 'trunc')),
  sign: (a) => Math.sign(one(a, 'sign')),
  ln: (a) => Math.log(one(a, 'ln')),
  log: (a) => (a.length === 2 ? Math.log(a[0]) / Math.log(a[1]) : Math.log10(one(a, 'log'))),
  log2: (a) => Math.log2(one(a, 'log2')),
  log10: (a) => Math.log10(one(a, 'log10')),
  exp: (a) => Math.exp(one(a, 'exp')),
  pow: (a) => Math.pow(...two(a, 'pow')),
  mod: (a) => { const [x, y] = two(a, 'mod'); return x % y },
  min: (a) => Math.min(...atLeastOne(a, 'min')),
  max: (a) => Math.max(...atLeastOne(a, 'max')),
  hypot: (a) => Math.hypot(...atLeastOne(a, 'hypot')),
  sin: (a) => Math.sin(one(a, 'sin')),
  cos: (a) => Math.cos(one(a, 'cos')),
  tan: (a) => Math.tan(one(a, 'tan')),
  asin: (a) => Math.asin(one(a, 'asin')),
  acos: (a) => Math.acos(one(a, 'acos')),
  atan: (a) => Math.atan(one(a, 'atan')),
  atan2: (a) => Math.atan2(...two(a, 'atan2')),
  root: (a) => { const [x, n] = two(a, 'root'); return Math.sign(x) * Math.pow(Math.abs(x), 1 / n) },
}

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }
  private next(): Token {
    const t = this.tokens[this.pos++]
    if (!t) throw new Error('unexpected end of expression')
    return t
  }

  parse(): number {
    if (this.tokens.length === 0) throw new Error('empty expression')
    const v = this.parseAdd()
    if (this.pos !== this.tokens.length) throw new Error('unexpected trailing input')
    return v
  }

  private parseAdd(): number {
    let left = this.parseMul()
    for (;;) {
      const t = this.peek()
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.pos++
        const right = this.parseMul()
        left = t.value === '+' ? left + right : left - right
      } else break
    }
    return left
  }

  private parseMul(): number {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t?.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.pos++
        const right = this.parseUnary()
        if (t.value === '*') left = left * right
        else if (t.value === '/') left = left / right
        else left = left % right
      } else break
    }
    return left
  }

  private parseUnary(): number {
    const t = this.peek()
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      this.pos++
      const operand = this.parseUnary()
      return t.value === '-' ? -operand : operand
    }
    return this.parsePow()
  }

  // Right-associative power; exponent may carry its own unary sign (2^-3).
  private parsePow(): number {
    const base = this.parsePrimary()
    const t = this.peek()
    if (t?.type === 'op' && t.value === '^') {
      this.pos++
      const exp = this.parseUnary()
      return Math.pow(base, exp)
    }
    return base
  }

  private parsePrimary(): number {
    const t = this.next()
    if (t.type === 'num') return t.value
    if (t.type === 'lparen') {
      const v = this.parseAdd()
      const close = this.next()
      if (close.type !== 'rparen') throw new Error('expected ")"')
      return v
    }
    if (t.type === 'id') {
      const name = t.value
      if (this.peek()?.type === 'lparen') {
        this.pos++ // consume '('
        const args: number[] = []
        if (this.peek()?.type !== 'rparen') {
          args.push(this.parseAdd())
          while (this.peek()?.type === 'comma') {
            this.pos++
            args.push(this.parseAdd())
          }
        }
        const close = this.next()
        if (close.type !== 'rparen') throw new Error('expected ")"')
        const fn = FUNCTIONS[name]
        if (!fn) throw new Error(`unknown function "${name}"`)
        return fn(args)
      }
      if (name in CONSTANTS) return CONSTANTS[name]
      throw new Error(`unknown identifier "${name}"`)
    }
    throw new Error('unexpected token in expression')
  }
}

/**
 * Evaluate a math expression safely. Throws on invalid input or non-finite
 * results. No eval / Function — only a fixed grammar of numbers, operators,
 * named constants and whitelisted functions.
 */
export function evaluateMathExpression(expression: string): number {
  if (typeof expression !== 'string') throw new Error('expression must be a string')
  if (expression.length > 1000) throw new Error('expression too long')
  const result = new Parser(tokenize(expression)).parse()
  if (!Number.isFinite(result)) throw new Error('result is not a finite number')
  return result
}

// ---------------------------------------------------------------------------
// Date / time helpers (timezone-aware | no external deps)
// ---------------------------------------------------------------------------

/** Minutes that `timeZone` is ahead of UTC at the given instant (DST-aware). */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const map: Record<string, number> = {}
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second)
  return Math.round((asUtc - date.getTime()) / 60000)
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  return `${sign}${hh}:${mm}`
}

/** Human + ISO description of "now" in an IANA timezone. Throws if invalid. */
function describeNowInTimeZone(timeZone: string): string {
  const now = new Date()
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'long',
  })
  const parts = dtf.formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const hh = get('hour')
  const mm = get('minute')
  const ss = get('second')
  const weekday = get('weekday')
  const offset = formatOffset(tzOffsetMinutes(now, timeZone))
  const iso = `${date}T${hh}:${mm}:${ss}${offset}`
  return `Current date and time in ${timeZone}: ${weekday}, ${date} ${hh}:${mm} (UTC${offset}). ISO 8601: ${iso}.`
}

async function fetchOrgTimezone(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<string> {
  try {
    const { data } = await client
      .from('organizations')
      .select('timezone')
      .eq('id', orgId)
      .maybeSingle()
    return data?.timezone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const CALCULATOR_DESCRIPTION =
  'Evaluate a mathematical expression and return the exact numeric result. ' +
  'Use this for ANY non-trivial arithmetic (totals, multiplication, division, ' +
  'percentages, powers) instead of computing it in your head. Supports + - * / % ^, ' +
  'parentheses, and functions sqrt, cbrt, abs, round, floor, ceil, min, max, pow, mod, ' +
  'ln, log, log2, exp, sin, cos, tan, hypot, plus the constants pi and e. ' +
  'Example: { "expression": "(1290.5 * 3) * 1.07" }.'

const THINK_DESCRIPTION =
  'A private scratchpad for your own step-by-step reasoning. Call this BEFORE acting ' +
  'when a task needs planning, when you must weigh options, follow rules/policies, or ' +
  'chain multiple tools. It performs NO action, fetches NO data and changes NOTHING — ' +
  'it only records your thought so you reason more carefully. The user never sees it. ' +
  'Input: { "thought": "..." }.'

const DATETIME_DESCRIPTION =
  'Get the current date and time. Call this whenever you need to know "now" — to ' +
  'resolve relative dates ("today", "tomorrow", "next Monday"), compute how far away ' +
  'an appointment is, or stamp something. Defaults to the organization timezone; pass ' +
  'an IANA timezone (e.g. "America/Sao_Paulo") to override. Returns the weekday, date, ' +
  'local time and an ISO 8601 timestamp. Input: { "timezone"?: "America/Sao_Paulo" }.'

const HANDOFF_DESCRIPTION =
  'Hand the conversation off to a human operator. Call this when the customer explicitly ' +
  'asks for a human, when you cannot help, or when the situation needs human judgement ' +
  '(complaints, sensitive issues, anything outside your tools). It pauses the assistant ' +
  'for this conversation so a human takes over — use it instead of guessing. ' +
  'Input: { "reason"?: "short reason for the handoff" }.'

/**
 * Build the always-on built-in tools. The toolCallsLog / index are threaded
 * through so built-in calls show up in agent_invocations.tool_calls exactly
 * like workflow and partner tools.
 */
export function buildBuiltinTools(params: {
  toolCallsLog: Json[]
  getNextToolCallIndex: () => number
  /** Service-role client | used by datetime (org timezone) and handoff. */
  serviceClient: SupabaseClient<Database>
  orgId: string
  /** Present in real conversations; absent in playground → handoff is a no-op. */
  conversationId?: string
}): Record<string, ReturnType<typeof dynamicTool>> {
  const { toolCallsLog, getNextToolCallIndex, serviceClient, orgId, conversationId } = params

  const calculator = dynamicTool({
    description: CALCULATOR_DESCRIPTION,
    inputSchema: jsonSchema<{ expression?: string }>({
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'The math expression to evaluate.' },
      },
      required: ['expression'],
    }),
    execute: async (args: unknown) => {
      const index = getNextToolCallIndex()
      const expression = String((args as { expression?: unknown } | null)?.expression ?? '')
      let result: string
      try {
        result = String(evaluateMathExpression(expression))
      } catch (err) {
        result = `Calculator error: ${err instanceof Error ? err.message : String(err)}`
      }
      toolCallsLog.push({
        name: 'calculator',
        args: { expression },
        result,
        denied: false,
        tool_call_index: index,
      })
      return result
    },
  })

  const think = dynamicTool({
    description: THINK_DESCRIPTION,
    inputSchema: jsonSchema<{ thought?: string }>({
      type: 'object',
      properties: {
        thought: { type: 'string', description: 'Your private step-by-step reasoning.' },
      },
      required: ['thought'],
    }),
    execute: async (args: unknown) => {
      const index = getNextToolCallIndex()
      const thought = String((args as { thought?: unknown } | null)?.thought ?? '')
      const result = 'Thought recorded. Continue.'
      toolCallsLog.push({
        name: 'think',
        args: { thought },
        result,
        denied: false,
        tool_call_index: index,
      })
      return result
    },
  })

  const datetime = dynamicTool({
    description: DATETIME_DESCRIPTION,
    inputSchema: jsonSchema<{ timezone?: string }>({
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'Optional IANA timezone, e.g. "America/Sao_Paulo". Defaults to the org timezone.',
        },
      },
    }),
    execute: async (args: unknown) => {
      const index = getNextToolCallIndex()
      const requested = String((args as { timezone?: unknown } | null)?.timezone ?? '').trim()
      let tz = requested || (await fetchOrgTimezone(serviceClient, orgId))
      let result: string
      try {
        result = describeNowInTimeZone(tz)
      } catch {
        tz = 'UTC'
        result = describeNowInTimeZone('UTC')
      }
      toolCallsLog.push({
        name: 'datetime',
        args: { timezone: tz },
        result,
        denied: false,
        tool_call_index: index,
      })
      return result
    },
  })

  const handoffToHuman = dynamicTool({
    description: HANDOFF_DESCRIPTION,
    inputSchema: jsonSchema<{ reason?: string }>({
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Short reason for the handoff (optional).' },
      },
    }),
    execute: async (args: unknown) => {
      const index = getNextToolCallIndex()
      const reason = String((args as { reason?: unknown } | null)?.reason ?? '').trim()
      let result: string
      if (!conversationId) {
        result = 'Handoff is not available in this context (no active conversation).'
      } else {
        try {
          await serviceClient
            .from('conversations')
            .update({ bot_status: 'paused', updated_at: new Date().toISOString() })
            .eq('id', conversationId)
          // Best-effort system timeline note (never blocks the handoff).
          try {
            await serviceClient.from('conversation_messages').insert({
              conversation_id: conversationId,
              org_id: orgId,
              role: 'system',
              content: reason
                ? `🙋 Handoff to a human requested: ${reason}`
                : '🙋 Handoff to a human requested.',
              metadata: { type: 'handoff', reason: reason || null },
            })
          } catch {
            // timeline note is non-critical
          }
          result =
            'Conversation handed off to a human. The assistant is now paused for this conversation.'
        } catch (err) {
          result = `Handoff failed: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      toolCallsLog.push({
        name: 'handoff_to_human',
        args: { reason },
        result,
        denied: false,
        tool_call_index: index,
      })
      return result
    },
  })

  return { calculator, think, datetime, handoff_to_human: handoffToHuman }
}

export const BUILTIN_TOOLS_SYSTEM_SUFFIX = `

## Built-in tools
You always have these utility tools available:
- "calculator": use it for any non-trivial arithmetic instead of computing in your head — it returns exact results.
- "think": use it as a private scratchpad to plan or reason before acting on multi-step tasks. It has no side effects and is never shown to the user.
- "datetime": call it whenever you need the current date/time or must resolve relative dates ("today", "tomorrow", "in 2 hours"). Never guess the date.
- "handoff_to_human": call it when the customer asks for a human or the situation is beyond your tools — it pauses the assistant so a human takes over.`
