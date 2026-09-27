// Ad assets (sitelinks, callouts, structured snippets, call) create+link and unlink.
//
// Implemented as a CommandHandler (see ../handlers.ts): this module owns its
// command types end to end — snapshot, plan, validate, execute, verify,
// rollback — and is composed over the base google adapter in ../index.ts.
//
// Google Ads models an extension as two objects created together: an `asset`
// (the content — sitelink/callout/structured snippet/call) and a link row
// (`campaignAsset` or `adGroupAsset`) that attaches it to a campaign or ad
// group with a `fieldType`. Both are created atomically in one
// `googleAds:mutate` batch, keyed by the asset's temporary resource name
// (`customers/{c}/assets/-1`) so the link operation can reference it before
// it exists. `google.asset.unlink` only removes the link row — the asset
// content itself stays in the account, matching how Google Ads UI "removes"
// an extension from a campaign/ad group without deleting the shared asset.

import type { AdsCommand, CommandOf } from '../../commands/catalog'
import type { DiffEntry, PlanResult, ResourceSnapshot } from '../../commands/types'
import { googleAdsMutate, mutateResources, parseTokens, runGaqlQuery } from '../../google-api'
import { compareFields, diffField } from '../diff'
import type { CommandHandler } from '../handlers'
import type { AdapterContext, ExecuteResult, VerifyResult } from '../types'

export type AssetFieldType = 'SITELINK' | 'CALLOUT' | 'STRUCTURED_SNIPPET' | 'CALL'

type AddAssetCommand =
  | CommandOf<'google.asset.add_sitelink'>
  | CommandOf<'google.asset.add_callout'>
  | CommandOf<'google.asset.add_structured_snippet'>
  | CommandOf<'google.asset.add_call'>

type UnlinkCommand = CommandOf<'google.asset.unlink'>
type AssetCommand = AddAssetCommand | UnlinkCommand

function refreshToken(ctx: AdapterContext): string {
  return parseTokens(ctx.credential).refresh_token
}

function fieldTypeForAdd(type: AddAssetCommand['type']): AssetFieldType {
  switch (type) {
    case 'google.asset.add_sitelink':
      return 'SITELINK'
    case 'google.asset.add_callout':
      return 'CALLOUT'
    case 'google.asset.add_structured_snippet':
      return 'STRUCTURED_SNIPPET'
    case 'google.asset.add_call':
      return 'CALL'
  }
}

function assetFieldLabel(fieldType: AssetFieldType): string {
  switch (fieldType) {
    case 'SITELINK':
      return 'Sitelink'
    case 'CALLOUT':
      return 'Callout'
    case 'STRUCTURED_SNIPPET':
      return 'Structured snippet'
    case 'CALL':
      return 'Call asset'
  }
}

/** Google's predefined structured snippet headers — anything else is rejected by the API with a generic error, so we catch it at plan time with a clear message. */
const STRUCTURED_SNIPPET_HEADERS = new Set([
  'Amenities', 'Brands', 'Courses', 'Degree programs', 'Destinations', 'Featured hotels',
  'Insurance coverage', 'Models', 'Neighborhoods', 'Service catalog', 'Shows', 'Styles', 'Types',
])

/**
 * "Typical useful count" warnings. Google documents ~20 as the practical
 * ceiling for sitelinks actually shown; the other thresholds are conservative
 * defaults (not sourced from an official Google-published limit) so an
 * operator gets a nudge before a campaign/ad group accumulates an unusually
 * large number of the same asset type.
 */
const WARN_THRESHOLD: Record<AssetFieldType, number> = {
  SITELINK: 20,
  CALLOUT: 20,
  STRUCTURED_SNIPPET: 10,
  CALL: 1,
}

// ─── GAQL readers ─────────────────────────────────────────────────────────────

type CampaignBasicRow = { campaign: { id: string; name: string; status: string }; customer?: { currencyCode?: string } }

async function readCampaignBasic(ctx: AdapterContext, campaignId: string): Promise<CampaignBasicRow | null> {
  const rows = await runGaqlQuery<CampaignBasicRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name, campaign.status, customer.currency_code FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type AdGroupBasicRow = { adGroup: { id: string; name: string; status: string }; campaign?: { id: string }; customer?: { currencyCode?: string } }

async function readAdGroupBasic(ctx: AdapterContext, adGroupId: string): Promise<AdGroupBasicRow | null> {
  const rows = await runGaqlQuery<AdGroupBasicRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id, customer.currency_code FROM ad_group WHERE ad_group.id = ${adGroupId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type AssetRow = {
  id: string
  finalUrls?: string[]
  sitelinkAsset?: { linkText?: string; description1?: string; description2?: string }
  calloutAsset?: { calloutText?: string }
  structuredSnippetAsset?: { header?: string; values?: string[] }
  callAsset?: { countryCode?: string; phoneNumber?: string }
}

const ASSET_FIELDS =
  'asset.id, asset.final_urls, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, ' +
  'asset.sitelink_asset.description2, asset.callout_asset.callout_text, asset.structured_snippet_asset.header, ' +
  'asset.structured_snippet_asset.values, asset.call_asset.country_code, asset.call_asset.phone_number'

export type CampaignAssetLink = {
  campaign: { id: string; name?: string; status?: string }
  campaignAsset: { status: string; fieldType?: string }
  asset: AssetRow
  customer?: { currencyCode?: string }
}

/**
 * Linked assets on `campaign_asset`. Ids come from the (digit-validated)
 * command schema or, for the MCP read tool, a zod-enforced digit regex — this
 * module never interpolates free text into GAQL.
 */
export async function queryCampaignAssetLinks(
  ctx: AdapterContext,
  opts: { campaignId?: string; fieldType?: AssetFieldType },
): Promise<CampaignAssetLink[]> {
  const conditions = [`campaign_asset.status != 'REMOVED'`]
  if (opts.campaignId) conditions.push(`campaign.id = ${opts.campaignId}`)
  if (opts.fieldType) conditions.push(`campaign_asset.field_type = '${opts.fieldType}'`)
  return runGaqlQuery<CampaignAssetLink>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT campaign.id, campaign.name, campaign.status, campaign_asset.status, campaign_asset.field_type, ${ASSET_FIELDS}, customer.currency_code
     FROM campaign_asset WHERE ${conditions.join(' AND ')}`,
  )
}

export type AdGroupAssetLink = {
  adGroup: { id: string; name?: string; status?: string }
  campaign?: { id: string }
  adGroupAsset: { status: string; fieldType?: string }
  asset: AssetRow
  customer?: { currencyCode?: string }
}

export async function queryAdGroupAssetLinks(
  ctx: AdapterContext,
  opts: { adGroupId?: string; fieldType?: AssetFieldType },
): Promise<AdGroupAssetLink[]> {
  const conditions = [`ad_group_asset.status != 'REMOVED'`]
  if (opts.adGroupId) conditions.push(`ad_group.id = ${opts.adGroupId}`)
  if (opts.fieldType) conditions.push(`ad_group_asset.field_type = '${opts.fieldType}'`)
  return runGaqlQuery<AdGroupAssetLink>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id, ad_group_asset.status, ad_group_asset.field_type, ${ASSET_FIELDS}, customer.currency_code
     FROM ad_group_asset WHERE ${conditions.join(' AND ')}`,
  )
}

/** Normalize an asset's Google-side content into the same shape the command schemas use. */
export function assetContent(fieldType: AssetFieldType, asset: AssetRow): Record<string, unknown> {
  switch (fieldType) {
    case 'SITELINK':
      return {
        link_text: asset.sitelinkAsset?.linkText ?? '',
        final_url: asset.finalUrls?.[0] ?? null,
        description1: asset.sitelinkAsset?.description1 ?? null,
        description2: asset.sitelinkAsset?.description2 ?? null,
      }
    case 'CALLOUT':
      return { text: asset.calloutAsset?.calloutText ?? '' }
    case 'STRUCTURED_SNIPPET':
      return { header: asset.structuredSnippetAsset?.header ?? '', values: asset.structuredSnippetAsset?.values ?? [] }
    case 'CALL':
      return { country_code: asset.callAsset?.countryCode ?? '', phone_number: asset.callAsset?.phoneNumber ?? '' }
  }
}

function extractCommandContent(fieldType: AssetFieldType, cmd: AddAssetCommand): Record<string, unknown> {
  switch (fieldType) {
    case 'SITELINK': {
      const c = cmd as CommandOf<'google.asset.add_sitelink'>
      return { link_text: c.link_text, final_url: c.final_url, description1: c.description1 ?? null, description2: c.description2 ?? null }
    }
    case 'CALLOUT':
      return { text: (cmd as CommandOf<'google.asset.add_callout'>).text }
    case 'STRUCTURED_SNIPPET': {
      const c = cmd as CommandOf<'google.asset.add_structured_snippet'>
      return { header: c.header, values: c.values }
    }
    case 'CALL': {
      const c = cmd as CommandOf<'google.asset.add_call'>
      return { country_code: c.country_code, phone_number: c.phone_number }
    }
  }
}

function contentMatches(fieldType: AssetFieldType, intended: Record<string, unknown>, existing: Record<string, unknown>): boolean {
  if (fieldType === 'STRUCTURED_SNIPPET') {
    const a = [...((intended.values as string[] | undefined) ?? [])].sort()
    const b = [...((existing.values as string[] | undefined) ?? [])].sort()
    return intended.header === existing.header && JSON.stringify(a) === JSON.stringify(b)
  }
  if (fieldType === 'SITELINK') return intended.link_text === existing.link_text && intended.final_url === existing.final_url
  if (fieldType === 'CALLOUT') return intended.text === existing.text
  return intended.country_code === existing.country_code && intended.phone_number === existing.phone_number
}

function assetLabel(fieldType: AssetFieldType, v: Record<string, unknown>): string {
  switch (fieldType) {
    case 'SITELINK':
      return `Sitelink "${v.link_text}" → ${v.final_url}`
    case 'CALLOUT':
      return `Callout "${v.text}"`
    case 'STRUCTURED_SNIPPET':
      return `${v.header}: ${Array.isArray(v.values) ? (v.values as string[]).join(', ') : ''}`
    case 'CALL':
      return `Call ${v.country_code} ${v.phone_number}`
  }
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

async function snapshotAdd(ctx: AdapterContext, cmd: AddAssetCommand): Promise<ResourceSnapshot | null> {
  const fieldType = fieldTypeForAdd(cmd.type)
  const intendedContent = extractCommandContent(fieldType, cmd)

  if (cmd.level === 'campaign') {
    const campaignId = cmd.campaign_id as string
    const campaign = await readCampaignBasic(ctx, campaignId)
    if (!campaign) return null
    const links = await queryCampaignAssetLinks(ctx, { campaignId, fieldType })
    const existing = links.find((l) => contentMatches(fieldType, intendedContent, assetContent(fieldType, l.asset)))
    return {
      resourceType: 'asset',
      resourceId: null,
      resourceName: `${assetLabel(fieldType, intendedContent)} → ${campaign.campaign.name}`,
      campaignId: campaign.campaign.id,
      currency: campaign.customer?.currencyCode ?? 'USD',
      fields: {
        parent_status: campaign.campaign.status,
        existing_asset_id: existing?.asset.id ?? null,
        linked_count: links.length,
      },
    }
  }

  const adGroupId = cmd.ad_group_id as string
  const group = await readAdGroupBasic(ctx, adGroupId)
  if (!group) return null
  const links = await queryAdGroupAssetLinks(ctx, { adGroupId, fieldType })
  const existing = links.find((l) => contentMatches(fieldType, intendedContent, assetContent(fieldType, l.asset)))
  return {
    resourceType: 'asset',
    resourceId: null,
    resourceName: `${assetLabel(fieldType, intendedContent)} → ${group.adGroup.name}`,
    campaignId: group.campaign?.id ?? null,
    currency: group.customer?.currencyCode ?? 'USD',
    fields: {
      parent_status: group.adGroup.status,
      existing_asset_id: existing?.asset.id ?? null,
      linked_count: links.length,
    },
  }
}

async function snapshotUnlink(ctx: AdapterContext, cmd: UnlinkCommand): Promise<ResourceSnapshot | null> {
  if (cmd.level === 'campaign') {
    const campaignId = cmd.campaign_id as string
    const links = await queryCampaignAssetLinks(ctx, { campaignId, fieldType: cmd.field_type })
    const found = links.find((l) => l.asset.id === cmd.asset_id)
    if (!found) return null
    const content = assetContent(cmd.field_type, found.asset)
    return {
      resourceType: 'asset',
      resourceId: `${campaignId}~${cmd.asset_id}~${cmd.field_type}`,
      resourceName: `${assetLabel(cmd.field_type, content)} → ${found.campaign.name ?? campaignId}`,
      campaignId,
      currency: found.customer?.currencyCode ?? 'USD',
      fields: { exists: true, ...content },
    }
  }

  const adGroupId = cmd.ad_group_id as string
  const links = await queryAdGroupAssetLinks(ctx, { adGroupId, fieldType: cmd.field_type })
  const found = links.find((l) => l.asset.id === cmd.asset_id)
  if (!found) return null
  const content = assetContent(cmd.field_type, found.asset)
  return {
    resourceType: 'asset',
    resourceId: `${adGroupId}~${cmd.asset_id}~${cmd.field_type}`,
    resourceName: `${assetLabel(cmd.field_type, content)} → ${found.adGroup.name ?? adGroupId}`,
    campaignId: found.campaign?.id ?? null,
    currency: found.customer?.currencyCode ?? 'USD',
    fields: { exists: true, ...content },
  }
}

async function snapshot(ctx: AdapterContext, command: AdsCommand): Promise<ResourceSnapshot | null> {
  const cmd = command as AssetCommand
  if (cmd.type === 'google.asset.unlink') return snapshotUnlink(ctx, cmd)
  return snapshotAdd(ctx, cmd)
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

function plan(command: AdsCommand, before: ResourceSnapshot): PlanResult {
  const cmd = command as AssetCommand
  const f = before.fields

  if (cmd.type === 'google.asset.unlink') {
    const label = assetLabel(cmd.field_type, f)
    const diff: DiffEntry[] = [diffField('asset_link', assetFieldLabel(cmd.field_type), label, null)]
    return { ok: true, intended: { exists: false }, diff, warnings: [], facts: {} }
  }

  if (f.parent_status === 'REMOVED') {
    return {
      ok: false,
      code: cmd.level === 'campaign' ? 'campaign_removed' : 'ad_group_removed',
      message: `The parent ${cmd.level === 'campaign' ? 'campaign' : 'ad group'} was removed in Google Ads.`,
    }
  }

  const fieldType = fieldTypeForAdd(cmd.type)

  if (cmd.type === 'google.asset.add_structured_snippet' && !STRUCTURED_SNIPPET_HEADERS.has(cmd.header)) {
    return {
      ok: false,
      code: 'invalid_header',
      message: `"${cmd.header}" is not one of Google's predefined structured snippet headers (${[...STRUCTURED_SNIPPET_HEADERS].join(', ')}).`,
    }
  }

  if (f.existing_asset_id) {
    return {
      ok: false,
      code: 'already_exists',
      message: `An identical ${assetFieldLabel(fieldType).toLowerCase()} is already linked here (asset ${f.existing_asset_id}).`,
    }
  }

  const warnings: string[] = []
  const linkedCount = Number(f.linked_count ?? 0)
  const threshold = WARN_THRESHOLD[fieldType]
  if (linkedCount + 1 > threshold) {
    warnings.push(
      `This ${cmd.level === 'campaign' ? 'campaign' : 'ad group'} will have ${linkedCount + 1} linked ${assetFieldLabel(fieldType).toLowerCase()} assets — more than the typical useful count (${threshold}).`,
    )
  }

  const intended = extractCommandContent(fieldType, cmd)
  const diff: DiffEntry[] = [diffField('asset_link', assetFieldLabel(fieldType), null, assetLabel(fieldType, intended))]
  return { ok: true, intended, diff, warnings, facts: {} }
}

// ─── Operations ───────────────────────────────────────────────────────────────

function buildAssetPayload(fieldType: AssetFieldType, cmd: AddAssetCommand): Record<string, unknown> {
  switch (fieldType) {
    case 'SITELINK': {
      const c = cmd as CommandOf<'google.asset.add_sitelink'>
      return {
        finalUrls: [c.final_url],
        sitelinkAsset: {
          linkText: c.link_text,
          ...(c.description1 ? { description1: c.description1 } : {}),
          ...(c.description2 ? { description2: c.description2 } : {}),
        },
      }
    }
    case 'CALLOUT':
      return { calloutAsset: { calloutText: (cmd as CommandOf<'google.asset.add_callout'>).text } }
    case 'STRUCTURED_SNIPPET': {
      const c = cmd as CommandOf<'google.asset.add_structured_snippet'>
      return { structuredSnippetAsset: { header: c.header, values: c.values } }
    }
    case 'CALL': {
      const c = cmd as CommandOf<'google.asset.add_call'>
      return { callAsset: { countryCode: c.country_code, phoneNumber: c.phone_number } }
    }
  }
}

/**
 * `google.asset.add_*` is one atomic googleAds:mutate batch: the asset
 * (temporary resource name `customers/{c}/assets/-1`) and the campaignAsset /
 * adGroupAsset link referencing it, in a single request — either both apply
 * or neither does.
 */
function buildAddOperations(cmd: AddAssetCommand, customerId: string): unknown[] {
  const c = `customers/${customerId}`
  const assetResourceName = `${c}/assets/-1`
  const fieldType = fieldTypeForAdd(cmd.type)
  const linkOperation =
    cmd.level === 'campaign'
      ? { campaignAssetOperation: { create: { campaign: `${c}/campaigns/${cmd.campaign_id}`, asset: assetResourceName, fieldType } } }
      : { adGroupAssetOperation: { create: { adGroup: `${c}/adGroups/${cmd.ad_group_id}`, asset: assetResourceName, fieldType } } }
  return [{ assetOperation: { create: { resourceName: assetResourceName, ...buildAssetPayload(fieldType, cmd) } } }, linkOperation]
}

function unlinkResourceName(cmd: UnlinkCommand, customerId: string): string {
  const c = `customers/${customerId}`
  return cmd.level === 'campaign'
    ? `${c}/campaignAssets/${cmd.campaign_id}~${cmd.asset_id}~${cmd.field_type}`
    : `${c}/adGroupAssets/${cmd.ad_group_id}~${cmd.asset_id}~${cmd.field_type}`
}

/**
 * `customers/{c}/campaignAssets/{campaignId}~{assetId}~{FIELD_TYPE}` (or
 * .../adGroupAssets/{adGroupId}~{assetId}~{FIELD_TYPE}) → its parts. Used to
 * read providerRef back for verify(), and to build the unlink rollback of an
 * add_* command from the link resource the execute() response returned.
 */
function parseAssetLinkRef(
  resourceName: string | null,
): { level: 'campaign' | 'ad_group'; parentId: string; assetId: string; fieldType: AssetFieldType } | null {
  if (!resourceName) return null
  const campaignMatch = resourceName.match(/\/campaignAssets\/(\d+)~(\d+)~([A-Z_]+)$/)
  if (campaignMatch) return { level: 'campaign', parentId: campaignMatch[1], assetId: campaignMatch[2], fieldType: campaignMatch[3] as AssetFieldType }
  const adGroupMatch = resourceName.match(/\/adGroupAssets\/(\d+)~(\d+)~([A-Z_]+)$/)
  if (adGroupMatch) return { level: 'ad_group', parentId: adGroupMatch[1], assetId: adGroupMatch[2], fieldType: adGroupMatch[3] as AssetFieldType }
  return null
}

type AssetMutateOperationResult = {
  assetResult?: { resourceName?: string }
  campaignAssetResult?: { resourceName?: string }
  adGroupAssetResult?: { resourceName?: string }
}

async function validate(ctx: AdapterContext, command: AdsCommand): Promise<void> {
  const cmd = command as AssetCommand
  // unlink is a pure remove: existence at the given field type was already
  // confirmed by snapshot, and there is nothing else to validate.
  if (cmd.type === 'google.asset.unlink') return
  const operations = buildAddOperations(cmd, ctx.adAccountId)
  await googleAdsMutate(ctx.adAccountId, refreshToken(ctx), operations, { validateOnly: true })
}

async function execute(ctx: AdapterContext, command: AdsCommand): Promise<ExecuteResult> {
  const cmd = command as AssetCommand
  if (cmd.type === 'google.asset.unlink') {
    const resourceName = unlinkResourceName(cmd, ctx.adAccountId)
    const service = cmd.level === 'campaign' ? 'campaignAssets' : 'adGroupAssets'
    const res = await mutateResources(ctx.adAccountId, refreshToken(ctx), service, [{ remove: resourceName }])
    return { providerRef: res.results?.[0]?.resourceName ?? resourceName, raw: res }
  }
  const operations = buildAddOperations(cmd, ctx.adAccountId)
  const res = await googleAdsMutate(ctx.adAccountId, refreshToken(ctx), operations)
  const responses = (res.mutateOperationResponses ?? []) as AssetMutateOperationResult[]
  const linkResult = responses.find((r) => r.campaignAssetResult?.resourceName || r.adGroupAssetResult?.resourceName)
  const providerRef = linkResult?.campaignAssetResult?.resourceName ?? linkResult?.adGroupAssetResult?.resourceName ?? null
  return { providerRef, raw: res }
}

// ─── Verify ───────────────────────────────────────────────────────────────────

async function verify(
  ctx: AdapterContext,
  command: AdsCommand,
  intended: Record<string, unknown>,
  providerRef: string | null,
): Promise<VerifyResult> {
  const cmd = command as AssetCommand

  if (cmd.type === 'google.asset.unlink') {
    const stillLinked =
      cmd.level === 'campaign'
        ? (await queryCampaignAssetLinks(ctx, { campaignId: cmd.campaign_id as string, fieldType: cmd.field_type })).some((l) => l.asset.id === cmd.asset_id)
        : (await queryAdGroupAssetLinks(ctx, { adGroupId: cmd.ad_group_id as string, fieldType: cmd.field_type })).some((l) => l.asset.id === cmd.asset_id)
    return {
      ok: !stillLinked,
      mismatches: stillLinked ? [{ field: 'exists', expected: false, actual: true }] : [],
      observed: { exists: stillLinked },
    }
  }

  const fieldType = fieldTypeForAdd(cmd.type)
  const parsed = parseAssetLinkRef(providerRef)
  if (!parsed) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }

  const links =
    parsed.level === 'campaign'
      ? await queryCampaignAssetLinks(ctx, { campaignId: parsed.parentId, fieldType })
      : await queryAdGroupAssetLinks(ctx, { adGroupId: parsed.parentId, fieldType })
  const found = links.find((l) => l.asset.id === parsed.assetId)
  if (!found) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }

  const observed = assetContent(fieldType, found.asset)
  const mismatches = compareFields(intended, observed)
  return { ok: mismatches.length === 0, mismatches, observed }
}

// ─── Rollback ─────────────────────────────────────────────────────────────────

function buildRollback(command: AdsCommand, before: ResourceSnapshot, providerRef: string | null): AdsCommand | null {
  const cmd = command as AssetCommand
  const base = { platform: 'google' as const, ad_account_id: cmd.ad_account_id }

  if (cmd.type === 'google.asset.unlink') {
    const f = before.fields
    if (!f.exists) return null
    switch (cmd.field_type) {
      case 'SITELINK':
        return typeof f.link_text === 'string' && typeof f.final_url === 'string'
          ? {
              ...base,
              type: 'google.asset.add_sitelink',
              level: cmd.level,
              campaign_id: cmd.campaign_id,
              ad_group_id: cmd.ad_group_id,
              link_text: f.link_text,
              final_url: f.final_url,
              ...(typeof f.description1 === 'string' ? { description1: f.description1 } : {}),
              ...(typeof f.description2 === 'string' ? { description2: f.description2 } : {}),
            }
          : null
      case 'CALLOUT':
        return typeof f.text === 'string'
          ? { ...base, type: 'google.asset.add_callout', level: cmd.level, campaign_id: cmd.campaign_id, ad_group_id: cmd.ad_group_id, text: f.text }
          : null
      case 'STRUCTURED_SNIPPET':
        return typeof f.header === 'string' && Array.isArray(f.values) && f.values.length >= 3
          ? {
              ...base,
              type: 'google.asset.add_structured_snippet',
              level: cmd.level,
              campaign_id: cmd.campaign_id,
              ad_group_id: cmd.ad_group_id,
              header: f.header,
              values: f.values as string[],
            }
          : null
      case 'CALL':
        return typeof f.country_code === 'string' && typeof f.phone_number === 'string'
          ? {
              ...base,
              type: 'google.asset.add_call',
              level: cmd.level,
              campaign_id: cmd.campaign_id,
              ad_group_id: cmd.ad_group_id,
              country_code: f.country_code,
              phone_number: f.phone_number,
            }
          : null
      default:
        return null
    }
  }

  // add_* → unlink using the new asset's id, parsed from the link resource execute() returned.
  const parsed = parseAssetLinkRef(providerRef)
  if (!parsed) return null
  return {
    ...base,
    type: 'google.asset.unlink',
    level: cmd.level,
    campaign_id: cmd.campaign_id,
    ad_group_id: cmd.ad_group_id,
    asset_id: parsed.assetId,
    field_type: parsed.fieldType,
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const assetsHandler: CommandHandler = {
  platform: 'google',
  types: ['google.asset.add_sitelink', 'google.asset.add_callout', 'google.asset.add_structured_snippet', 'google.asset.add_call', 'google.asset.unlink'],
  snapshot,
  plan,
  validate,
  execute,
  verify,
  buildRollback,
}
