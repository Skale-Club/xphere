import { redirect } from 'next/navigation'

// Canonical location is now /settings/knowledge so it renders inside
// the Settings SubSidebarLayout. Redirect for backwards-compat.
export default function KnowledgeRedirect() {
  redirect('/settings/knowledge')
}
