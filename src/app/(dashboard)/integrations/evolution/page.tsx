import { redirect } from 'next/navigation'
import { MessageCircle } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { EvolutionSetupFlow } from '@/components/integrations/evolution-setup-flow'
import { getEvolutionInstance } from './actions'

export default async function EvolutionIntegrationPage() {
  const user = await getUser()
  if (!user) {
    redirect('/login')
  }

  const instance = await getEvolutionInstance()

  const origin = process.env.OPERATOR_PUBLIC_ORIGIN ?? 'https://operator.skale.club'
  const webhookUrl = `${origin}/api/evolution/webhook`

  return (
    <PageContainer>
      <PageHeader
        eyebrow="WhatsApp"
        eyebrowIcon={MessageCircle}
        title="Evolution Go"
        description="Self-hosted WhatsApp gateway. Connect your Evolution Go instance, scan the QR, and start receiving messages."
        back={{ href: '/integrations', label: 'All integrations' }}
      />

      <EvolutionSetupFlow initialInstance={instance} webhookUrl={webhookUrl} />
    </PageContainer>
  )
}
