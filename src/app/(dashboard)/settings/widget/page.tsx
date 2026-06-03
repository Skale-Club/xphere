import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageSquare } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WidgetSettingsForm } from '@/components/widget/widget-settings-form'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

const DEFAULT_WIDGET_SETTINGS = {
  displayName: 'AI Assistant',
  primaryColor: '#18181B',
  welcomeMessage: 'Hi! How can I help?',
} as const

function normalizeWidgetValue(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export default async function SettingsWidgetPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: activeOrgId } = await supabase.rpc('get_current_org_id')

  if (!activeOrgId) {
    return (
      <PageContainer size="narrow">
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>
              Choose an organization before configuring its widget settings.
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

  const { data: organization, error } = await supabase
    .from('organizations')
    .select(
      'id, name, widget_display_name, widget_primary_color, widget_welcome_message, widget_token, widget_avatar_url'
    )
    .eq('id', activeOrgId)
    .single()

  if (error || !organization) {
    throw new Error(error?.message ?? 'Failed to load widget settings.')
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Embed"
        eyebrowIcon={MessageSquare}
        title="Widget"
        description={`Configure the public chat widget for ${organization.name}.`}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <WidgetSettingsForm
          initialSettings={{
            displayName: normalizeWidgetValue(
              organization.widget_display_name,
              DEFAULT_WIDGET_SETTINGS.displayName
            ),
            primaryColor: normalizeWidgetValue(
              organization.widget_primary_color,
              DEFAULT_WIDGET_SETTINGS.primaryColor
            ),
            welcomeMessage: normalizeWidgetValue(
              organization.widget_welcome_message,
              DEFAULT_WIDGET_SETTINGS.welcomeMessage
            ),
            avatarUrl: organization.widget_avatar_url || '',
          }}
          widgetToken={organization.widget_token}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Active organization</CardTitle>
            <CardDescription>
              Widget settings always apply to the current org selection in the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-[13px]">
            <div>
              <p className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Organization</p>
              <p className="mt-1 font-medium text-text-primary">{organization.name}</p>
            </div>
            <div>
              <p className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Current token</p>
              <code className="mt-1 block overflow-x-auto rounded-[6px] border border-border-subtle bg-bg-tertiary px-3 py-2 text-[11px] font-mono text-text-secondary">
                {organization.widget_token}
              </code>
            </div>
            <div className="rounded-[8px] border border-dashed border-border bg-bg-secondary/40 p-4 text-[12px] leading-relaxed text-text-tertiary">
              Saved changes are picked up by new widget loads on public sites through the token-based
              config endpoint.
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
