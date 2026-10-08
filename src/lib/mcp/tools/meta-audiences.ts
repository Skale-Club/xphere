import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { OrgOAuthProvider, type AdsConnectionQueryClient } from '@/lib/meta/audience-provider'
import {
  reconcileMetaAudience,
  SupabaseAudienceReconcileStore,
  type ReconcileConfig,
} from '@/lib/meta/audience-reconcile'
import {
  normalizeAudienceSourceDefinition,
  type XcraperMasterDefinition,
} from '@/lib/meta/audience-source'
import { isValidNiche, NICHE_FORMAT_MESSAGE, nicheAudienceTitle } from '@/lib/prospects/niche'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

type AudienceConfigRow = {
  id: string
  org_id: string
  ads_connection_id: string | null
  meta_ad_account_id: string
  custom_audience_id: string | null
  audience_name: string | null
  audience_kind: string
  source_definition: ReconcileConfig['sourceDefinition']
  sync_enabled: boolean
  consent_basis: ReconcileConfig['consentBasis']
  terms_accepted_at: string | null
  terms_accepted_by: string | null
  operational_status: string
  last_synced_at: string | null
  last_sync_stats: unknown
  last_error_code: string | null
  last_error_message: string | null
}

const configColumns = [
  'id', 'org_id', 'ads_connection_id', 'meta_ad_account_id', 'custom_audience_id',
  'audience_name', 'audience_kind', 'source_definition', 'sync_enabled', 'consent_basis',
  'terms_accepted_at', 'terms_accepted_by', 'operational_status', 'last_synced_at',
  'last_sync_stats', 'last_error_code', 'last_error_message',
].join(', ')

async function loadConfig(orgId: string, id: string): Promise<AudienceConfigRow | null> {
  const { data, error } = await db()
    .from('meta_audience_config')
    .select(configColumns)
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Could not read Meta audience configuration')
  return data as AudienceConfigRow | null
}

function reconcileConfig(config: AudienceConfigRow): ReconcileConfig {
  return {
    id: config.id,
    orgId: config.org_id,
    adsConnectionId: config.ads_connection_id,
    metaAdAccountId: config.meta_ad_account_id,
    customAudienceId: config.custom_audience_id,
    audienceName: config.audience_name ?? 'Xphere Prospects',
    consentBasis: config.consent_basis,
    termsAcceptedAt: config.terms_accepted_at,
    termsAcceptedBy: config.terms_accepted_by,
    audienceKind: config.audience_kind,
    sourceDefinition: config.source_definition,
  }
}

/** Prefix of the audience name a niche audience gets when the caller gives none. */
export const NICHE_AUDIENCE_NAME_PREFIX = 'Skale Club - Prospects - '

/** Niche / category facets of a scrape audience; empty arrays mean "no filter". */
function audienceFacets(config: Pick<AudienceConfigRow, 'audience_kind' | 'source_definition'>) {
  const definition = normalizeAudienceSourceDefinition(config.audience_kind, config.source_definition)
  return definition.kind === 'xcraper_master'
    ? { niches: definition.niches ?? [], categories: definition.categories ?? [] }
    : { niches: [] as string[], categories: [] as string[] }
}

function nicheAudienceSummary(config: AudienceConfigRow) {
  return {
    id: config.id,
    name: config.audience_name,
    kind: config.audience_kind,
    ...audienceFacets(config),
    sync_enabled: config.sync_enabled,
    remote_audience_created: Boolean(config.custom_audience_id),
    operational_status: config.operational_status,
  }
}

export const metaAudienceTools: McpToolDef[] = [
  {
    name: 'meta_audiences_status',
    title: 'List Meta custom audiences',
    description:
      'List this workspace Meta/Facebook Custom Audience configurations (kind: xcraper_master/prospect_segment = prospecting, crm_contacts = CRM leads/customers, pixel_website = Pixel website visitors), consent readiness, connection status, and recent aggregate sync results. Prospect audiences also show their niches / categories filter (empty = takes every scraped prospect). Returns no contact identifiers, hashes, or access tokens.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      const service = db()
      const [configsResult, connectionsResult, runsResult] = await Promise.all([
        service.from('meta_audience_config').select(configColumns).eq('org_id', auth.orgId).order('created_at', { ascending: true }),
        service.from('ads_connections').select('id, status, health, usable, ad_account_id, token_expires_at').eq('org_id', auth.orgId).eq('platform', 'meta'),
        service.from('meta_audience_sync_runs').select('audience_config_id, status, dry_run, target_count, add_count, remove_count, invalid_count, suppressed_count, error_code, created_at, completed_at').eq('org_id', auth.orgId).order('created_at', { ascending: false }).limit(20),
      ])
      if (configsResult.error || connectionsResult.error || runsResult.error) {
        return { error: 'meta_audience_status_unavailable', detail: 'Could not load Meta audience status.' }
      }
      const connections = new Map((connectionsResult.data ?? []).map((row: Record<string, unknown>) => [row.id, row]))
      return {
        audiences: (configsResult.data ?? []).map((config: AudienceConfigRow) => {
          const connection = connections.get(config.ads_connection_id ?? '') as Record<string, unknown> | undefined
          return {
            id: config.id,
            name: config.audience_name,
            kind: config.audience_kind,
            // Scrape audiences only: the niche slugs / Google Maps categories this audience is
            // filtered to. Empty = no filter (the audience takes every scraped prospect).
            ...audienceFacets(config),
            sync_enabled: config.sync_enabled,
            terms_accepted: Boolean(config.terms_accepted_at && config.terms_accepted_by),
            operational_status: config.operational_status,
            remote_audience_created: Boolean(config.custom_audience_id),
            // `connection_status` is selection only (active/available) as of
            // migration 1300; `connection_usable` is the real "can we sync"
            // signal (status='active' AND health='ok') — surfaced separately
            // so an operator/AI reading this doesn't mistake a hidden-but-
            // healthy account for a broken one, or vice versa. See
            // docs/integrations/ads-connection-health-plan.md.
            connection_status: connection?.status ?? 'missing',
            connection_health: connection?.health ?? null,
            connection_usable: connection?.usable ?? false,
            connection_expires_at: connection?.token_expires_at ?? null,
            last_synced_at: config.last_synced_at,
            last_sync_stats: config.last_sync_stats,
            last_error_code: config.last_error_code,
            last_error_message: config.last_error_message,
          }
        }),
        recent_runs: runsResult.data ?? [],
      }
    },
  },
  {
    name: 'meta_audience_sync',
    title: 'Preview or sync a Meta custom audience',
    description:
      'Sync a configured Meta/Facebook Custom Audience. Every scrape goes up to Meta with no human approval (owner rule, 2026-10-08): after prospects land, call with confirmed:true. ADD and REMOVE are both expected (REMOVE takes out opt-outs, DND and deleted rows). Without confirmed it only previews aggregate counts. Requires sync_enabled=true, accepted Customer List terms and an active Meta connection; the hourly job reconciles enabled audiences anyway. Never returns contact identifiers or hashes.',
    area: 'general_xphere',
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: z.object({
      audience_id: z.string().uuid().describe('Configuration id from meta_audiences_status.'),
      confirmed: z.boolean().optional().describe('true writes the ADD/REMOVE membership changes to Meta (no approval needed). Omit for a count-only preview.'),
    }).strict(),
    handler: async (input, { auth }) => {
      const config = await loadConfig(auth.orgId, input.audience_id)
      if (!config) return { error: 'meta_audience_not_found', detail: 'Meta audience configuration was not found in this workspace.' }

      const service = db()
      if (!input.confirmed) {
        const projection = await new SupabaseAudienceReconcileStore(service).loadProjectedMembers(reconcileConfig(config))
        return {
          dry_run: true,
          audience_id: config.id,
          name: config.audience_name,
          eligible: projection.members.length,
          with_email: projection.members.filter((member) => member.emailHash).length,
          with_phone: projection.members.filter((member) => member.phoneHash).length,
          suppressed: projection.suppressedCount,
          invalid: projection.invalidCount,
          message: 'Preview only, nothing was sent to Meta. Call again with confirmed:true to sync; no human approval is needed for audience sync.',
        }
      }

      if (!config.sync_enabled) {
        return { error: 'meta_audience_sync_disabled', detail: 'Enable this audience in Xphere before requesting a real sync.' }
      }
      if (!config.terms_accepted_at || !config.terms_accepted_by) {
        return { error: 'meta_audience_terms_not_accepted', detail: 'Accept the Meta Customer List Custom Audience terms in Xphere first.' }
      }
      if (!config.ads_connection_id) {
        return { error: 'meta_audience_connection_required', detail: 'Select an active tenant Meta connection in Xphere first.' }
      }

      const result = await reconcileMetaAudience({
        store: new SupabaseAudienceReconcileStore(service),
        provider: new OrgOAuthProvider(service as unknown as AdsConnectionQueryClient),
        orgId: auth.orgId,
        audienceConfigId: config.id,
        trigger: 'manual',
        dryRun: false,
      })
      if (result.status === 'skipped') {
        return { error: 'meta_audience_sync_busy', detail: 'Another reconciliation is already running.' }
      }
      if (result.status === 'failed') {
        return { error: result.errorCode || 'meta_audience_sync_failed', detail: result.errorMessage }
      }
      return { synced: true, audience_id: config.id, ...result }
    },
  },
  {
    name: 'meta_audience_create_niche',
    title: 'Create a Meta custom audience for one prospect niche',
    description:
      "Create the Meta/Facebook Custom Audience (\"bag\") for ONE prospect niche, so ads for barbershops never reach nail salons. The niche is the slug Xcraper stamps on every scrape (lowercase, singular English, e.g. \"barbershop\", \"nail_salon\"). The audience takes the scraped prospects whose niches include it (optionally also limited to Google Maps categories). It reuses the ad account, consent basis and accepted Customer List terms of this workspace's existing enabled prospect audience, so it needs no human approval (owner rule, 2026-10-08); it refuses when there is no such accepted audience or the Meta connection is not usable. The audience starts enabled and marked dirty: the hourly job creates it on Meta and uploads the members, or call meta_audience_sync with confirmed:true to do it now. Idempotent: if an audience for this niche already exists it is returned, not duplicated. Returns no contact identifiers.",
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: z.object({
      niche: z.string().trim().refine(isValidNiche, { message: NICHE_FORMAT_MESSAGE })
        .describe('Niche slug, e.g. "barbershop" or "nail_salon".'),
      name: z.string().trim().min(1).max(200).optional()
        .describe('Audience name shown in Meta. Default: "Skale Club - Prospects - <Niche Title>", e.g. "Skale Club - Prospects - Barbershops".'),
      categories: z.array(z.string().trim().min(1).max(100)).max(50).optional()
        .describe('Optional Google Maps categories (case-insensitive, exact match on the scraped category) to narrow the niche, e.g. ["Barber shop"]. Omit to take every business scraped for the niche.'),
    }).strict(),
    handler: async (input, { auth }) => {
      const service = db()
      const { data, error } = await service
        .from('meta_audience_config')
        .select(configColumns)
        .eq('org_id', auth.orgId)
        .eq('audience_kind', 'xcraper_master')
        .order('created_at', { ascending: true })
      if (error) return { error: 'meta_audience_status_unavailable', detail: 'Could not read Meta audience configurations.' }

      const masters = ((data ?? []) as AudienceConfigRow[]).filter((config) => config.audience_kind === 'xcraper_master').map((config) => ({
        config,
        definition: normalizeAudienceSourceDefinition(config.audience_kind, config.source_definition) as XcraperMasterDefinition,
      }))

      // Idempotent: an audience filtered to exactly this niche already exists.
      const existing = masters.find(({ definition }) =>
        definition.niches?.length === 1 && definition.niches[0] === input.niche,
      )
      if (existing) {
        const requested = [...new Set(((input.categories ?? []) as string[]).map((category) => category.toLowerCase()))].sort()
        const stored = [...new Set((existing.definition.categories ?? []).map((category) => category.toLowerCase()))].sort()
        const categoriesDiffer = input.categories !== undefined && JSON.stringify(requested) !== JSON.stringify(stored)
        return {
          created: false,
          audience: nicheAudienceSummary(existing.config),
          message: categoriesDiffer
            ? 'An audience for this niche already exists and was returned unchanged; its categories differ from the ones requested (edit it in Settings > Integrations > Meta audience).'
            : 'An audience for this niche already exists; nothing was created.',
        }
      }

      // Reuse the connection, consent basis and terms a human already accepted. Prefer the plain
      // master (no niche filter) so every niche audience clones the same, original configuration.
      const donors = masters
        .filter(({ config }) =>
          config.sync_enabled && config.ads_connection_id && config.terms_accepted_at && config.terms_accepted_by,
        )
        .sort((a, b) =>
          ((a.definition.niches?.length ?? 0) + (a.definition.categories?.length ?? 0)) -
          ((b.definition.niches?.length ?? 0) + (b.definition.categories?.length ?? 0)),
        )
      const donor = donors[0]
      if (!donor) {
        return {
          error: 'meta_audience_master_required',
          detail: 'There is no enabled prospect audience with accepted Meta Customer List terms to reuse. A human must enable and accept the terms on the main prospect audience first (Settings > Integrations > Meta audience).',
        }
      }
      const base = donor.config

      const { data: connection, error: connectionError } = await service
        .from('ads_connections')
        .select('id, status, usable, ad_account_id, token_expires_at')
        .eq('id', base.ads_connection_id)
        .eq('org_id', auth.orgId)
        .eq('platform', 'meta')
        .maybeSingle()
      if (connectionError || !connection || connection.ad_account_id !== base.meta_ad_account_id) {
        return { error: 'meta_audience_connection_not_found', detail: 'The Meta connection of the main prospect audience is not available in this workspace.' }
      }
      if (!connection.usable) {
        return { error: 'meta_audience_connection_inactive', detail: 'Reconnect the Meta account of the main prospect audience first.' }
      }
      const expires = connection.token_expires_at ? Date.parse(connection.token_expires_at) : Number.NaN
      if (!Number.isFinite(expires) || expires <= Date.now()) {
        return { error: 'meta_audience_connection_expired', detail: 'The Meta token of the main prospect audience expired. Reconnect it first.' }
      }

      // Same normalizer every reader uses: de-duplicates categories, drops an empty list.
      const sourceDefinition = normalizeAudienceSourceDefinition('xcraper_master', {
        sourceTypes: donor.definition.sourceTypes,
        niches: [input.niche],
        categories: input.categories ?? [],
      })
      const now = new Date().toISOString()
      const { data: created, error: insertError } = await service
        .from('meta_audience_config')
        .insert({
          org_id: auth.orgId,
          ads_connection_id: base.ads_connection_id,
          meta_business_id: null,
          meta_ad_account_id: base.meta_ad_account_id,
          audience_name: input.name ?? `${NICHE_AUDIENCE_NAME_PREFIX}${nicheAudienceTitle(input.niche)}`,
          audience_kind: 'xcraper_master',
          source_definition: sourceDefinition,
          consent_basis: base.consent_basis,
          terms_accepted_at: base.terms_accepted_at,
          terms_accepted_by: base.terms_accepted_by,
          sync_enabled: true,
          operational_status: 'dirty',
          dirty_at: now,
          dirty_reason: 'niche_audience_created',
          next_sync_at: now,
        })
        .select(configColumns)
        .single()
      if (insertError || !created) {
        return { error: 'meta_audience_create_failed', detail: 'Could not create the niche audience configuration.' }
      }

      return {
        created: true,
        audience: nicheAudienceSummary(created as AudienceConfigRow),
        message: 'Niche audience created, enabled and queued. The hourly job creates it on Meta and uploads its members; call meta_audience_sync with confirmed:true to do it now.',
      }
    },
  },
]
