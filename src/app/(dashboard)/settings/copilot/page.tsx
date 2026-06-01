import { redirect } from 'next/navigation'
import { Bot } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { CopilotSettingsForm } from '@/components/settings/copilot-settings-form'

export default async function CopilotSettingsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) redirect('/organizations')

  const [orgResult, providerResult] = await Promise.all([
    supabase
      .from('organizations')
      .select('settings')
      .eq('id', orgId as string)
      .maybeSingle(),
    supabase
      .from('integrations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId as string)
      .in('provider', ['openrouter', 'anthropic'])
      .eq('is_active', true),
  ])

  const settings = (orgResult.data?.settings ?? {}) as Record<string, unknown>
  const copilotEnabled = settings.copilot_enabled !== false // default true
  const hasProvider = (providerResult.count ?? 0) > 0

  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Settings"
        eyebrowIcon={Bot}
        title="Copilot"
        description="The AI assistant built into the dashboard. Enable or disable it for all users in this workspace, and connect an AI provider to activate it."
      />
      <CopilotSettingsForm
        initialEnabled={copilotEnabled}
        hasProvider={hasProvider}
      />
    </PageContainer>
  )
}
