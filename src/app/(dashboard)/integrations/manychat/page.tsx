import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getUser } from '@/lib/supabase/server'
import { ManychatSettings } from '@/components/integrations/manychat-settings'
import { getManychatChannel } from './actions'

export default async function ManychatIntegrationsPage() {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const channel = await getManychatChannel()

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
          className="text-sm font-medium underline underline-offset-4"
        >
          Settings
        </Link>
        <Link
          href="/integrations/manychat/rules"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
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

      <ManychatSettings channel={channel} />
    </div>
  )
}
