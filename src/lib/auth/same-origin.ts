import { resolveRequestOrigin } from '@/lib/site-url'

// Hosts that serve the production app. NEXT_PUBLIC_SITE_URL names only one of
// them, but the same deployment answers on all three.
const PRODUCTION_ORIGINS = [
  'https://xphere.app',
  'https://www.xphere.app',
  'https://xphere-stage.skale.club',
]

/**
 * CSRF guard for the sign-in and sign-out endpoints: the browser sets Origin on
 * cross-site POSTs and a page cannot forge it.
 */
export function isSameAuthOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  if (origin === resolveRequestOrigin(request)) return true
  return process.env.NODE_ENV === 'production' && PRODUCTION_ORIGINS.includes(origin)
}
