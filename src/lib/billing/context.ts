// Resolves the trusted billing context (org + caller role) from the
// authenticated session. The org id is read from the DB via get_current_org_id()
// — never accepted from the client — so it is safe to use as the billing owner.
import 'server-only'
import { headers } from 'next/headers'
import { createClient, getUser } from '@/lib/supabase/server'

export interface BillingContext {
  userId: string
  orgId: string
  isAdmin: boolean
}

/**
 * Returns the active billing context for the current request, or null when the
 * caller is unauthenticated or not attached to an org.
 */
export async function getBillingContext(): Promise<BillingContext | null> {
  const user = await getUser()
  if (!user) return null

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('organization_id', orgId as string)
    .eq('user_id', user.id)
    .maybeSingle()

  return {
    userId: user.id,
    orgId: orgId as string,
    isAdmin: membership?.role === 'admin',
  }
}

/**
 * Absolute base URL for Stripe redirect targets. Prefers the incoming request
 * origin (so local dev and previews work), falling back to the canonical
 * production host.
 */
export async function getBaseUrl(): Promise<string> {
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin.replace(/\/$/, '')

  const host = h.get('host')
  if (host) {
    const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https'
    return `${proto}://${host}`
  }

  return 'https://xphere.app'
}
