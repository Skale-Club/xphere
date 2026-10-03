import { orgRedirect } from '@/lib/org/redirect'

// Canonical location is now /settings/email-templates so it renders inside
// the Settings SubSidebarLayout. Redirect for backwards-compat.
export default async function EmailTemplatesRedirect() {
  return orgRedirect('/settings/email-templates')
}
