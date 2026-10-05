// Flat, comparable view of a Business Profile location and the subset Local
// SEO edits. Pure — shared by sync and the UI. Writes are engine commands
// (see profileCommands in ./commands.ts).

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

