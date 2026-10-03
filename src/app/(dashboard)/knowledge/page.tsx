import { orgRedirect } from '@/lib/org/redirect'

// Canonical location is now /settings/knowledge so it renders inside
// the Settings SubSidebarLayout. Redirect for backwards-compat.
export default async function KnowledgeRedirect() {
  return orgRedirect('/settings/knowledge')
}
