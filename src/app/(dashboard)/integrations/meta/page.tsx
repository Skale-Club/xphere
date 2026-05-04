import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import { MetaSettings } from '@/components/integrations/meta-settings'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
}

type AutomationOption = {
  id: string
  toolName: string
  actionType: string
}

export default async function MetaIntegrationsPage() {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')

  if (!orgId) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>
              Choose an organization before connecting Messenger or Instagram channels.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/organizations" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Go to organizations
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const [{ data: channels, error: channelsError }, { data: automations, error: automationsError }] = await Promise.all([
    supabase
      .from('meta_channels')
      .select('id, page_id, page_name, channel_type, ig_username, is_active, last_synced_at, connection_error, automation_id')
      .order('page_name', { ascending: true })
      .order('channel_type', { ascending: true }),
    supabase
      .from('tool_configs')
      .select('id, tool_name, action_type')
      .eq('is_active', true)
      .order('tool_name', { ascending: true }),
  ])

  if (channelsError) {
    throw new Error(channelsError.message)
  }

  if (automationsError) {
    throw new Error(automationsError.message)
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
  }))

  const automationOptions: AutomationOption[] = (automations ?? []).map((automation) => ({
    id: automation.id,
    toolName: automation.tool_name,
    actionType: automation.action_type,
  }))

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Meta Messaging</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
          Connect Facebook once to sync the org&apos;s Messenger pages and any linked Instagram professional accounts.
        </p>
      </div>

      <MetaSettings channels={channelRows} automationOptions={automationOptions} />
    </div>
  )
}
