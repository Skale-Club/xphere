import { redirect } from 'next/navigation'

import { SeoNoAccess } from '@/components/seo/section-gate'
import { SeoSectionTabs } from '@/components/seo/seo-section-tabs'
import { getSeoSections } from '@/lib/seo/sections.server'
import { getUser } from '@/lib/supabase/server'

// Website audits, Local SEO, Reviews and their reports live under one sidebar
// item. Each tab keeps its own permission + billing feature (see
// src/lib/seo/sections.ts); its layout gates the route, this one only frames it.
export default async function SeoLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  const sections = await getSeoSections()
  if (sections.length === 0) {
    return <SeoNoAccess title="No access to SEO" detail="Ask an admin of this organization to grant you access to SEO, Local SEO or Reviews." />
  }

  return (
    <div className="flex h-full flex-col">
      {sections.length > 1 && (
        <div className="shrink-0 border-b border-border-subtle bg-bg-secondary px-4 py-3 sm:px-6">
          <SeoSectionTabs tabs={sections.map(({ key, label, href }) => ({ key, label, href }))} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
