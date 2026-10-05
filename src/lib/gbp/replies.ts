import 'server-only'

// AI reply drafts for Google reviews (OpenRouter, the org's key or the
// platform's). A draft is only text: publishing always goes through the
// change ledger, and replies to <= 3 star reviews always wait for a person.

import type { SupabaseClient } from '@supabase/supabase-js'

import { createOpenRouterClient, resolveOpenRouterCredential } from '@/lib/llm/openrouter'
import type { Database } from '@/types/database'

type Admin = SupabaseClient<Database>
type ReviewRow = Database['public']['Tables']['gbp_reviews']['Row']

const MODEL = process.env.GBP_REPLY_MODEL ?? 'anthropic/claude-haiku-4.5'

export type ReplySettings = {
  tone: string
  signature: string | null
  instructions: string | null
  autoReplyPositive: boolean
  autoReplyMinRating: number
}

export async function getReplySettings(admin: Admin, orgId: string): Promise<ReplySettings> {
  const { data } = await admin.from('gbp_reply_settings').select('*').eq('org_id', orgId).maybeSingle()
  return {
    tone: data?.tone ?? 'warm and professional',
    signature: data?.signature ?? null,
    instructions: data?.instructions ?? null,
    autoReplyPositive: data?.auto_reply_positive ?? false,
    autoReplyMinRating: Math.max(4, data?.auto_reply_min_rating ?? 5),
  }
}

export function buildReplyPrompt(input: {
  businessName: string
  review: Pick<ReviewRow, 'rating' | 'comment' | 'reviewer_name'>
  settings: ReplySettings
}): string {
  const { businessName, review, settings } = input
  const lines = [
    `You write the owner's public reply to a Google review of "${businessName}".`,
    `Tone: ${settings.tone}.`,
    'Rules:',
    '- Reply in the same language as the review. If the review has no text, reply in the language of the business name.',
    '- 2 to 4 sentences, under 600 characters. Plain text, no hashtags, no emojis unless the reviewer used them.',
    '- Thank the reviewer by first name when one is given. Mention one specific thing they wrote.',
    '- For 1-3 stars: apologise without admitting legal fault, do not argue, invite them to continue the conversation privately. Never offer refunds or discounts.',
    '- Never invent facts about the business, staff names, prices or policies.',
    '- Do not ask for a better rating.',
  ]
  if (settings.instructions) lines.push(`Business instructions: ${settings.instructions}`)
  if (settings.signature) lines.push(`End with this signature on its own line: ${settings.signature}`)
  lines.push(
    '',
    `Rating: ${review.rating ?? '?'} of 5`,
    `Reviewer: ${review.reviewer_name ?? 'A customer'}`,
    `Review: ${review.comment?.trim() || '(no text, rating only)'}`,
    '',
    'Return only the reply text.',
  )
  return lines.join('\n')
}

export async function generateReplyDraft(
  admin: Admin,
  input: { orgId: string; reviewId: string; createdBy?: string | null },
): Promise<{ ok: true; draftId: string; text: string } | { ok: false; error: string }> {
  const { data: review } = await admin.from('gbp_reviews').select('*').eq('id', input.reviewId).eq('org_id', input.orgId).maybeSingle()
  if (!review) return { ok: false, error: 'Review not found.' }
  const { data: location } = await admin.from('local_seo_locations').select('business_name').eq('id', review.location_id).maybeSingle()
  const settings = await getReplySettings(admin, input.orgId)

  let text: string
  try {
    const credential = await resolveOpenRouterCredential(input.orgId, admin)
    const client = createOpenRouterClient(credential.apiKey)
    const res = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.4,
      messages: [{ role: 'user', content: buildReplyPrompt({ businessName: location?.business_name ?? 'the business', review, settings }) }],
    })
    text = (res.choices[0]?.message?.content ?? '').trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg === 'no_openrouter_key' ? 'No AI key is configured for this organization.' : `AI draft failed: ${msg}` }
  }
  if (!text) return { ok: false, error: 'The AI returned an empty reply.' }
  text = text.replace(/^["']|["']$/g, '').slice(0, 4000)

  const { data: draft, error } = await admin
    .from('gbp_reply_drafts')
    .insert({ org_id: input.orgId, review_id: review.id, draft: text, model: MODEL, source: 'ai', created_by: input.createdBy ?? null })
    .select('id')
    .single()
  if (error || !draft) return { ok: false, error: error?.message ?? 'Could not save the draft.' }
  return { ok: true, draftId: draft.id, text }
}
