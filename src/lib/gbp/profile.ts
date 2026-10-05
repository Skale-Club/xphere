// Flat, comparable view of a Business Profile location, plus the editable
// subset and its PATCH mapping. Pure — shared by sync, the ledger and the UI.

import type { GbpLocation, TimePeriod } from './client'

export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const
export type Day = (typeof DAYS)[number]

/** One opening interval in the UI's terms: "MONDAY 09:00-18:00". */
export type HoursRow = { day: Day; open: string; close: string }

export type FlatProfile = {
  title: string | null
  description: string | null
  websiteUri: string | null
  primaryPhone: string | null
  address: string | null
  primaryCategory: string | null
  additionalCategories: string[]
  hours: HoursRow[]
  openStatus: string | null
}

/** Fields the change ledger may write. */
export const EDITABLE_FIELDS = ['description', 'websiteUri', 'primaryPhone', 'hours'] as const
export type EditableField = (typeof EDITABLE_FIELDS)[number]
export type ProfilePatch = Partial<Pick<FlatProfile, EditableField>>

const pad = (n: number | undefined) => String(n ?? 0).padStart(2, '0')
const hhmm = (t?: { hours?: number; minutes?: number }) => (t ? `${pad(t.hours)}:${pad(t.minutes)}` : '00:00')

export function periodsToRows(periods: TimePeriod[] | undefined): HoursRow[] {
  return (periods ?? [])
    .filter((p): p is TimePeriod & { openDay: Day } => (DAYS as readonly string[]).includes(p.openDay))
    .map((p) => ({ day: p.openDay, open: hhmm(p.openTime), close: hhmm(p.closeTime) === '00:00' ? '24:00' : hhmm(p.closeTime) }))
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.open.localeCompare(b.open))
}

export function rowsToPeriods(rows: HoursRow[]): TimePeriod[] {
  const parse = (s: string) => {
    const [h, m] = s.split(':').map(Number)
    return { hours: h, minutes: m }
  }
  return rows.map((r) => {
    const overnight = r.close !== '24:00' && r.close <= r.open
    const closeDay = overnight ? DAYS[(DAYS.indexOf(r.day) + 1) % 7] : r.day
    return {
      openDay: r.day,
      openTime: parse(r.open),
      closeDay,
      closeTime: r.close === '24:00' ? { hours: 24, minutes: 0 } : parse(r.close),
    }
  })
}

export function formatAddress(a: GbpLocation['storefrontAddress']): string | null {
  if (!a) return null
  const parts = [...(a.addressLines ?? []), a.locality, a.administrativeArea, a.postalCode].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

export function flattenProfile(loc: GbpLocation): FlatProfile {
  return {
    title: loc.title ?? null,
    description: loc.profile?.description ?? null,
    websiteUri: loc.websiteUri ?? null,
    primaryPhone: loc.phoneNumbers?.primaryPhone ?? null,
    address: formatAddress(loc.storefrontAddress),
    primaryCategory: loc.categories?.primaryCategory?.displayName ?? null,
    additionalCategories: (loc.categories?.additionalCategories ?? []).map((c) => c.displayName ?? c.name ?? '').filter(Boolean),
    hours: periodsToRows(loc.regularHours?.periods),
    openStatus: loc.openInfo?.status ?? null,
  }
}

export type FieldDiff = { field: string; before: unknown; after: unknown }

export function diffProfiles(before: Partial<FlatProfile>, after: Partial<FlatProfile>, fields?: readonly string[]): FieldDiff[] {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const out: FieldDiff[] = []
  for (const k of keys) {
    const a = (before as Record<string, unknown>)[k] ?? null
    const b = (after as Record<string, unknown>)[k] ?? null
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: k, before: a, after: b })
  }
  return out
}

/** PATCH body + updateMask for an editable patch. */
export function buildLocationPatch(patch: ProfilePatch): { updateMask: string[]; body: Partial<GbpLocation> } {
  const updateMask: string[] = []
  const body: Partial<GbpLocation> = {}
  if ('description' in patch) {
    updateMask.push('profile.description')
    body.profile = { description: patch.description ?? '' }
  }
  if ('websiteUri' in patch) {
    updateMask.push('websiteUri')
    body.websiteUri = patch.websiteUri ?? ''
  }
  if ('primaryPhone' in patch) {
    updateMask.push('phoneNumbers.primaryPhone')
    body.phoneNumbers = { primaryPhone: patch.primaryPhone ?? '' }
  }
  if ('hours' in patch) {
    updateMask.push('regularHours')
    body.regularHours = { periods: rowsToPeriods(patch.hours ?? []) }
  }
  return { updateMask, body }
}

export const FIELD_LABEL: Record<string, string> = {
  title: 'Name',
  description: 'Description',
  websiteUri: 'Website',
  primaryPhone: 'Phone',
  address: 'Address',
  primaryCategory: 'Primary category',
  additionalCategories: 'Additional categories',
  hours: 'Opening hours',
  openStatus: 'Open status',
}

export function describeValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field === 'hours' && Array.isArray(v)) {
    return (v as HoursRow[]).map((r) => `${r.day.slice(0, 3)} ${r.open}–${r.close}`).join(', ') || 'Closed'
  }
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}
