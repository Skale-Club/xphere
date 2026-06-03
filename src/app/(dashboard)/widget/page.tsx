import { redirect } from 'next/navigation'

// Canonical location moved to /settings/widget so it renders inside the
// Settings layout. Redirect existing direct links for backwards-compat.
export default function WidgetPageRedirect() {
  redirect('/settings/widget')
}
