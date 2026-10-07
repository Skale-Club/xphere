'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { acknowledgeProfileSnapshot, proposeProfileEdit } from '@/app/(dashboard)/seo/local/gbp-actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { DAYS, FIELD_LABEL, type Day, type FlatProfile, type HoursRow, type ProfilePatch } from '@/lib/gbp/profile'

type Alert = { id: string; takenAt: string; byGoogle: boolean; fields: string[] }

export function ProfileEditor({
  locationId,
  profile,
  syncedAt,
  canManage,
  canApprove,
  alerts,
}: {
  locationId: string
  profile: FlatProfile
  syncedAt: string | null
  canManage: boolean
  canApprove: boolean
  alerts: Alert[]
}) {
  const router = useRouter()
  const [description, setDescription] = useState(profile.description ?? '')
  const [website, setWebsite] = useState(profile.websiteUri ?? '')
  const [phone, setPhone] = useState(profile.primaryPhone ?? '')
  const [hours, setHours] = useState<HoursRow[]>(profile.hours ?? [])
  const [busy, start] = useTransition()

  function submit() {
    const patch: ProfilePatch = {}
    if (description !== (profile.description ?? '')) patch.description = description || null
    if (website !== (profile.websiteUri ?? '')) patch.websiteUri = website || null
    if (phone !== (profile.primaryPhone ?? '')) patch.primaryPhone = phone || null
    if (JSON.stringify(hours) !== JSON.stringify(profile.hours ?? [])) patch.hours = hours
    if (!Object.keys(patch).length) {
      toast.info('Nothing changed.')
      return
    }
    start(async () => {
      const res = await proposeProfileEdit(locationId, patch)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(res.message)
        router.refresh()
      }
    })
  }

  function ack(id: string) {
    start(async () => {
      await acknowledgeProfileSnapshot(id, locationId)
      router.refresh()
    })
  }

  const setRow = (i: number, patch: Partial<HoursRow>) => setHours((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-4">
      {alerts.map((a) => (
        <div key={a.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-warning/40 bg-warning/5 p-4 text-[13px]">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <div className="font-medium text-text-primary">{a.byGoogle ? 'Google updated your profile' : 'Your profile changed outside Xphere'}</div>
              <div className="text-text-secondary">
                {a.fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')} · {new Date(a.takenAt).toLocaleString()}
              </div>
              <div className="text-text-tertiary">Check the values below; edit them back if Google got it wrong.</div>
            </div>
          </div>
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => ack(a.id)} disabled={busy}>
              Got it
            </Button>
          )}
        </div>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{profile.title ?? 'Business Profile'}</CardTitle>
          <CardDescription>
            {[profile.primaryCategory, ...profile.additionalCategories].filter(Boolean).join(' · ')}
            {profile.address ? ` — ${profile.address}` : ''}
            {syncedAt ? ` · synced ${new Date(syncedAt).toLocaleString()}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pf-desc">Description</Label>
              <Textarea id="pf-desc" rows={6} maxLength={750} value={description} disabled={!canManage} onChange={(e) => setDescription(e.target.value)} />
              <p className="text-right text-xs text-text-tertiary">{description.length}/750</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-web">Website</Label>
              <Input id="pf-web" value={website} disabled={!canManage} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-phone">Phone</Label>
              <Input id="pf-phone" value={phone} disabled={!canManage} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Opening hours</Label>
            {hours.length === 0 && <p className="text-sm text-text-secondary">No regular hours set.</p>}
            {hours.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select value={r.day} disabled={!canManage} onValueChange={(v) => setRow(i, { day: v as Day })}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d.charAt(0) + d.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="time" className="w-[110px]" value={r.open} disabled={!canManage} onChange={(e) => setRow(i, { open: e.target.value })} />
                <span className="text-text-tertiary">–</span>
                <Input type="time" className="w-[110px]" value={r.close === '24:00' ? '23:59' : r.close} disabled={!canManage} onChange={(e) => setRow(i, { close: e.target.value })} />
                {canManage && (
                  <button type="button" className="rounded p-1 text-text-tertiary hover:bg-bg-tertiary" aria-label="Remove interval" onClick={() => setHours((rows) => rows.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            {canManage && (
              <Button size="sm" variant="ghost" onClick={() => setHours((rows) => [...rows, { day: 'MONDAY', open: '09:00', close: '18:00' }])}>
                <Plus className="h-4 w-4" />
                Add interval
              </Button>
            )}
          </div>
          {canManage && (
            <div className="flex items-center justify-between gap-3 lg:col-span-2">
              <p className="text-xs text-text-tertiary">
                {canApprove
                  ? 'Changes are checked for conflicts, published to Google and read back.'
                  : 'Changes go to an approver before they reach Google.'}
              </p>
              <Button onClick={submit} loading={busy}>
                {canApprove ? 'Publish changes' : 'Send for approval'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
