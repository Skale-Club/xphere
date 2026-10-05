import 'server-only'

import { GbpApiError, GbpClient } from '@/lib/gbp/client'
import { createServiceRoleClient } from '@/lib/supabase/admin'

// Google Business Profile reads and writes for the Ads Command Engine adapter.
//
// There is ONE Business Profile login: the Local SEO connect flow, which owns
// the OAuth tokens in gbp_connections. Engine targets (ads_connections rows
// with platform 'google_business') are created when a Local SEO location is
// linked to a profile, and their "credential" is only a reference to that
// gbp_connections row — never a copy of the token.

export const GBP_CREDENTIAL_PREFIX = 'gbp_connection:'

export function gbpConnectionCredential(connectionId: string): string {
  return `${GBP_CREDENTIAL_PREFIX}${connectionId}`
}

export function parseGbpConnectionCredential(credential: string): string {
  if (!credential.startsWith(GBP_CREDENTIAL_PREFIX)) {
    throw new GoogleBusinessError('This Business Profile target predates the Local SEO connection. Relink the location in Local SEO.', 401, 'STALE_CREDENTIAL')
  }
  return credential.slice(GBP_CREDENTIAL_PREFIX.length)
}

export const GOOGLE_BUSINESS_LOCATION_READ_MASK = [
  'name', 'title', 'phoneNumbers', 'categories', 'storefrontAddress', 'websiteUri',
  'regularHours', 'specialHours', 'serviceArea', 'openInfo', 'profile', 'serviceItems', 'metadata',
].join(',')

export class GoogleBusinessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'GoogleBusinessError'
  }
}

export type GoogleBusinessTarget = { accountId: string; locationId: string; fullName: string }

export function parseGoogleBusinessTarget(value: string): GoogleBusinessTarget {
  const match = /^accounts\/([^/]+)\/locations\/([^/]+)$/.exec(value)
  if (!match) throw new Error('Invalid Google Business target; expected accounts/{account_id}/locations/{location_id}')
  return { accountId: match[1], locationId: match[2], fullName: value }
}

async function request<T>(
  credential: string,
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  // GbpClient refreshes and persists the access token, and marks the
  // connection `error` when Google rejects the refresh token, so Local SEO
  // shows "reconnect" for engine failures too.
  const client = new GbpClient(createServiceRoleClient(), parseGbpConnectionCredential(credential))
  try {
    return await client.request<T>(url, {
      method: options.method ?? 'GET',
      headers: { 'x-goog-api-format-version': '2' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    if (error instanceof GbpApiError) {
      // status 0 = network failure or token refresh outage: retryable.
      throw new GoogleBusinessError(error.message, error.status || 503, error.kind.toUpperCase())
    }
    throw error
  }
}

function infoBase(locationId: string) {
  return `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${encodeURIComponent(locationId)}`
}

function legacyBase(target: GoogleBusinessTarget) {
  return `https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(target.accountId)}/locations/${encodeURIComponent(target.locationId)}`
}

export async function getGoogleBusinessLocation(targetName: string, credential: string): Promise<Record<string, unknown>> {
  const target = parseGoogleBusinessTarget(targetName)
  const url = new URL(infoBase(target.locationId))
  url.searchParams.set('readMask', GOOGLE_BUSINESS_LOCATION_READ_MASK)
  return request(credential, url.toString())
}

export async function patchGoogleBusinessLocation(
  targetName: string,
  credential: string,
  body: Record<string, unknown>,
  updateMask: string[],
  validateOnly = false,
): Promise<Record<string, unknown>> {
  const target = parseGoogleBusinessTarget(targetName)
  const url = new URL(infoBase(target.locationId))
  url.searchParams.set('updateMask', updateMask.join(','))
  if (validateOnly) url.searchParams.set('validateOnly', 'true')
  return request(credential, url.toString(), { method: 'PATCH', body: { name: `locations/${target.locationId}`, ...body } })
}

export async function getGoogleBusinessAttributes(targetName: string, credential: string): Promise<Record<string, unknown>[]> {
  const target = parseGoogleBusinessTarget(targetName)
  const result = await request<{ attributes?: Record<string, unknown>[] }>(credential, `${infoBase(target.locationId)}/attributes`)
  return result.attributes ?? []
}

export async function updateGoogleBusinessAttributes(
  targetName: string,
  credential: string,
  attributes: Record<string, unknown>[],
  attributeMask: string[],
): Promise<Record<string, unknown>> {
  const target = parseGoogleBusinessTarget(targetName)
  const url = new URL(`${infoBase(target.locationId)}/attributes`)
  url.searchParams.set('attributeMask', attributeMask.join(','))
  return request(credential, url.toString(), { method: 'PATCH', body: { name: `locations/${target.locationId}/attributes`, attributes } })
}

function resourceName(id: string, prefix: string): string {
  return id.includes('/') ? id : `${prefix}/${id}`
}

export async function getGoogleBusinessLocalPost(targetName: string, credential: string, postId: string) {
  const target = parseGoogleBusinessTarget(targetName)
  const name = resourceName(postId, `${legacyBase(target)}/localPosts`)
  const url = name.startsWith('http') ? name : `https://mybusiness.googleapis.com/v4/${name}`
  return request<Record<string, unknown>>(credential, url)
}

export async function createGoogleBusinessLocalPost(targetName: string, credential: string, body: Record<string, unknown>) {
  const target = parseGoogleBusinessTarget(targetName)
  return request<Record<string, unknown>>(credential, `${legacyBase(target)}/localPosts`, { method: 'POST', body })
}

export async function updateGoogleBusinessLocalPost(targetName: string, credential: string, postId: string, body: Record<string, unknown>, updateMask: string[]) {
  const target = parseGoogleBusinessTarget(targetName)
  const name = postId.includes('/') ? postId : `accounts/${target.accountId}/locations/${target.locationId}/localPosts/${postId}`
  const url = new URL(`https://mybusiness.googleapis.com/v4/${name}`)
  url.searchParams.set('updateMask', updateMask.join(','))
  return request<Record<string, unknown>>(credential, url.toString(), { method: 'PATCH', body: { name, ...body } })
}

export async function deleteGoogleBusinessLocalPost(targetName: string, credential: string, postId: string) {
  const target = parseGoogleBusinessTarget(targetName)
  const name = postId.includes('/') ? postId : `accounts/${target.accountId}/locations/${target.locationId}/localPosts/${postId}`
  return request<Record<string, unknown>>(credential, `https://mybusiness.googleapis.com/v4/${name}`, { method: 'DELETE' })
}

export async function listGoogleBusinessLocalPosts(targetName: string, credential: string) {
  const target = parseGoogleBusinessTarget(targetName)
  const result = await request<{ localPosts?: Record<string, unknown>[] }>(credential, `${legacyBase(target)}/localPosts?pageSize=100`)
  return result.localPosts ?? []
}

export async function getGoogleBusinessReview(targetName: string, credential: string, reviewId: string) {
  const target = parseGoogleBusinessTarget(targetName)
  const name = reviewId.includes('/') ? reviewId : `accounts/${target.accountId}/locations/${target.locationId}/reviews/${reviewId}`
  return request<Record<string, unknown>>(credential, `https://mybusiness.googleapis.com/v4/${name}`)
}

export async function replyToGoogleBusinessReview(targetName: string, credential: string, reviewId: string, comment: string) {
  const target = parseGoogleBusinessTarget(targetName)
  const name = reviewId.includes('/') ? reviewId : `accounts/${target.accountId}/locations/${target.locationId}/reviews/${reviewId}`
  return request<Record<string, unknown>>(credential, `https://mybusiness.googleapis.com/v4/${name}/reply`, { method: 'PUT', body: { comment } })
}

export async function deleteGoogleBusinessReviewReply(targetName: string, credential: string, reviewId: string) {
  const target = parseGoogleBusinessTarget(targetName)
  const name = reviewId.includes('/') ? reviewId : `accounts/${target.accountId}/locations/${target.locationId}/reviews/${reviewId}`
  return request<Record<string, unknown>>(credential, `https://mybusiness.googleapis.com/v4/${name}/reply`, { method: 'DELETE' })
}

export async function listGoogleBusinessReviews(targetName: string, credential: string) {
  const target = parseGoogleBusinessTarget(targetName)
  const result = await request<{ reviews?: Record<string, unknown>[] }>(credential, `${legacyBase(target)}/reviews?pageSize=100&orderBy=updateTime%20desc`)
  return result.reviews ?? []
}

export async function createGoogleBusinessMedia(targetName: string, credential: string, body: Record<string, unknown>) {
  const target = parseGoogleBusinessTarget(targetName)
  return request<Record<string, unknown>>(credential, `${legacyBase(target)}/media`, { method: 'POST', body })
}

export async function getGoogleBusinessMedia(targetName: string, credential: string, mediaName: string) {
  const target = parseGoogleBusinessTarget(targetName)
  const name = mediaName.includes('/') ? mediaName : `accounts/${target.accountId}/locations/${target.locationId}/media/${mediaName}`
  return request<Record<string, unknown>>(credential, `https://mybusiness.googleapis.com/v4/${name}`)
}

export async function listGoogleBusinessMedia(targetName: string, credential: string) {
  const target = parseGoogleBusinessTarget(targetName)
  const result = await request<{ mediaItems?: Record<string, unknown>[] }>(credential, `${legacyBase(target)}/media?pageSize=100`)
  return result.mediaItems ?? []
}
