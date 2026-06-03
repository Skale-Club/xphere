import { NextRequest } from 'next/server'
import { getUser } from '@/lib/supabase/server'
import { getAdsAttribution } from '@/lib/ads/attribution'

export const runtime = 'nodejs'

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

// date preset → ISO date range
function resolveDateRange(preset: string): { from: string; to: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  function iso(d: Date) { return d.toISOString() }

  switch (preset) {
    case 'today':
      return { from: iso(today), to: iso(now) }
    case 'yesterday': {
      const yest = new Date(today); yest.setDate(yest.getDate() - 1)
      return { from: iso(yest), to: iso(today) }
    }
    case 'last_7d': {
      const d = new Date(today); d.setDate(d.getDate() - 7)
      return { from: iso(d), to: iso(now) }
    }
    case 'last_14d': {
      const d = new Date(today); d.setDate(d.getDate() - 14)
      return { from: iso(d), to: iso(now) }
    }
    case 'last_30d': {
      const d = new Date(today); d.setDate(d.getDate() - 30)
      return { from: iso(d), to: iso(now) }
    }
    case 'last_90d': {
      const d = new Date(today); d.setDate(d.getDate() - 90)
      return { from: iso(d), to: iso(now) }
    }
    case 'this_month': {
      const d = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: iso(d), to: iso(now) }
    }
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end   = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: iso(start), to: iso(end) }
    }
    default: {
      const d = new Date(today); d.setDate(d.getDate() - 30)
      return { from: iso(d), to: iso(now) }
    }
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return err('Forbidden', 403)

  const url = new URL(request.url)
  const platform = url.searchParams.get('platform') as 'meta' | 'google' | null
  const since = url.searchParams.get('since')
  const until = url.searchParams.get('until')
  const datePreset = url.searchParams.get('date_preset') ?? 'last_30d'

  const { from, to } = since && until ? { from: since, to: until } : resolveDateRange(datePreset)

  try {
    const data = await getAdsAttribution({ from, to, platformFilter: platform })
    return Response.json(data)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Attribution query failed' }, { status: 500 })
  }
}
