import Link from 'next/link'

import { MessageCircleMore } from 'lucide-react'

import { getIntegrations } from './actions'
import { IntegrationsTable } from '@/components/integrations/integrations-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function IntegrationsPage() {
  const integrations = await getIntegrations()

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect external services to your organization.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircleMore className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Meta Messaging</CardTitle>
          </div>
          <CardDescription>
            Facebook Login manages multiple Messenger and Instagram channel rows, so it lives on a dedicated settings page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/integrations/meta" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Open Meta channel settings
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageCircleMore className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">ManyChat</CardTitle>
          </div>
          <CardDescription>
            Connect a ManyChat bot to receive subscriber events and route them to actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/integrations/manychat" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Open ManyChat settings
          </Link>
        </CardContent>
      </Card>

      <IntegrationsTable integrations={integrations} />
    </div>
  )
}
