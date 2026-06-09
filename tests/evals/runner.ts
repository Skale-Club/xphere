// tests/evals/runner.ts
// Eval harness runner (Project 2, Q2).
// Runs each golden-set case through runAgent(), judges the response, and
// reports per-case and aggregate results.
//
// Required env vars (from .env.local or CI secrets):
//   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY      — service-role key (bypasses RLS)
//   ANTHROPIC_API_KEY              — key for both agent + judge LLM calls
//   EVAL_ORG_ID                    — org under which the eval agent lives
//   EVAL_AGENT_ID                  — agent ID to evaluate (must be is_active=true)
//
// Run locally:
//   npx vitest run tests/evals/runner.ts --reporter=verbose
//
// CI gate:
//   Average score must be >= AVG_SCORE_GATE
//   No case may score below MIN_CASE_GATE

import { describe, it, expect, beforeAll } from 'vitest'
import { runAgent } from '@/lib/agent-runtime'
import { EVAL_CASES, type EvalCase } from './golden-set'
import { judgeResponse, type JudgeResult } from './judge'

// ---------------------------------------------------------------------------
// Gate thresholds
// ---------------------------------------------------------------------------

const AVG_SCORE_GATE = 3.5   // average across all cases
const MIN_CASE_GATE = 2      // no individual case may score below this

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summariseResult(c: EvalCase, r: JudgeResult): string {
  const status = r.score >= c.minScore ? '✅ PASS' : '❌ FAIL'
  const lines = [
    `${status} [${c.id}] ${c.description}`,
    `  Score: ${r.score}/5 (min: ${c.minScore})`,
    `  Rationale: ${r.rationale}`,
  ]
  if (r.criteriaMisses.length) {
    lines.push(`  Misses: ${r.criteriaMisses.join('; ')}`)
  }
  if (r.violations.length) {
    lines.push(`  Violations: ${r.violations.join('; ')}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Agent eval harness', () => {
  const orgId = process.env.EVAL_ORG_ID
  const agentId = process.env.EVAL_AGENT_ID

  beforeAll(() => {
    if (!orgId || !agentId) {
      console.warn(
        '[eval-harness] EVAL_ORG_ID or EVAL_AGENT_ID not set — skipping eval suite.\n' +
        'Set both env vars to run quality evals against a real agent.',
      )
    }
  })

  // Individual case tests
  for (const c of EVAL_CASES) {
    it(`[${c.id}] ${c.description}`, async () => {
      if (!orgId || !agentId) {
        // Skip gracefully without failing CI when env vars are absent.
        // Use console to communicate; Vitest treats skips as neutral.
        console.log(`[eval-harness] Skipping ${c.id} — EVAL_ORG_ID/EVAL_AGENT_ID not set`)
        return
      }

      // Run agent
      const result = await runAgent({
        orgId,
        agentId,
        channel: c.channel,
        userMessage: c.userMessage,
        mode: 'production',
        maxSteps: 3, // cap steps for eval latency
      })

      const agentResponse = result.text

      // Judge the response
      const judgeResult = await judgeResponse({
        userMessage: c.userMessage,
        agentResponse,
        criteria: c.criteria,
        antiCriteria: c.antiCriteria,
      })

      // Log detailed result for CI output
      console.log(summariseResult(c, judgeResult))

      // Assert gate thresholds
      expect(
        judgeResult.score,
        `Case ${c.id} scored ${judgeResult.score}/5 — min acceptable: ${c.minScore}.\n${judgeResult.rationale}`,
      ).toBeGreaterThanOrEqual(MIN_CASE_GATE)

      expect(
        judgeResult.score,
        `Case ${c.id} scored below its case-level minimum (${c.minScore}).\n${judgeResult.rationale}`,
      ).toBeGreaterThanOrEqual(c.minScore)
    })
  }

  // Aggregate gate
  it('aggregate average score meets gate', async () => {
    if (!orgId || !agentId) {
      console.log('[eval-harness] Skipping aggregate gate — EVAL_ORG_ID/EVAL_AGENT_ID not set')
      return
    }

    const results: Array<{ id: string; score: number }> = []

    for (const c of EVAL_CASES) {
      const result = await runAgent({
        orgId,
        agentId,
        channel: c.channel,
        userMessage: c.userMessage,
        mode: 'production',
        maxSteps: 3,
      })

      const judgeResult = await judgeResponse({
        userMessage: c.userMessage,
        agentResponse: result.text,
        criteria: c.criteria,
        antiCriteria: c.antiCriteria,
      })

      results.push({ id: c.id, score: judgeResult.score })
    }

    const avg = results.reduce((s, r) => s + r.score, 0) / results.length
    const below = results.filter((r) => r.score < MIN_CASE_GATE)

    console.log(
      `\n📊 Eval summary:\n` +
      results.map((r) => `  ${r.id}: ${r.score}/5`).join('\n') +
      `\n  Average: ${avg.toFixed(2)} (gate: ${AVG_SCORE_GATE})\n`,
    )

    expect(
      avg,
      `Average score ${avg.toFixed(2)} < gate ${AVG_SCORE_GATE}. Cases: ${results.map((r) => `${r.id}:${r.score}`).join(', ')}`,
    ).toBeGreaterThanOrEqual(AVG_SCORE_GATE)

    expect(
      below.length,
      `Cases below MIN_CASE_GATE (${MIN_CASE_GATE}): ${below.map((r) => r.id).join(', ')}`,
    ).toBe(0)
  })
})
