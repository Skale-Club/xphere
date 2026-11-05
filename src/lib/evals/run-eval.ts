// Agent eval suite runner usable from the app (cron route) and scripts.
// Same cases, same judge and same gates as tests/evals/runner.test.ts, but each
// case is run ONCE and the average/gates are computed from those same results
// (the vitest runner re-runs every case a second time for its aggregate test).

import { runAgent } from '@/lib/agent-runtime'
import { EVAL_CASES, type EvalCase } from '@/lib/evals/golden-set'
import { judgeResponse, type JudgeResult } from '@/lib/evals/judge'

export const AVG_SCORE_GATE = 3.5   // average across all cases
export const MIN_CASE_GATE = 2      // no individual case may score below this

export interface EvalRunInput {
  orgId: string
  agentId: string
  // --- injection points (tests) ---
  cases?: EvalCase[]
  run?: (input: {
    orgId: string
    agentId: string
    channel: EvalCase['channel']
    userMessage: string
    mode: 'production'
    maxSteps: number
  }) => Promise<{ text: string }>
  judge?: typeof judgeResponse
  log?: (line: string) => void
}

/** Counts and scores only: no agent output, no customer data. */
export interface EvalReport {
  cases: number
  errored: number
  average: number
  belowCaseMinimum: number   // score < the case's own minScore
  belowGate: number          // score < MIN_CASE_GATE
  passed: boolean
  scores: Array<{ id: string; score: number | null }>
}

function summarise(c: EvalCase, r: JudgeResult): string {
  const status = r.score >= c.minScore ? 'PASS' : 'FAIL'
  const lines = [
    `${status} [${c.id}] ${c.description}`,
    `  Score: ${r.score}/5 (min: ${c.minScore})`,
    `  Rationale: ${r.rationale}`,
  ]
  if (r.criteriaMisses.length) lines.push(`  Misses: ${r.criteriaMisses.join('; ')}`)
  if (r.violations.length) lines.push(`  Violations: ${r.violations.join('; ')}`)
  return lines.join('\n')
}

export function requireEvalConfig(env: NodeJS.ProcessEnv, orgId: string | null, agentId: string | null): string[] {
  const missing: string[] = []
  if (!env.ANTHROPIC_API_KEY?.trim()) missing.push('ANTHROPIC_API_KEY')
  if (!orgId) missing.push('EVAL_ORG_ID')
  if (!agentId) missing.push('EVAL_AGENT_ID')
  return missing
}

export async function runEvalSuite(input: EvalRunInput): Promise<EvalReport> {
  const cases = input.cases ?? EVAL_CASES
  const run = input.run ?? runAgent
  const judge = input.judge ?? judgeResponse
  const log = input.log ?? ((line: string) => console.log(line))

  const scores: EvalReport['scores'] = []
  let errored = 0
  let belowCaseMinimum = 0
  let belowGate = 0

  for (const c of cases) {
    try {
      const result = await run({
        orgId: input.orgId,
        agentId: input.agentId,
        channel: c.channel,
        userMessage: c.userMessage,
        mode: 'production',
        maxSteps: 3, // cap steps for eval latency
      })
      const judged = await judge({
        userMessage: c.userMessage,
        agentResponse: result.text,
        criteria: c.criteria,
        antiCriteria: c.antiCriteria,
      })
      log(summarise(c, judged))
      scores.push({ id: c.id, score: judged.score })
      if (judged.score < c.minScore) belowCaseMinimum++
      if (judged.score < MIN_CASE_GATE) belowGate++
    } catch (err) {
      // An erroring case counts as a failure of that case, not of the whole run.
      errored++
      belowCaseMinimum++
      belowGate++
      scores.push({ id: c.id, score: null })
      console.error(`[eval-harness] case ${c.id} errored:`, err instanceof Error ? err.message : 'unknown error')
    }
  }

  const scored = scores.filter((s): s is { id: string; score: number } => s.score !== null)
  const average = scored.length ? scored.reduce((sum, s) => sum + s.score, 0) / scored.length : 0
  const passed = errored === 0 && belowCaseMinimum === 0 && belowGate === 0 && average >= AVG_SCORE_GATE

  log(
    `[eval-harness] summary: ${scores.map((s) => `${s.id}=${s.score ?? 'error'}`).join(' ')} ` +
    `average=${average.toFixed(2)} (gate ${AVG_SCORE_GATE}) passed=${passed}`,
  )

  return { cases: cases.length, errored, average, belowCaseMinimum, belowGate, passed, scores }
}
