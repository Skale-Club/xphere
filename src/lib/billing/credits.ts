// Copilot credit wallet facade. All writes go through the SECURITY DEFINER RPCs
// (atomic balance update + ledger insert), invoked with the service-role client —
// the same trust boundary the rest of the billing layer uses for writes. Reads use
// service-role too so callers can pass a server-resolved org_id without RLS setup.
//
// IMPORTANT: org_id passed here MUST be the caller's resolved active org
// (get_current_org_id), never a client-supplied value.
import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/admin'

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
  createdAt: string
}

/** Recent credit transactions for an org, newest first (for the billing UI). */
export async function getCopilotLedger(orgId: string, limit = 10): Promise<CreditLedgerEntry[]> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('copilot_credit_ledger')
    .select('id, kind, amount_usd, balance_after, note, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    amountUsd: Number(r.amount_usd),
    balanceAfter: Number(r.balance_after),
    note: r.note,
    createdAt: r.created_at,
  }))
}

/**
 * Debit a cost that has ALREADY been incurred (a completed Copilot turn). Always
 * applies (we never lose a real cost) and may drive the balance negative; the
 * pre-turn check gates the next turn. Fails OPEN: a wallet error must never break
 * the Copilot — it just isn't recorded.
 */
export async function debitCopilot(
  orgId: string,
  costUsd: number,
  runId?: string | null,
): Promise<{ allowed: boolean; balanceAfter: number }> {
  if (!(costUsd > 0)) return { allowed: true, balanceAfter: 0 }
  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase.rpc('debit_copilot_credits', {
      p_org_id: orgId,
      p_amount_usd: costUsd,
      p_run_id: runId ?? null,
    })
    if (error) throw error
    const res = (data ?? {}) as { allowed?: boolean; balance_after?: number }
    return { allowed: res.allowed ?? true, balanceAfter: Number(res.balance_after ?? 0) }
  } catch (err) {
    console.error('[billing] debitCopilot failed (failing open):', err)
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
