'use server'

import { z } from 'zod'

import { requireFeature } from '@/lib/billing/guards'
import { businessSearchKey } from '@/lib/local-seo/credentials'
import { requirePermission } from '@/lib/rbac/server'
import { resolveReviewLink } from '@/lib/reviews/resolve-review-link'
import type { ReviewLinkResult } from '@/lib/reviews/review-link'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient, getUser } from '@/lib/supabase/server'

const inputSchema = z.object({
  text: z.string().trim().min(1, 'Paste a Google Maps link or type a business name.').max(2000),
  near: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
})

export async function generateReviewLink(input: z.input<typeof inputSchema>): Promise<ReviewLinkResult> {
  const user = await getUser()
  if (!user) return { kind: 'error', error: 'Not authenticated.' }
  const perm = await requirePermission('reviews.view')
  if (!perm.ok) return { kind: 'error', error: perm.error ?? 'You do not have permission to do this.' }
  const feature = await requireFeature('reviews')
  if (!feature.ok) return { kind: 'error', error: feature.error }

  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { kind: 'error', error: parsed.error.issues[0]?.message ?? 'Invalid input.' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { kind: 'error', error: 'No active organization.' }

  const serpApiKey = await businessSearchKey(createServiceRoleClient(), orgId as string)
  return resolveReviewLink({ text: parsed.data.text, near: parsed.data.near ?? null }, { serpApiKey })
}
