import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUser, createClient } from '@/lib/supabase/server'
import { ManychatRules } from '@/components/integrations/manychat-rules'
import { getManychatRules } from '../rule-actions'
import type { Database } from '@/types/database'

type ToolConfigRow = Database['public']['Tables']['tool_configs']['Row']

export default async function ManychatRulesPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const supabase = await createClient()

  const [rules, toolConfigsResult, channelResult] = await Promise.all([
    getManychatRules(),
    supabase.from('tool_configs').select('id, tool_name, action_type, is_active').order('tool_name'),
    supabase.from('manychat_channels').select('id').maybeSingle(),
  ])

  const toolConfigs: Pick<ToolConfigRow, 'id' | 'tool_name' | 'action_type' | 'is_active'>[] =
    toolConfigsResult.data ?? []

  const channelId = channelResult.data?.id ?? null

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">ManyChat</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
          Connect your ManyChat bot to receive subscriber events and route them to actions.
        </p>
      </div>

      {/* Sub-page navigation */}
      <nav className="flex gap-4 border-b pb-2">
        <Link
          href="/integrations/manychat"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Settings
        </Link>
        <Link
          href="/integrations/manychat/rules"
          className="text-sm font-medium underline underline-offset-4"
        >
          Rules
        </Link>
        <Link
          href="/integrations/manychat/events"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Events
        </Link>
      </nav>

      <div>
        <h2 className="text-base font-semibold">Routing Rules</h2>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
          Define how inbound ManyChat events are matched and routed to actions.
        </p>
      </div>
      <ManychatRules rules={rules} toolConfigs={toolConfigs} channelId={channelId} />
    </div>
  )
}
