// MCP tools for Google Business Profile. Reads are org-scoped by hand
// (service-role client). The only write is a PROPOSAL: replies and profile
// edits from an AI land in the change ledger and wait for a person with
// local_seo.approve in Local SEO — an agent can never publish on its own.

import { z } from 'zod'

import { proposeChange } from '@/lib/gbp/commands'
import { generateReplyDraft } from '@/lib/gbp/replies'
import { createServiceRoleClient } from '@/lib/supabase/admin'

import type { McpToolDef } from '../tool-types'

const db = () => createServiceRoleClient()

export const gbpTools: McpToolDef[] = [
  {
    name: 'gbp_list_reviews',
    title: 'List Google reviews',
    description:
      'Google reviews of a Local SEO location connected to Business Profile, newest first. Filter to unreplied or to 1-3 star reviews.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        location_id: z.string().uuid(),
        unreplied_only: z.boolean().optional(),
        max_rating: z.number().int().min(1).max(5).optional(),
        limit: z.number().int().positive().max(100).optional(),
      })
      .strict(),
    handler: async ({ location_id, unreplied_only, max_rating, limit = 25 }, { auth }) => {
      let q = db()
        .from('gbp_reviews')
        .select('id, reviewer_name, rating, comment, create_time, reply_comment, reply_state')
        .eq('org_id', auth.orgId)
        .eq('location_id', location_id)
        .order('create_time', { ascending: false, nullsFirst: false })
        .limit(limit)
      if (unreplied_only) q = q.eq('reply_state', 'none')
      if (max_rating) q = q.lte('rating', max_rating)
      const { data } = await q
      return { reviews: data ?? [] }
    },
  },
  {
    name: 'gbp_create_reply_draft',
    title: 'Draft a review reply',
    description: "Generate an AI reply draft for a Google review in the org's tone. Saves the draft only; nothing is published.",
    area: 'general_xphere',
    inputSchema: z.object({ review_id: z.string().uuid() }).strict(),
    handler: async ({ review_id }, { auth }) => {
      const res = await generateReplyDraft(db(), { orgId: auth.orgId, reviewId: review_id, createdBy: auth.userId })
      if (!res.ok) return { error: 'draft_failed', detail: res.error }
      return { draft_id: res.draftId, text: res.text }
    },
  },
  {
    name: 'gbp_propose_change',
    title: 'Propose a Business Profile change',
    description:
      'Propose a reply to a review or a profile edit (description, website, phone). The change waits for a human ' +
      'approver in Local SEO; tell the operator where to approve it. Never claim it was published.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        location_id: z.string().uuid(),
        reply: z.object({ review_id: z.string().uuid(), text: z.string().min(1).max(4000) }).optional(),
        profile: z
          .object({ description: z.string().max(750).optional(), website: z.string().url().optional(), phone: z.string().max(40).optional() })
          .optional(),
      })
      .strict()
      .refine((v) => !!v.reply !== !!v.profile, { message: 'Pass exactly one of reply or profile.' }),
    handler: async ({ location_id, reply, profile }, { auth }) => {
      const command = reply
        ? ({ type: 'review.reply', reviewId: reply.review_id, comment: reply.text } as const)
        : ({
            type: 'profile.update',
            patch: {
              ...(profile?.description !== undefined ? { description: profile.description } : {}),
              ...(profile?.website !== undefined ? { websiteUri: profile.website } : {}),
              ...(profile?.phone !== undefined ? { primaryPhone: profile.phone } : {}),
            },
          } as const)
      const res = await proposeChange(db(), {
        orgId: auth.orgId,
        locationId: location_id,
        command,
        actor: { type: 'ai', id: auth.userId, label: 'MCP agent' },
      })
      if (!res.ok) return { error: res.code, detail: res.message, status: 422 }
      return {
        change_id: res.change.id,
        status: res.change.status,
        approve_at: `/local-seo/${location_id}/${reply ? 'reviews' : 'profile'}`,
        next_step: 'A person with Local SEO approval rights must approve this change before it reaches Google.',
      }
    },
  },
]
