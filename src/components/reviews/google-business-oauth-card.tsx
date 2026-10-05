'use client'

import { useMemo, useState, useTransition } from 'react'
import { AlertCircle, Building2, CheckCircle2, ExternalLink, Loader2, Unplug } from 'lucide-react'
import { toast } from 'sonner'

import { disconnectGoogleBusinessOAuth, setActiveGoogleBusinessLocations } from '@/app/(dashboard)/integrations/google-reviews/actions'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

export type GoogleBusinessConnectionView = {
  ad_account_id: string
  ad_account_name: string | null
  status: string
  health: string
  connection_error: string | null
}

export function GoogleBusinessOAuthCard({
  connections,
  error,
}: {
  connections: GoogleBusinessConnectionView[]
  error?: string | null
}) {
  const initial = useMemo(() => connections.filter((row) => row.status === 'active').map((row) => row.ad_account_id), [connections])
  const [selected, setSelected] = useState(new Set(initial))
  const [pending, startTransition] = useTransition()

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function save() {
    startTransition(async () => {
      const result = await setActiveGoogleBusinessLocations([...selected])
      if (result.error) toast.error(result.error)
      else toast.success('Business Profile locations updated.')
    })
  }

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectGoogleBusinessOAuth()
      if (result.error) toast.error(result.error)
      else toast.success('Google Business Profile disconnected.')
    })
  }

  return (
    <section className="rounded-[14px] border border-border bg-bg-secondary p-6 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#4285F4]/10 text-[#4285F4]">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[15px] font-medium text-text-primary">Google Business Profile control</h2>
            <p className="mt-0.5 max-w-2xl text-[12.5px] text-text-secondary">
              OAuth access for posts, review replies, photos, categories, services, attributes, address, hours, service area and open status. Every write uses preview and explicit approval.
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant={connections.length ? 'outline' : 'default'}>
          <a href="/api/google-business/connect">
            {connections.length ? 'Reconnect' : 'Connect Google Business'}
            <ExternalLink className="ml-2 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-[10px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {connections.length ? (
        <div className="space-y-3">
          <div className="divide-y divide-border-subtle rounded-[10px] border border-border-subtle">
            {connections.map((connection) => (
              <label key={connection.ad_account_id} className="flex cursor-pointer items-start gap-3 px-3 py-3">
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(connection.ad_account_id)}
                  onCheckedChange={(value) => toggle(connection.ad_account_id, value === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
                    {connection.ad_account_name ?? connection.ad_account_id}
                    {connection.health === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-text-tertiary">{connection.ad_account_id}</span>
                  {connection.connection_error ? <span className="block text-[11px] text-destructive">{connection.connection_error}</span> : null}
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Save active locations
            </Button>
            <Button size="sm" variant="outline" onClick={disconnect} disabled={pending}>
              <Unplug className="mr-2 h-3.5 w-3.5" />
              Disconnect OAuth
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-text-tertiary">
          Requires Google approval for the Business Profile APIs and the <code>business.manage</code> OAuth scope. Xphere stores the refresh token encrypted per organization.
        </p>
      )}
    </section>
  )
}
