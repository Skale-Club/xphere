import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { NewCampaignWizard } from '../_components/new-campaign-wizard'
import { createClient } from '@/lib/supabase/server'

async function getSetupData() {
  const supabase = await createClient()
  const [assistantsRes, integRes, resendRes] = await Promise.all([
    supabase
      .from('assistant_mappings')
      .select('vapi_assistant_id, name')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('integrations')
      .select('provider')
      .eq('is_active', true),
    supabase
      .from('tenant_email_integrations')
      .select('id')
      .eq('status', 'connected')
      .limit(1),
  ])

  const assistants = (assistantsRes.data ?? []).map((a) => ({
    id: a.vapi_assistant_id,
    name: a.name ?? a.vapi_assistant_id,
  }))

  const providers = new Set((integRes.data ?? []).map((i) => i.provider))

  return {
    assistants,
    hasTwilio: providers.has('twilio'),
    hasResend: (resendRes.data ?? []).length > 0,
  }
}

export default async function NewCampaignPage() {
  const { assistants, hasTwilio, hasResend } = await getSetupData()

  return (
    <PageContainer>
      <PageHeader back={{ href: '/campaigns', label: 'Back to campaigns' }} />
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">New campaign</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Set up a multi-channel outreach campaign for your contacts.
          </p>
        </div>
        <NewCampaignWizard
          assistants={assistants}
          hasTwilio={hasTwilio}
          hasResend={hasResend}
        />
      </div>
    </PageContainer>
  )
}
