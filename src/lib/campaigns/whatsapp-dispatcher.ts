/**
 * Campaign dispatcher for WhatsApp Cloud (template-based outbound).
 *
 *   1. Resolves the active Cloud account for the org (fails if absent)
 *   2. Resolves the campaign's template (fails if status != APPROVED)
 *   3. Iterates recipients with status='pending' in small batches
 *   4. Per recipient:
 *      - DND check (`contact.dnd_enabled` + 'whatsapp' channel)
 *      - Opt-in check (MARKETING templates only)
 *      - Resolves variable mapping → strings
 *      - POST /{phone-number-id}/messages
 *      - Updates row: status='sent' + wamid + cost_usd + message_type,
 *        or status='failed' + error_message, or status='skipped'
 *   5. When all recipients are terminal → campaigns.status = 'completed'
 *
 * Naive rate-limit: small batches with a setTimeout between them. Meta's
 * Coexistence cap is 5 msg/s and the entry-tier Cloud cap is 80 msg/s. We
 * stay well under either.
 */

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getActiveCloudAccount } from '@/lib/whatsapp/cloud/resolve-account'
import { sendCloudTemplate } from '@/lib/whatsapp/cloud/send-template'
import { resolveVariables, type VariableMapping, type ContactShape } from '@/lib/whatsapp/cloud/variable-resolver'
import { estimateCost, templateCategoryToCost } from '@/lib/whatsapp/cloud/pricing'

// NOTE on serverless timeout (Vercel):
//   This dispatcher is invoked via `after()` in the /api/campaigns/[id]/start
//   route. The function's wall-clock budget is bounded by the route's
//   maxDuration (60s default on Pro; configurable up to 300s).
//
//   With BATCH_SIZE=20 and BATCH_DELAY_MS=1500, we can process roughly:
//     - 60s budget  → ~800 recipients per launch
//     - 300s budget → ~4000 recipients per launch
//
//   For larger campaigns the dispatcher leaves the remaining recipients in
//   status='pending', and a cron / re-invocation can pick them up later
//   (campaigns.status is only marked 'completed' when zero pending remain).
//   A future iteration should move this to a Supabase Edge Function or a
//   proper job queue; for v1 the run-and-resume model is acceptable.
const BATCH_SIZE = 20
const BATCH_DELAY_MS = 1_500

export interface DispatchResult {
  ok: boolean
  error?: string
  processed: number
  sent: number
  failed: number
  skipped: number
}

export async function startWhatsAppCampaign(campaignId: string): Promise<DispatchResult> {
  const supabase = createServiceRoleClient()

  // 1. Load campaign + template
  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, organization_id, channel, whatsapp_template_id, whatsapp_variable_mapping, status')
    .eq('id', campaignId)
    .maybeSingle()

  if (campErr || !campaign) {
    return { ok: false, error: 'Campaign not found', processed: 0, sent: 0, failed: 0, skipped: 0 }
  }
  if (campaign.channel !== 'whatsapp') {
    return { ok: false, error: 'Campaign is not a WhatsApp campaign', processed: 0, sent: 0, failed: 0, skipped: 0 }
  }
  if (!campaign.whatsapp_template_id) {
    return { ok: false, error: 'Campaign has no template selected', processed: 0, sent: 0, failed: 0, skipped: 0 }
  }

  const account = await getActiveCloudAccount(campaign.organization_id)
  if (!account) {
    return { ok: false, error: 'No active WhatsApp Cloud account', processed: 0, sent: 0, failed: 0, skipped: 0 }
  }

  const { data: template } = await supabase
    .from('whatsapp_templates')
    .select('name, language, category, status, body_variable_count, header_variable_count')
    .eq('id', campaign.whatsapp_template_id)
    .maybeSingle()

  if (!template) {
    return { ok: false, error: 'Template not found', processed: 0, sent: 0, failed: 0, skipped: 0 }
  }
  if (template.status !== 'APPROVED') {
    return { ok: false, error: `Template is ${template.status}, must be APPROVED`, processed: 0, sent: 0, failed: 0, skipped: 0 }
  }

  const mapping = (campaign.whatsapp_variable_mapping ?? null) as VariableMapping | null
  const isMarketing = template.category === 'MARKETING'

  // Update campaign to running if currently draft/scheduled
  await supabase.from('campaigns').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', campaignId)

  // 2. Process recipients in batches
  let processed = 0
  let sent = 0
  let failed = 0
  let skipped = 0

  while (true) {
    const { data: batch } = await supabase
      .from('campaign_recipients')
      .select('id, contact_id, status')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .limit(BATCH_SIZE)

    if (!batch || batch.length === 0) break

    const contactIds = batch.map((r) => r.contact_id).filter((id): id is string => Boolean(id))
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, name, email, phone, company, custom_fields, dnd_enabled, dnd_channels, whatsapp_opt_in')
      .in('id', contactIds.length > 0 ? contactIds : ['00000000-0000-0000-0000-000000000000'])

    const contactMap = new Map((contacts ?? []).map((c) => [c.id, c]))

    for (const recipient of batch) {
      processed += 1
      const contact = recipient.contact_id ? contactMap.get(recipient.contact_id) : null
      if (!contact || !contact.phone) {
        await markSkipped(recipient.id, 'Contact missing or no phone')
        skipped += 1
        continue
      }

      // DND
      if (contact.dnd_enabled && Array.isArray(contact.dnd_channels) && (contact.dnd_channels.includes('whatsapp') || contact.dnd_channels.includes('all'))) {
        await markSkipped(recipient.id, 'Contact opted out (DND)')
        skipped += 1
        continue
      }

      // Opt-in for MARKETING
      if (isMarketing && !contact.whatsapp_opt_in) {
        await markSkipped(recipient.id, 'No opt-in for marketing')
        skipped += 1
        continue
      }

      // Resolve variables
      const shape: ContactShape = {
        first_name: contact.first_name ?? null,
        last_name: contact.last_name ?? null,
        name: contact.name ?? null,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        company: contact.company ?? null,
        custom_fields: (contact.custom_fields as Record<string, unknown> | null) ?? null,
      }
      const vars = resolveVariables(mapping, shape)

      // Validate variable counts match template expectations
      if (vars.body.length !== template.body_variable_count || vars.header.length !== template.header_variable_count) {
        await markFailed(recipient.id, `Variable count mismatch (body ${vars.body.length}/${template.body_variable_count}, header ${vars.header.length}/${template.header_variable_count})`)
        failed += 1
        continue
      }

      const res = await sendCloudTemplate({
        account,
        to: contact.phone,
        templateName: template.name,
        language: template.language,
        bodyVariables: vars.body,
        headerVariables: vars.header,
      })

      if (res.ok) {
        const category = templateCategoryToCost(template.category)
        const country = guessCountryFromE164(contact.phone)
        const cost = estimateCost(category, country)
        await supabase
          .from('campaign_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            wamid: res.wamid,
            cost_usd: cost,
            message_type: category,
            updated_at: new Date().toISOString(),
          })
          .eq('id', recipient.id)
        sent += 1
      } else {
        await markFailed(recipient.id, `${res.error}${res.code ? ` (code ${res.code})` : ''}`)
        failed += 1
      }
    }

    // Naive rate-limit between batches
    await sleep(BATCH_DELAY_MS)
  }

  // 3. Mark campaign completed if no pending remain
  const { count: pendingLeft } = await supabase
    .from('campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')

  if ((pendingLeft ?? 0) === 0) {
    await supabase
      .from('campaigns')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', campaignId)
  }

  return { ok: true, processed, sent, failed, skipped }

  // ── helpers ──
  async function markSkipped(id: string, reason: string) {
    await supabase
      .from('campaign_recipients')
      .update({ status: 'skipped', error_message: reason, updated_at: new Date().toISOString() })
      .eq('id', id)
  }
  async function markFailed(id: string, reason: string) {
    await supabase
      .from('campaign_recipients')
      .update({ status: 'failed', error_message: reason, updated_at: new Date().toISOString() })
      .eq('id', id)
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Best-effort country code lookup from E.164 first 1-3 digits. */
function guessCountryFromE164(e164: string | null): string {
  if (!e164) return ''
  const digits = e164.replace(/\D/g, '')
  if (digits.startsWith('55')) return 'br'
  if (digits.startsWith('1')) return 'us'
  if (digits.startsWith('91')) return 'in'
  if (digits.startsWith('52')) return 'mx'
  return ''
}
