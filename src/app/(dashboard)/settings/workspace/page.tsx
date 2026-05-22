import { redirect } from 'next/navigation'
import { Palette } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { WorkspaceBrandingForm } from '@/components/settings/workspace-branding-form'
import { CurrencySettingsSection } from '@/components/settings/currency-settings-section'
import { WhatsAppProviderSettings } from './whatsapp-provider-settings'
import { LabelsSettings } from './labels-settings'
import { getActiveWhatsAppProvider } from './actions'

export default async function WorkspaceSettingsPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) redirect('/organizations')

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, logo_url, accent_color, brand_name, daily_cost_cap_usd_override, default_currency')
    .eq('id', orgId as string)
    .single()

  if (!org) redirect('/organizations')

  const whatsapp = await getActiveWhatsAppProvider()

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
          daily_cost_cap_usd: org.daily_cost_cap_usd_override != null ? Number(org.daily_cost_cap_usd_override) : null,
        }}
      />
      <div className="mt-8">
        <CurrencySettingsSection defaultCurrency={org.default_currency ?? 'USD'} />
      </div>
      <div className="mt-8">
        <WhatsAppProviderSettings initial={whatsapp} />
      </div>
      <div className="mt-8">
        <LabelsSettings />
      </div>
    </PageContainer>
  )
}
