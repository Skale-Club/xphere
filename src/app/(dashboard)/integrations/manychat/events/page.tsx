import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUser } from '@/lib/supabase/server'
import { ManychatEvents } from '@/components/integrations/manychat-events'
import { getManychatEvents } from '../event-actions'

type SearchParams = {
  status?: string
  from?: string
  to?: string
  offset?: string
}

export default async function ManychatEventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const offset = parseInt(params.offset ?? '0', 10) || 0
  const status = ['matched', 'unmatched', 'error'].includes(params.status ?? '')
    ? (params.status as 'matched' | 'unmatched' | 'error')
    : undefined

  const { events, total } = await getManychatEvents({
    status,
    from: params.from,
    to: params.to,
    offset,
    limit: 25,
  })

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Event Log</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
          Inbound ManyChat webhook events and their routing outcomes.
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
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Rules
        </Link>
        <Link
          href="/integrations/manychat/events"
          className="text-sm font-medium underline underline-offset-4"
        >
          Events
        </Link>
      </nav>

      <ManychatEvents
        initialEvents={events}
        initialTotal={total}
        searchParams={params}
      />
    </div>
  )
}
