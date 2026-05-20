export const runtime = 'nodejs'

import { createClient, getUser } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const user = await getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { endpoint, keys, userAgent } = body as {
      endpoint: string
      keys: { p256dh: string; auth: string }
      userAgent?: string
    }

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return Response.json({ error: 'Invalid subscription' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (!orgId) return Response.json({ error: 'No active org' }, { status: 400 })

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        org_id: orgId as string,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: userAgent ?? request.headers.get('user-agent') ?? null,
      },
      { onConflict: 'user_id,endpoint' },
    )

    if (error) {
      console.error('[push/subscribe] upsert error:', error.message)
      return Response.json({ error: 'Failed to save subscription' }, { status: 500 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[push/subscribe] unexpected error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { endpoint } = body as { endpoint: string }
    if (!endpoint) return Response.json({ error: 'endpoint required' }, { status: 400 })

    const supabase = await createClient()
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint)

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[push/subscribe] DELETE unexpected error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
