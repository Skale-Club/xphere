// Customer Match user lists: create, rename, remove, upload (hashed), attach, detach.
//
// Implemented as a CommandHandler (see ../handlers.ts): this module owns its
// command types end to end — snapshot, plan, validate, execute, verify,
// rollback — and is composed over the base google adapter in ../index.ts.
//
// Uploads never see raw PII: the MCP tool / dashboard hash emails and phones
// server-side (src/lib/ads/customer-match.ts) before a command reaches the
// engine, so only SHA-256 digests ever land in the command payload. Nothing
// in this module — diff, warnings, verification observed state — echoes a
// hash count as anything but a count; the digests themselves are never put
// in a diff entry (Google receives them directly in the upload request, not
// through a value this module logs).

import { AdsValidationError } from '../../validation'
import type { AdsCommand, CommandOf } from '../../commands/catalog'
import type { DiffEntry, PlanResult, ResourceSnapshot } from '../../commands/types'
import { googleAdsRequest, mutateResources, parseTokens, runGaqlQuery, type GAdsMutateService } from '../../google-api'
import { criterionIdFromResourceName } from '../google-adapter'
import { diffField, effective, compareFields } from '../diff'
import type { AdapterContext, ExecuteResult, VerifyResult } from '../types'
import type { CommandHandler } from '../handlers'

type CustomerMatchCommand = Extract<
  AdsCommand,
  { type: 'google.user_list.create' | 'google.user_list.rename' | 'google.user_list.remove' | 'google.user_list.upload' | 'google.user_list.attach' | 'google.user_list.detach' }
>

/** Google's offlineUserDataJobs:addOperations request body is capped well above this, but we chunk conservatively. */
const UPLOAD_CHUNK_SIZE = 10_000

function refreshToken(ctx: AdapterContext): string {
  return parseTokens(ctx.credential).refresh_token
}

/** Case/whitespace-insensitive name match, used only in code — never interpolated into GAQL. */
function sameName(a: string | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()
}

/** "customers/1/userLists/456" → "456" (also used for campaigns/adGroups elsewhere). */
function idFromResourceName(resourceName: string | null): string | null {
  const match = resourceName?.match(/\/(\d+)$/)
  return match ? match[1] : null
}

/** "customers/1/userLists/456" → "456", pulled out of ad_group_criterion.user_list.user_list. */
function userListIdFromResourceName(resourceName: string | null | undefined): string | null {
  const match = resourceName?.match(/\/userLists\/(\d+)$/)
  return match ? match[1] : null
}

// ─── GAQL readers ─────────────────────────────────────────────────────────────

type CustomerCurrencyRow = { customer?: { currencyCode?: string } }

async function readCustomerCurrency(ctx: AdapterContext): Promise<CustomerCurrencyRow | null> {
  const rows = await runGaqlQuery<CustomerCurrencyRow>(ctx.adAccountId, refreshToken(ctx), `SELECT customer.currency_code FROM customer LIMIT 1`)
  return rows[0] ?? null
}

type UserListNameRow = { userList: { id: string; name: string; type?: string } }

/** Every CRM-based (Customer Match) list — the "already exists by name" check for create. */
async function listCrmUserLists(ctx: AdapterContext): Promise<UserListNameRow[]> {
  return runGaqlQuery<UserListNameRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT user_list.id, user_list.name, user_list.type FROM user_list WHERE user_list.type = 'CRM_BASED'`,
  )
}

type UserListRow = {
  userList: { id: string; name: string; type?: string; membershipStatus?: string }
  customer?: { currencyCode?: string }
}

async function readUserList(ctx: AdapterContext, userListId: string): Promise<UserListRow | null> {
  const rows = await runGaqlQuery<UserListRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT user_list.id, user_list.name, user_list.type, user_list.membership_status, customer.currency_code
     FROM user_list WHERE user_list.id = ${userListId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type UserListAttachmentRow = { adGroupCriterion: { criterionId: string } }

/** How many (non-removed) ad group criteria target/exclude this list — shown as a warning before a delete. */
async function countUserListAttachments(ctx: AdapterContext, userListId: string): Promise<number> {
  const rows = await runGaqlQuery<UserListAttachmentRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_criterion.criterion_id FROM ad_group_criterion
     WHERE ad_group_criterion.type = 'USER_LIST' AND ad_group_criterion.status != 'REMOVED'
       AND ad_group_criterion.user_list.user_list = 'customers/${ctx.adAccountId}/userLists/${userListId}'`,
  )
  return rows.length
}

type AdGroupRow = { adGroup: { id: string; name: string }; campaign: { id: string }; customer?: { currencyCode?: string } }

async function readAdGroup(ctx: AdapterContext, adGroupId: string): Promise<AdGroupRow | null> {
  const rows = await runGaqlQuery<AdGroupRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group.id, ad_group.name, campaign.id, customer.currency_code
     FROM ad_group WHERE ad_group.id = ${adGroupId} LIMIT 1`,
  )
  return rows[0] ?? null
}

type UserListCriterionRow = {
  adGroupCriterion: { criterionId: string; status: string; negative?: boolean; type?: string; userList?: { userList?: string } }
  adGroup: { id: string; name?: string }
  campaign: { id: string }
  customer?: { currencyCode?: string }
}

/** Every non-removed USER_LIST criterion in an ad group — used to find an existing attachment of a given list. */
async function listUserListCriteria(ctx: AdapterContext, adGroupId: string): Promise<UserListCriterionRow[]> {
  return runGaqlQuery<UserListCriterionRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.negative,
            ad_group_criterion.type, ad_group_criterion.user_list.user_list,
            ad_group.id, ad_group.name, campaign.id, customer.currency_code
     FROM ad_group_criterion
     WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.type = 'USER_LIST' AND ad_group_criterion.status != 'REMOVED'`,
  )
}

async function readUserListCriterion(
  ctx: AdapterContext,
  adGroupId: string,
  criterionId: string,
): Promise<{ adGroup: { id: string; name?: string }; campaign: { id: string }; customer?: { currencyCode?: string }; userListId: string | null; negative: boolean } | null> {
  const rows = await runGaqlQuery<UserListCriterionRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.negative,
            ad_group_criterion.type, ad_group_criterion.user_list.user_list,
            ad_group.id, ad_group.name, campaign.id, customer.currency_code
     FROM ad_group_criterion
     WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.criterion_id = ${criterionId} LIMIT 1`,
  )
  const row = rows[0]
  if (!row || row.adGroupCriterion.type !== 'USER_LIST') return null
  return {
    adGroup: row.adGroup,
    campaign: row.campaign,
    customer: row.customer,
    userListId: userListIdFromResourceName(row.adGroupCriterion.userList?.userList),
    negative: Boolean(row.adGroupCriterion.negative),
  }
}

type OfflineJobStatusRow = { offlineUserDataJob: { status: string; failureReason?: string } }

function isOfflineJobResourceName(value: string): boolean {
  return /^customers\/\d+\/offlineUserDataJobs\/\d+$/.test(value)
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

async function snapshotCustomerMatch(ctx: AdapterContext, cmd: CustomerMatchCommand): Promise<ResourceSnapshot | null> {
  switch (cmd.type) {
    case 'google.user_list.create': {
      const [customerRow, lists] = await Promise.all([readCustomerCurrency(ctx), listCrmUserLists(ctx)])
      const existing = lists.find((l) => sameName(l.userList.name, cmd.name))
      return {
        resourceType: 'user_list',
        resourceId: null,
        resourceName: cmd.name,
        campaignId: null,
        currency: customerRow?.customer?.currencyCode ?? 'USD',
        fields: { existing_user_list_id: existing?.userList.id ?? null },
      }
    }

    case 'google.user_list.rename': {
      const row = await readUserList(ctx, cmd.user_list_id)
      if (!row) return null
      return {
        resourceType: 'user_list',
        resourceId: row.userList.id,
        resourceName: row.userList.name,
        campaignId: null,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: { name: row.userList.name },
      }
    }

    case 'google.user_list.remove': {
      const row = await readUserList(ctx, cmd.user_list_id)
      if (!row) return null
      const attachmentCount = await countUserListAttachments(ctx, cmd.user_list_id)
      return {
        resourceType: 'user_list',
        resourceId: row.userList.id,
        resourceName: row.userList.name,
        campaignId: null,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: { name: row.userList.name, attachment_count: attachmentCount },
      }
    }

    case 'google.user_list.upload': {
      const row = await readUserList(ctx, cmd.user_list_id)
      if (!row) return null
      return {
        resourceType: 'user_list',
        resourceId: row.userList.id,
        resourceName: row.userList.name,
        campaignId: null,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: { name: row.userList.name, type: row.userList.type ?? null, membership_status: row.userList.membershipStatus ?? null },
      }
    }

    case 'google.user_list.attach': {
      const group = await readAdGroup(ctx, cmd.ad_group_id)
      if (!group) return null
      const criteria = await listUserListCriteria(ctx, cmd.ad_group_id)
      const existing = criteria.find((c) => userListIdFromResourceName(c.adGroupCriterion.userList?.userList) === cmd.user_list_id)
      return {
        resourceType: 'ad_group',
        resourceId: null,
        resourceName: `Customer Match list ${cmd.user_list_id} → ${group.adGroup.name}`,
        campaignId: group.campaign.id,
        currency: group.customer?.currencyCode ?? 'USD',
        fields: {
          existing_criterion_id: existing?.adGroupCriterion.criterionId ?? null,
          existing_negative: existing ? Boolean(existing.adGroupCriterion.negative) : null,
        },
      }
    }

    case 'google.user_list.detach': {
      const row = await readUserListCriterion(ctx, cmd.ad_group_id, cmd.criterion_id)
      if (!row) return null
      return {
        resourceType: 'ad_group',
        resourceId: cmd.criterion_id,
        resourceName: `Customer Match list ${row.userListId ?? '?'} → ${row.adGroup.name ?? row.adGroup.id}`,
        campaignId: row.campaign.id,
        currency: row.customer?.currencyCode ?? 'USD',
        fields: { exists: true, user_list_id: row.userListId, exclude: row.negative },
      }
    }

    default:
      return null
  }
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

function planCustomerMatch(cmd: CustomerMatchCommand, before: ResourceSnapshot): PlanResult {
  const f = before.fields
  const warnings: string[] = []

  const done = (intended: Record<string, unknown>, diff: DiffEntry[]): PlanResult => {
    const changes = effective(diff)
    if (changes.length === 0) return { ok: false, code: 'no_op', message: 'The resource already has this value — nothing to change.' }
    return { ok: true, intended, diff: changes, warnings, facts: {} }
  }

  switch (cmd.type) {
    case 'google.user_list.create': {
      if (f.existing_user_list_id) {
        return { ok: false, code: 'already_exists', message: `A Customer Match list named "${cmd.name}" already exists (user list ${f.existing_user_list_id}).` }
      }
      const intended: Record<string, unknown> = { name: cmd.name, membership_status: 'OPEN', membership_life_span: cmd.membership_life_span_days }
      const diff: DiffEntry[] = [
        diffField('name', 'List name', null, cmd.name),
        diffField('membership_life_span', 'Membership duration (days)', null, cmd.membership_life_span_days),
      ]
      if (cmd.description) {
        intended.description = cmd.description
        diff.push(diffField('description', 'Description', null, cmd.description))
      }
      return done(intended, diff)
    }

    case 'google.user_list.rename':
      return done({ name: cmd.name }, [diffField('name', 'List name', f.name, cmd.name)])

    case 'google.user_list.remove': {
      const attachmentCount = Number(f.attachment_count ?? 0)
      if (attachmentCount > 0) {
        warnings.push(`This list is attached to ${attachmentCount} ad group(s) — deleting it removes those targeting/exclusion criteria too. This cannot be undone.`)
      } else {
        warnings.push('Deleting a Customer Match list cannot be undone.')
      }
      return done({ exists: false }, [diffField('user_list', 'Customer Match list', f.name, null)])
    }

    case 'google.user_list.upload': {
      if (f.type !== 'CRM_BASED') {
        return { ok: false, code: 'not_customer_match_list', message: 'This user list is not a Customer Match (CRM-based) list.' }
      }
      if (f.membership_status === 'CLOSED' || f.membership_status === 'REMOVED') {
        return { ok: false, code: 'list_closed', message: `This Customer Match list is ${f.membership_status} and can no longer accept uploads.` }
      }
      warnings.push(
        'Google Ads processes Customer Match uploads asynchronously — a PENDING/RUNNING/SUCCESS status here just means the job was accepted, not that it finished. Check with ads_google_user_list_upload_status.',
      )
      warnings.push('Google cannot confirm ahead of time that this account has accepted the Customer Match Terms of Service — the job fails if it has not.')
      const intended: Record<string, unknown> = {
        hashed_email_count: cmd.hashed_emails.length,
        hashed_phone_count: cmd.hashed_phones.length,
        consent_ad_user_data: cmd.consent_ad_user_data,
        consent_ad_personalization: cmd.consent_ad_personalization,
      }
      // Counts only — never the digests themselves.
      const diff: DiffEntry[] = [
        diffField('hashed_emails', 'Hashed emails to upload', null, cmd.hashed_emails.length),
        diffField('hashed_phones', 'Hashed phones to upload', null, cmd.hashed_phones.length),
      ]
      return done(intended, diff)
    }

    case 'google.user_list.attach': {
      if (f.existing_criterion_id) {
        if (f.existing_negative === cmd.exclude) {
          return {
            ok: false,
            code: 'already_exists',
            message: `This list is already ${cmd.exclude ? 'excluded from' : 'targeted in'} this ad group (criterion ${f.existing_criterion_id}).`,
          }
        }
        return {
          ok: false,
          code: 'exclude_mismatch',
          message: `This list is already attached to this ad group as ${f.existing_negative ? 'an exclusion' : 'a target'} (criterion ${f.existing_criterion_id}) — detach it first before attaching it with the opposite setting.`,
        }
      }
      return done(
        { user_list_id: cmd.user_list_id, negative: cmd.exclude, status: 'ENABLED' },
        [diffField('user_list', cmd.exclude ? 'Excluded Customer Match list' : 'Targeted Customer Match list', null, cmd.user_list_id)],
      )
    }

    case 'google.user_list.detach':
      return done(
        { exists: false },
        [diffField('user_list', f.exclude ? 'Excluded Customer Match list' : 'Targeted Customer Match list', f.user_list_id, null)],
      )

    default:
      return { ok: false, code: 'unsupported_command', message: `${(cmd as { type: string }).type} is not implemented.` }
  }
}

// ─── Operations (create / rename / remove / attach / detach) ──────────────────

function buildOperation(cmd: CustomerMatchCommand, customerId: string): { service: GAdsMutateService; operation: unknown } {
  const c = `customers/${customerId}`
  switch (cmd.type) {
    case 'google.user_list.create':
      return {
        service: 'userLists',
        operation: {
          create: {
            name: cmd.name,
            ...(cmd.description ? { description: cmd.description } : {}),
            membershipStatus: 'OPEN',
            membershipLifeSpan: cmd.membership_life_span_days,
            crmBasedUserList: { uploadKeyType: 'CONTACT_INFO', dataSourceType: 'FIRST_PARTY' },
          },
        },
      }
    case 'google.user_list.rename':
      return {
        service: 'userLists',
        operation: { update: { resourceName: `${c}/userLists/${cmd.user_list_id}`, name: cmd.name }, updateMask: 'name' },
      }
    case 'google.user_list.remove':
      return { service: 'userLists', operation: { remove: `${c}/userLists/${cmd.user_list_id}` } }
    case 'google.user_list.attach':
      return {
        service: 'adGroupCriteria',
        operation: {
          create: {
            adGroup: `${c}/adGroups/${cmd.ad_group_id}`,
            status: 'ENABLED',
            negative: cmd.exclude,
            userList: { userList: `${c}/userLists/${cmd.user_list_id}` },
          },
        },
      }
    case 'google.user_list.detach':
      return { service: 'adGroupCriteria', operation: { remove: `${c}/adGroupCriteria/${cmd.ad_group_id}~${cmd.criterion_id}` } }
    default:
      throw new AdsValidationError(`${(cmd as { type: string }).type} does not build a single-service operation`)
  }
}

/** Pure removes: existence (already proven by snapshot) is the only thing to validate. */
const SKIP_VALIDATE: ReadonlySet<CustomerMatchCommand['type']> = new Set(['google.user_list.remove', 'google.user_list.detach'])

// ─── Upload: the 3-step offline user data job flow ────────────────────────────

async function executeUpload(ctx: AdapterContext, cmd: CommandOf<'google.user_list.upload'>): Promise<string> {
  const c = `customers/${ctx.adAccountId}`

  const createRes = await googleAdsRequest<{ resourceName: string }>(
    `customers/${ctx.adAccountId}/offlineUserDataJobs:create`,
    refreshToken(ctx),
    {
      body: {
        job: {
          type: 'CUSTOMER_MATCH_USER_LIST',
          customerMatchUserListMetadata: {
            userList: `${c}/userLists/${cmd.user_list_id}`,
            consent: { adUserData: cmd.consent_ad_user_data, adPersonalization: cmd.consent_ad_personalization },
          },
        },
      },
    },
  )
  const jobResourceName = createRes.resourceName

  const operations = [
    ...cmd.hashed_emails.map((hashedEmail) => ({ create: { userIdentifiers: [{ hashedEmail }] } })),
    ...cmd.hashed_phones.map((hashedPhoneNumber) => ({ create: { userIdentifiers: [{ hashedPhoneNumber }] } })),
  ]
  for (let i = 0; i < operations.length; i += UPLOAD_CHUNK_SIZE) {
    const chunk = operations.slice(i, i + UPLOAD_CHUNK_SIZE)
    await googleAdsRequest(`${jobResourceName}:addOperations`, refreshToken(ctx), {
      body: { enablePartialFailure: true, operations: chunk },
    })
  }

  await googleAdsRequest(`${jobResourceName}:run`, refreshToken(ctx), { body: {} })
  return jobResourceName
}

async function verifyUpload(ctx: AdapterContext, providerRef: string | null): Promise<VerifyResult> {
  if (!providerRef || !isOfflineJobResourceName(providerRef)) {
    return { ok: false, mismatches: [{ field: 'status', expected: 'PENDING|RUNNING|SUCCESS', actual: null }], observed: null }
  }
  const rows = await runGaqlQuery<OfflineJobStatusRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT offline_user_data_job.status, offline_user_data_job.failure_reason
     FROM offline_user_data_job WHERE offline_user_data_job.resource_name = '${providerRef}'`,
  )
  const row = rows[0]
  if (!row) return { ok: false, mismatches: [{ field: 'status', expected: 'PENDING|RUNNING|SUCCESS', actual: null }], observed: null }
  const status = row.offlineUserDataJob.status
  // The upload is asynchronous: PENDING/RUNNING just means Google accepted the
  // job, not that it finished. Only FAILED counts as a verification mismatch.
  const ok = status === 'PENDING' || status === 'RUNNING' || status === 'SUCCESS'
  return {
    ok,
    mismatches: ok ? [] : [{ field: 'status', expected: 'PENDING|RUNNING|SUCCESS', actual: status }],
    observed: {
      status,
      failure_reason: row.offlineUserDataJob.failureReason ?? null,
      note: 'Customer Match uploads are processed asynchronously by Google; PENDING/RUNNING means the job was accepted, not that it has finished.',
    },
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────────

export const customerMatchHandler: CommandHandler = {
  platform: 'google',
  types: [
    'google.user_list.create',
    'google.user_list.rename',
    'google.user_list.remove',
    'google.user_list.upload',
    'google.user_list.attach',
    'google.user_list.detach',
  ],

  snapshot(ctx, command) {
    return snapshotCustomerMatch(ctx, command as CustomerMatchCommand)
  },

  plan(command, before) {
    return planCustomerMatch(command as CustomerMatchCommand, before)
  },

  async validate(ctx, command) {
    const cmd = command as CustomerMatchCommand
    if (cmd.type === 'google.user_list.upload') {
      // Google has no validate-only for offline user data jobs. The
      // reachable read-only checks (list exists, is CRM_BASED, not closed)
      // already happened in snapshot()/plan(); whether the account accepted
      // the Customer Match Terms of Service can't be checked ahead of a
      // real job, which plan() warns about instead.
      return
    }
    if (SKIP_VALIDATE.has(cmd.type)) return
    const { service, operation } = buildOperation(cmd, ctx.adAccountId)
    await mutateResources(ctx.adAccountId, refreshToken(ctx), service, [operation], { validateOnly: true })
  },

  async execute(ctx, command): Promise<ExecuteResult> {
    const cmd = command as CustomerMatchCommand
    if (cmd.type === 'google.user_list.upload') {
      const jobResourceName = await executeUpload(ctx, cmd)
      return { providerRef: jobResourceName, raw: { jobResourceName } }
    }
    const { service, operation } = buildOperation(cmd, ctx.adAccountId)
    const res = await mutateResources(ctx.adAccountId, refreshToken(ctx), service, [operation])
    return { providerRef: res.results?.[0]?.resourceName ?? null, raw: res }
  },

  async verify(ctx, command, intended, providerRef): Promise<VerifyResult> {
    const cmd = command as CustomerMatchCommand

    if (cmd.type === 'google.user_list.upload') return verifyUpload(ctx, providerRef)

    if (cmd.type === 'google.user_list.remove') {
      const row = await readUserList(ctx, cmd.user_list_id)
      return {
        ok: !row,
        mismatches: row ? [{ field: 'exists', expected: false, actual: true }] : [],
        observed: { exists: Boolean(row) },
      }
    }

    if (cmd.type === 'google.user_list.detach') {
      const row = await readUserListCriterion(ctx, cmd.ad_group_id, cmd.criterion_id)
      return {
        ok: !row,
        mismatches: row ? [{ field: 'exists', expected: false, actual: true }] : [],
        observed: { exists: Boolean(row) },
      }
    }

    if (cmd.type === 'google.user_list.create') {
      const userListId = idFromResourceName(providerRef)
      const row = userListId ? await readUserList(ctx, userListId) : null
      if (!row) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }
      const observed = { name: row.userList.name, membership_status: row.userList.membershipStatus ?? null }
      const mismatches = compareFields({ name: intended.name, membership_status: intended.membership_status }, observed)
      return { ok: mismatches.length === 0, mismatches, observed }
    }

    if (cmd.type === 'google.user_list.rename') {
      const row = await readUserList(ctx, cmd.user_list_id)
      if (!row) return { ok: false, mismatches: [{ field: 'name', expected: intended.name, actual: null }], observed: null }
      const observed = { name: row.userList.name }
      const mismatches = compareFields(intended, observed)
      return { ok: mismatches.length === 0, mismatches, observed }
    }

    // google.user_list.attach
    const criterionId = criterionIdFromResourceName(providerRef)
    const criteria = criterionId ? await listUserListCriteria(ctx, cmd.ad_group_id) : []
    const found = criteria.find((c) => c.adGroupCriterion.criterionId === criterionId)
    if (!found) return { ok: false, mismatches: [{ field: '*', expected: intended, actual: null }], observed: null }
    const observed = {
      user_list_id: userListIdFromResourceName(found.adGroupCriterion.userList?.userList),
      negative: Boolean(found.adGroupCriterion.negative),
    }
    const mismatches = compareFields({ user_list_id: intended.user_list_id, negative: intended.negative }, observed)
    return { ok: mismatches.length === 0, mismatches, observed }
  },

  buildRollback(command, before, providerRef): AdsCommand | null {
    const cmd = command as CustomerMatchCommand
    const f = before.fields
    const base = { platform: 'google' as const, ad_account_id: cmd.ad_account_id }

    switch (cmd.type) {
      case 'google.user_list.rename':
        return typeof f.name === 'string' ? { ...base, type: cmd.type, user_list_id: cmd.user_list_id, name: f.name } : null

      case 'google.user_list.attach': {
        const criterionId = criterionIdFromResourceName(providerRef)
        return criterionId ? { ...base, type: 'google.user_list.detach', ad_group_id: cmd.ad_group_id, criterion_id: criterionId } : null
      }

      case 'google.user_list.detach':
        return typeof f.user_list_id === 'string'
          ? { ...base, type: 'google.user_list.attach', ad_group_id: cmd.ad_group_id, user_list_id: f.user_list_id, exclude: Boolean(f.exclude) }
          : null

      // create: rollback is intentionally null. Undoing a create means
      // deleting the list, which is itself risk 4 (google.user_list.remove)
      // and detaches every ad group/campaign using it — never automatic.
      case 'google.user_list.create':
      // remove: the list (and its membership) is gone; nothing to restore.
      case 'google.user_list.remove':
      // upload: Google has no "remove these uploaded members" job type
      // reachable through this flow, so there is no safe inverse.
      case 'google.user_list.upload':
        return null

      default:
        return null
    }
  },
}
