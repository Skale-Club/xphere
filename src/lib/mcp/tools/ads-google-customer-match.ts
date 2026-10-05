// MCP tools for Google Ads Customer Match — reads plus the one write entry
// point (upload), which goes through the Ads Command Engine like every other
// change (see src/lib/mcp/tools/ads-control.ts for the general preview →
// approve flow this follows).
//
// ads_google_prepare_customer_match_upload is the only tool here that turns
// contacts into a command: it hashes raw emails/phones/addresses (or contacts read
// from the org's own CRM by tag) server-side with the same normalise+SHA-256
// helpers the dashboard uses (src/lib/ads/customer-match.ts), then previews a
// google.user_list.upload command. Raw addresses/numbers and their hashes
// never appear in the tool's response — only accepted/rejected counts — and
// raw values never reach the change ledger (the command schema accepts only
// normalized SHA-256 identifiers).

import { z } from 'zod'

import { mcpActor } from '@/lib/ads/commands/actors'
import { previewChange, type EngineFailure, type PreviewSuccess } from '@/lib/ads/commands/engine'
import { loadEffectivePolicy } from '@/lib/ads/commands/policies'
import { resolveAdAccount } from '@/lib/ads/ai-accounts'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import { hashContacts } from '@/lib/ads/customer-match'
import { parseTokens, runGaqlQuery } from '@/lib/ads/google-api'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { McpToolDef } from '../tool-types'

const ConsentSchema = z.enum(['GRANTED', 'DENIED', 'UNSPECIFIED'])

function failure(result: EngineFailure) {
  return {
    error: result.code,
    detail: result.message,
    ...(result.violations ? { violations: result.violations.map((v) => v.message) } : {}),
  }
}

/** Same shape as ads-control.ts's preview response, minus anything about the uploaded contacts themselves. */
async function uploadPreviewResponse(
  orgId: string,
  result: PreviewSuccess | EngineFailure,
  counts: { accepted: number; rejected: number; optedOut?: number },
) {
  if (!result.ok) return failure(result)
  const { change } = result
  const policy = await loadEffectivePolicy(orgId, change.platform, change.ad_account_id)
  const nextStep =
    change.status !== 'awaiting_approval'
      ? `This change is already ${change.status}.`
      : policy.aiMode === 'execute_with_confirmation'
        ? 'Show the operator accepted/rejected counts and the warnings above and ask them to confirm. Only after an explicit yes, call ads_approve_change with change_id and confirmation_token. Never approve on your own initiative.'
        : 'This account requires a human to approve AI-proposed changes. Tell the operator the upload is waiting in Xphere → Ads → Changes; do not try to approve it yourself.'
  return {
    change_id: change.id,
    status: change.status,
    ad_account_id: change.ad_account_id,
    user_list_id: (change.command as { user_list_id?: string }).user_list_id ?? null,
    accepted_contacts: counts.accepted,
    rejected_contacts: counts.rejected,
    /** CRM contacts skipped because they opted out of all contact (DND "all"). */
    opted_out_skipped: counts.optedOut ?? 0,
    diff: change.diff.map((d) => ({ field: d.label, before: d.beforeDisplay, after: d.afterDisplay })),
    warnings: change.warnings,
    approval_required: change.approval_required,
    approval_reasons: change.approval_reasons.map((r) => r.message),
    confirmation_token: result.confirmationToken ?? null,
    ai_mode: policy.aiMode,
    next_step: nextStep,
  }
}

type UserListRow = {
  userList: {
    id: string
    name: string
    membershipStatus?: string
    sizeForSearch?: string
    sizeForDisplay?: string
    matchRatePercentage?: number
  }
}

type OfflineJobStatusRow = { offlineUserDataJob: { status: string; failureReason?: string } }

export const adsGoogleCustomerMatchTools: McpToolDef[] = [
  {
    name: 'ads_google_list_user_lists',
    title: 'List Google Ads Customer Match lists',
    description:
      'Customer Match (CRM-based) user lists for the account: id, name, membership status, list size for Search/Display and match rate. Use to find user_list_id values for google.user_list.* commands and for ads_google_prepare_customer_match_upload.',
    area: 'general_xphere',
    inputSchema: z.object({ customer_id: z.string().optional() }).strict(),
    handler: async ({ customer_id }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const rows = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, () =>
          runGaqlQuery<UserListRow>(
            conn.accountId,
            parseTokens(conn.token).refresh_token,
            `SELECT user_list.id, user_list.name, user_list.membership_status, user_list.size_for_search,
                    user_list.size_for_display, user_list.match_rate_percentage
             FROM user_list WHERE user_list.type = 'CRM_BASED'`,
          ),
        )
        return {
          customer_id: conn.accountId,
          user_lists: rows.map((r) => ({
            user_list_id: r.userList.id,
            name: r.userList.name,
            membership_status: r.userList.membershipStatus ?? null,
            size_for_search: r.userList.sizeForSearch != null ? Number(r.userList.sizeForSearch) : null,
            size_for_display: r.userList.sizeForDisplay != null ? Number(r.userList.sizeForDisplay) : null,
            match_rate_percentage: r.userList.matchRatePercentage ?? null,
          })),
        }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  {
    name: 'ads_google_user_list_upload_status',
    title: 'Get a Customer Match upload job status',
    description:
      'Status of an offline user data job created by a google.user_list.upload change (PENDING, RUNNING, SUCCESS or FAILED, plus failure_reason). Uploads are processed asynchronously by Google — PENDING/RUNNING is normal right after approval. Pass the job resource name from the change (see ads_get_change_status verification.observed, or the raw execute result).',
    area: 'general_xphere',
    inputSchema: z
      .object({
        customer_id: z.string().optional(),
        job_resource_name: z.string().regex(/^customers\/\d+\/offlineUserDataJobs\/\d+$/, 'Must look like customers/{id}/offlineUserDataJobs/{id}'),
      })
      .strict(),
    handler: async ({ customer_id, job_resource_name }, { auth }) => {
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }
      try {
        const rows = await withConnectionHealth({ orgId: auth.orgId, platform: 'google', adAccountId: conn.accountId }, () =>
          runGaqlQuery<OfflineJobStatusRow>(
            conn.accountId,
            parseTokens(conn.token).refresh_token,
            `SELECT offline_user_data_job.status, offline_user_data_job.failure_reason
             FROM offline_user_data_job WHERE offline_user_data_job.resource_name = '${job_resource_name}'`,
          ),
        )
        const row = rows[0]
        if (!row) return { error: 'not_found', detail: 'No offline user data job with that resource name on this account.' }
        return {
          customer_id: conn.accountId,
          job_resource_name,
          status: row.offlineUserDataJob.status,
          failure_reason: row.offlineUserDataJob.failureReason ?? null,
        }
      } catch (e) {
        return { error: 'google_api_error', detail: e instanceof Error ? e.message : 'Unknown error' }
      }
    },
  },

  {
    name: 'ads_google_prepare_customer_match_upload',
    title: 'Hash contacts and preview a Customer Match upload',
    description:
      'Turn raw contacts into a Customer Match add/remove job: give emails, phones or complete postal identities directly, or a crm_tag to pull contacts already tagged in the Xphere CRM (org-scoped). Contacts are normalised and SHA-256 hashed here on the server — this tool NEVER returns raw values or hashes, only accepted/rejected counts. Previews a google.user_list.upload change the same way ads_preview_change does: show the operator the counts and warnings, then ads_approve_change with the confirmation_token after they agree.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: z
      .object({
        customer_id: z.string().optional(),
        user_list_id: z.string().min(1).max(20).regex(/^\d+$/, 'Must be a numeric id'),
        emails: z.array(z.string()).max(10_000).optional(),
        phones: z.array(z.string()).max(10_000).optional(),
        addresses: z.array(z.object({
          first_name: z.string().min(1),
          last_name: z.string().min(1),
          country_code: z.string().length(2),
          postal_code: z.string().min(1).max(20),
        }).strict()).max(10_000).optional(),
        operation_type: z.enum(['ADD', 'REMOVE']).default('ADD'),
        /** Pull contacts with this tag from the org's own CRM instead of (or in addition to) emails/phones. */
        crm_tag: z.string().trim().min(1).max(100).optional(),
        /** ISO 3166-1 alpha-2, used only for phones with no country code of their own. */
        default_country: z.string().length(2).optional(),
        consent_ad_user_data: ConsentSchema.default('UNSPECIFIED'),
        consent_ad_personalization: ConsentSchema.default('UNSPECIFIED'),
      })
      .strict(),
    handler: async ({ customer_id, user_list_id, emails, phones, addresses, operation_type, crm_tag, default_country, consent_ad_user_data, consent_ad_personalization }, { auth }) => {
      if (!emails?.length && !phones?.length && !addresses?.length && !crm_tag) {
        return { error: 'no_contacts', detail: 'Provide emails, phones and/or complete addresses, or crm_tag to pull contacts from the CRM.' }
      }
      const conn = await resolveAdAccount(auth.orgId, 'google', customer_id)
      if (!conn.ok) return { error: conn.error, detail: conn.detail, available_accounts: conn.available }

      const rawEmails = [...(emails ?? [])]
      const rawPhones = [...(phones ?? [])]
      let optedOut = 0

      if (crm_tag) {
        const { data, error } = await createServiceRoleClient()
          .from('contacts')
          .select('email, phone_e164, phone, dnd_channels')
          .eq('org_id', auth.orgId)
          .contains('tags', [crm_tag])
        if (error) return { error: 'crm_read_error', detail: error.message }
        for (const row of data ?? []) {
          // A contact who opted out of everything must not be uploaded for ad
          // targeting either — Customer Match is still using their data.
          if ((row.dnd_channels ?? []).includes('all')) {
            optedOut++
            continue
          }
          if (row.email) rawEmails.push(row.email)
          const phone = row.phone_e164 ?? row.phone
          if (phone) rawPhones.push(phone)
        }
        if (!data?.length) {
          return { error: 'no_contacts', detail: `No contacts in the CRM are tagged "${crm_tag}".` }
        }
      }

      // Hashing happens here, once, before anything else touches the
      // contacts — the raw values go out of scope right after this call.
      const { hashed_emails, hashed_phones, hashed_addresses, rejected } = hashContacts({
        emails: rawEmails,
        phones: rawPhones,
        addresses,
        defaultCountry: default_country,
      })
      const accepted = hashed_emails.length + hashed_phones.length + hashed_addresses.length
      if (accepted === 0) {
        return { error: 'no_valid_contacts', detail: 'None of the given contacts normalised to a valid email, E.164 phone number, or complete postal address.', rejected }
      }

      const result = await previewChange({
        orgId: auth.orgId,
        actor: mcpActor(auth),
        command: {
          platform: 'google',
          ad_account_id: conn.accountId,
          type: 'google.user_list.upload',
          user_list_id,
          hashed_emails,
          hashed_phones,
          ...(hashed_addresses.length > 0 ? { hashed_addresses } : {}),
          ...(operation_type !== undefined ? { operation_type } : {}),
          consent_ad_user_data,
          consent_ad_personalization,
        },
      })
      return uploadPreviewResponse(auth.orgId, result, { accepted, rejected, optedOut })
    },
  },
]
