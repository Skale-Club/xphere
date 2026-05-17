// src/app/api/voice/contact-by-phone/route.ts
// Tiny endpoint used by IncomingCallBanner to resolve a caller's name from the
// active org's contacts. Auth gated via getUser(); RLS scopes the lookup.

import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(request.url)
  const phone = url.searchParams.get('phone')
  if (!phone) return Response.json({ name: null })

  const supabase = await createClient()
  const { data } = await supabase
    .from('contacts')
    .select('name')
    .eq('phone', phone)
    .limit(1)
    .maybeSingle()

  return Response.json({ name: data?.name ?? null })
}
