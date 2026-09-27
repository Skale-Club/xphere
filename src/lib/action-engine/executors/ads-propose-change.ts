// Workflow action: propose an ad change through the Ads Command Engine.
//
// A workflow never applies an ad change by itself. It previews one — the
// engine snapshots the resource, computes the diff, checks the account policy
// and asks the platform to validate — and the change waits in Ads → Changes
// for a human with ads.approve. Only low-risk commands (reversible settings and
// targeting, risk ≤ 2) are allowed from automation; bids, strategy and
// structural changes must come from a person or an AI session with a human
// in the loop.

import { workflowActor } from '@/lib/ads/commands/actors'
import { COMMAND_CATALOG, parseCommand } from '@/lib/ads/commands/catalog'
import { previewChange } from '@/lib/ads/commands/engine'

export const WORKFLOW_MAX_RISK = 2

export async function executeAdsProposeChange(
  params: Record<string, unknown>,
  ctx: { organizationId: string; workflowLabel?: string },
): Promise<string> {
  const parsed = parseCommand(params.command)
  if (!parsed.ok) throw new Error(`ads_propose_change: invalid command — ${parsed.message}`)

  const entry = COMMAND_CATALOG[parsed.command.type]
  if (entry.risk > WORKFLOW_MAX_RISK) {
    throw new Error(
      `ads_propose_change: ${parsed.command.type} is risk ${entry.risk}; workflows may only propose risk ≤ ${WORKFLOW_MAX_RISK} changes (status, budget, names, dates, targeting, keywords).`,
    )
  }

  const result = await previewChange({
    orgId: ctx.organizationId,
    actor: workflowActor(ctx.workflowLabel ?? 'workflow'),
    command: parsed.command,
    idempotencyKey: typeof params.idempotency_key === 'string' && params.idempotency_key.length >= 8 ? params.idempotency_key : undefined,
  })

  if (!result.ok) {
    // A no-op (already at the target value) is a normal outcome for an
    // automation re-running on the same condition, not a failure.
    if (result.code === 'no_op' || result.code === 'already_exists') {
      return JSON.stringify({ ok: true, skipped: true, reason: result.message })
    }
    throw new Error(`ads_propose_change: ${result.code} — ${result.message}`)
  }

  const change = result.change
  return JSON.stringify({
    ok: true,
    change_id: change.id,
    status: change.status,
    action: change.label,
    resource: change.resource_name ?? change.resource_id,
    diff: change.diff.map((d) => `${d.label}: ${d.beforeDisplay} → ${d.afterDisplay}`),
    warnings: change.warnings,
    duplicate: result.duplicate,
    review_url: '/ads/changes',
  })
}
