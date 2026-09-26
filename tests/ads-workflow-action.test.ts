import { beforeEach, describe, expect, it, vi } from 'vitest'

// The workflow action is the automation door into the Ads Command Engine. What
// it must guarantee: only low-risk commands get through, the actor is always a
// `workflow` (so the policy demands human approval), and re-running on the
// same condition is harmless.

const previewMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ads/commands/engine', () => ({ previewChange: previewMock }))

import { executeAdsProposeChange, WORKFLOW_MAX_RISK } from '@/lib/action-engine/executors/ads-propose-change'
import { COMMAND_CATALOG } from '@/lib/ads/commands/catalog'

const PAUSE = {
  platform: 'google',
  ad_account_id: '1234567890',
  type: 'google.campaign.set_status',
  campaign_id: '111',
  status: 'PAUSED',
}

const change = {
  id: 'chg-1',
  status: 'awaiting_approval',
  label: 'Set campaign status',
  resource_name: 'Brand',
  resource_id: '111',
  diff: [{ label: 'Status', beforeDisplay: 'ENABLED', afterDisplay: 'PAUSED' }],
  warnings: [],
}

beforeEach(() => {
  previewMock.mockReset()
  previewMock.mockResolvedValue({ ok: true, change, duplicate: false })
})

describe('ads_propose_change workflow action', () => {
  it('previews a low-risk command as a workflow actor and returns the change id', async () => {
    const out = JSON.parse(await executeAdsProposeChange({ command: PAUSE }, { organizationId: 'org-1' }))

    expect(out).toMatchObject({ ok: true, change_id: 'chg-1', status: 'awaiting_approval' })
    const args = previewMock.mock.calls[0][0]
    expect(args.orgId).toBe('org-1')
    expect(args.actor.type).toBe('workflow')
    expect(args.actor.canApprove).toBe(false)
  })

  it('refuses commands above the workflow risk ceiling before touching the engine', async () => {
    const bid = { platform: 'google', ad_account_id: '1234567890', type: 'google.ad_group.set_cpc_bid', ad_group_id: '5', cpc_bid: 2 }
    expect(COMMAND_CATALOG['google.ad_group.set_cpc_bid'].risk).toBeGreaterThan(WORKFLOW_MAX_RISK)

    await expect(executeAdsProposeChange({ command: bid }, { organizationId: 'org-1' })).rejects.toThrow(/risk 3/)
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('rejects a malformed command with the offending field named', async () => {
    await expect(
      executeAdsProposeChange({ command: { ...PAUSE, campaign_id: 'abc' } }, { organizationId: 'org-1' }),
    ).rejects.toThrow(/campaign_id/)
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('treats "already at the target value" as a skip, so a re-run is harmless', async () => {
    previewMock.mockResolvedValue({ ok: false, code: 'no_op', message: 'already paused' })
    const out = JSON.parse(await executeAdsProposeChange({ command: PAUSE }, { organizationId: 'org-1' }))
    expect(out).toMatchObject({ ok: true, skipped: true })
  })

  it('surfaces a policy block as a failure', async () => {
    previewMock.mockResolvedValue({ ok: false, code: 'policy_blocked', message: 'AI read only' })
    await expect(executeAdsProposeChange({ command: PAUSE }, { organizationId: 'org-1' })).rejects.toThrow(/policy_blocked/)
  })

  it('passes a caller idempotency key through, ignoring one too short to be safe', async () => {
    await executeAdsProposeChange({ command: PAUSE, idempotency_key: 'run-42-pause-brand' }, { organizationId: 'org-1' })
    await executeAdsProposeChange({ command: PAUSE, idempotency_key: 'x' }, { organizationId: 'org-1' })
    expect(previewMock.mock.calls[0][0].idempotencyKey).toBe('run-42-pause-brand')
    expect(previewMock.mock.calls[1][0].idempotencyKey).toBeUndefined()
  })
})
