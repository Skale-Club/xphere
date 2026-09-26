// Map command-engine outcomes to HTTP responses for the dashboard routes.

import type { EngineFailure, ExecutionSuccess, PreviewSuccess } from './engine'

const STATUS_BY_CODE: Record<string, number> = {
  invalid_command: 400,
  invalid_input: 400,
  unsupported_command: 422,
  forbidden: 403,
  missing_permission: 403,
  approval_requires_human: 403,
  not_found: 404,
  resource_not_found: 404,
  no_connection: 404,
  state_conflict: 409,
  invalid_state: 409,
  already_exists: 409,
  no_op: 409,
  expired: 410,
  policy_blocked: 422,
  invalid_confirmation: 422,
  not_reversible: 422,
  no_budget: 422,
  adset_budgets: 422,
  campaign_budget: 422,
  lifetime_budget: 422,
  resource_removed: 422,
  resource_archived: 422,
  end_in_past: 422,
  provider_rejected: 422,
  connection_error: 424,
  retry_scheduled: 202,
  provider_unavailable: 503,
  circuit_open: 503,
  retries_exhausted: 502,
}

export function engineResponse(result: PreviewSuccess | ExecutionSuccess | EngineFailure): Response {
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.message, code: result.code, violations: result.violations, change: result.change },
      { status: STATUS_BY_CODE[result.code] ?? 502 },
    )
  }
  const { change } = result
  const pending = change.status === 'awaiting_approval'
  return Response.json(
    {
      ok: true,
      change,
      pending_approval: pending,
      ...('confirmationToken' in result && result.confirmationToken ? { confirmation_token: result.confirmationToken } : {}),
    },
    { status: pending || change.status === 'queued' ? 202 : 200 },
  )
}
