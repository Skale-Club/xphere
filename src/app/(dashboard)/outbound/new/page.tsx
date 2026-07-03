import { Megaphone } from 'lucide-react'

import { CampaignForm } from '@/components/campaigns/campaign-form'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export default function NewCampaignPage() {
  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Outbound"
        eyebrowIcon={Megaphone}
        title="New campaign"
        description="Create an outbound calling campaign. Set pacing, schedule, and assistant."
        back={{ href: '/campaigns?channel=calls', label: 'Back to campaigns' }}
      />
      <CampaignForm />
    </PageContainer>
  )
}
