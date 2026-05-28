// One-click unsubscribe endpoint (RFC 8058). Mail clients POST here when the
// user hits the native "unsubscribe" button; the List-Unsubscribe-Post header
// on marketing emails points at this URL. GET redirects to the human-facing
// confirmation page.

import { NextResponse } from 'next/server'

import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { recordUnsubscribe } from '@/lib/email/unsubscribe'

export const runtime = 'nodejs'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  const parsed = await verifyUnsubscribeToken(token)
  if (!parsed) {
    // Always 200 to mail clients so they mark it done; log invalid attempts.
    console.warn('[unsubscribe:one-click] invalid token')
    return NextResponse.json({ ok: true })
  }
  try {
    await recordUnsubscribe(parsed.orgId, parsed.email, 'one_click')
  } catch (err) {
    console.error('[unsubscribe:one-click] failed:', err)
  }
  return NextResponse.json({ ok: true })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params
  return NextResponse.redirect(
    new URL(`/unsubscribe/${token}`, process.env.NEXT_PUBLIC_APP_URL ?? 'https://xphere.app'),
  )
}
