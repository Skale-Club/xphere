import { redirect } from 'next/navigation'

import { getUser } from '@/lib/supabase/server'
import { GoogleContactsSettings } from '@/components/integrations/google-contacts-settings'
import { getGoogleContactsIntegration } from './actions'

interface Props {
  searchParams: Promise<{ connected?: string; error?: string }>
}

export default async function GoogleContactsPage({ searchParams }: Props) {
  const user = await getUser()
  if (!user) redirect('/login')

  const [integration, params] = await Promise.all([
    getGoogleContactsIntegration(),
    searchParams,
  ])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Google Contacts</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
          Connect a Google account to create, update, find, and delete contacts via the action engine.
        </p>
      </div>

      <GoogleContactsSettings
        integration={integration}
        connected={params.connected === 'true'}
        error={params.error}
      />
    </div>
  )
}
