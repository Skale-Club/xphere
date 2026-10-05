// The Ads Command Engine — the only path from "someone wants to change an ad
// account" to a provider write.
//
//   preview   parse → load credential → snapshot → plan (diff) → policy →
//             provider validate-only → ledger row (awaiting_approval)
//   approve   authorize the approver → re-check policy → queued → execute
//   execute   claim → re-snapshot → optimistic-concurrency check (before
//             hash) → provider write → read-back verification → journey
//   rollback  build the inverse command from the stored "before" state and
//             preview it as a NEW change (history is never rewritten)
//
// Entry points (dashboard routes, MCP tools, Copilot, cron) resolve the actor
// and its permissions, then call into here. Nothing else calls an adapter's
// execute().

import { invalidateAccountReports } from '../cache'
import { markConnectionError } from '../connection-health'
import { recordMutationExecution } from '../journey-db'
import { getAdapter, loadAdapterContext } from '../providers'
import type { AdapterContext, AdsProviderAdapter } from '../providers/types'
import { COMMAND_CATALOG, parseCommand, targetResourceId, type AdsCommand } from './catalog'
import { hashState, newConfirmationToken, sha256, stableStringify } from './hash'
import { evaluatePolicy, loadEffectivePolicy, type PolicyViolation } from './policies'
import {
  appendEvent,
  dueQueuedChanges,
  getChangeRow,
  insertChange,
  listChangeEvents,
  listChangeRows,
  staleApprovals,
  stuckChanges,
  recentAccountFailures,
  changesToReconcile,
  hasLaterChange,
  updateReconciliation,
  transition,
  type ChangeFilters,
  type ChangeRow,
  type EventActor,
} from './store'
import type { AdsActor, ChangeStatus, DiffEntry, PolicyFacts, ResourceSnapshot, RiskLevel } from './types'
import { TERMINAL_STATUSES } from './types'
import type { Json } from '@/types/database'

export const MAX_ATTEMPTS = 5

/**
 * Circuit breaker: after this many transient failures on one ad account in the
 * window, executions for that account pause instead of adding to the storm.
 */
export const CIRCUIT_THRESHOLD = 5
export const CIRCUIT_WINDOW_MINUTES = 10

// ─── Public shapes ────────────────────────────────────────────────────────────

export type ChangeView = {
  id: string
  platform: 'meta' | 'google' | 'google_business'
  ad_account_id: string
  command_type: string
  label: string
  command: AdsCommand
  resource_type: string
  resource_id: string | null
  resource_name: string | null
  campaign_id: string | null
  status: ChangeStatus
  risk_level: number
  diff: DiffEntry[]
  warnings: string[]
  approval_required: boolean
  approval_reasons: PolicyViolation[]
  approval_expires_at: string | null
  approved_by_label: string | null
  approved_at: string | null
  actor_type: string
  actor_label: string | null
  attempt_count: number
  next_attempt_at: string | null
  error_code: string | null
  error_message: string | null
  verification: unknown
  provider_ref: string | null
  rollback_of: string | null
  batch_id: string | null
  created_at: string
  executed_at: string | null
  completed_at: string | null
  /** Set when the platform no longer matches what this change applied (edited outside Xphere). */
  external_drift: unknown
  external_drift_detected_at: string | null
  last_reconciled_at: string | null
}

export type EngineFailure = {
  ok: false
  code: string
  message: string
  violations?: PolicyViolation[]
  change?: ChangeView
}

export type PreviewSuccess = {
  ok: true
  change: ChangeView
  /** Present only for machine actors: echo it to ads_approve_change to confirm this exact diff. */
  confirmationToken?: string
  duplicate: boolean
}

export type ExecutionSuccess = { ok: true; change: ChangeView }

type StoredPolicyVerdict = {
  approval_reasons?: PolicyViolation[]
  facts?: PolicyFacts
}

export function toChangeView(row: ChangeRow): ChangeView {
  const verdict = (row.policy_verdict ?? {}) as StoredPolicyVerdict
  return {
    id: row.id,
    platform: row.platform as 'meta' | 'google' | 'google_business',
    ad_account_id: row.ad_account_id,
    command_type: row.command_type,
    label: COMMAND_CATALOG[row.command_type as AdsCommand['type']]?.label ?? row.command_type,
    command: row.payload as unknown as AdsCommand,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    resource_name: row.resource_name,
    campaign_id: row.campaign_id,
    status: row.status as ChangeStatus,
    risk_level: row.risk_level,
    diff: (row.diff ?? []) as unknown as DiffEntry[],
    warnings: (row.warnings ?? []) as unknown as string[],
    approval_required: row.approval_required,
    approval_reasons: verdict.approval_reasons ?? [],
    approval_expires_at: row.approval_expires_at,
    approved_by_label: row.approved_by_label,
    approved_at: row.approved_at,
    actor_type: row.actor_type,
    actor_label: row.actor_label,
    attempt_count: row.attempt_count,
    next_attempt_at: row.next_attempt_at,
    error_code: row.error_code,
    error_message: row.error_message,
    verification: row.verification,
    provider_ref: row.provider_ref,
    rollback_of: row.rollback_of,
    batch_id: row.batch_id,
    created_at: row.created_at,
    executed_at: row.executed_at,
    completed_at: row.completed_at,
    external_drift: row.external_drift,
    external_drift_detected_at: row.external_drift_detected_at,
    last_reconciled_at: row.last_reconciled_at,
  }
}

function fail(code: string, message: string, extra: Partial<EngineFailure> = {}): EngineFailure {
  return { ok: false, code, message, ...extra }
}

function eventActor(actor: AdsActor): EventActor {
  return { type: actor.type, id: actor.id, label: actor.label }
}

const SYSTEM_ACTOR: AdsActor = { type: 'system', id: null, label: 'system:ads-engine', canManage: true, canApprove: false }

// ─── Preview ──────────────────────────────────────────────────────────────────

export type PreviewInput = {
  orgId: string
  actor: AdsActor
  command: unknown
  idempotencyKey?: string
  batchId?: string
  batchSize?: number
  rollbackOf?: string
}

export async function previewChange(input: PreviewInput): Promise<PreviewSuccess | EngineFailure> {
  const { orgId, actor } = input
  const parsed = parseCommand(input.command)
  if (!parsed.ok) return fail('invalid_command', parsed.message)
  const command = parsed.command
  const entry = COMMAND_CATALOG[command.type]

  const adapter = getAdapter(command.platform)
  if (!adapter.capabilities().some((c) => c.type === command.type)) {
    return fail('unsupported_command', `${command.type} is not implemented for ${command.platform} yet.`)
  }

  const conn = await loadAdapterContext(orgId, command.platform, command.ad_account_id)
  if (!conn.ok) return fail(conn.code, conn.message)

  let before: ResourceSnapshot | null
  try {
    before = await adapter.snapshot(conn.ctx, command)
  } catch (error) {
    return providerFailure(adapter, conn.ctx, command, error)
  }
  if (!before) {
    return fail('resource_not_found', `The target resource was not found in ${command.platform} account ${command.ad_account_id}.`)
  }

  const plan = adapter.plan(command, before)
  if (!plan) return fail('unsupported_command', `${command.type} is not implemented for ${command.platform} yet.`)
  if (!plan.ok) return fail(plan.code, plan.message)

  const policy = await loadEffectivePolicy(orgId, command.platform, command.ad_account_id)
  const verdict = evaluatePolicy({
    policy,
    actor,
    risk: entry.risk,
    campaignId: before.campaignId,
    facts: plan.facts,
    batchSize: input.batchSize,
  })
  if (verdict.blocked.length > 0) {
    return fail('policy_blocked', verdict.blocked.map((v) => v.message).join(' '), { violations: verdict.blocked })
  }

  // Let the platform run its own checks (minimum budgets, keyword policy,
  // CBO conflicts...) before anyone is asked to approve a doomed change.
  try {
    await adapter.validate(conn.ctx, command, before)
  } catch (error) {
    const cls = adapter.classifyError(error)
    if (cls.auth) await markConnectionError({ orgId, platform: command.platform, adAccountId: command.ad_account_id, error })
    return fail(cls.transient ? 'provider_unavailable' : 'provider_rejected', cls.message)
  }

  const beforeHash = hashState(before.fields)
  const idempotencyKey =
    input.idempotencyKey ?? sha256(stableStringify({ command, beforeHash, rollbackOf: input.rollbackOf ?? null }))
  const token = actor.type === 'user' ? null : newConfirmationToken()
  const now = Date.now()

  const insertRow = {
    org_id: orgId,
    platform: command.platform,
    ad_account_id: command.ad_account_id,
    command_type: command.type,
    resource_type: entry.resourceType,
    resource_id: before.resourceId ?? targetResourceId(command),
    resource_name: before.resourceName,
    campaign_id: before.campaignId,
    payload: command as unknown as Json,
    before_state: before as unknown as Json,
    before_hash: beforeHash,
    intended_state: plan.intended as Json,
    diff: plan.diff as unknown as Json,
    warnings: plan.warnings as unknown as Json,
    policy_verdict: { approval_reasons: verdict.approvalReasons, facts: plan.facts } as unknown as Json,
    risk_level: entry.risk as RiskLevel,
    status: 'awaiting_approval' as const,
    actor_type: actor.type,
    actor_id: actor.id,
    actor_label: actor.label,
    idempotency_key: idempotencyKey,
    approval_required: verdict.approvalReasons.length > 0,
    approval_expires_at: new Date(now + policy.approvalTtlMinutes * 60_000).toISOString(),
    confirmation_hash: token?.hash ?? null,
    rollback_of: input.rollbackOf ?? null,
    batch_id: input.batchId ?? null,
  }

  let { row, duplicate } = await insertChange(insertRow)

  // A derived key only deduplicates changes still in flight. A finished one —
  // cancelled, expired, failed, or even succeeded (pause → roll back → pause
  // again reproduces the exact same before-state) — must not swallow a fresh
  // request. An explicit caller key is honoured as-is: that is a client
  // retrying the same request and it should get the original row back.
  if (duplicate && !input.idempotencyKey && TERMINAL_STATUSES.includes(row.status as ChangeStatus)) {
    ;({ row, duplicate } = await insertChange({ ...insertRow, idempotency_key: `${idempotencyKey}:${now}` }))
  }

  if (!duplicate) {
    await appendEvent({
      orgId,
      changeId: row.id,
      eventType: 'previewed',
      to: 'awaiting_approval',
      actor: eventActor(actor),
      detail: { approval_reasons: verdict.approvalReasons, warnings: plan.warnings },
    })
  } else if (token && row.status === 'awaiting_approval' && row.actor_label === actor.label) {
    // Same machine actor re-previewing the same change: hand it a fresh token.
    const refreshed = await transition({
      orgId,
      changeId: row.id,
      from: ['awaiting_approval'],
      to: 'awaiting_approval',
      patch: { confirmation_hash: token.hash },
      actor: eventActor(actor),
      eventType: 'confirmation_reissued',
    })
    if (refreshed) row = refreshed
  }

  return {
    ok: true,
    change: toChangeView(row),
    confirmationToken: token && row.status === 'awaiting_approval' && row.actor_label === actor.label ? token.token : undefined,
    duplicate,
  }
}

async function providerFailure(
  adapter: AdsProviderAdapter,
  ctx: AdapterContext,
  command: AdsCommand,
  error: unknown,
): Promise<EngineFailure> {
  const cls = adapter.classifyError(error)
  if (cls.auth) await markConnectionError({ orgId: ctx.orgId, platform: command.platform, adAccountId: ctx.adAccountId, error })
  return fail(cls.auth ? 'connection_error' : cls.transient ? 'provider_unavailable' : cls.code, cls.message)
}

// ─── Submit (preview + confirm in one call) ───────────────────────────────────

/**
 * For a human in the dashboard, the click on "Apply" IS the confirmation of
 * the diff they were shown. When their own permissions satisfy the policy the
 * change executes right away; otherwise it stays awaiting_approval for an
 * `ads.approve` holder.
 */
export async function submitChange(input: PreviewInput): Promise<PreviewSuccess | ExecutionSuccess | EngineFailure> {
  const preview = await previewChange(input)
  if (!preview.ok) return preview
  if (input.actor.type !== 'user') return preview
  if (preview.change.status !== 'awaiting_approval') return preview
  if (preview.change.approval_required && !input.actor.canApprove) return preview
  return approveChange({ orgId: input.orgId, changeId: preview.change.id, actor: input.actor })
}

// ─── Approve ──────────────────────────────────────────────────────────────────

export async function approveChange(params: {
  orgId: string
  changeId: string
  actor: AdsActor
  confirmationToken?: string
}): Promise<ExecutionSuccess | EngineFailure> {
  const { orgId, changeId, actor } = params
  const row = await getChangeRow(orgId, changeId)
  if (!row) return fail('not_found', 'Change request not found.')
  if (row.status !== 'awaiting_approval') {
    return fail('invalid_state', `This change is ${row.status}, not awaiting approval.`, { change: toChangeView(row) })
  }

  if (row.approval_expires_at && Date.parse(row.approval_expires_at) < Date.now()) {
    const expired = await transition({ orgId, changeId, from: ['awaiting_approval'], to: 'expired', actor: eventActor(actor) })
    return fail('expired', 'The approval window for this change has passed. Preview it again.', {
      change: expired ? toChangeView(expired) : undefined,
    })
  }

  const policy = await loadEffectivePolicy(orgId, row.platform as 'meta' | 'google' | 'google_business', row.ad_account_id)

  if (actor.type === 'user') {
    if (!actor.canManage) return fail('forbidden', 'You do not have permission to manage ads (ads.manage).')
    if (row.approval_required && !actor.canApprove) {
      return fail('forbidden', 'This change needs approval from someone with the ads.approve permission.')
    }
  } else {
    if (policy.aiMode !== 'execute_with_confirmation') {
      return fail(
        'approval_requires_human',
        'This account requires changes proposed by the AI to be approved in the dashboard (Ads → Changes).',
        { change: toChangeView(row) },
      )
    }
    if (row.actor_label !== actor.label) {
      return fail('forbidden', 'An AI client can only confirm changes it proposed itself.')
    }
    if (!params.confirmationToken || !row.confirmation_hash || sha256(params.confirmationToken) !== row.confirmation_hash) {
      return fail('invalid_confirmation', 'The confirmation token does not match this change. Preview it again and confirm the new diff.')
    }
  }

  // Policy may have tightened since the preview — the approval is for a diff,
  // not a blank cheque.
  const verdict = (row.policy_verdict ?? {}) as StoredPolicyVerdict
  const recheck = evaluatePolicy({
    policy,
    actor: actor.type === 'user' ? actor : { ...actor, type: row.actor_type as AdsActor['type'] },
    risk: row.risk_level as RiskLevel,
    campaignId: row.campaign_id,
    facts: verdict.facts ?? {},
  })
  if (recheck.blocked.length > 0) {
    const failed = await transition({
      orgId,
      changeId,
      from: ['awaiting_approval'],
      to: 'failed',
      patch: { error_code: 'policy_blocked', error_message: recheck.blocked.map((v) => v.message).join(' '), completed_at: new Date().toISOString() },
      actor: eventActor(actor),
      detail: { violations: recheck.blocked },
    })
    return fail('policy_blocked', recheck.blocked.map((v) => v.message).join(' '), {
      violations: recheck.blocked,
      change: failed ? toChangeView(failed) : undefined,
    })
  }

  const queued = await transition({
    orgId,
    changeId,
    from: ['awaiting_approval'],
    to: 'queued',
    patch: {
      approved_by: actor.id,
      approved_by_label: actor.label,
      approved_at: new Date().toISOString(),
      next_attempt_at: new Date().toISOString(),
      confirmation_hash: null,
    },
    actor: eventActor(actor),
    eventType: 'approved',
  })
  if (!queued) {
    const current = await getChangeRow(orgId, changeId)
    return fail('invalid_state', 'This change was approved or cancelled by someone else just now.', {
      change: current ? toChangeView(current) : undefined,
    })
  }

  return executeChange({ orgId, changeId, actor })
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeChange(params: { orgId: string; changeId: string; actor: AdsActor }): Promise<ExecutionSuccess | EngineFailure> {
  const { orgId, changeId, actor } = params
  const current = await getChangeRow(orgId, changeId)
  if (!current) return fail('not_found', 'Change request not found.')

  const claimed = await transition({
    orgId,
    changeId,
    from: ['queued'],
    to: 'executing',
    patch: { attempt_count: current.attempt_count + 1, executed_at: new Date().toISOString(), next_attempt_at: null },
    actor: eventActor(actor),
    detail: { attempt: current.attempt_count + 1 },
  })
  if (!claimed) {
    return fail('invalid_state', `This change is ${current.status}; it can only execute from queued.`, { change: toChangeView(current) })
  }

  const ev = eventActor(actor)
  const terminal = async (to: ChangeStatus, patch: Record<string, unknown>, detail?: Record<string, unknown>, eventType?: string) => {
    const row = await transition({
      orgId,
      changeId,
      from: ['executing', 'verifying'],
      to,
      patch: { ...patch, completed_at: TERMINAL_STATUSES.includes(to) ? new Date().toISOString() : null },
      actor: ev,
      detail,
      eventType,
    })
    return row ?? (await getChangeRow(orgId, changeId)) ?? claimed
  }

  const command = claimed.payload as unknown as AdsCommand
  const adapter = getAdapter(command.platform)
  const conn = await loadAdapterContext(orgId, command.platform, command.ad_account_id)
  if (!conn.ok) {
    const row = await terminal('failed', { error_code: conn.code, error_message: conn.message })
    return fail(conn.code, conn.message, { change: toChangeView(row) })
  }

  // ── Circuit breaker: an account already failing repeatedly waits it out.
  const recentFailures = await recentAccountFailures(orgId, command.platform, command.ad_account_id, CIRCUIT_WINDOW_MINUTES)
  if (recentFailures >= CIRCUIT_THRESHOLD) {
    const row = await transition({
      orgId,
      changeId,
      from: ['executing'],
      to: 'queued',
      patch: {
        // This attempt never reached the platform — don't spend a retry on it.
        attempt_count: claimed.attempt_count - 1,
        next_attempt_at: new Date(Date.now() + CIRCUIT_WINDOW_MINUTES * 60_000).toISOString(),
      },
      actor: ev,
      eventType: 'circuit_open',
      detail: { recent_failures: recentFailures, window_minutes: CIRCUIT_WINDOW_MINUTES },
    })
    return fail(
      'circuit_open',
      `${command.platform} account ${command.ad_account_id} had ${recentFailures} temporary failures in the last ${CIRCUIT_WINDOW_MINUTES} minutes; this change will run in ${CIRCUIT_WINDOW_MINUTES} minutes.`,
      { change: row ? toChangeView(row) : undefined },
    )
  }

  // ── Optimistic concurrency: the world must still look like the preview.
  let now: ResourceSnapshot | null
  try {
    now = await adapter.snapshot(conn.ctx, command)
  } catch (error) {
    return handleExecutionError(adapter, conn.ctx, command, claimed, error, actor)
  }
  if (!now) {
    const row = await terminal('failed', { error_code: 'resource_not_found', error_message: 'The resource no longer exists.' })
    return fail('resource_not_found', 'The resource no longer exists.', { change: toChangeView(row) })
  }

  if (hashState(now.fields) !== claimed.before_hash) {
    // A retry after a timeout may find its own earlier write already applied.
    const replan = adapter.plan(command, now)
    if (claimed.attempt_count > 1 && !replan.ok && (replan.code === 'no_op' || replan.code === 'already_exists')) {
      const row = await terminal(
        'succeeded',
        { verification: { ok: true, note: 'Applied by an earlier attempt; confirmed on retry.', observed: now.fields } as unknown as Json },
        undefined,
        'succeeded',
      )
      await afterSuccess(row, actor)
      return { ok: true, change: toChangeView(row) }
    }
    const message = 'The resource changed after this change was previewed. Preview it again against the current state.'
    const row = await terminal('failed', {
      error_code: 'state_conflict',
      error_message: message,
      verification: { current: now.fields } as unknown as Json,
    })
    return fail('state_conflict', message, { change: toChangeView(row) })
  }

  let providerRef: string | null = null
  try {
    const before = claimed.before_state as unknown as ResourceSnapshot
    const result = await adapter.execute(conn.ctx, command, before)
    providerRef = result.providerRef
  } catch (error) {
    return handleExecutionError(adapter, conn.ctx, command, claimed, error, actor)
  }

  await transition({
    orgId,
    changeId,
    from: ['executing'],
    to: 'verifying',
    patch: { provider_ref: providerRef, error_code: null, error_message: null },
    actor: ev,
  })

  // ── Read-back verification.
  let finalRow: ChangeRow
  try {
    const verdict = await adapter.verify(conn.ctx, command, (claimed.intended_state ?? {}) as Record<string, unknown>, providerRef)
    finalRow = verdict.ok
      ? await terminal('succeeded', { verification: { ok: true, observed: verdict.observed } as unknown as Json })
      : await terminal(
          'drifted',
          {
            verification: { ok: false, mismatches: verdict.mismatches, observed: verdict.observed } as unknown as Json,
            error_code: 'verification_mismatch',
            error_message: 'The platform accepted the change but reads back a different value.',
          },
          { mismatches: verdict.mismatches },
        )
  } catch (error) {
    // The write succeeded; only the confirmation read failed. Record that
    // honestly instead of calling a landed change "failed".
    finalRow = await terminal('succeeded', {
      verification: { ok: null, checked: false, error: error instanceof Error ? error.message : String(error) } as unknown as Json,
    })
  }

  await afterSuccess(finalRow, actor)
  return { ok: true, change: toChangeView(finalRow) }
}

async function handleExecutionError(
  adapter: AdsProviderAdapter,
  ctx: AdapterContext,
  command: AdsCommand,
  claimed: ChangeRow,
  error: unknown,
  actor: AdsActor,
): Promise<EngineFailure> {
  const cls = adapter.classifyError(error)
  if (cls.auth) await markConnectionError({ orgId: ctx.orgId, platform: command.platform, adAccountId: ctx.adAccountId, error })

  const attempt = claimed.attempt_count
  if (cls.transient && attempt < MAX_ATTEMPTS) {
    const delayMinutes = 2 ** (attempt - 1)
    const row = await transition({
      orgId: ctx.orgId,
      changeId: claimed.id,
      from: ['executing'],
      to: 'queued',
      patch: {
        next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        error_code: cls.code,
        error_message: cls.message,
      },
      actor: eventActor(actor),
      eventType: 'retry_scheduled',
      detail: { attempt, delay_minutes: delayMinutes, error: cls.message },
    })
    return fail('retry_scheduled', `Temporary ${command.platform} error (${cls.message}). Retrying in ${delayMinutes} min.`, {
      change: row ? toChangeView(row) : undefined,
    })
  }

  const code = cls.auth ? 'connection_error' : cls.transient ? 'retries_exhausted' : cls.code
  const row = await transition({
    orgId: ctx.orgId,
    changeId: claimed.id,
    from: ['executing'],
    to: 'failed',
    patch: { error_code: code, error_message: cls.message, completed_at: new Date().toISOString() },
    actor: eventActor(actor),
    detail: { attempt, error: cls.message },
  })
  return fail(code, cls.message, { change: row ? toChangeView(row) : undefined })
}

function journeyType(row: ChangeRow): Parameters<typeof recordMutationExecution>[0]['executionType'] {
  const command = row.payload as unknown as AdsCommand
  if (command.type.endsWith('.set_status') && row.resource_type === 'campaign') {
    const status = (command as { status: string }).status
    return status === 'PAUSED' ? 'campaign_pause' : 'campaign_enable'
  }
  if (command.type.endsWith('set_daily_budget')) {
    const facts = ((row.policy_verdict ?? {}) as StoredPolicyVerdict).facts ?? {}
    return facts.budgetAfter != null && facts.budgetBefore != null && facts.budgetAfter < facts.budgetBefore
      ? 'budget_decrease'
      : 'budget_increase'
  }
  if (/keyword|targeting/.test(command.type)) return 'audience_change'
  return 'manual'
}

async function afterSuccess(row: ChangeRow, actor: AdsActor): Promise<void> {
  const diff = (row.diff ?? []) as unknown as DiffEntry[]
  const first = diff[0]
  const label = COMMAND_CATALOG[row.command_type as AdsCommand['type']]?.label ?? row.command_type
  // The ads journey/report caches only model paid-media concepts. Business
  // Profile still has the full immutable ledger above, but must not be forced
  // into campaign analytics tables whose platform CHECK excludes it.
  if (row.platform !== 'google_business') {
    await recordMutationExecution({
      orgId: row.org_id,
      platform: row.platform as 'meta' | 'google',
      toolName: row.command_type,
      executedByAi: row.actor_type === 'ai',
      actorId: row.approved_by ?? row.actor_id ?? actor.id ?? undefined,
      campaignId: row.campaign_id ?? undefined,
      campaignName: row.resource_type === 'campaign' ? row.resource_name ?? undefined : undefined,
      beforeValue: first?.beforeDisplay ?? null,
      afterValue: first?.afterDisplay ?? null,
      title: `${label}: ${row.resource_name ?? row.resource_id ?? ''}${first ? ` (${first.beforeDisplay} → ${first.afterDisplay})` : ''}`.slice(0, 300),
      executionType: journeyType(row),
      description: row.status === 'drifted' ? 'Applied, but the platform reads back a different value.' : undefined,
      changeRequestId: row.id,
    })
    await invalidateAccountReports(row.org_id, row.platform as 'meta' | 'google', row.ad_account_id)
  }
}

// ─── Cancel / rollback / retry ────────────────────────────────────────────────

export async function cancelChange(params: { orgId: string; changeId: string; actor: AdsActor; reason?: string }): Promise<ExecutionSuccess | EngineFailure> {
  const row = await getChangeRow(params.orgId, params.changeId)
  if (!row) return fail('not_found', 'Change request not found.')
  if (params.actor.type === 'user' && !params.actor.canManage) return fail('forbidden', 'You do not have permission to manage ads (ads.manage).')
  if (params.actor.type !== 'user' && row.actor_label !== params.actor.label) {
    return fail('forbidden', 'An AI client can only cancel changes it proposed itself.')
  }
  const cancelled = await transition({
    orgId: params.orgId,
    changeId: params.changeId,
    from: ['draft', 'awaiting_approval', 'queued'],
    to: 'cancelled',
    patch: { completed_at: new Date().toISOString(), confirmation_hash: null },
    actor: eventActor(params.actor),
    detail: params.reason ? { reason: params.reason } : undefined,
  })
  if (!cancelled) return fail('invalid_state', `This change is ${row.status} and can no longer be cancelled.`, { change: toChangeView(row) })
  return { ok: true, change: toChangeView(cancelled) }
}

/** Preview the inverse of a completed change. It then follows the normal approval path. */
export async function rollbackChange(params: { orgId: string; changeId: string; actor: AdsActor }): Promise<PreviewSuccess | EngineFailure> {
  const row = await getChangeRow(params.orgId, params.changeId)
  if (!row) return fail('not_found', 'Change request not found.')
  if (row.status !== 'succeeded' && row.status !== 'drifted') {
    return fail('invalid_state', `Only applied changes can be rolled back (this one is ${row.status}).`)
  }
  const command = row.payload as unknown as AdsCommand
  const inverse = getAdapter(command.platform).buildRollback(
    command,
    row.before_state as unknown as ResourceSnapshot,
    row.provider_ref,
  )
  if (!inverse) return fail('not_reversible', 'This change has no safe automatic inverse. Make the reverse change explicitly.')
  return previewChange({ orgId: params.orgId, actor: params.actor, command: inverse, rollbackOf: row.id })
}

/** Re-preview a failed/expired/cancelled change against the current state. */
export async function retryChange(params: { orgId: string; changeId: string; actor: AdsActor }): Promise<PreviewSuccess | EngineFailure> {
  const row = await getChangeRow(params.orgId, params.changeId)
  if (!row) return fail('not_found', 'Change request not found.')
  if (!['failed', 'expired', 'cancelled', 'drifted'].includes(row.status)) {
    return fail('invalid_state', `This change is ${row.status}; only failed, expired, cancelled or drifted changes can be retried.`)
  }
  return previewChange({
    orgId: params.orgId,
    actor: params.actor,
    command: row.payload,
    batchId: row.batch_id ?? undefined,
    rollbackOf: row.rollback_of ?? undefined,
  })
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getChange(orgId: string, changeId: string) {
  const row = await getChangeRow(orgId, changeId)
  if (!row) return null
  const events = await listChangeEvents(orgId, changeId)
  return { change: toChangeView(row), events }
}

export async function listChanges(orgId: string, filters: ChangeFilters = {}): Promise<ChangeView[]> {
  return (await listChangeRows(orgId, filters)).map(toChangeView)
}

// ─── Batches ──────────────────────────────────────────────────────────────────

/**
 * Approve every pending change of a batch, one at a time (providers
 * rate-limit per account). Each change keeps its own policy check, conflict
 * check and verification; one failure never stops the rest.
 */
export async function approveBatch(params: {
  orgId: string
  batchId: string
  actor: AdsActor
  /** Machine actors: change_id → confirmation token from the preview. */
  confirmationTokens?: Record<string, string>
}): Promise<{ results: Array<ExecutionSuccess | (EngineFailure & { change_id: string })> }> {
  const pending = await listChangeRows(params.orgId, { batchId: params.batchId, status: ['awaiting_approval'], limit: 200 })
  const results: Array<ExecutionSuccess | (EngineFailure & { change_id: string })> = []
  for (const row of [...pending].reverse()) {
    const result = await approveChange({
      orgId: params.orgId,
      changeId: row.id,
      actor: params.actor,
      confirmationToken: params.confirmationTokens?.[row.id],
    })
    results.push(result.ok ? result : { ...result, change_id: row.id })
  }
  return { results }
}

// ─── Reconciliation (external drift) ──────────────────────────────────────────

/**
 * Re-read recently applied changes and flag the ones whose effect is no longer
 * on the platform — edited or reverted outside Xphere. Status stays
 * `succeeded` (it did apply); the drift is recorded next to it and in the
 * event log, and shows up for the operator and the AI.
 */
export async function reconcileAppliedChanges(opts: { limit?: number; maxAgeDays?: number; everyHours?: number } = {}): Promise<{
  checked: number
  drifted: number
  errors: number
}> {
  const rows = await changesToReconcile(opts.limit ?? 10, opts.maxAgeDays ?? 7, opts.everyHours ?? 6)
  let drifted = 0
  let errors = 0
  for (const row of rows) {
    const now = new Date().toISOString()
    try {
      if (await hasLaterChange(row)) {
        await updateReconciliation(row.org_id, row.id, { last_reconciled_at: now })
        continue
      }
      const command = row.payload as unknown as AdsCommand
      const conn = await loadAdapterContext(row.org_id, command.platform, command.ad_account_id)
      if (!conn.ok) {
        await updateReconciliation(row.org_id, row.id, { last_reconciled_at: now })
        continue
      }
      const verdict = await getAdapter(command.platform).verify(
        conn.ctx,
        command,
        (row.intended_state ?? {}) as Record<string, unknown>,
        row.provider_ref,
      )
      if (!verdict.ok && !row.external_drift_detected_at) {
        drifted++
        const drift = { mismatches: verdict.mismatches, observed: verdict.observed }
        await updateReconciliation(row.org_id, row.id, {
          last_reconciled_at: now,
          external_drift: drift as unknown as Json,
          external_drift_detected_at: now,
        })
        await appendEvent({
          orgId: row.org_id,
          changeId: row.id,
          eventType: 'external_change_detected',
          actor: SYSTEM_ACTOR,
          detail: drift,
        })
      } else {
        await updateReconciliation(row.org_id, row.id, { last_reconciled_at: now })
      }
    } catch {
      errors++
      // A failed read is not evidence of drift; try again next cycle.
      await updateReconciliation(row.org_id, row.id, { last_reconciled_at: now }).catch(() => {})
    }
  }
  return { checked: rows.length, drifted, errors }
}

// ─── Worker (cron) ────────────────────────────────────────────────────────────

export async function processChangeQueue(opts: { limit?: number; budgetMs?: number } = {}): Promise<{
  expired: number
  executed: number
  failed: number
  stuck: Array<{ id: string; org_id: string; status: string }>
  reconciliation: { checked: number; drifted: number; errors: number }
}> {
  const limit = opts.limit ?? 25
  // xphere.app sits behind Cloudflare, which cuts a request at 100s. Stop
  // starting new work well before that; whatever is left runs next tick.
  const startedAt = Date.now()
  const budgetMs = opts.budgetMs ?? 60_000
  const timeLeft = () => budgetMs - (Date.now() - startedAt)
  let expired = 0
  for (const stale of await staleApprovals(100)) {
    const row = await transition({
      orgId: stale.org_id,
      changeId: stale.id,
      from: ['awaiting_approval'],
      to: 'expired',
      patch: { completed_at: new Date().toISOString(), confirmation_hash: null },
      actor: SYSTEM_ACTOR,
    })
    if (row) expired++
  }

  let executed = 0
  let failed = 0
  // Sequential on purpose: providers rate-limit per account, and a retry
  // storm is how a transient 429 becomes an outage.
  for (const due of await dueQueuedChanges(limit)) {
    if (timeLeft() < 10_000) break
    const result = await executeChange({ orgId: due.org_id, changeId: due.id, actor: SYSTEM_ACTOR })
    if (result.ok) executed++
    else if (!['retry_scheduled', 'invalid_state', 'circuit_open'].includes(result.code)) failed++
  }

  const reconciliation =
    timeLeft() > 25_000 ? await reconcileAppliedChanges({ limit: 10 }) : { checked: 0, drifted: 0, errors: 0 }
  return { expired, executed, failed, stuck: await stuckChanges(15, 50), reconciliation }
}
