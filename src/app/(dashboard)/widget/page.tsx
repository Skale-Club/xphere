import { orgRedirect } from '@/lib/org/redirect'

// Canonical location moved to /settings/widget so it renders inside the
// Settings layout. Redirect existing direct links for backwards-compat.
export default async function WidgetPageRedirect() {
  return orgRedirect('/settings/widget')
}
