// tests/evals/judge.ts
// LLM-as-judge for the eval harness (Project 2, Q2).
// Uses Claude Sonnet (via Anthropic SDK) to evaluate an agent response against
// a set of criteria.  Returns a numeric score (1–5) and a concise rationale.
//
// Design notes:
// - Judge model is intentionally different from the agent model (Haiku) to
//   avoid self-grading bias.
// - Criteria are presented as positive statements; anti-criteria are flagged as
//   violations.
// - JSON output is requested explicitly and parsed with a fallback.

import Anthropic from '@anthropic-ai/sdk'

const JUDGE_MODEL = 'claude-sonnet-4-5'

export type JudgeInput = {
  userMessage: string
  agentResponse: string
  criteria: string[]
  antiCriteria?: string[]
}

export type JudgeResult = {
  score: number         // integer 1–5
  rationale: string    // 1–3 sentences explaining the score
  criteriaHits: string[]  // criteria that were clearly met
  criteriaMisses: string[]  // criteria that were not met
  violations: string[]   // anti-criteria that were triggered
}

const JUDGE_SYSTEM_PROMPT = `You are an expert evaluator of conversational AI agents.
Your task is to score an agent response on a scale of 1–5 based on provided criteria.

Scoring rubric:
5 — All criteria met; response is excellent and no anti-criteria violated.
4 — Most criteria met with only minor gaps; no anti-criteria violated.
3 — Some criteria met but notable gaps; no or minor anti-criteria violations.
2 — Few criteria met; anti-criteria may be violated.
1 — Criteria largely unmet or anti-criteria clearly violated.

Respond ONLY with valid JSON in this exact shape (no markdown fences):
{
  "score": <integer 1-5>,
  "rationale": "<1-3 sentences>",
  "criteriaHits": ["<criterion text>", ...],
  "criteriaMisses": ["<criterion text>", ...],
  "violations": ["<anti-criterion text>", ...]
}`.trim()

function buildJudgePrompt(input: JudgeInput): string {
  const lines: string[] = [
    `User message: "${input.userMessage}"`,
    '',
    `Agent response: "${input.agentResponse}"`,
    '',
    'Criteria (positive — should be met):',
    ...input.criteria.map((c, i) => `  ${i + 1}. ${c}`),
  ]

  if (input.antiCriteria && input.antiCriteria.length > 0) {
    lines.push(
      '',
      'Anti-criteria (negative — must NOT be present):',
      ...input.antiCriteria.map((c, i) => `  ${i + 1}. ${c}`),
    )
  }

  lines.push('', 'Evaluate the agent response and return the JSON score object.')
  return lines.join('\n')
}

export async function judgeResponse(input: JudgeInput): Promise<JudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — cannot run LLM judge')

  const client = new Anthropic({ apiKey })

  const message = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 512,
    system: JUDGE_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: buildJudgePrompt(input) },
    ],
  })

  const textBlock = message.content.find((b) => b.type === 'text')
  const raw = textBlock?.type === 'text' ? textBlock.text.trim() : ''

  try {
    const parsed = JSON.parse(raw) as {
      score: number
      rationale: string
      criteriaHits: string[]
      criteriaMisses: string[]
      violations: string[]
    }
    return {
      score: Math.max(1, Math.min(5, Math.round(parsed.score))),
      rationale: parsed.rationale ?? '',
      criteriaHits: parsed.criteriaHits ?? [],
      criteriaMisses: parsed.criteriaMisses ?? [],
      violations: parsed.violations ?? [],
    }
  } catch {
    // Fallback: extract score from text if JSON parse fails
    const scoreMatch = raw.match(/"score"\s*:\s*(\d)/)
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 1
    return {
      score: Math.max(1, Math.min(5, score)),
      rationale: raw.slice(0, 200),
      criteriaHits: [],
      criteriaMisses: input.criteria,
      violations: [],
    }
  }
}
