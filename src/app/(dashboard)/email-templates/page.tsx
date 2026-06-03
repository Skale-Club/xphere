import { redirect } from 'next/navigation'

// Canonical location is now /settings/email-templates so it renders inside
// the Settings SubSidebarLayout. Redirect for backwards-compat.
export default function EmailTemplatesRedirect() {
  redirect('/settings/email-templates')
}
