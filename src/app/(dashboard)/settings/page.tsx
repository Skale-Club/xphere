import { orgRedirect } from '@/lib/org/redirect'

// /settings has no landing page of its own | the sub-sidebar already lists every
// section. Going to /settings jumps straight to the first item (Profile).
export default async function SettingsIndexPage() {
  return orgRedirect('/settings/profile')
}
