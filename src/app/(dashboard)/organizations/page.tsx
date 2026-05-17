import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { OrganizationsTable } from '@/components/organizations/organizations-table'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export default async function OrganizationsPage() {
  const user = await getUser()
  if (!user) redirect('/login')
  const supabase = await createClient()

  const { data: organizations, error } = await supabase
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Tenants"
        eyebrowIcon={Building2}
        title="Organizations"
        description="Manage tenants and their Vapi assistant mappings."
      />
      <OrganizationsTable organizations={organizations ?? []} />
    </PageContainer>
  )
}
