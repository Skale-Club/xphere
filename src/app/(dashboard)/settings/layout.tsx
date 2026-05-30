import { redirect } from 'next/navigation'

import { getUser } from '@/lib/supabase/server'
import { redirectIfDemo } from '@/lib/demo/route-guard'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  // Settings exposes credentials, billing and workspace config — never to the
  // public demo visitor (read-only). Superadmins use their own login.
  await redirectIfDemo()

  // The dedicated settings sub-nav is intentionally absent: the main sidebar
  // (Integrations, Members, etc.) covers the same destinations, and the user
  // avatar dropdown links straight to Profile/Workspace/All settings. Adding
  // a secondary nav here would just duplicate options.
  return <>{children}</>
}
