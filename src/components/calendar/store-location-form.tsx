'use client'

// SEED-028 Phase A: tenant location create/edit form.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  createTenantLocation,
  updateTenantLocation,
  type TenantLocationInput,
} from '@/app/(dashboard)/settings/locations/_actions/tenant-locations'

interface Props {
  initial?: {
    id: string
    name: string
    address_line_1: string
    address_line_2: string | null
    city: string
    state: string | null
    postal_code: string | null
    country: string
    phone: string | null
    notes: string | null
    is_default: boolean
  }
  onDone?: () => void
}

export function StoreLocationForm({ initial, onDone }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<TenantLocationInput>({
    name: initial?.name ?? '',
    address_line_1: initial?.address_line_1 ?? '',
    address_line_2: initial?.address_line_2 ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    postal_code: initial?.postal_code ?? '',
    country: initial?.country ?? 'US',
    phone: initial?.phone ?? '',
    notes: initial?.notes ?? '',
    is_default: initial?.is_default ?? false,
  })

  function set<K extends keyof TenantLocationInput>(key: K, value: TenantLocationInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.address_line_1.trim() || !form.city.trim()) {
      toast.error('Name, address and city are required')
      return
    }
    startTransition(async () => {
      const res = initial
        ? await updateTenantLocation(initial.id, form)
        : await createTenantLocation(form)
      if (!res.ok) {
        toast.error(res.error ?? 'Save failed')
        return
      }
      toast.success(initial ? 'Location updated' : 'Location added')
      router.refresh()
      onDone?.()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1">
        <Label>Location name</Label>
        <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Downtown Branch" />
      </div>
      <div className="space-y-1">
        <Label>Street address</Label>
        <Input value={form.address_line_1} onChange={(e) => set('address_line_1', e.target.value)} placeholder="123 Main St" />
      </div>
      <div className="space-y-1">
        <Label>Address line 2 (optional)</Label>
        <Input value={form.address_line_2 ?? ''} onChange={(e) => set('address_line_2', e.target.value)} placeholder="Suite 200" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>City</Label>
          <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>State / Region</Label>
          <Input value={form.state ?? ''} onChange={(e) => set('state', e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>Postal code</Label>
          <Input value={form.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Country</Label>
          <Input value={form.country} onChange={(e) => set('country', e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Phone (optional)</Label>
        <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+1 555 123 4567" />
      </div>
      <div className="space-y-1">
        <Label>Internal notes (optional)</Label>
        <Textarea
          value={form.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
          placeholder="Parking, access codes, anything the organizer should know"
        />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border-subtle px-3 py-2">
        <div>
          <p className="text-sm text-text-primary">Default location</p>
          <p className="text-xs text-text-tertiary">Used when an event type has no specific store selected.</p>
        </div>
        <Switch checked={!!form.is_default} onCheckedChange={(v) => set('is_default', v)} />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <MapPin className="h-3.5 w-3.5" />
          {initial ? 'Save changes' : 'Add location'}
        </Button>
      </div>
    </form>
  )
}
