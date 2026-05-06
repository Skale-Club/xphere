import { redirect } from 'next/navigation'

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

      <ManychatSettings channel={channel} />
    </div>
  )
}
