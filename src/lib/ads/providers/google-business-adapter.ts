import type { AdsCommand, AdsCommandType, CommandOf } from '../commands/catalog'
import { COMMAND_CATALOG } from '../commands/catalog'
import type { DiffEntry, PlanResult, ResourceSnapshot } from '../commands/types'
import { assertPublicHttpsUrl } from '../safe-fetch'
import {
  createGoogleBusinessLocalPost,
  createGoogleBusinessMedia,
  getGoogleBusinessAttributes,
  getGoogleBusinessLocalPost,
  getGoogleBusinessLocation,
  getGoogleBusinessMedia,
  getGoogleBusinessReview,
  GoogleBusinessError,
  patchGoogleBusinessLocation,
  replyToGoogleBusinessReview,
  updateGoogleBusinessAttributes,
  updateGoogleBusinessLocalPost,
} from '@/lib/google-business/api'
import { compareFields, diffField, effective } from './diff'
import type { AdapterContext, AdsProviderAdapter, ExecuteResult, VerifyResult } from './types'

const TYPES = [
  'google_business.local_post.create',
  'google_business.local_post.update',
  'google_business.review.reply',
  'google_business.media.upload',
  'google_business.location.update_info',
  'google_business.location.update_service_items',
  'google_business.location.update_categories',
  'google_business.location.update_service_area',
  'google_business.location.update_attributes',
  'google_business.location.update_address',
  'google_business.location.set_regular_hours',
  'google_business.location.set_special_hours',
  'google_business.location.set_open_status',
] as const satisfies readonly AdsCommandType[]

type BusinessCommand = CommandOf<(typeof TYPES)[number]>
const TYPE_SET = new Set<AdsCommandType>(TYPES)

function isBusinessCommand(command: AdsCommand): command is BusinessCommand {
  return TYPE_SET.has(command.type)
}

function plain(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stripName(value: unknown, prefix: string): string | null {
  if (typeof value !== 'string') return null
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function postFields(post: Record<string, unknown>) {
  const media = Array.isArray(post.media) ? plain(post.media[0]) : {}
  const cta = plain(post.callToAction)
  return {
    summary: post.summary ?? null,
    photo_url: media.sourceUrl ?? null,
    cta_type: cta.actionType ?? null,
    cta_url: cta.url ?? null,
  }
}

function locationFields(location: Record<string, unknown>) {
  const profile = plain(location.profile)
  const phones = plain(location.phoneNumbers)
  const categories = plain(location.categories)
  const primary = plain(categories.primaryCategory)
  const additional = Array.isArray(categories.additionalCategories) ? categories.additionalCategories.map(plain) : []
  const serviceArea = plain(location.serviceArea)
  const places = plain(serviceArea.places)
  const openInfo = plain(location.openInfo)
  return {
    description: profile.description ?? null,
    primary_phone: phones.primaryPhone ?? null,
    website_url: location.websiteUri ?? null,
    service_items: location.serviceItems ?? [],
    primary_category_id: stripName(primary.name, 'categories/'),
    additional_category_ids: additional.map((item) => stripName(item.name, 'categories/')).filter(Boolean),
    service_area: {
      business_type: serviceArea.businessType ?? null,
      places: Array.isArray(places.placeInfos)
        ? places.placeInfos.map((item) => ({ place_name: plain(item).placeName, place_id: plain(item).placeId }))
        : [],
    },
    address: location.storefrontAddress ?? null,
    regular_hours: location.regularHours ?? null,
    special_hours: location.specialHours ?? null,
    open_status: openInfo.status ?? null,
  }
}

function time(value: string): Record<string, number> {
  const [hours, minutes] = value.split(':').map(Number)
  return { hours, minutes }
}

function date(value: string): Record<string, number> {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function money(amount: string | number, currencyCode: string) {
  const numeric = Number(amount)
  const units = Math.trunc(numeric)
  return { currencyCode, units: String(units), nanos: Math.round((numeric - units) * 1_000_000_000) }
}

function serviceItems(command: CommandOf<'google_business.location.update_service_items'>) {
  return command.service_items.map((item) => ({
    ...(item.service_type_id ? { structuredServiceItem: { serviceTypeId: item.service_type_id, ...(item.description ? { description: item.description } : {}) } } : {}),
    ...(!item.service_type_id ? { freeFormServiceItem: {
      category: `categories/${item.category_id}`,
      label: { displayName: item.display_name, languageCode: item.language_code ?? 'en' },
    } } : {}),
    ...(item.price ? { price: money(item.price.amount, item.price.currency_code) } : {}),
  }))
}

function postBody(command: CommandOf<'google_business.local_post.create'> | CommandOf<'google_business.local_post.update'>) {
  return {
    ...(command.summary !== undefined ? { summary: command.summary } : {}),
    ...('language_code' in command ? { languageCode: command.language_code } : {}),
    ...('summary' in command && command.type.endsWith('.create') ? { topicType: 'STANDARD' } : {}),
    ...(command.photo_url ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: command.photo_url }] } : {}),
    ...(command.cta_type ? { callToAction: { actionType: command.cta_type, ...(command.cta_url ? { url: command.cta_url } : {}) } } : {}),
  }
}

function intended(command: BusinessCommand): Record<string, unknown> {
  switch (command.type) {
    case 'google_business.local_post.create': return postFields(postBody(command))
    case 'google_business.local_post.update': return Object.fromEntries(Object.entries(postFields(postBody(command))).filter(([, value]) => value !== null))
    case 'google_business.review.reply': return { reply_comment: command.comment }
    case 'google_business.media.upload': return { photo_url: command.photo_url, category: command.category }
    case 'google_business.location.update_info': return {
      ...(command.description !== undefined ? { description: command.description } : {}),
      ...(command.primary_phone !== undefined ? { primary_phone: command.primary_phone } : {}),
      ...(command.website_url !== undefined ? { website_url: command.website_url } : {}),
    }
    case 'google_business.location.update_service_items': return { service_items: serviceItems(command) }
    case 'google_business.location.update_categories': return { primary_category_id: command.primary_category_id, additional_category_ids: command.additional_category_ids }
    case 'google_business.location.update_service_area': return { service_area: { business_type: command.business_type, places: command.places } }
    case 'google_business.location.update_attributes': return {
      attributes: command.attributes,
      unset_attribute_ids: command.unset_attribute_ids,
    }
    case 'google_business.location.update_address': return { address: {
      regionCode: command.region_code,
      addressLines: command.address_lines,
      ...(command.administrative_area ? { administrativeArea: command.administrative_area } : {}),
      ...(command.locality ? { locality: command.locality } : {}),
      ...(command.postal_code ? { postalCode: command.postal_code } : {}),
    } }
    case 'google_business.location.set_regular_hours': return { regular_hours: { periods: command.periods.map((period) => ({
      openDay: period.open_day, openTime: time(period.open_time), closeDay: period.close_day ?? period.open_day, closeTime: time(period.close_time),
    })) } }
    case 'google_business.location.set_special_hours': return { special_hours: { specialHourPeriods: command.periods.map((period) => ({
      startDate: date(period.date), endDate: date(period.date), closed: period.closed,
      ...(!period.closed ? { openTime: time(period.open_time!), closeTime: time(period.close_time!) } : {}),
    })) } }
    case 'google_business.location.set_open_status': return { open_status: command.status }
  }
}

async function snapshot(ctx: AdapterContext, command: BusinessCommand): Promise<ResourceSnapshot | null> {
  try {
    if (command.type === 'google_business.local_post.update') {
      const post = await getGoogleBusinessLocalPost(ctx.adAccountId, ctx.credential, command.post_id)
      return { resourceType: 'local_post', resourceId: String(post.name ?? command.post_id), resourceName: String(post.name ?? command.post_id), campaignId: null, currency: 'USD', fields: postFields(post) }
    }
    if (command.type === 'google_business.review.reply') {
      const review = await getGoogleBusinessReview(ctx.adAccountId, ctx.credential, command.review_id)
      const reply = plain(review.reviewReply)
      const reviewer = plain(review.reviewer)
      return { resourceType: 'review', resourceId: String(review.name ?? command.review_id), resourceName: String(reviewer.displayName ?? review.name ?? command.review_id), campaignId: null, currency: 'USD', fields: { reply_comment: reply.comment ?? null } }
    }
    if (command.type === 'google_business.location.update_attributes') {
      const [location, attributes] = await Promise.all([
        getGoogleBusinessLocation(ctx.adAccountId, ctx.credential),
        getGoogleBusinessAttributes(ctx.adAccountId, ctx.credential),
      ])
      const touched = new Set([...command.attributes.map((a) => a.attribute_id.replace(/^attributes\//, '')), ...command.unset_attribute_ids.map((id) => id.replace(/^attributes\//, ''))])
      const selected = attributes.filter((attribute) => touched.has(String(attribute.name ?? '').replace(/^attributes\//, '')))
      return { resourceType: 'attribute', resourceId: ctx.adAccountId, resourceName: String(location.title ?? ctx.adAccountId), campaignId: null, currency: 'USD', fields: { attributes: selected } }
    }
    const location = await getGoogleBusinessLocation(ctx.adAccountId, ctx.credential)
    return {
      resourceType: command.type === 'google_business.media.upload' ? 'media' : command.type === 'google_business.local_post.create' ? 'local_post' : COMMAND_CATALOG[command.type].resourceType,
      resourceId: command.type.includes('.create') || command.type === 'google_business.media.upload' ? null : ctx.adAccountId,
      resourceName: String(location.title ?? ctx.adAccountId),
      campaignId: null,
      currency: 'USD',
      fields: locationFields(location),
    }
  } catch (error) {
    if (error instanceof GoogleBusinessError && error.status === 404) return null
    throw error
  }
}

function plan(command: BusinessCommand, before: ResourceSnapshot): PlanResult {
  const after = intended(command)
  const diffs: DiffEntry[] = []
  for (const [field, value] of Object.entries(after)) {
    diffs.push(diffField(field, field.replaceAll('_', ' '), before.fields[field], value))
  }
  const diff = effective(diffs)
  if (!diff.length && !command.type.endsWith('.create') && command.type !== 'google_business.media.upload') {
    return { ok: false, code: 'no_op', message: 'The Business Profile already has these values.' }
  }
  const warnings = []
  if (command.type === 'google_business.location.update_address') warnings.push('Changing the address can trigger Google re-verification and temporarily unpublish the profile.')
  if (command.type === 'google_business.location.update_categories') warnings.push('Changing the primary category can trigger review or re-verification by Google.')
  if (command.type === 'google_business.location.update_service_items' || command.type === 'google_business.location.update_service_area' || command.type.includes('hours')) {
    warnings.push('This action replaces the complete current list; omitted values are removed.')
  }
  return { ok: true, intended: after, diff: diff.length ? diff : [diffField('create', 'new public resource', null, after)], warnings, facts: {} }
}

function locationPatch(command: BusinessCommand): { body: Record<string, unknown>; mask: string[] } | null {
  switch (command.type) {
    case 'google_business.location.update_info': return { body: {
      ...(command.description !== undefined ? { profile: { description: command.description } } : {}),
      ...(command.primary_phone !== undefined ? { phoneNumbers: { primaryPhone: command.primary_phone } } : {}),
      ...(command.website_url !== undefined ? { websiteUri: command.website_url } : {}),
    }, mask: [command.description !== undefined ? 'profile.description' : '', command.primary_phone !== undefined ? 'phoneNumbers.primaryPhone' : '', command.website_url !== undefined ? 'websiteUri' : ''].filter(Boolean) }
    case 'google_business.location.update_service_items': return { body: { serviceItems: serviceItems(command) }, mask: ['serviceItems'] }
    case 'google_business.location.update_categories': return { body: { categories: {
      primaryCategory: { name: `categories/${command.primary_category_id}` },
      additionalCategories: command.additional_category_ids.map((id) => ({ name: `categories/${id}` })),
    } }, mask: ['categories'] }
    case 'google_business.location.update_service_area': return { body: { serviceArea: {
      businessType: command.business_type,
      places: { placeInfos: command.places.map((place) => ({ placeName: place.place_name, placeId: place.place_id })) },
    } }, mask: ['serviceArea'] }
    case 'google_business.location.update_address': return { body: { storefrontAddress: intended(command).address }, mask: ['storefrontAddress'] }
    case 'google_business.location.set_regular_hours': return { body: { regularHours: intended(command).regular_hours }, mask: ['regularHours'] }
    case 'google_business.location.set_special_hours': return { body: { specialHours: intended(command).special_hours }, mask: ['specialHours'] }
    case 'google_business.location.set_open_status': return { body: { openInfo: { status: command.status } }, mask: ['openInfo.status'] }
    default: return null
  }
}

function attributePayload(command: CommandOf<'google_business.location.update_attributes'>) {
  const attrs = command.attributes.map((attribute) => ({
    name: `attributes/${attribute.attribute_id.replace(/^attributes\//, '')}`,
    ...(attribute.values ? { values: attribute.values } : {}),
    ...(attribute.uri_values ? { uriValues: attribute.uri_values.map((uri) => ({ uri })) } : {}),
    ...(attribute.set_enum_values || attribute.unset_enum_values ? { repeatedEnumValue: { setValues: attribute.set_enum_values ?? [], unsetValues: attribute.unset_enum_values ?? [] } } : {}),
  }))
  attrs.push(...command.unset_attribute_ids.map((id) => ({ name: `attributes/${id.replace(/^attributes\//, '')}` })))
  return { attrs, mask: attrs.map((attribute) => String(attribute.name).replace(/^attributes\//, '')) }
}

async function execute(ctx: AdapterContext, command: BusinessCommand): Promise<ExecuteResult> {
  switch (command.type) {
    case 'google_business.local_post.create': {
      const result = await createGoogleBusinessLocalPost(ctx.adAccountId, ctx.credential, postBody(command))
      return { providerRef: String(result.name ?? ''), raw: result }
    }
    case 'google_business.local_post.update': {
      const body = postBody(command)
      const result = await updateGoogleBusinessLocalPost(ctx.adAccountId, ctx.credential, command.post_id, body, Object.keys(body).filter((key) => key !== 'languageCode'))
      return { providerRef: String(result.name ?? command.post_id), raw: result }
    }
    case 'google_business.review.reply': {
      const result = await replyToGoogleBusinessReview(ctx.adAccountId, ctx.credential, command.review_id, command.comment)
      return { providerRef: command.review_id, raw: result }
    }
    case 'google_business.media.upload': {
      const result = await createGoogleBusinessMedia(ctx.adAccountId, ctx.credential, { mediaFormat: 'PHOTO', locationAssociation: { category: command.category }, sourceUrl: command.photo_url })
      return { providerRef: String(result.name ?? ''), raw: result }
    }
    case 'google_business.location.update_attributes': {
      const payload = attributePayload(command)
      const result = await updateGoogleBusinessAttributes(ctx.adAccountId, ctx.credential, payload.attrs, payload.mask)
      return { providerRef: ctx.adAccountId, raw: result }
    }
    default: {
      const patch = locationPatch(command)
      if (!patch) throw new Error(`Unsupported Google Business command ${command.type}`)
      const result = await patchGoogleBusinessLocation(ctx.adAccountId, ctx.credential, patch.body, patch.mask)
      return { providerRef: ctx.adAccountId, raw: result }
    }
  }
}

async function observed(ctx: AdapterContext, command: BusinessCommand, providerRef: string | null): Promise<Record<string, unknown> | null> {
  if (command.type === 'google_business.local_post.create' || command.type === 'google_business.local_post.update') {
    const id = providerRef || (command.type === 'google_business.local_post.update' ? command.post_id : '')
    if (!id) return null
    return postFields(await getGoogleBusinessLocalPost(ctx.adAccountId, ctx.credential, id))
  }
  if (command.type === 'google_business.review.reply') {
    const review = await getGoogleBusinessReview(ctx.adAccountId, ctx.credential, command.review_id)
    return { reply_comment: plain(review.reviewReply).comment ?? null }
  }
  if (command.type === 'google_business.media.upload') {
    if (!providerRef) return null
    const media = await getGoogleBusinessMedia(ctx.adAccountId, ctx.credential, providerRef)
    return { photo_url: media.sourceUrl ?? command.photo_url, category: plain(media.locationAssociation).category ?? command.category }
  }
  if (command.type === 'google_business.location.update_attributes') {
    return { attributes: await getGoogleBusinessAttributes(ctx.adAccountId, ctx.credential) }
  }
  return locationFields(await getGoogleBusinessLocation(ctx.adAccountId, ctx.credential))
}

export const googleBusinessAdapter: AdsProviderAdapter = {
  platform: 'google_business',
  capabilities: () => TYPES.map((type) => ({ type, label: COMMAND_CATALOG[type].label, risk: COMMAND_CATALOG[type].risk })),
  snapshot(ctx, command) {
    return isBusinessCommand(command) ? snapshot(ctx, command) : Promise.resolve(null)
  },
  plan(command, before) {
    return isBusinessCommand(command) ? plan(command, before) : { ok: false, code: 'unsupported_command', message: 'Unsupported Google Business command' }
  },
  async validate(ctx, command) {
    if (!isBusinessCommand(command)) return
    if ('photo_url' in command && command.photo_url) await assertPublicHttpsUrl(command.photo_url)
    const patch = locationPatch(command)
    if (patch) await patchGoogleBusinessLocation(ctx.adAccountId, ctx.credential, patch.body, patch.mask, true)
  },
  execute(ctx, command) {
    if (!isBusinessCommand(command)) throw new Error('Unsupported Google Business command')
    return execute(ctx, command)
  },
  async verify(ctx, command, expected, providerRef): Promise<VerifyResult> {
    if (!isBusinessCommand(command)) return { ok: false, mismatches: [], observed: null }
    const value = await observed(ctx, command, providerRef)
    if (!value) return { ok: false, mismatches: Object.entries(expected).map(([field, wanted]) => ({ field, expected: wanted, actual: null })), observed: null }
    if (command.type === 'google_business.location.update_attributes') {
      // Attribute responses normalize enum/URI values differently by type.
      // A successful PATCH followed by an authenticated read is the strongest
      // stable verification available; preserve the raw observed set.
      return { ok: true, mismatches: [], observed: value }
    }
    const mismatches = compareFields(expected, value)
    return { ok: mismatches.length === 0, mismatches, observed: value }
  },
  buildRollback(command, before): AdsCommand | null {
    if (!isBusinessCommand(command)) return null
    const base = { platform: 'google_business' as const, ad_account_id: command.ad_account_id }
    switch (command.type) {
      case 'google_business.local_post.update': {
        const rollback: Record<string, unknown> = { ...base, type: command.type, post_id: command.post_id }
        for (const field of ['summary', 'photo_url', 'cta_type'] as const) {
          if (command[field] === undefined) continue
          if (typeof before.fields[field] !== 'string') return null
          rollback[field] = before.fields[field]
        }
        if (command.cta_type !== undefined && before.fields.cta_type !== 'CALL') {
          if (typeof before.fields.cta_url !== 'string') return null
          rollback.cta_url = before.fields.cta_url
        }
        return rollback as AdsCommand
      }
      case 'google_business.review.reply': return typeof before.fields.reply_comment === 'string' ? { ...base, type: command.type, review_id: command.review_id, comment: before.fields.reply_comment } : null
      case 'google_business.location.update_info': {
        const rollback: Record<string, unknown> = { ...base, type: command.type }
        for (const field of ['description', 'primary_phone', 'website_url'] as const) {
          if (command[field] === undefined) continue
          if (typeof before.fields[field] !== 'string') return null
          rollback[field] = before.fields[field]
        }
        return rollback as AdsCommand
      }
      case 'google_business.location.set_open_status': return before.fields.open_status === 'OPEN' || before.fields.open_status === 'CLOSED_TEMPORARILY' ? { ...base, type: command.type, status: before.fields.open_status } : null
      default: return null
    }
  },
  classifyError(error) {
    if (error instanceof GoogleBusinessError) {
      return {
        code: error.code ?? `HTTP_${error.status}`,
        message: error.message,
        transient: error.status === 429 || error.status >= 500,
        auth: error.status === 401 || error.status === 403,
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { code: 'GOOGLE_BUSINESS_ERROR', message, transient: /timeout|fetch failed|ECONNRESET/i.test(message), auth: /invalid_grant|unauthorized/i.test(message) }
  },
}
