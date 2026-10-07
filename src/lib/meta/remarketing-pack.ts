/**
 * The standard remarketing audience set every tenant can create in one click.
 *
 * Kept as data, not code paths, so the pack is the same for every client and
 * a tenant's differences live in what they choose (ad account, Pixel) rather
 * than in a per-client playbook. Pixel presets omit `pixelId`; the action
 * fills it from the Pixel the operator picked.
 */

import {
  DEFAULT_CRM_LIFECYCLE_STAGES,
  DEFAULT_LEAD_PIXEL_EVENTS,
  MAX_PIXEL_RETENTION_DAYS,
  type CrmContactsDefinition,
  type PixelWebsiteDefinition,
} from '@/lib/meta/audience-source'

export type RemarketingPreset =
  | { kind: 'pixel_website'; label: string; definition: Omit<PixelWebsiteDefinition, 'kind' | 'pixelId'> }
  | { kind: 'crm_contacts'; label: string; definition: Omit<CrmContactsDefinition, 'kind'> }

export const REMARKETING_PACK: readonly RemarketingPreset[] = [
  {
    kind: 'pixel_website',
    label: 'Site Visitors 30D',
    definition: { events: ['PageView'], retentionDays: 30, urlContains: null },
  },
  {
    kind: 'pixel_website',
    label: `Site Visitors ${MAX_PIXEL_RETENTION_DAYS}D`,
    definition: { events: ['PageView'], retentionDays: MAX_PIXEL_RETENTION_DAYS, urlContains: null },
  },
  {
    kind: 'pixel_website',
    label: `Site Form Submitters ${MAX_PIXEL_RETENTION_DAYS}D`,
    definition: { events: [...DEFAULT_LEAD_PIXEL_EVENTS], retentionDays: MAX_PIXEL_RETENTION_DAYS, urlContains: null },
  },
  {
    kind: 'crm_contacts',
    label: 'CRM Leads',
    definition: { lifecycleStages: [...DEFAULT_CRM_LIFECYCLE_STAGES], sources: [], sourceTypes: [], tags: [] },
  },
  {
    kind: 'crm_contacts',
    label: 'CRM Customers',
    definition: { lifecycleStages: ['customer'], sources: [], sourceTypes: [], tags: [] },
  },
]

/** "Skale Club | Site Visitors 30D" — the brand first so audiences group by tenant in Ads Manager. */
export function remarketingPackName(brand: string, label: string): string {
  return `${brand.trim() || 'Xphere'} | ${label}`.slice(0, 200)
}
