import { Plug } from 'lucide-react'
import { Suspense } from 'react'

import { getIntegrationsForDisplay } from '@/app/(dashboard)/integrations/actions'
import { getTelegramBot } from '@/app/(dashboard)/integrations/telegram/actions'
import { IntegrationList } from '@/components/integrations/integration-list'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import type { SavedIntegration } from '@/lib/integrations/registry'

interface Props {
  searchParams: Promise<{ open?: string }>
}

export default async function SettingsIntegrationsPage({ searchParams }: Props) {
  const { open } = await searchParams
  const [rows, telegramBot] = await Promise.all([getIntegrationsForDisplay(), getTelegramBot()])

  const saved: Record<string, SavedIntegration> = {}
  for (const row of rows) {
    saved[row.provider] = {
      id: row.id,
      provider: row.provider,
      name: row.name,
      masked_api_key: row.masked_api_key,
      location_id: row.location_id,
      config: row.config,
      is_active: row.is_active,
    }
  }

  // `telegram_bots` lives outside the generic `integrations` table, so it
  // needs its own per-org lookup to make the list card's status accurate.
  if (telegramBot) {
    saved['telegram'] = {
      id: telegramBot.id,
      provider: 'telegram',
      name: telegramBot.botUsername ? `@${telegramBot.botUsername}` : 'Telegram',
      masked_api_key: telegramBot.botUsername ? `@${telegramBot.botUsername}` : '',
      location_id: null,
      config: null,
      is_active: true,
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Connections"
        eyebrowIcon={Plug}
        title="Integrations"
        description="Wire Xphere into the rest of your stack | messaging, voice, CRM, calendar, and AI providers."
      />
      <Suspense fallback={null}>
        <IntegrationList saved={saved} initialOpen={open} />
      </Suspense>
    </PageContainer>
  )
}
