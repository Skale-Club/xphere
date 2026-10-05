// Advanced Google Ads controls whose Windsor equivalents are parameters of
// broad update actions. Xphere keeps them as narrow, independently auditable
// commands so each preview has a precise diff and rollback.

import type { AdsCommand, CommandOf } from '../../commands/catalog'
import type { PlanResult, ResourceSnapshot } from '../../commands/types'
import { mutateResources, parseTokens, runGaqlQuery } from '../../google-api'
import { compareFields, diffField, effective } from '../diff'
import type { CommandHandler } from '../handlers'
import type { AdapterContext, ExecuteResult, VerifyResult } from '../types'

type AdvancedGoogleCommand = CommandOf<'google.ad_group.set_rotation_mode'>

type AdGroupRotationRow = {
  adGroup: { id: string; name: string; status?: string; adRotationMode?: string }
  campaign: { id: string }
  customer?: { currencyCode?: string }
}

function refreshToken(ctx: AdapterContext): string {
  return parseTokens(ctx.credential).refresh_token
}

async function readAdGroupRotation(ctx: AdapterContext, adGroupId: string): Promise<AdGroupRotationRow | null> {
  const rows = await runGaqlQuery<AdGroupRotationRow>(
    ctx.adAccountId,
    refreshToken(ctx),
    `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.ad_rotation_mode,
            campaign.id, customer.currency_code
     FROM ad_group WHERE ad_group.id = ${adGroupId} LIMIT 1`,
  )
  return rows[0] ?? null
}

async function snapshot(ctx: AdapterContext, cmd: AdvancedGoogleCommand): Promise<ResourceSnapshot | null> {
  const row = await readAdGroupRotation(ctx, cmd.ad_group_id)
  if (!row) return null
  return {
    resourceType: 'ad_group',
    resourceId: row.adGroup.id,
    resourceName: row.adGroup.name,
    campaignId: row.campaign.id,
    currency: row.customer?.currencyCode ?? 'USD',
    fields: { status: row.adGroup.status ?? null, rotation_mode: row.adGroup.adRotationMode ?? null },
  }
}

function plan(cmd: AdvancedGoogleCommand, before: ResourceSnapshot): PlanResult {
  if (before.fields.status === 'REMOVED') {
    return { ok: false, code: 'resource_removed', message: 'This ad group was removed in Google Ads and cannot be changed.' }
  }
  const diff = effective([diffField('rotation_mode', 'Ad rotation mode', before.fields.rotation_mode, cmd.rotation_mode)])
  if (!diff.length) return { ok: false, code: 'no_op', message: 'The resource already has this value — nothing to change.' }
  return { ok: true, intended: { rotation_mode: cmd.rotation_mode }, diff, warnings: [], facts: {} }
}

function operation(ctx: AdapterContext, cmd: AdvancedGoogleCommand) {
  return {
    update: {
      resourceName: `customers/${ctx.adAccountId}/adGroups/${cmd.ad_group_id}`,
      adRotationMode: cmd.rotation_mode,
    },
    updateMask: 'adRotationMode',
  }
}

export const advancedGoogleHandler: CommandHandler = {
  platform: 'google',
  types: ['google.ad_group.set_rotation_mode'],

  snapshot(ctx, command) {
    return snapshot(ctx, command as AdvancedGoogleCommand)
  },

  plan(command, before) {
    return plan(command as AdvancedGoogleCommand, before)
  },

  async validate(ctx, command) {
    const cmd = command as AdvancedGoogleCommand
    await mutateResources(ctx.adAccountId, refreshToken(ctx), 'adGroups', [operation(ctx, cmd)], { validateOnly: true })
  },

  async execute(ctx, command): Promise<ExecuteResult> {
    const cmd = command as AdvancedGoogleCommand
    const res = await mutateResources(ctx.adAccountId, refreshToken(ctx), 'adGroups', [operation(ctx, cmd)])
    return { providerRef: res.results?.[0]?.resourceName ?? null, raw: res }
  },

  async verify(ctx, command, intended): Promise<VerifyResult> {
    const cmd = command as AdvancedGoogleCommand
    const row = await readAdGroupRotation(ctx, cmd.ad_group_id)
    if (!row) return { ok: false, mismatches: [{ field: 'rotation_mode', expected: intended.rotation_mode, actual: null }], observed: null }
    const observed = { rotation_mode: row.adGroup.adRotationMode ?? null }
    const mismatches = compareFields(intended, observed)
    return { ok: mismatches.length === 0, mismatches, observed }
  },

  buildRollback(command, before): AdsCommand | null {
    const cmd = command as AdvancedGoogleCommand
    const previous = before.fields.rotation_mode
    if (previous !== 'OPTIMIZE' && previous !== 'ROTATE_INDEFINITELY') return null
    return { platform: 'google', ad_account_id: cmd.ad_account_id, type: cmd.type, ad_group_id: cmd.ad_group_id, rotation_mode: previous }
  },
}
