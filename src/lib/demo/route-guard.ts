import 'server-only'

import { redirect } from 'next/navigation'

import { isDemoSession } from '@/lib/demo/guard'

/**
 * Server guard for sensitive areas that must stay hidden from public demo
 * visitors (settings, integrations, members, credentials, etc.). Drop at the
 * top of a layout/page server component:
 *
 *   await redirectIfDemo()
 */
export async function redirectIfDemo(to = '/dashboard'): Promise<void> {
  if (await isDemoSession()) {
    redirect(to)
  }
}
