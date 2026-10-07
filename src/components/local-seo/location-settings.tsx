'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Plus, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  addKeywords,
  deleteKeyword,
  deleteLocation,
  findGridCenter,
  updateLocation,
} from '@/app/(dashboard)/seo/local/actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { GRID_SIZES, type GridShape } from '@/lib/local-seo/types'

type LocationForm = {
  id: string
  name: string
  businessName: string
  placeId: string | null
  address: string | null
  centerLat: number
  centerLng: number
  language: string
  country: string
  defaultGridSize: number
  defaultSpacingM: number
  defaultShape: GridShape
  googleBusinessProfileId: string | null
  isActive: boolean
}

const NONE = '__none__'

export function LocationSettings({
  location,
  keywords,
  reviewProfiles,
  canManage,
}: {
  location: LocationForm
  keywords: { id: string; keyword: string }[]
  reviewProfiles: { id: string; label: string }[]
  canManage: boolean
}) {
  const router = useRouter()
  const [form, setForm] = useState(location)
  const [newKeywords, setNewKeywords] = useState('')
  const [centerQuery, setCenterQuery] = useState('')
  const [centerLabel, setCenterLabel] = useState<string | null>(null)
  const [finding, startFind] = useTransition()
  const [saving, startSave] = useTransition()
  const [busy, startBusy] = useTransition()
  const set = <K extends keyof LocationForm>(k: K, v: LocationForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  function save() {
    startSave(async () => {
      const res = await updateLocation(location.id, {
        name: form.name,
        language: form.language,
        country: form.country,
        defaultGridSize: form.defaultGridSize,
        defaultSpacingM: form.defaultSpacingM,
        defaultShape: form.defaultShape,
        googleBusinessProfileId: form.googleBusinessProfileId,
        isActive: form.isActive,
        centerLat: form.centerLat,
        centerLng: form.centerLng,
      })
      if ('error' in res) toast.error(res.error)
      else {
        toast.success('Settings saved')
        router.refresh()
      }
    })
  }

  function findCenter() {
    startFind(async () => {
      const res = await findGridCenter(centerQuery)
      if ('error' in res) toast.error(res.error)
      else {
        setForm((f) => ({ ...f, centerLat: res.lat, centerLng: res.lng }))
        setCenterLabel(res.label)
        toast.success('Centre found. Save to use it on the next scans.')
      }
    })
  }

  const centerMoved = form.centerLat !== location.centerLat || form.centerLng !== location.centerLng
  const coords = `${form.centerLat.toFixed(5)}, ${form.centerLng.toFixed(5)}`

  function add() {
    startBusy(async () => {
      const res = await addKeywords(location.id, newKeywords.split(/[\n,]/))
      if ('error' in res) toast.error(res.error)
      else {
        setNewKeywords('')
        toast.success(res.added ? `${res.added} keyword${res.added === 1 ? '' : 's'} added` : 'Already tracked')
        router.refresh()
      }
    })
  }

  function remove(id: string) {
    startBusy(async () => {
      const res = await deleteKeyword(id, location.id)
      if ('error' in res) toast.error(res.error)
      else router.refresh()
    })
  }

  function destroy() {
    startBusy(async () => {
      const res = await deleteLocation(location.id)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success('Location deleted')
        router.push('/seo/local')
      }
    })
  }

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keywords</CardTitle>
          <CardDescription>The searches tracked on the geogrid. Write them the way customers type them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {keywords.length === 0 && <p className="text-sm text-text-secondary">No keywords yet.</p>}
            {keywords.map((k) => (
              <span key={k.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-secondary py-0.5 pl-3 pr-1 text-[13px]">
                {k.keyword}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => remove(k.id)}
                    disabled={busy}
                    className="rounded-full p-0.5 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                    aria-label={`Remove ${k.keyword}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
          {canManage && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                add()
              }}
            >
              <Input
                value={newKeywords}
                onChange={(e) => setNewKeywords(e.target.value)}
                placeholder="Add keywords, comma separated"
              />
              <Button type="submit" variant="secondary" disabled={busy || !newKeywords.trim()}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Location</CardTitle>
          <CardDescription>
            {location.businessName}
            {location.placeId ? ` · ${location.placeId}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ls-set-name">Name</Label>
            <Input id="ls-set-name" value={form.name} disabled={!canManage} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ls-set-lang">Search language</Label>
              <Input id="ls-set-lang" value={form.language} disabled={!canManage} onChange={(e) => set('language', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-set-country">Country code</Label>
              <Input id="ls-set-country" value={form.country} maxLength={2} disabled={!canManage} onChange={(e) => set('country', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Default grid</Label>
              <Select value={String(form.defaultGridSize)} disabled={!canManage} onValueChange={(v) => set('defaultGridSize', Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRID_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s} × {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ls-set-spacing">Spacing (m)</Label>
              <Input
                id="ls-set-spacing"
                type="number"
                min={100}
                max={20000}
                step={50}
                value={form.defaultSpacingM}
                disabled={!canManage}
                onChange={(e) => set('defaultSpacingM', Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Shape</Label>
              <Select value={form.defaultShape} disabled={!canManage} onValueChange={(v) => set('defaultShape', v as GridShape)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="square">Square</SelectItem>
                  <SelectItem value="circle">Circle</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ls-set-center">Grid center</Label>
            <p className="flex items-center gap-1.5 text-xs text-text-secondary">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <a
                href={`https://www.google.com/maps?q=${form.centerLat},${form.centerLng}`}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {centerLabel ? `${centerLabel} (${coords})` : coords}
              </a>
              {centerMoved && <span className="text-warning">· unsaved</span>}
            </p>
            {canManage && (
              <div className="flex gap-2">
                <Input
                  id="ls-set-center"
                  value={centerQuery}
                  onChange={(e) => setCenterQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (centerQuery.trim()) findCenter()
                    }
                  }}
                  placeholder="City or address, e.g. Framingham, MA"
                />
                <Button type="button" variant="secondary" onClick={findCenter} loading={finding} disabled={!centerQuery.trim()}>
                  <Search className="h-4 w-4" />
                  Find
                </Button>
              </div>
            )}
            <p className="text-xs text-text-tertiary">
              {location.address
                ? 'Defaults to the Google Maps pin.'
                : 'Service-area business: Google hides the address, so centre the grid on the city it serves.'}{' '}
              New scans use this centre; earlier scans keep theirs.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Reviews profile</Label>
            <Select
              value={form.googleBusinessProfileId ?? NONE}
              disabled={!canManage}
              onValueChange={(v) => set('googleBusinessProfileId', v === NONE ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not linked</SelectItem>
                {reviewProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium text-text-primary">Active</span>
              <span className="block text-xs text-text-secondary">Paused locations keep their history but cannot be scanned.</span>
            </span>
            <Switch checked={form.isActive} disabled={!canManage} onCheckedChange={(v) => set('isActive', v)} />
          </label>
          {canManage && (
            <div className="flex items-center justify-between pt-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="text-danger">
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {location.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Every keyword, scan and competitor snapshot of this location is deleted. Used points are not refunded.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={destroy}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button onClick={save} loading={saving}>
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
