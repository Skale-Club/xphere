import { redirect } from 'next/navigation'
import { Phone } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { getCalls, getAssistantOptions } from '@/app/(dashboard)/calls/actions'
import { getCampaigns } from '@/app/(dashboard)/outbound/actions'
import { CallsFilters } from '@/components/calls/calls-filters'
import { CallsTable } from '@/components/calls/calls-table'
import { CampaignList } from '@/components/campaigns/campaign-list'
import { AssistantMappingsTable } from '@/components/assistants/assistant-mappings-table'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import type { Database } from '@/types/database'
import { PhoneTabs, type PhoneTab } from './_tabs'

type AssistantMapping = Database['public']['Tables']['assistant_mappings']['Row']

function CallsTabContent({
  callsData,
  assistantOptions,
  page,
}: {
  callsData: Awaited<ReturnType<typeof getCalls>>
  assistantOptions: Awaited<ReturnType<typeof getAssistantOptions>>
  page: number
}) {
  const total = callsData.total
  const totalPages = Math.ceil(total / 20)
  return (
    <div className="space-y-4">
      <CallsFilters assistants={assistantOptions} />
      <CallsTable calls={callsData.calls} total={total} page={page} totalPages={totalPages} />
    </div>
  )
}

const VALID_TABS: PhoneTab[] = ['calls', 'campaigns', 'assistants']

function parseTab(raw: string | undefined): PhoneTab {
  if (raw && (VALID_TABS as string[]).includes(raw)) return raw as PhoneTab
  return 'calls'
}

export default async function PhonePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const user = await getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const activeTab = parseTab(params.tab as string | undefined)

  // Fetch only what the active tab needs
  let callsData: Awaited<ReturnType<typeof getCalls>> | null = null
  let assistantOptions: Awaited<ReturnType<typeof getAssistantOptions>> | null = null
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> | null = null
  let assistantMappings: AssistantMapping[] | null = null

  if (activeTab === 'calls') {
    const page = Math.max(1, Number(params.page ?? '1') || 1)
    const from = params.from as string | undefined
    const to = params.to as string | undefined
    const status = params.status as string | undefined
    const assistantId = params.assistant as string | undefined
    const callType = params.type as string | undefined
    const q = params.q as string | undefined

    const [calls, assistants] = await Promise.all([
      getCalls({ page, from, to, status, assistantId, callType, q }),
      getAssistantOptions(),
    ])
    callsData = calls
    assistantOptions = assistants
  }

  if (activeTab === 'campaigns') {
    campaigns = await getCampaigns()
  }

  if (activeTab === 'assistants') {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('assistant_mappings')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[phone:assistants] failed to load assistant_mappings', error)
    }
    assistantMappings = data ?? []
  }

  const description =
    activeTab === 'calls'
      ? 'Every completed call processed through your assistants.'
      : activeTab === 'campaigns'
      ? 'Manage outbound calling campaigns.'
      : 'Link Vapi assistants to this organization and keep a friendly name your team can recognize.'

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Voice"
        eyebrowIcon={Phone}
        title="Phone"
        description={description}
      />

      <PhoneTabs activeTab={activeTab} />

      {activeTab === 'calls' && callsData && assistantOptions && (
        <CallsTabContent
          callsData={callsData}
          assistantOptions={assistantOptions}
          page={Number(params.page ?? '1')}
        />
      )}

      {activeTab === 'campaigns' && campaigns && (
        <CampaignList campaigns={campaigns} />
      )}

      {activeTab === 'assistants' && assistantMappings && (
        <AssistantMappingsTable mappings={assistantMappings} />
      )}
    </PageContainer>
  )
}
