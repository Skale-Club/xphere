import { redirect } from 'next/navigation'
import { Send } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

import { getTelegramBot, listAgentsForSelect } from './actions'
import { TelegramSettings } from './telegram-settings'

export default async function TelegramIntegrationPage() {
  const user = await getUser()
  if (!user) {
    redirect('/login')
  }

  const [bot, agents] = await Promise.all([getTelegramBot(), listAgentsForSelect()])

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Messaging"
        eyebrowIcon={Send}
        title="Telegram"
        description="Conecte um bot do Telegram para notificações de workflow e atendimento automático em DMs."
        back={{ href: '/integrations', label: 'All integrations' }}
      />

      <TelegramSettings initialBot={bot} agents={agents} />
    </PageContainer>
  )
}
