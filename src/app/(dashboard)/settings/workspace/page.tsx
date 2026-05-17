import { redirect } from 'next/navigation'
import { Palette } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { WorkspaceBrandingForm } from '@/components/settings/workspace-branding-form'

export default async function WorkspaceSettingsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) redirect('/organizations')

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, logo_url, accent_color, brand_name')
    .eq('id', orgId as string)
    .single()

  if (!org) redirect('/organizations')

  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Workspace"
        eyebrowIcon={Palette}
        title="Branding"
        description="Customize your workspace logo, accent color, and brand name. Changes apply instantly across the dashboard."
      />
      <WorkspaceBrandingForm
        org={{
          id: org.id,
          name: org.name,
          logo_url: org.logo_url,
          accent_color: org.accent_color,
          brand_name: org.brand_name,
        }}
      />
    </PageContainer>
  )
}
