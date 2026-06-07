'use client'

// SEED-028 Phase A: list + inline form for tenant locations.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, MapPin, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StoreLocationForm } from '@/components/calendar/store-location-form'
import { deleteTenantLocation } from '../_actions/tenant-locations'
import type { Database } from '@/types/database'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'

type TenantLocation = Database['public']['Tables']['tenant_locations']['Row']

interface Props {
  initial: TenantLocation[]
}

export function LocationsList({ initial }: Props) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRemove(id: string) {
    setRemovingId(id)
    startTransition(async () => {
      const res = await deleteTenantLocation(id)
      setRemovingId(null)
      if (!res.ok) {
        toast.error(res.error ?? 'Could not remove location')
        return
      }
      toast.success('Location removed')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          {initial.length === 0
            ? 'No locations yet. Add your first to enable in-person bookings.'
            : `${initial.length} location${initial.length !== 1 ? 's' : ''}`}
        </p>
        {!adding && !editingId && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add location
          </Button>
        )}
      </div>

      {adding && (
        <Card>
          <CardContent className="p-4">
            <StoreLocationForm onDone={() => setAdding(false)} />
          </CardContent>
        </Card>
      )}

      {initial.length === 0 && !adding ? (
        <Card>
          <CardContent className="p-8 text-center">
            <MapPin className="mx-auto h-8 w-8 text-text-tertiary mb-3" />
            <p className="text-sm text-text-secondary mb-1">No locations configured</p>
            <p className="text-xs text-text-tertiary">
              Add your first location to allow bookings at a physical address.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {initial.map((loc) =>
            editingId === loc.id ? (
              <Card key={loc.id}>
                <CardContent className="p-4">
                  <StoreLocationForm
                    initial={{
                      id: loc.id,
                      name: loc.name,
                      address_line_1: loc.address_line_1,
                      address_line_2: loc.address_line_2,
                      city: loc.city,
                      state: loc.state,
                      postal_code: loc.postal_code,
                      country: loc.country,
                      phone: loc.phone,
                      notes: loc.notes,
                      is_default: loc.is_default,
                    }}
                    onDone={() => setEditingId(null)}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card key={loc.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text-primary">{loc.name}</p>
                        {loc.is_default && (
                          <Badge variant="secondary" className="text-[10px]">
                            Default
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {[loc.address_line_1, loc.address_line_2, loc.city, loc.state, loc.postal_code]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                      {loc.phone && (
                        <p className="text-xs text-text-tertiary mt-0.5">{formatPhoneDisplay(loc.phone)}</p>
                      )}
                      {loc.latitude == null && (
                        <p className="text-[11px] text-amber-500 mt-1">
                          Coordinates unavailable | Maps deep links will use the address string only.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(loc.id)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending && removingId === loc.id}
                        onClick={() => handleRemove(loc.id)}
                      >
                        {isPending && removingId === loc.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  )
}
