import { Megaphone } from 'lucide-react'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { NewCampaignWizard } from '../_components/new-campaign-wizard'
import { createClient } from '@/lib/supabase/server'

async function getSetupData() {
  const supabase = await createClient()

  // Fetch Vapi assistants from assistant_mappings (active ones with names)
  const [assistantsRes, integRes] = await Promise.all([
    supabase
      .from('assistant_mappings')
      .select('vapi_assistant_id, name')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('integrations')
      .select('provider')
      .eq('is_active', true),
  ])

  const assistants = (assistantsRes.data ?? []).map((a) => ({
    id: a.vapi_assistant_id,
    name: a.name ?? a.vapi_assistant_id,
  }))

  const providers = new Set((integRes.data ?? []).map((i) => i.provider))
  const hasTwilio = providers.has('twilio')
  const hasResend = false // not yet supported in provider enum

  return { assistants, hasTwilio, hasResend }
}

export default async function NewCampaignPage() {
  const { assistants, hasTwilio, hasResend } = await getSetupData()

  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Campaigns"
        eyebrowIcon={Megaphone}
        title="New campaign"
        description="Reach your contacts across calls, SMS, and more."
        back={{ href: '/campaigns', label: 'Back to campaigns' }}
      />
      <NewCampaignWizard
        assistants={assistants}
        hasTwilio={hasTwilio}
        hasResend={hasResend}
      />
    </PageContainer>
  )
}
