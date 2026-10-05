import 'server-only'

// Local SEO's view of a Business Profile change that just settled in the Ads
// Command Engine ledger (ads_change_requests). The engine calls this on every
// terminal status of a google_business change, whichever surface proposed it,
// so review reply state, reply drafts, post status and the chart annotations
// never disagree with what actually happened on Google.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

type ChangeRow = Database['public']['Tables']['ads_change_requests']['Row']

type Payload = {
  type: string
  ad_account_id: string
  review_id?: string
  comment?: string
  post_id?: string
  summary?: string
}

const LOCATION_LABEL: Record<string, string> = {
  'google_business.location.update_info': 'description, website or phone',
  'google_business.location.set_regular_hours': 'opening hours',
  'google_business.location.set_special_hours': 'special hours',
  'google_business.location.update_categories': 'categories',
  'google_business.location.update_service_items': 'services',
  'google_business.location.update_service_area': 'service area',
  'google_business.location.update_attributes': 'attributes',
  'google_business.location.update_address': 'address',
  'google_business.location.set_open_status': 'open status',
}

async function linkedLocationIds(admin: ReturnType<typeof createServiceRoleClient>, orgId: string, target: string): Promise<string[]> {
  const [accountName, locationId] = target.split('/locations/')
  if (!accountName || !locationId) return []
  const { data } = await admin
    .from('local_seo_locations')
    .select('id')
    .eq('org_id', orgId)
    .eq('gbp_account_name', accountName)
    .eq('gbp_location_name', `locations/${locationId}`)
  return (data ?? []).map((l) => l.id)
}

export async function onBusinessProfileChangeSettled(row: ChangeRow): Promise<void> {
  const admin = createServiceRoleClient()
  const command = row.payload as unknown as Payload
  // drifted = Google accepted the write but reads back something else; it landed.
  const landed = row.status === 'succeeded' || row.status === 'drifted'
  const now = new Date().toISOString()
  const reason = row.error_message ?? (row.status === 'expired' ? 'The approval window passed.' : `Change ${row.status}.`)

  switch (command.type) {
    case 'google_business.review.reply': {
      if (landed) {
        await admin
          .from('gbp_reviews')
          .update({ reply_comment: command.comment ?? null, reply_update_time: now, reply_state: 'replied', updated_at: now })
          .eq('org_id', row.org_id)
          .eq('review_name', command.review_id!)
        const { data: linked } = await admin
          .from('gbp_reply_drafts')
          .update({ status: 'sent', sent_at: now, error: null })
          .eq('change_request_id', row.id)
          .select('id')
        if (!linked?.length) {
          // A retry from Ads → Changes is a new, unlinked change: adopt the
          // failed draft of the same review.
          const { data: rev } = await admin.from('gbp_reviews').select('id').eq('org_id', row.org_id).eq('review_name', command.review_id!).maybeSingle()
          if (rev) {
            await admin
              .from('gbp_reply_drafts')
              .update({ status: 'sent', sent_at: now, error: null, change_request_id: row.id })
              .eq('org_id', row.org_id)
              .eq('review_id', rev.id)
              .eq('status', 'failed')
          }
        }
      } else {
        await admin
          .from('gbp_reply_drafts')
          .update({ status: row.status === 'cancelled' ? 'rejected' : 'failed', error: row.status === 'cancelled' ? null : reason.slice(0, 500) })
          .eq('change_request_id', row.id)
        await admin
          .from('gbp_reviews')
          .update({ reply_state: 'none' })
          .eq('org_id', row.org_id)
          .eq('review_name', command.review_id!)
          .eq('reply_state', 'pending')
      }
      return
    }

    case 'google_business.review.delete_reply': {
      if (landed) {
        await admin
          .from('gbp_reviews')
          .update({ reply_comment: null, reply_update_time: null, reply_state: 'none', updated_at: now })
          .eq('org_id', row.org_id)
          .eq('review_name', command.review_id!)
      }
      return
    }

    case 'google_business.local_post.create': {
      let { data: posts } = await admin
        .from('gbp_posts')
        .select('id, summary, location_id')
        .eq('change_request_id', row.id)
      if (!posts?.length && landed) {
        // A retry from Ads → Changes is a new, unlinked change: adopt the
        // failed post with the same text on this profile.
        const locations = await linkedLocationIds(admin, row.org_id, command.ad_account_id)
        const { data: orphans } = locations.length
          ? await admin
              .from('gbp_posts')
              .select('id, summary, location_id')
              .eq('org_id', row.org_id)
              .in('location_id', locations)
              .in('status', ['failed', 'publishing'])
              .eq('summary', command.summary ?? '')
          : { data: [] }
        posts = orphans ?? []
        for (const post of posts) await admin.from('gbp_posts').update({ change_request_id: row.id }).eq('id', post.id)
      }
      if (landed) {
        for (const post of posts ?? []) {
          await admin
            .from('gbp_posts')
            .update({ status: 'live', post_name: row.provider_ref, published_at: now, error: null })
            .eq('id', post.id)
        }
        const title = `Post: ${(posts?.[0]?.summary ?? row.resource_name ?? 'published').slice(0, 80)}`
        for (const locationId of await linkedLocationIds(admin, row.org_id, command.ad_account_id)) {
          await admin.from('local_seo_annotations').insert({ org_id: row.org_id, location_id: locationId, occurred_at: now, kind: 'post', title, ref_id: row.id })
        }
      } else {
        for (const post of posts ?? []) {
          await admin
            .from('gbp_posts')
            .update(row.status === 'cancelled' ? { status: 'draft', error: null } : { status: 'failed', error: reason.slice(0, 500) })
            .eq('id', post.id)
        }
      }
      return
    }

    case 'google_business.local_post.delete': {
      if (landed) {
        await admin.from('gbp_posts').update({ status: 'deleted' }).eq('org_id', row.org_id).eq('post_name', command.post_id!)
      }
      return
    }

    default: {
      const what = LOCATION_LABEL[command.type]
      if (!landed || !what) return
      for (const locationId of await linkedLocationIds(admin, row.org_id, command.ad_account_id)) {
        await admin.from('local_seo_annotations').insert({
          org_id: row.org_id,
          location_id: locationId,
          occurred_at: now,
          kind: 'profile_change',
          title: `Profile: ${what} updated`,
          ref_id: row.id,
        })
      }
    }
  }
}
