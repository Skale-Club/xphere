import { createClient, getUser } from '@/lib/supabase/server'
import { getProviderKey } from '@/lib/integrations/get-provider-key'

export const runtime = 'nodejs'

function isAllowedZernioMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'https:' &&
      url.hostname === 'zernio.com' &&
      /^\/api\/v1\/[a-z0-9_-]+\/media\/[^/]+$/i.test(url.pathname) &&
      Boolean(url.searchParams.get('accountId'))
    )
  } catch {
    return false
  }
}

export async function GET(request: Request): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const mediaUrl = url.searchParams.get('url') ?? ''
  if (!isAllowedZernioMediaUrl(mediaUrl)) {
    return Response.json({ error: 'Invalid media URL' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return Response.json({ error: 'No active organization' }, { status: 400 })

  const apiKey = await getProviderKey('zernio', orgId, supabase)
  if (!apiKey) return Response.json({ error: 'Zernio is not connected' }, { status: 400 })

  const { data: linkedMessage, error: mediaLookupError } = await supabase
    .from('conversation_messages')
    .select('id')
    .eq('org_id', orgId)
    .contains('metadata', {
      media: [{ provider: 'zernio', original_url: mediaUrl }],
    } as never)
    .limit(1)
    .maybeSingle()

  if (mediaLookupError) {
    console.error('[zernio/media] media lookup failed:', mediaLookupError.message)
    return Response.json({ error: 'Could not verify Zernio media' }, { status: 500 })
  }
  if (!linkedMessage) {
    return Response.json({ error: 'Zernio media not found' }, { status: 404 })
  }

  const upstream = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: 'Could not load Zernio media' }, { status: upstream.status || 502 })
  }

  const headers = new Headers()
  const contentType = upstream.headers.get('content-type')
  const contentLength = upstream.headers.get('content-length')
  if (contentType) headers.set('content-type', contentType)
  if (contentLength) headers.set('content-length', contentLength)
  headers.set('cache-control', 'private, max-age=300')

  return new Response(upstream.body, { status: 200, headers })
}
