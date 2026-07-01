// Copilot credit wallet facade. All writes go through the SECURITY DEFINER RPCs
// (atomic balance update + ledger insert), invoked with the service-role client —
// the same trust boundary the rest of the billing layer uses for writes. Reads use
// service-role too so callers can pass a server-resolved org_id without RLS setup.
//
// IMPORTANT: org_id passed here MUST be the caller's resolved active org
// (get_current_org_id), never a client-supplied value.
import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/admin'

/**
 * Feature/reason tag for a metered credit debit. Every debit through
 * `meterDebit()` is tagged with one of these so the ledger records which
 * feature consumed the credit (see the `reason` column on
 * copilot_credit_ledger, migration 1225).
 *
 * TO HOOK IN A NEW FEATURE:
 *   1. Add your tag to this union (e.g. 'workflow_run').
 *   2. Call `meterDebit(orgId, 'your_tag', costUsd, refId)` after the cost
 *      is incurred (never before — this is a post-hoc debit, not a
 *      pre-check; gate the action separately with getCopilotBalance/
 *      hasCopilotCredits if you need to block before running).
 *   3. `meterDebit` fails OPEN: a wallet/DB error is caught, logged, and
 *      the call returns `{ allowed: true, balanceAfter: 0 }` — it never
 *      throws and never blocks your feature's success path. Do not wrap
 *      it in a try/catch expecting to handle failure differently.
 *   4. `refId` is optional and stored in `copilot_run_id` (FK to
 *      copilot_runs, ON DELETE SET NULL) — today this column is still
 *      Copilot-run-specific. If your feature's run/execution ID is not a
 *      row in `copilot_runs`, pass `null` for now; generalizing this
 *      column to a free-text ref is deferred (see RESEARCH.md Open
 *      Question 3) until a second feature actually needs it.
 */
export type MeterReason = 'copilot_turn'

export interface CopilotBalance {
  /** Monthly allowance remaining (resets each period). */
  includedUsd: number
  /** Purchased/granted credits (persist across resets). */
  topupUsd: number
  /** Spendable total = included + topup. */
  totalUsd: number
  /** The plan's monthly allowance (what a reset refills to). */
  includedAllowanceUsd: number
  periodEnd: string | null
}

const EMPTY_BALANCE: CopilotBalance = {
  includedUsd: 0,
  topupUsd: 0,
  totalUsd: 0,
  includedAllowanceUsd: 0,
  periodEnd: null,
}

/** Current wallet for an org. Returns a zeroed balance when no wallet row exists. */
export async function getCopilotBalance(orgId: string): Promise<CopilotBalance> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('copilot_credit_balances')
    .select('included_balance_usd, topup_balance_usd, included_allowance_usd, period_end')
    .eq('org_id', orgId)
    .maybeSingle()
  if (!data) return EMPTY_BALANCE
  const inc = Number(data.included_balance_usd)
  const top = Number(data.topup_balance_usd)
  return {
    includedUsd: inc,
    topupUsd: top,
    totalUsd: inc + top,
    includedAllowanceUsd: Number(data.included_allowance_usd),
    periodEnd: data.period_end,
  }
}

/** True when the org has any spendable Copilot credit left. */
export async function hasCopilotCredits(orgId: string): Promise<boolean> {
  const { totalUsd } = await getCopilotBalance(orgId)
  return totalUsd > 0
}

export interface CreditLedgerEntry {
  id: string
  kind: string
  amountUsd: number
  balanceAfter: number
  note: string | null
  reason: string | null
  createdAt: string
}

/** Recent credit transactions for an org, newest first (for the billing UI). */
export async function getCopilotLedger(orgId: string, limit = 10): Promise<CreditLedgerEntry[]> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('copilot_credit_ledger')
    .select('id, kind, amount_usd, balance_after, note, reason, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    amountUsd: Number(r.amount_usd),
    balanceAfter: Number(r.balance_after),
    note: r.note,
    reason: r.reason ?? null,
    createdAt: r.created_at,
  }))
}

/**
 * Debit a cost that has ALREADY been incurred, tagged with the feature/reason
 * that triggered it. Always applies (we never lose a real cost) and may drive
 * the balance negative; the pre-turn check gates the NEXT action, not this
 * one. Fails OPEN: a wallet error must never break the caller — it just isn't
 * recorded.
 *
 * This is the SINGLE reusable credit-debit interface (MET-01) — every
 * feature that consumes Copilot credits calls this, not a feature-specific
 * variant. See the `MeterReason` doc comment above for how to add a new tag.
 */
export async function meterDebit(
  orgId: string,
  reason: MeterReason,
  costUsd: number,
  refId?: string | null,
): Promise<{ allowed: boolean; balanceAfter: number }> {
  if (!(costUsd > 0)) return { allowed: true, balanceAfter: 0 }
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase.rpc('debit_copilot_credits', {
      p_org_id: orgId,
      p_amount_usd: costUsd,
      p_run_id: refId ?? null,
      p_reason: reason,
    })
    if (error) throw error
    const res = (data ?? {}) as { allowed?: boolean; balance_after?: number }
    return { allowed: res.allowed ?? true, balanceAfter: Number(res.balance_after ?? 0) }
  } catch (err) {
    console.error('[billing] meterDebit failed (failing open):', err)
    return { allowed: true, balanceAfter: 0 }
  }
}

/** Add credits to the persistent top-up bucket (à la carte purchase or agency grant). */
export async function grantCopilot(
  orgId: string,
  amountUsd: number,
  kind: 'topup' | 'grant',
  ref?: string | null,
  note?: string | null,
): Promise<number> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('credit_copilot_credits', {
    p_org_id: orgId,
    p_amount_usd: amountUsd,
    p_kind: kind,
    p_ref: ref ?? null,
    p_note: note ?? null,
  })
  if (error) throw new Error(`grantCopilot failed: ${error.message}`)
  return Number(data ?? 0)
}

/**
 * Refresh the monthly allowance at the start of a billing period: SETS the included
 * bucket to `includedUsd` (no roll-over) and leaves top-ups intact. Idempotent for
 * the same period.
 */
export async function resetCopilotForPeriod(
  orgId: string,
  includedUsd: number,
  periodEnd?: string | null,
): Promise<number> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('reset_copilot_credits', {
    p_org_id: orgId,
    p_included_usd: includedUsd,
    p_period_end: periodEnd ?? null,
  })
  if (error) throw new Error(`resetCopilotForPeriod failed: ${error.message}`)
  return Number(data ?? 0)
}

/**
 * Lazily provision the wallet for the CURRENT period: refills the monthly allowance
 * only when the stored period has lapsed (or was never set), so mid-period calls are
 * no-ops and never restore already-spent credits. Used as a safety net for trials
 * and pre-first-invoice subscriptions; the Stripe webhook does the authoritative
 * reset on `invoice.paid`. A null `periodEnd` defaults to +30 days so a period is
 * always bounded (otherwise every call would look "lapsed" and reset repeatedly).
 */
export async function ensureCopilotProvisioned(
  orgId: string,
  includedUsd: number,
  periodEnd?: string | null,
): Promise<void> {
  try {
    const bal = await getCopilotBalance(orgId)
    const lapsed = !bal.periodEnd || new Date(bal.periodEnd).getTime() <= Date.now()
    if (!lapsed) return
    const end = periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    await resetCopilotForPeriod(orgId, includedUsd, end)
  } catch (err) {
    // Provisioning is best-effort; never break the caller (the credit check that
    // follows will simply see whatever balance exists).
    console.error('[billing] ensureCopilotProvisioned failed:', err)
  }
}
