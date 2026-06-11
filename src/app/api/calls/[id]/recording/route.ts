// src/app/api/calls/[id]/recording/route.ts
// Authenticated, org-scoped audio proxy for call recordings.
//
// Why this exists: Twilio recording media (api.twilio.com/.../Recordings/RE….mp3)
// requires HTTP Basic Auth. When Hetzner object storage isn't configured we store
// the raw Twilio URL in call_logs.recording_url, so the browser player can't fetch
// it directly (401 Unauthorized). This route streams the audio server-side with the
// org's Twilio credentials. For recordings already moved to our own storage it just
// redirects to the stored (public/CDN) URL.
//
// Access is gated by the authenticated Supabase client: the unified_calls lookup is
// RLS-scoped, so a user can only ever proxy recordings belonging to their org.

import { getUser, createClient } from '@/lib/supabase/server'
import { resolveTwilioCredentialsForOrg } from '@/lib/twilio/voice'

export const runtime = 'nodejs'

function isTwilioMediaUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('api.twilio.com')
  } catch {
    return false
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params

  const user = await getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // RLS-scoped: only returns the row if it belongs to the user's org.
  const supabase = await createClient()
  const { data: call } = await supabase
    .from('unified_calls')
    .select('recording_url, org_id')
    .eq('id', id)
    .maybeSingle()

  if (!call?.recording_url) {
    return new Response('Recording not found', { status: 404 })
  }

  // Already on our own storage (or any non-Twilio public URL) — hand it straight back.
  if (!isTwilioMediaUrl(call.recording_url)) {
    return Response.redirect(call.recording_url, 302)
  }

  const creds = await resolveTwilioCredentialsForOrg(call.org_id)
  if (!creds) {
    return new Response('Twilio credentials unavailable', { status: 502 })
  }

  // Ensure we request the playable media (.mp3) rather than the JSON resource.
  const mediaUrl =
    call.recording_url.endsWith('.mp3') || call.recording_url.endsWith('.wav')
      ? call.recording_url
      : `${call.recording_url}.mp3`

  const basicAuth = `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`
  const range = request.headers.get('range')

  const upstream = await fetch(mediaUrl, {
    headers: {
      Authorization: basicAuth,
      ...(range ? { Range: range } : {}),
    },
    cache: 'no-store',
  })

  if (!upstream.ok && upstream.status !== 206) {
    return new Response('Failed to fetch recording', { status: 502 })
  }

  // Stream the audio straight through, preserving range/seek headers.
  const headers = new Headers()
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg')
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', 'private, max-age=3600')
  const contentLength = upstream.headers.get('content-length')
  if (contentLength) headers.set('Content-Length', contentLength)
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)

  return new Response(upstream.body, { status: upstream.status, headers })
}
