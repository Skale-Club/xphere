export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { drainXpotTaskSync } from '@/lib/xpot/task-sync'

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await drainXpotTaskSync(createServiceRoleClient(), 50)
    return Response.json({ ok: true, ...result })
  } catch (error) {
    console.error('[cron/xpot-task-sync]', error)
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
