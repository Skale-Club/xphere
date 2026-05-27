/**
 * Subscribe our Meta App to webhook events for a customer WABA.
 *
 * Meta sends NO webhooks until the App is explicitly subscribed to the WABA
 * (per-customer step). Called automatically by the "Connect" server action
 * after credentials are validated. Idempotent.
 *
 * Reference: POST /{waba-id}/subscribed_apps
 */

import { metaFetch, MetaApiException } from './client'
import type { CloudAccount } from './types'

export async function subscribeApp(
  account: Pick<CloudAccount, 'accessToken' | 'wabaId'>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await metaFetch(account, `/${account.wabaId}/subscribed_apps`, {
      method: 'POST',
    })
    return { ok: true }
  } catch (err) {
    if (err instanceof MetaApiException) {
      // 2200 = already subscribed → treat as success
      if (err.metaError.code === 2200) return { ok: true }
      return { ok: false, error: err.metaError.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Subscribe failed' }
  }
}

export async function unsubscribeApp(
  account: Pick<CloudAccount, 'accessToken' | 'wabaId'>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await metaFetch(account, `/${account.wabaId}/subscribed_apps`, {
      method: 'DELETE',
    })
    return { ok: true }
  } catch (err) {
    if (err instanceof MetaApiException) {
      return { ok: false, error: err.metaError.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Unsubscribe failed' }
  }
}
