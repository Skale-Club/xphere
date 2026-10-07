// Workflow actions for Google Business Profile. They only PROPOSE: replies,
// posts and profile edits land in the change ledger awaiting someone with
// local_seo.approve (same posture as ads_propose_change). Drafting a reply
// writes nothing to Google.

import { proposeChange } from '@/lib/gbp/commands'
import type { ProfilePatch } from '@/lib/gbp/profile'
import { generateReplyDraft } from '@/lib/gbp/replies'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const WORKFLOW_ACTOR = { type: 'workflow' as const, label: 'Workflow' }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function executeGbpDraftReviewReply(params: Record<string, unknown>, ctx: { organizationId: string }): Promise<string> {
  const reviewId = str(params.review_id)
  if (!reviewId) throw new Error('gbp_draft_review_reply: review_id is required')
  const admin = createServiceRoleClient()
  const draft = await generateReplyDraft(admin, { orgId: ctx.organizationId, reviewId })
  if (!draft.ok) throw new Error(`gbp_draft_review_reply: ${draft.error}`)
  if (params.submit_for_approval === true) {
    const { data: review } = await admin.from('gbp_reviews').select('location_id').eq('id', reviewId).maybeSingle()
    if (review) {
      const res = await proposeChange(admin, {
        orgId: ctx.organizationId,
        locationId: review.location_id,
        command: { type: 'review.reply', reviewId, comment: draft.text, draftId: draft.draftId },
        actor: WORKFLOW_ACTOR,
      })
      if (!res.ok) throw new Error(`gbp_draft_review_reply: ${res.message}`)
      return JSON.stringify({ ok: true, draft_id: draft.draftId, change_id: res.change.id, status: res.change.status, text: draft.text })
    }
  }
  return JSON.stringify({ ok: true, draft_id: draft.draftId, text: draft.text })
}

export async function executeGbpProposePost(params: Record<string, unknown>, ctx: { organizationId: string }): Promise<string> {
  const locationId = str(params.location_id)
  const summary = str(params.summary)
  if (!locationId || !summary) throw new Error('gbp_propose_post: location_id and summary are required')
  const admin = createServiceRoleClient()
  const ctaType = str(params.cta_type)
  const allowedCta = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL']
  const { data: post, error } = await admin
    .from('gbp_posts')
    .insert({
      org_id: ctx.organizationId,
      location_id: locationId,
      summary: summary.slice(0, 1500),
      media_url: str(params.media_url),
      cta_type: ctaType && allowedCta.includes(ctaType) ? (ctaType as 'BOOK') : null,
      cta_url: str(params.cta_url),
      status: 'draft',
    })
    .select('id')
    .single()
  if (error || !post) throw new Error(`gbp_propose_post: ${error?.message ?? 'insert failed'}`)
  const res = await proposeChange(admin, {
    orgId: ctx.organizationId,
    locationId,
    command: { type: 'post.create', postId: post.id },
    actor: WORKFLOW_ACTOR,
  })
  if (!res.ok) throw new Error(`gbp_propose_post: ${res.message}`)
  return JSON.stringify({ ok: true, post_id: post.id, change_id: res.change.id, status: res.change.status })
}

export async function executeGbpProposeProfileChange(params: Record<string, unknown>, ctx: { organizationId: string }): Promise<string> {
  const locationId = str(params.location_id)
  if (!locationId) throw new Error('gbp_propose_profile_change: location_id is required')
  const patch: ProfilePatch = {}
  if ('description' in params) patch.description = str(params.description)
  if ('website' in params) patch.websiteUri = str(params.website)
  if ('phone' in params) patch.primaryPhone = str(params.phone)
  const res = await proposeChange(createServiceRoleClient(), {
    orgId: ctx.organizationId,
    locationId,
    command: { type: 'profile.update', patch },
    actor: WORKFLOW_ACTOR,
  })
  if (!res.ok) {
    if (res.code === 'no_op') return JSON.stringify({ ok: true, skipped: true, reason: res.message })
    throw new Error(`gbp_propose_profile_change: ${res.message}`)
  }
  return JSON.stringify({ ok: true, change_id: res.change.id, status: res.change.status, review_url: `/seo/local/${locationId}/profile` })
}
