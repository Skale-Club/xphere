import { redirect } from 'next/navigation'
import { MessageCircleMore } from 'lucide-react'

import { getUser, createClient } from '@/lib/supabase/server'
import { ManychatRules } from '@/components/integrations/manychat-rules'
import { ManychatSubnav } from '@/components/integrations/manychat-subnav'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getManychatRules } from '../rule-actions'
import type { Database } from '@/types/database'

type ToolConfigRow = Database['public']['Tables']['_legacy_tool_configs']['Row']

export default async function ManychatRulesPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()

  const [rules, toolConfigsResult, channelResult] = await Promise.all([
    getManychatRules(),
    supabase.from('_legacy_tool_configs').select('id, tool_name, action_type, is_active').order('tool_name'),
    supabase.from('manychat_channels').select('id').maybeSingle(),
  ])

  const toolConfigs: Pick<ToolConfigRow, 'id' | 'tool_name' | 'action_type' | 'is_active'>[] =
    toolConfigsResult.data ?? []

  const channelId = channelResult.data?.id ?? null

  return (
    <PageContainer>
      <PageHeader
        eyebrow="ManyChat"
        eyebrowIcon={MessageCircleMore}
        title="Routing rules"
        description="Define how inbound ManyChat events are matched and routed to actions."
        back={{ href: '/integrations', label: 'All integrations' }}
      />

      <ManychatSubnav active="rules" />

      <ManychatRules rules={rules} toolConfigs={toolConfigs} channelId={channelId} />
    </PageContainer>
  )
}
