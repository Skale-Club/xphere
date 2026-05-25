import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageCircleMore } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { MetaSettings } from '@/components/integrations/meta-settings'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

type MetaChannelView = {
  id: string
  pageId: string
  pageName: string
  channelType: 'messenger' | 'instagram'
  igUsername: string | null
  isActive: boolean
  lastSyncedAt: string | null
  connectionError: string | null
  automationId: string | null
  provider: 'direct' | 'manychat'
}

type AutomationOption = {
  id: string
  toolName: string
  actionType: string
}

export default async function MetaIntegrationsPage() {
  const user = await getUser()

  if (!user) {
    redirect('/')
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  if (!orgId) {
    return (
      <PageContainer size="narrow">
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>
              Choose an organization before connecting Messenger or Instagram channels.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/organizations" className="text-sm font-medium text-accent underline-offset-4 hover:underline">
              Go to organizations
            </Link>
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  // Fail-soft: if either query fails we still render the page with an empty
  // list rather than crashing it. Errors are logged for Vercel inspection.
  const [{ data: channels, error: channelsError }, { data: automations, error: automationsError }] = await Promise.all([
    supabase
      .from('meta_channels')
      .select('id, page_id, page_name, channel_type, ig_username, is_active, last_synced_at, connection_error, automation_id, provider')
      .order('page_name', { ascending: true })
      .order('channel_type', { ascending: true }),
    supabase
      .from('_legacy_tool_configs')
      .select('id, tool_name, action_type')
      .eq('is_active', true)
      .order('tool_name', { ascending: true }),
  ])

  if (channelsError) {
    console.error('[integrations:meta] failed to load meta_channels', channelsError)
  }

  if (automationsError) {
    console.error('[integrations:meta] failed to load tool_configs', automationsError)
  }

  const channelRows: MetaChannelView[] = (channels ?? []).map((channel) => ({
    id: channel.id,
    pageId: channel.page_id,
    pageName: channel.page_name ?? 'Unnamed Page',
    channelType: channel.channel_type,
    igUsername: channel.ig_username,
    isActive: channel.is_active,
    lastSyncedAt: channel.last_synced_at,
    connectionError: channel.connection_error,
    automationId: channel.automation_id,
    provider: ((channel as { provider?: string }).provider as 'direct' | 'manychat') ?? 'direct',
  }))

  const automationOptions: AutomationOption[] = (automations ?? []).map((automation) => ({
    id: automation.id,
    toolName: automation.tool_name,
    actionType: automation.action_type,
  }))

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Meta Messaging"
        eyebrowIcon={MessageCircleMore}
        title="Meta Messaging"
        description="Connect Facebook once to sync the org's Messenger pages and any linked Instagram professional accounts."
        back={{ href: '/integrations', label: 'All integrations' }}
      />

      <MetaSettings channels={channelRows} automationOptions={automationOptions} />
    </PageContainer>
  )
}
