import { redirect } from 'next/navigation'

// /settings has no landing page of its own | the sub-sidebar already lists every
// section. Going to /settings jumps straight to the first item (Profile).
export default function SettingsIndexPage() {
  redirect('/settings/profile')
}
