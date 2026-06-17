import { NextResponse } from 'next/server'

import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(): Promise<Response> {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()

  // RLS scopes the delete to the caller's active org; remove every stored Meta
  // connection (one row per ad account, all sharing the same OAuth token).
  const { error } = await supabase
    .from('ads_connections')
    .delete()
    .eq('platform', 'meta')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
