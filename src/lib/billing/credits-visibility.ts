// Pure, client-safe logic for the Copilot credit balance indicator (CRB-03/04).
// Deliberately has NO 'server-only' import and NO IO — this module is imported
// directly by the client component `CreditsIndicator` (via credits-indicator.tsx),
// so pulling in `server-only` here (as the rest of src/lib/billing/credits.ts
// does) would break the client bundle. Re-exported from credits.ts for callers
// that only need the server-side wallet facade's existing import path.

/**
 * Pure decision: does this org have "a credits plan" for CRB-03 visibility
 * purposes? True if EITHER the org's resolved plan grants a nonzero monthly
 * Copilot allowance, OR the org's wallet has already been provisioned with a
 * nonzero allowance, OR the org has any spendable balance at all (e.g.
 * topup-only credits with no plan allowance). False only when none of these
 * hold — i.e. no billing relationship of any kind.
 *
 * Deliberately does NOT depend on isBillingEnforced() — see RESEARCH.md
 * Pitfall 1 and CONTEXT.md's Visibility Gating decision.
 */
export function hasCreditsPlan(input: {
  planCopilotIncludedUsd: number
  balanceIncludedAllowanceUsd: number
  balanceTotalUsd: number
}): boolean {
  return (
    input.planCopilotIncludedUsd > 0 ||
    input.balanceIncludedAllowanceUsd > 0 ||
    input.balanceTotalUsd > 0
  )
}

/**
 * 3-state visual threshold for the CRB-04 credit balance indicator, per
 * UI-SPEC.md's Color section: healthy / low / zero, driven by totalUsd
 * relative to includedAllowanceUsd at a 20% threshold. When
 * includedAllowanceUsd is 0 ("no allowance concept applies" — e.g.
 * topup-only orgs), any positive balance is healthy; only a
 * zero-or-negative balance is the zero state.
 */
export function getCreditsVisualState(
  totalUsd: number,
  includedAllowanceUsd: number,
): 'healthy' | 'low' | 'zero' {
  if (totalUsd <= 0) return 'zero'
  if (includedAllowanceUsd > 0 && totalUsd <= 0.2 * includedAllowanceUsd) return 'low'
  return 'healthy'
}
