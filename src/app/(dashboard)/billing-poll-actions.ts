'use server'

import { createClient, getUser } from '@/lib/supabase/server'

export interface PolledCopilotBalance {
  includedUsd: number
  topupUsd: number
  totalUsd: number
  includedAllowanceUsd: number
}

/**
 * Current Copilot credit balance for the org this tab is pinned to, read with
 * the member's own session (RLS `copilot_credit_balances_org_read`), so a
 * caller can never read an org they do not belong to. Polled by the credits
 * indicator; returns null when there is nothing to show or the read fails (the
 * indicator then keeps its last value).
 */
export async function fetchCopilotBalance(orgId: string): Promise<PolledCopilotBalance | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('copilot_credit_balances')
    .select('included_balance_usd, topup_balance_usd, included_allowance_usd')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error || !data) return null
  const includedUsd = Number(data.included_balance_usd)
  const topupUsd = Number(data.topup_balance_usd)
  return {
    includedUsd,
    topupUsd,
    totalUsd: includedUsd + topupUsd,
    includedAllowanceUsd: Number(data.included_allowance_usd),
  }
}
