// src/lib/notifications/push-sender.ts
// Node port of supabase/functions/push-sender (Deno). Loads the notification and
// the user's push subscriptions, sends via Web Push and deletes subscriptions
// that answer 410/404. Runs inside the app when EDGE_FUNCTIONS_IN_APP lists
// "push-sender" (see lib/edge-functions/switch); VAPID keys come from
// lib/push/vapid-config.ts (table first, Vault RPC as fallback).

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadVapidConfig, type VapidConfig } from '@/lib/push/vapid-config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export interface PushRequest {
  user_id?: string
  notification_id?: string
}

export interface PushResult {
  status: number
  body: string
}

export interface PushDeps {
  loadVapid: (db: Db) => Promise<{ config: VapidConfig }>
  send: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    vapid: VapidConfig,
  ) => Promise<unknown>
}

const defaultDeps: PushDeps = {
  loadVapid: (db) => loadVapidConfig(db),
  send: async (subscription, payload, vapid) => {
    const webpush = (await import('web-push')).default
    // Passed per call, so no module-level VAPID state is shared.
    return webpush.sendNotification(subscription, payload, {
      vapidDetails: { subject: vapid.contact, publicKey: vapid.public_key, privateKey: vapid.private_key },
    })
  },
}

export async function sendPushForNotification(
  db: Db,
  request: PushRequest,
  overrides: Partial<PushDeps> = {},
): Promise<PushResult> {
  const deps: PushDeps = { ...defaultDeps, ...overrides }
  const { user_id, notification_id } = request
  if (!user_id || !notification_id) {
    return { status: 400, body: 'user_id and notification_id required' }
  }

  // Same failure as the Deno function had at cold start: no VAPID config, no push.
  let vapid: VapidConfig
  try {
    vapid = (await deps.loadVapid(db)).config
  } catch (err) {
    console.error('[push-sender]', err instanceof Error ? err.message : err)
    return { status: 500, body: 'VAPID config unavailable' }
  }

  const { data: notif, error: notifErr } = await db
    .from('notifications')
    .select('id, type, payload')
    .eq('id', notification_id)
    .single()

  if (notifErr || !notif) {
    console.error('[push-sender] notification not found:', notification_id)
    return { status: 404, body: 'Notification not found' }
  }

  const pushData = buildPushData(notif.type as string, notif.payload as Record<string, unknown>)

  const { data: subs, error: subsErr } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', user_id)

  if (subsErr || !subs || subs.length === 0) return { status: 200, body: 'ok' }

  const staleIds: string[] = []

  await Promise.all(
    (subs as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>).map(async (sub) => {
      try {
        await deps.send(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(pushData),
          vapid,
        )
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          // Subscription is no longer valid
          staleIds.push(sub.id)
        } else {
          console.error('[push-sender] send error for sub', sub.id, err)
        }
      }
    }),
  )

  if (staleIds.length > 0) {
    await db.from('push_subscriptions').delete().in('id', staleIds)
  }

  return { status: 200, body: 'ok' }
}

export interface PushData {
  title: string
  body: string
  url: string
  tag: string
  /** Incoming-call only: ring window in seconds; the SW auto-closes after it. */
  timeoutSeconds?: number
}

export function buildPushData(type: string, payload: Record<string, unknown>): PushData {
  switch (type) {
    case 'new_conversation':
    case 'new_message': {
      const name = (payload.contact_name as string | undefined) ?? 'Someone'
      const msg = (payload.message_preview as string | undefined) ?? ''
      const preview = msg.length > 60 ? msg.slice(0, 60) + '…' : msg
      return {
        title: type === 'new_message' ? name : 'New conversation',
        body: preview ? (type === 'new_message' ? preview : `${name}: ${preview}`) : name,
        url: payload.conversation_id ? `/inbox?conversation=${payload.conversation_id}` : '/inbox',
        tag: `conv-${payload.conversation_id ?? 'inbox'}`,
      }
    }
    case 'missed_call': {
      const caller =
        (payload.caller_name as string | undefined) ??
        (payload.caller_number as string | undefined) ??
        'Unknown caller'
      return {
        title: 'Missed call',
        body: caller,
        url: payload.call_log_id ? `/calls?highlight=${payload.call_log_id}` : '/calls',
        tag: `call-${payload.call_log_id ?? 'missed'}`,
      }
    }
    case 'incoming_call': {
      const caller =
        (payload.caller_name as string | undefined) ??
        (payload.caller_number as string | undefined) ??
        'Unknown caller'
      const callId = payload.call_id as string | undefined
      return {
        title: 'Incoming call',
        body: `Call from ${caller}`,
        // Deep link into the answer flow: the app registers the Voice SDK
        // device and asks the server to redirect the ringing call to it.
        url: callId ? `/calls?answer=${encodeURIComponent(callId)}` : '/calls',
        tag: `incoming-${callId ?? 'call'}`,
        timeoutSeconds: typeof payload.timeout_seconds === 'number' ? payload.timeout_seconds : undefined,
      }
    }
    case 'handoff_requested': {
      const name = (payload.contact_name as string | undefined) ?? 'A contact'
      const reason = (payload.reason as string | undefined) ?? ''
      return {
        title: `${name} needs a human`,
        body: reason.length > 80 ? reason.slice(0, 80) + '…' : reason || 'The assistant handed this conversation over',
        url: payload.conversation_id ? `/inbox?conversation=${payload.conversation_id}` : '/inbox',
        tag: `handoff-${payload.conversation_id ?? 'inbox'}`,
      }
    }
    case 'ads_connection_expiring': {
      const platform = payload.platform === 'google' ? 'Google Ads' : 'Meta'
      const days = typeof payload.days_left === 'number' ? payload.days_left : null
      const expired = payload.kind === 'expired'
      return {
        title: expired
          ? `${platform} connection expired`
          : `${platform} connection expires in ${days} day${days === 1 ? '' : 's'}`,
        body: 'Reconnect it to keep reports, conversions and audiences syncing.',
        url: payload.platform === 'google' ? '/ads/google' : '/ads',
        tag: `ads-expiry-${payload.platform ?? 'meta'}`,
      }
    }
    case 'flow_failed': {
      const flowName = (payload.flow_name as string | undefined) ?? 'A workflow'
      return {
        title: 'Workflow failed',
        body: `${flowName} encountered an error`,
        url: payload.flow_id ? `/workflows/flows/${payload.flow_id}` : '/workflows',
        tag: `flow-${payload.flow_id ?? 'failed'}`,
      }
    }
    default:
      return { title: 'New notification', body: '', url: '/inbox', tag: `notif-${type}` }
  }
}
