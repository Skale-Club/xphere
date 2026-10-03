import { orgRedirect } from '@/lib/org/redirect'

// Canonical location is now /settings/integrations so it renders inside
// the Settings SubSidebarLayout. Redirect for backwards-compat.
export default async function IntegrationsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>
}) {
  void searchParams // consumed by the canonical page
  return orgRedirect('/settings/integrations')
}
