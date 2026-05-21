'use server'

// SEED-028 Phase A: tenant_locations CRUD + best-effort geocoding.
//
// Geocoding uses Google Geocoding API when GOOGLE_MAPS_API_KEY is set.
// When unavailable we save without coordinates | the resolver (Phase D)
// still produces a Maps URL from the address string.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export interface TenantLocationInput {
  name: string
  address_line_1: string
  address_line_2?: string | null
  city: string
  state?: string | null
  postal_code?: string | null
  country: string
  phone?: string | null
  notes?: string | null
  business_hours?: Record<string, unknown>
  is_default?: boolean
}

interface GeocodeResult {
  latitude: number | null
  longitude: number | null
}

async function geocode(input: TenantLocationInput): Promise<GeocodeResult> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return { latitude: null, longitude: null }

  const parts = [
    input.address_line_1,
    input.address_line_2,
    input.city,
    input.state,
    input.postal_code,
    input.country,
  ].filter(Boolean)
  const address = encodeURIComponent(parts.join(', '))

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${address}&key=${apiKey}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return { latitude: null, longitude: null }
    const json = (await res.json()) as {
      results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>
    }
    const loc = json.results?.[0]?.geometry?.location
    if (!loc) return { latitude: null, longitude: null }
    return { latitude: loc.lat, longitude: loc.lng }
  } catch {
    return { latitude: null, longitude: null }
  }
}

export async function listTenantLocations() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenant_locations')
    .select('*')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('name')
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const, data: data ?? [] }
}

export async function createTenantLocation(input: TenantLocationInput) {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false as const, error: 'No active org' }

  const coords = await geocode(input)

  if (input.is_default) {
    await supabase
      .from('tenant_locations')
      .update({ is_default: false })
      .eq('org_id', orgId as string)
      .eq('is_default', true)
  }

  const { data, error } = await supabase
    .from('tenant_locations')
    .insert({
      org_id: orgId as string,
      name: input.name,
      address_line_1: input.address_line_1,
      address_line_2: input.address_line_2 ?? null,
      city: input.city,
      state: input.state ?? null,
      postal_code: input.postal_code ?? null,
      country: input.country,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
      business_hours: (input.business_hours ?? {}) as unknown as import('@/types/database').Json,
      is_default: !!input.is_default,
      latitude: coords.latitude,
      longitude: coords.longitude,
    })
    .select('*')
    .single()

  if (error) return { ok: false as const, error: error.message }
  revalidatePath('/settings/locations')
  return { ok: true as const, data }
}

export async function updateTenantLocation(id: string, input: Partial<TenantLocationInput>) {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false as const, error: 'No active org' }

  let coords: GeocodeResult | null = null
  const addressChanged =
    input.address_line_1 !== undefined ||
    input.city !== undefined ||
    input.state !== undefined ||
    input.postal_code !== undefined ||
    input.country !== undefined

  if (addressChanged) {
    const { data: current } = await supabase
      .from('tenant_locations')
      .select('address_line_1, address_line_2, city, state, postal_code, country')
      .eq('id', id)
      .single()

    if (current) {
      coords = await geocode({
        name: '',
        address_line_1: input.address_line_1 ?? current.address_line_1,
        address_line_2: input.address_line_2 ?? current.address_line_2 ?? undefined,
        city: input.city ?? current.city,
        state: input.state ?? current.state ?? undefined,
        postal_code: input.postal_code ?? current.postal_code ?? undefined,
        country: input.country ?? current.country,
      })
    }
  }

  if (input.is_default === true) {
    await supabase
      .from('tenant_locations')
      .update({ is_default: false })
      .eq('org_id', orgId as string)
      .eq('is_default', true)
      .neq('id', id)
  }

  const updatePayload: Record<string, unknown> = { ...input }
  if (coords) {
    updatePayload.latitude = coords.latitude
    updatePayload.longitude = coords.longitude
  }

  const { error } = await supabase
    .from('tenant_locations')
    .update(updatePayload)
    .eq('id', id)

  if (error) return { ok: false as const, error: error.message }
  revalidatePath('/settings/locations')
  return { ok: true as const }
}

export async function deleteTenantLocation(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('tenant_locations')
    .update({ is_active: false })
    .eq('id', id)

  if (error) return { ok: false as const, error: error.message }
  revalidatePath('/settings/locations')
  return { ok: true as const }
}
