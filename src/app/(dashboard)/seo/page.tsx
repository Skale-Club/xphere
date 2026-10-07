import { orgRedirect } from '@/lib/org/redirect'
import { getSeoSections } from '@/lib/seo/sections.server'

// /seo opens the first tab the user can reach; the layout already handled "none".
export default async function SeoIndexPage() {
  const [first] = await getSeoSections()
  return orgRedirect(first?.href ?? '/dashboard')
}
