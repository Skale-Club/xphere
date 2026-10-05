import { redirect } from 'next/navigation'
import { ShieldOff } from 'lucide-react'
import { getUser } from '@/lib/supabase/server'
import { can } from '@/lib/rbac/server'
import { PageContainer } from '@/components/layout/page-header'
import { Card, CardContent } from '@/components/ui/card'

// Hiding the nav item does not protect the route: gate every /seo page here.
export default async function SeoLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  if (!(await can('seo.view'))) {
    return (
      <PageContainer>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <ShieldOff className="h-6 w-6 text-text-tertiary" />
            <h2 className="text-lg font-semibold">No access to SEO</h2>
            <p className="max-w-md text-sm text-text-secondary">Ask an admin of this organization to grant you the “View SEO audits” permission.</p>
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  return children
}
