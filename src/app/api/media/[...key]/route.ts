// GET /api/media/<bucket>/<org-id>/<rest...>
//
// The session-gated address of an object in a PRIVATE bucket (chat media,
// import files, recordings). Stored `metadata.media[].url` values point here
// once a bucket is on R2; the route checks the caller is a member of the org in
// the path and redirects to a short-lived signed URL, so a leaked link stops
// working within minutes instead of staying open forever.
//
// 401: no session.  404: not a member of that org, malformed key, unknown or
// non-org bucket. A non-member never learns whether the object exists.

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { PRIVATE_BUCKETS, assertSafePath, signedUrl, type PrivateBucket } from '@/lib/storage'

export const runtime = 'nodejs'

/** Private buckets whose first path segment is an org id. global-knowledge is platform-wide, so never served here. */
const ORG_SCOPED_BUCKETS = PRIVATE_BUCKETS.filter((b) => b !== 'global-knowledge') as readonly string[]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNED_TTL_SECONDS = 300

const notFound = () => Response.json({ error: 'Not found' }, { status: 404 })

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = await params
  const segments = Array.isArray(key) ? key : []
  // Next has already decoded each segment, so an encoded "..", "/" or "\" shows up literally.
  if (segments.length < 3 || segments.some((s) => s.includes('/') || s.includes('\\'))) return notFound()

  const [bucket, orgId, ...rest] = segments
  if (!ORG_SCOPED_BUCKETS.includes(bucket) || !UUID_RE.test(orgId)) return notFound()

  const path = [orgId, ...rest].join('/')
  try {
    assertSafePath(path)
  } catch {
    return notFound()
  }

  const admin = createServiceRoleClient()
  const { data: membership } = await admin
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!membership) return notFound()

  let url: string
  try {
    url = await signedUrl(bucket as PrivateBucket, path, SIGNED_TTL_SECONDS)
  } catch (err) {
    console.error('[api/media] could not sign', bucket, err instanceof Error ? err.message : err)
    return Response.json({ error: 'Media unavailable' }, { status: 502 })
  }

  return new Response(null, {
    status: 302,
    headers: { Location: url, 'Cache-Control': 'private, no-store' },
  })
}
