// Client-safe ads credential expiry helpers.
//
// connection-health.ts pulls in the service-role client and the platform API
// errors, so client components could not import these from there and had
// started mirroring the constant. They live here; connection-health.ts
// re-exports them for existing server importers.

/** Connections within this window are surfaced to the operator as "expiring". */
export const EXPIRY_WARNING_DAYS = 14

/** Days until a stored token expires, or null when there is no expiry on file. */
export function daysUntilExpiry(tokenExpiresAt: string | null, now = new Date()): number | null {
  if (!tokenExpiresAt) return null
  const expiry = new Date(tokenExpiresAt)
  if (Number.isNaN(expiry.getTime())) return null
  return Math.floor((expiry.getTime() - now.getTime()) / 86_400_000)
}

export interface AdsConnectionSummaryRow {
  ad_account_id: string
  ad_account_name: string | null
  status: string
  health: string | null
  token_expires_at: string | null
}

export type AdsConnectionState = 'not_connected' | 'ok' | 'expiring' | 'expired' | 'broken'

export interface AdsConnectionSummary {
  state: AdsConnectionState
  accountCount: number
  /** Ad accounts the org selected ('active'), by name. */
  activeAccounts: string[]
  /** Soonest expiry among the selected accounts (all accounts when none is selected). */
  expiresAt: string | null
  daysLeft: number | null
}

/**
 * One status for a platform's connection, judged on the accounts the org
 * actually uses: a broken or lapsed credential there is what stops reports,
 * conversions and audience syncs.
 */
export function summarizeAdsConnection(rows: AdsConnectionSummaryRow[], now = new Date()): AdsConnectionSummary {
  if (rows.length === 0) {
    return { state: 'not_connected', accountCount: 0, activeAccounts: [], expiresAt: null, daysLeft: null }
  }
  const active = rows.filter((row) => row.status === 'active')
  const judged = active.length > 0 ? active : rows
  const expiresAt = judged
    .map((row) => row.token_expires_at)
    .filter((value): value is string => Boolean(value) && !Number.isNaN(Date.parse(value as string)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
  const daysLeft = daysUntilExpiry(expiresAt, now)

  let state: AdsConnectionState = 'ok'
  if (daysLeft !== null && daysLeft <= 0) state = 'expired'
  else if (judged.some((row) => row.health === 'error')) state = 'broken'
  else if (daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS) state = 'expiring'

  return {
    state,
    accountCount: rows.length,
    activeAccounts: active.map((row) => row.ad_account_name ?? row.ad_account_id),
    expiresAt,
    daysLeft,
  }
}
