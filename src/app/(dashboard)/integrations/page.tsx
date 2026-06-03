import { redirect } from 'next/navigation'

// Canonical location is now /settings/integrations so it renders inside
// the Settings SubSidebarLayout. Redirect for backwards-compat.
export default function IntegrationsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>
}) {
  void searchParams // consumed by the canonical page
  redirect('/settings/integrations')
}
