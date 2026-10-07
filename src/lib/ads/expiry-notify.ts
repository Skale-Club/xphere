// Ads connection expiry notifications.
//
// The nightly ads-tick already marks expiring/expired connections so the Ads
// pages show a banner, but a banner only helps someone who opens /ads. A Meta
// token lapsing silently stops reporting, the CAPI fallback and every Custom
// Audience sync for the org, so owners/admins also get an in-app notification
// (and web push) on a few countdown days and once on the night it lapses.
//
// One notification per org + platform + day, listing the affected accounts:
// connecting Meta stores the same user token on every ad account it can see,
// so per-account notifications would arrive as a burst of identical alerts.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { insertNotification } from '@/lib/notifications/insert'

/** Days-left values that trigger a notification. ads-tick runs once a day. */
export const EXPIRY_NOTICE_DAYS: readonly number[] = [14, 7, 3, 1]

export interface ExpiryCandidate {
  org_id: string
  platform: string
  ad_account_id: string
  ad_account_name: string | null
  /** Admin selection: only connections in use ('active') are worth an alert. */
  status: string
  /** Health before this tick ran, so an expiry is announced only once. */
  health: string | null
  daysLeft: number
}

export interface ExpiryNotice {
  orgId: string
  platform: string
  kind: 'expiring' | 'expired'
  daysLeft: number
  accounts: string[]
}

export function planExpiryNotices(candidates: ExpiryCandidate[]): ExpiryNotice[] {
  const notices = new Map<string, ExpiryNotice>()
  for (const candidate of candidates) {
    if (candidate.status !== 'active') continue
    let kind: ExpiryNotice['kind'] | null = null
    if (candidate.daysLeft <= 0) {
      // Already flagged on an earlier night: the banner carries it from here.
      if (candidate.health !== 'error') kind = 'expired'
    } else if (EXPIRY_NOTICE_DAYS.includes(candidate.daysLeft)) {
      kind = 'expiring'
    }
    if (!kind) continue

    const daysLeft = kind === 'expired' ? 0 : candidate.daysLeft
    const key = `${candidate.org_id}:${candidate.platform}:${kind}:${daysLeft}`
    const notice = notices.get(key) ?? {
      orgId: candidate.org_id,
      platform: candidate.platform,
      kind,
      daysLeft,
      accounts: [],
    }
    notice.accounts.push(candidate.ad_account_name ?? candidate.ad_account_id)
    notices.set(key, notice)
  }
  return [...notices.values()]
}

/** Send each notice to the org's owners and admins. Returns how many were sent. */
export async function sendExpiryNotices(
  supabase: SupabaseClient<Database>,
  notices: ExpiryNotice[],
): Promise<number> {
  let sent = 0
  for (const notice of notices) {
    const { data: admins, error } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('organization_id', notice.orgId)
      .in('role', ['owner', 'admin'])
    if (error || !admins || admins.length === 0) continue

    await insertNotification(
      notice.orgId,
      'ads_connection_expiring',
      {
        platform: notice.platform,
        kind: notice.kind,
        days_left: notice.daysLeft,
        accounts: notice.accounts,
        account_count: notice.accounts.length,
      },
      admins.map((member) => member.user_id),
    )
    sent++
  }
  return sent
}
