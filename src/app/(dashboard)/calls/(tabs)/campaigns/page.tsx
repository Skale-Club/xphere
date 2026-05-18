import { getCampaigns } from '@/app/(dashboard)/outbound/actions'
import { CampaignList } from '@/components/campaigns/campaign-list'

export default async function CallsCampaignsPage() {
  const campaigns = await getCampaigns()
  return <CampaignList campaigns={campaigns} />
}
