/**
 * Single definition of "who belongs to a Meta audience".
 *
 * This lived in three places that had to agree but had no way to enforce it:
 * `isSelected` in audience-members.ts (projection), `asSourceDefinition` in
 * audience-dirty.ts (scheduling), and `sourceDefinition` in
 * audience-reconcile.ts (the database query). A scope that disagreed between
 * them would schedule a sync that then projected a different member set, or
 * quietly skip entities the query never fetched. One implementation removes
 * that class of bug.
 *
 * `xcraper_master` selects scraped prospects. It matches a SET of source types
 * because scraping has shipped under more than one: `xcraper` (the current
 * push in xcraper/backend/src/services/xphere.ts) and `google-maps` (an
 * earlier path). Both are the same act of scraping a business off Google Maps,
 * and an audience of "everyone we scraped" has to contain both.
 *
 * `crm_contacts` selects inbound CRM contacts (website forms, API, inbox
 * channels, imports) by lifecycle stage, with optional source / source-type /
 * tag narrowing. It is the remarketing counterpart of the prospect audiences:
 * prospects are people we found, CRM contacts are people who found us.
 *
 * `pixel_website` is not a member list at all. Meta builds it from Pixel
 * events (visitors, form submitters) with a rule Xphere creates once; there is
 * nothing to project, hash or upload, so it never selects a CRM entity.
 */

export const DEFAULT_SCRAPE_SOURCE_TYPES = ['xcraper', 'google-maps'] as const

/** Every inbound stage: someone who reached out, is being worked, or bought. */
export const DEFAULT_CRM_LIFECYCLE_STAGES = ['lead', 'opportunity', 'customer'] as const
export const CRM_LIFECYCLE_STAGES = ['lead', 'opportunity', 'customer', 'lost'] as const

/** Standard Pixel events that mean "this visitor handed us their details". */
export const DEFAULT_LEAD_PIXEL_EVENTS = ['Lead', 'Contact', 'CompleteRegistration', 'SubmitApplication', 'Schedule'] as const

/** Meta caps website custom audience retention at 180 days. */
export const MAX_PIXEL_RETENTION_DAYS = 180

export type AudienceKind = 'xcraper_master' | 'prospect_segment' | 'crm_contacts' | 'pixel_website'
export const AUDIENCE_KINDS: readonly AudienceKind[] = ['xcraper_master', 'prospect_segment', 'crm_contacts', 'pixel_website']

export interface CrmContactsDefinition {
  kind: 'crm_contacts'
  lifecycleStages: string[]
  /** contacts.source values (e.g. 'api', 'whatsapp'); empty = any source. */
  sources: string[]
  /** contacts.source_type values (e.g. a site slug); empty = any. */
  sourceTypes: string[]
  /** Any-of tag match; empty = no tag filter. */
  tags: string[]
}

export interface PixelWebsiteDefinition {
  kind: 'pixel_website'
  pixelId: string
  /** Any-of Pixel event names. */
  events: string[]
  retentionDays: number
  /** Optional case-insensitive URL fragment the event page must contain. */
  urlContains: string | null
}

export type AudienceSourceDefinition =
  | { kind: 'xcraper_master'; sourceTypes: string[] }
  | { kind: 'prospect_segment'; entityKeys: string[] }
  | CrmContactsDefinition
  | PixelWebsiteDefinition

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
}

/**
 * Resolve the source types a stored `xcraper_master` definition selects.
 *
 * An explicit singular `sourceType` is honoured EXACTLY as configured and is
 * never widened: it is a deliberate narrowing someone saved (a scope pinned to
 * one provider), and silently adding source types to it would change an
 * existing audience's membership behind their back. Only an unset definition
 * falls back to every known scrape source.
 */
function readSourceTypes(record: Record<string, unknown>): string[] {
  const plural = strings(record.sourceTypes)
  if (plural.length > 0) return [...new Set(plural)]

  const singular = record.sourceType
  if (typeof singular === 'string' && singular.trim() !== '') return [singular]

  return [...DEFAULT_SCRAPE_SOURCE_TYPES]
}

/** Normalize a persisted `source_definition` JSON column into a usable definition. */
export function normalizeAudienceSourceDefinition(
  audienceKind: string | null | undefined,
  raw: unknown,
): AudienceSourceDefinition {
  const record = asRecord(raw)

  if (audienceKind === 'prospect_segment') {
    return { kind: 'prospect_segment', entityKeys: strings(record.entityKeys) }
  }

  if (audienceKind === 'crm_contacts') {
    // Only known stages survive: an unknown stage would silently select
    // nothing, and 'prospect' belongs to the prospect audiences, not here.
    const stages = strings(record.lifecycleStages).filter((stage) =>
      (CRM_LIFECYCLE_STAGES as readonly string[]).includes(stage),
    )
    return {
      kind: 'crm_contacts',
      lifecycleStages: stages.length > 0 ? [...new Set(stages)] : [...DEFAULT_CRM_LIFECYCLE_STAGES],
      sources: [...new Set(strings(record.sources))],
      sourceTypes: [...new Set(strings(record.sourceTypes))],
      tags: [...new Set(strings(record.tags))],
    }
  }

  if (audienceKind === 'pixel_website') {
    const days = typeof record.retentionDays === 'number' ? Math.trunc(record.retentionDays) : Number.NaN
    const urlContains = typeof record.urlContains === 'string' && record.urlContains.trim() !== ''
      ? record.urlContains.trim()
      : null
    return {
      kind: 'pixel_website',
      pixelId: typeof record.pixelId === 'string' ? record.pixelId.trim() : '',
      events: [...new Set(strings(record.events))],
      retentionDays: Number.isFinite(days) ? Math.min(Math.max(days, 1), MAX_PIXEL_RETENTION_DAYS) : 30,
      urlContains,
    }
  }

  return { kind: 'xcraper_master', sourceTypes: readSourceTypes(record) }
}

/** Whether Xphere uploads hashed members for this audience (vs Meta building it from Pixel events). */
export function isMemberListAudience(definition: AudienceSourceDefinition): boolean {
  return definition.kind !== 'pixel_website'
}

/** Whether a definition selects anything at all — a config that fails this must not sync. */
export function isAudienceDefinitionValid(definition: AudienceSourceDefinition): boolean {
  switch (definition.kind) {
    case 'xcraper_master':
      return definition.sourceTypes.length > 0
    case 'prospect_segment':
      return definition.entityKeys.length > 0
    case 'crm_contacts':
      return definition.lifecycleStages.length > 0
    case 'pixel_website':
      return /^\d{5,20}$/.test(definition.pixelId) && definition.events.length > 0
  }
}

/** CRM contact fields a `crm_contacts` scope filters on. */
export interface CrmContactFacts {
  lifecycleStage: string | null
  source: string | null
  sourceType: string | null
  tags: string[] | null
}

export function matchesCrmContactsDefinition(contact: CrmContactFacts, definition: CrmContactsDefinition): boolean {
  if (!contact.lifecycleStage || !definition.lifecycleStages.includes(contact.lifecycleStage)) return false
  if (definition.sources.length > 0 && !(contact.source && definition.sources.includes(contact.source))) return false
  if (definition.sourceTypes.length > 0 && !(contact.sourceType && definition.sourceTypes.includes(contact.sourceType))) return false
  if (definition.tags.length > 0 && !(contact.tags ?? []).some((tag) => definition.tags.includes(tag))) return false
  return true
}

/** Source types to filter on, or null when the definition does not select by source. */
export function audienceSourceTypes(definition: AudienceSourceDefinition): string[] | null {
  return definition.kind === 'xcraper_master' ? definition.sourceTypes : null
}

/** Whether an entity's `source_type` falls inside a source-selecting definition. */
export function matchesAudienceSourceType(
  sourceType: string | null | undefined,
  definition: AudienceSourceDefinition,
): boolean {
  if (definition.kind !== 'xcraper_master') return false
  return typeof sourceType === 'string' && definition.sourceTypes.includes(sourceType)
}
