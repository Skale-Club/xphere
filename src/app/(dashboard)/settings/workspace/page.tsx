import { redirect } from 'next/navigation'
import { Palette } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { CompanyProfileForm } from '@/components/settings/company-profile-form'
import { WorkspaceBrandingForm } from '@/components/settings/workspace-branding-form'
import { WorkspaceSaveProvider } from '@/components/settings/workspace-save-bar'

export default async function WorkspaceSettingsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) redirect('/organizations')

  const { data: org } = await supabase
    .from('organizations')
    .select(
      'id, name, logo_url, accent_color, brand_name, daily_cost_cap_usd_override, default_currency, legal_name, tax_id, address_line1, address_line2, address_city, address_state, address_postal_code, address_country, timezone',
    )
    .eq('id', orgId as string)
    .single()

  if (!org) redirect('/organizations')

  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Workspace"
        eyebrowIcon={Palette}
        title="Workspace"
        description="Your company identity, branding and usage controls. The company details below also feed billing and email compliance."
      />

      <WorkspaceSaveProvider>
        <CompanyProfileForm
          orgId={org.id}
          initial={{
            legal_name: org.legal_name,
            tax_id: org.tax_id,
            address_line1: org.address_line1,
            address_line2: org.address_line2,
            address_city: org.address_city,
            address_state: org.address_state,
            address_postal_code: org.address_postal_code,
            address_country: org.address_country,
            timezone: org.timezone ?? 'UTC',
            default_currency: org.default_currency ?? 'USD',
          }}
        />

        <div className="mt-8">
          <WorkspaceBrandingForm
            org={{
              id: org.id,
              name: org.name,
              logo_url: org.logo_url,
              accent_color: org.accent_color,
              brand_name: org.brand_name,
              daily_cost_cap_usd:
                org.daily_cost_cap_usd_override != null ? Number(org.daily_cost_cap_usd_override) : null,
            }}
          />
        </div>
      </WorkspaceSaveProvider>
    </PageContainer>
  )
}
