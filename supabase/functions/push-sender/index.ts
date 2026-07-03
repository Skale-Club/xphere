// Deno Edge Function: push-sender
// Invoked by server actions after inserting a notification row.
// Loads all push_subscriptions for the target user, sends via Web Push,
// and deletes stale subscriptions that return 410 Gone.

import webpush from 'npm:web-push@^3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@^2'

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into edge
// functions by the platform — not secrets we manage.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

// VAPID keys live encrypted in Supabase Vault — never in code or env. Read them
// at cold start via a SECURITY DEFINER RPC that only the service role may call.
const { data: vapidRows, error: vapidErr } = await supabase.rpc('get_push_vapid_config')
const vapid = Array.isArray(vapidRows) ? vapidRows[0] : vapidRows
if (vapidErr || !vapid?.public_key || !vapid?.private_key || !vapid?.contact) {
  throw new Error(
    `[push-sender] Could not load VAPID config from Vault: ${vapidErr?.message ?? 'missing values'}`,
  )
}

webpush.setVapidDetails(vapid.contact, vapid.public_key, vapid.private_key)

interface PushPayload {
  user_id: string
  notification_id: string
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let body: PushPayload
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { user_id, notification_id } = body
  if (!user_id || !notification_id) {
    return new Response('user_id and notification_id required', { status: 400 })
  }

  // Load the notification row
  const { data: notif, error: notifErr } = await supabase
    .from('notifications')
    .select('id, type, payload')
    .eq('id', notification_id)
    .single()

  if (notifErr || !notif) {
    console.error('[push-sender] notification not found:', notification_id)
    return new Response('Notification not found', { status: 404 })
  }

  // Build push payload from notification type + payload
  const pushData = buildPushData(notif.type as string, notif.payload as Record<string, unknown>)

  // Load subscriptions for this user
  const { data: subs, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', user_id)

  if (subsErr || !subs || subs.length === 0) {
    return new Response('ok', { status: 200 })
  }

  const staleIds: string[] = []

  await Promise.all(
    subs.map(async (sub) => {
      const subscription = {
        endpoint: sub.endpoint as string,
        keys: {
          p256dh: sub.p256dh as string,
          auth: sub.auth as string,
        },
      }
      try {
        await webpush.sendNotification(subscription, JSON.stringify(pushData))
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          // Subscription is no longer valid
          staleIds.push(sub.id as string)
        } else {
          console.error('[push-sender] send error for sub', sub.id, err)
        }
      }
    }),
  )

  if (staleIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', staleIds)
  }

  return new Response('ok', { status: 200 })
})

interface PushData {
  title: string
  body: string
  url: string
  tag: string
  /** Incoming-call only: ring window in seconds — the SW auto-closes after it. */
  timeoutSeconds?: number
}

function buildPushData(type: string, payload: Record<string, unknown>): PushData {
  switch (type) {
    case 'new_conversation':
    case 'new_message': {
      const name = (payload.contact_name as string | undefined) ?? 'Someone'
      const msg = (payload.message_preview as string | undefined) ?? ''
      const preview = msg.length > 60 ? msg.slice(0, 60) + '…' : msg
      return {
        title: type === 'new_message' ? name : 'New conversation',
        body: preview ? (type === 'new_message' ? preview : `${name}: ${preview}`) : name,
        url: payload.conversation_id
          ? `/inbox?conversation=${payload.conversation_id}`
          : '/inbox',
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
        timeoutSeconds:
          typeof payload.timeout_seconds === 'number' ? payload.timeout_seconds : undefined,
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
      return {
        title: 'New notification',
        body: '',
        url: '/inbox',
        tag: `notif-${type}`,
      }
  }
}
