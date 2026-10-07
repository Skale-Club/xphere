import { ShieldOff } from 'lucide-react'

import { PageContainer } from '@/components/layout/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { can } from '@/lib/rbac/server'
import { SEO_SECTIONS, type SeoSection } from '@/lib/seo/sections'

export function SeoNoAccess({ title, detail }: { title: string; detail: string }) {
  return (
    <PageContainer>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <ShieldOff className="h-6 w-6 text-text-tertiary" />
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="max-w-md text-sm text-text-secondary">{detail}</p>
        </CardContent>
      </Card>
    </PageContainer>
  )
}

/**
 * Hiding a tab does not protect its route: every SEO tab's layout wraps its
 * pages in this gate on the tab's own permission.
 */
export async function SeoSectionGate({ section, children }: { section: SeoSection['key']; children: React.ReactNode }) {
  const s = SEO_SECTIONS.find((x) => x.key === section)!
  if (!(await can(s.permission))) {
    return (
      <SeoNoAccess
        title={`No access to ${s.key === 'website' ? 'SEO' : s.key === 'local' ? 'Local SEO' : s.label}`}
        detail={`Ask an admin of this organization to grant you the “${s.permissionLabel}” permission.`}
      />
    )
  }
  return children
}
