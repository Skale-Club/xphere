'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Link2, Loader2, RefreshCw, Unlink } from 'lucide-react'
import { toast } from 'sonner'

import {
  disconnectGbp,
  linkGbpLocation,
  listGbpLocations,
  saveReplySettings,
  syncGbpNow,
  unlinkGbpLocation,
  type GbpLocationOption,
} from '@/app/(dashboard)/local-seo/gbp-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export type GbpConnectionView = { id: string; email: string | null; status: 'active' | 'error' | 'revoked'; error: string | null }

const CALLBACK_MESSAGES: Record<string, string> = {
  connected: 'Google account connected. Now pick the Business Profile location.',
  denied: 'Google access was not granted.',
  csrf: 'The sign-in expired. Try again.',
  forbidden: 'You need the "Manage Google connections" permission.',
  scope_missing: 'Google did not grant Business Profile access. Tick the permission on the consent screen.',
  no_refresh_token: 'Google did not return a long-lived token. Remove Xphere from your Google account permissions and connect again.',
  not_configured: 'Google sign-in is not configured on this platform.',
}

export function GbpConnectionCard({
  locationId,
  connections,
  linked,
  syncError,
  lastSyncedAt,
  canAdmin,
  canManage,
  canApprove,
  replySettings,
}: {
  locationId: string
  connections: GbpConnectionView[]
  linked: { connectionId: string; locationName: string; title: string | null } | null
  syncError: string | null
  lastSyncedAt: string | null
  canAdmin: boolean
  canManage: boolean
  canApprove: boolean
  replySettings: { tone: string; signature: string | null; instructions: string | null; autoReplyPositive: boolean; autoReplyMinRating: number }
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [busy, start] = useTransition()
  const [options, setOptions] = useState<{ connectionId: string; list: GbpLocationOption[] } | null>(null)
  const [choice, setChoice] = useState<string>('')
  const [settings, setSettings] = useState(replySettings)

  useEffect(() => {
    const status = params.get('gbp')
    if (!status) return
    const msg = CALLBACK_MESSAGES[status] ?? `Google connection: ${status}`
    if (status === 'connected') toast.success(msg)
    else toast.error(msg)
  }, [params])

  const returnPath = `/local-seo/${locationId}/settings`
  const connectHref = `/api/local-seo/gbp/oauth?return=${encodeURIComponent(returnPath)}`

  function loadOptions(connectionId: string) {
    start(async () => {
      const res = await listGbpLocations(connectionId)
      if ('error' in res) toast.error(res.error)
      else setOptions({ connectionId, list: res.options })
    })
  }

  function link() {
    const opt = options?.list.find((o) => o.locationName === choice)
    if (!options || !opt) return
    start(async () => {
      const res = await linkGbpLocation(locationId, { connectionId: options.connectionId, accountName: opt.accountName, locationName: opt.locationName })
      if ('error' in res) toast.error(res.error)
      else {
        toast.success('Linked. The first sync runs within 15 minutes, or use Sync now.')
        if (res.warning) toast.warning(res.warning)
        setOptions(null)
        router.refresh()
      }
    })
  }

  function run<T>(fn: () => Promise<T | { error: string }>, ok?: (r: T) => string) {
    start(async () => {
      const res = await fn()
      if (res && typeof res === 'object' && 'error' in res) toast.error((res as { error: string }).error)
      else {
        if (ok) toast.success(ok(res as T))
        router.refresh()
      }
    })
  }

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google Business Profile</CardTitle>
          <CardDescription>Official reviews and replies, posts, profile edits and performance. Every change goes through an approval log.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-[13px]">
          {linked ? (
            <div className="space-y-2 rounded-lg border border-border-subtle p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="font-medium text-text-primary">{linked.title ?? linked.locationName}</span>
              </div>
              <div className="text-text-tertiary">
                {lastSyncedAt ? `Last sync ${new Date(lastSyncedAt).toLocaleString()}` : 'Waiting for the first sync'}
              </div>
              {syncError && <div className="text-danger">Last sync failed: {syncError}</div>}
              <div className="flex flex-wrap gap-2 pt-1">
                {canManage && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => syncGbpNow(locationId), (r) => (r as { message: string }).message)}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Sync now
                  </Button>
                )}
                {canAdmin && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => unlinkGbpLocation(locationId), () => 'Unlinked')}>
                    <Unlink className="h-4 w-4" />
                    Unlink
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-text-secondary">Not linked. Connect a Google account that manages this business, then pick its location.</p>
          )}

          <div className="space-y-2">
            <div className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">Google accounts</div>
            {connections.length === 0 && <p className="text-text-secondary">None connected yet.</p>}
            {connections.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle p-2.5">
                <div className="min-w-0">
                  <div className="truncate text-text-primary">{c.email ?? 'Google account'}</div>
                  {c.status !== 'active' && <div className="text-danger">{c.error ?? 'Needs reconnecting'}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={c.status === 'active' ? 'success' : 'danger'}>{c.status === 'active' ? 'Active' : 'Reconnect'}</Badge>
                  {canAdmin && c.status === 'active' && !linked && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => loadOptions(c.id)}>
                      <Link2 className="h-4 w-4" />
                      Pick location
                    </Button>
                  )}
                  {canAdmin && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => disconnectGbp(c.id), () => 'Disconnected')}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {canAdmin && (
              <Button asChild size="sm" variant="secondary">
                <a href={connectHref}>Connect a Google account</a>
              </Button>
            )}
          </div>

          {options && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              {options.list.length === 0 ? (
                <p className="text-text-secondary">This Google account manages no Business Profile locations.</p>
              ) : (
                <>
                  <Select value={choice} onValueChange={setChoice}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose the location" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.list.map((o) => (
                        <SelectItem key={o.locationName} value={o.locationName}>
                          {o.title}
                          {o.address ? ` · ${o.address}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={link} disabled={!choice || busy}>
                    Link this location
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review replies</CardTitle>
          <CardDescription>How AI drafts sound. Replies to 1–3 star reviews always wait for a person.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rs-tone">Tone</Label>
            <Input id="rs-tone" value={settings.tone} disabled={!canApprove} onChange={(e) => setSettings({ ...settings, tone: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-sig">Signature</Label>
            <Input id="rs-sig" value={settings.signature ?? ''} disabled={!canApprove} placeholder="— The Bigode team" onChange={(e) => setSettings({ ...settings, signature: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rs-ins">Extra instructions</Label>
            <Textarea
              id="rs-ins"
              rows={3}
              value={settings.instructions ?? ''}
              disabled={!canApprove}
              placeholder="Mention we open on Sundays. Never promise refunds."
              onChange={(e) => setSettings({ ...settings, instructions: e.target.value })}
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium text-text-primary">Auto-reply to positive reviews</span>
              <span className="block text-xs text-text-secondary">Publishes the AI reply without review for reviews at or above the rating below.</span>
            </span>
            <Switch checked={settings.autoReplyPositive} disabled={!canApprove} onCheckedChange={(v) => setSettings({ ...settings, autoReplyPositive: v })} />
          </label>
          <Select
            value={String(settings.autoReplyMinRating)}
            disabled={!canApprove || !settings.autoReplyPositive}
            onValueChange={(v) => setSettings({ ...settings, autoReplyMinRating: Number(v) })}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 stars only</SelectItem>
              <SelectItem value="4">4 and 5 stars</SelectItem>
            </SelectContent>
          </Select>
          {canApprove && (
            <div className="flex justify-end">
              <Button size="sm" disabled={busy} onClick={() => run(() => saveReplySettings(settings), () => 'Saved')}>
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
