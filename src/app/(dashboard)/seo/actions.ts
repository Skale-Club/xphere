'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { assertWritableOrThrow } from '@/lib/demo/guard'
import { requirePermission } from '@/lib/rbac/server'
import { requireFeature } from '@/lib/billing/guards'
import { parseSiteInput } from '@/lib/seo/url'
import { MAX_PAGES_OPTIONS } from '@/lib/seo/constants'
import type { Database } from '@/types/database'

type SiteRow = Database['public']['Tables']['seo_sites']['Row']

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data })
const err = (error: string): ActionResult<never> => ({ ok: false, error })

const scheduleSchema = z.enum(['off', 'weekly', 'monthly'])
const maxPagesSchema = z.coerce
  .number()
  .int()
  .refine((n) => (MAX_PAGES_OPTIONS as readonly number[]).includes(n), 'Unsupported page limit')

const createSiteSchema = z.object({
  url: z.string().trim().min(3).max(500),
  name: z.string().trim().max(120).optional(),
  schedule: scheduleSchema.default('weekly'),
  maxPages: maxPagesSchema.default(200),
})

const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  schedule: scheduleSchema,
  maxPages: maxPagesSchema,
})

function nextAuditAt(schedule: 'off' | 'weekly' | 'monthly'): string | null {
  if (schedule === 'off') return null
  const days = schedule === 'monthly' ? 30 : 7
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

/** Shared guard: signed in, allowed to manage SEO, plan includes it, not a demo org. */
async function guardManage(): Promise<{ userId: string } | { error: string }> {
  await assertWritableOrThrow()
  const user = await getUser()
  if (!user) return { error: 'Not authenticated' }
  const perm = await requirePermission('seo.manage')
  if (!perm.ok) return { error: perm.error ?? 'Forbidden' }
  const feature = await requireFeature('seo')
  if (!feature.ok) return { error: feature.error }
  return { userId: user.id }
}

export async function createSite(input: z.input<typeof createSiteSchema>): Promise<ActionResult<{ id: string }>> {
  const guard = await guardManage()
  if ('error' in guard) return err(guard.error)

  const parsed = createSiteSchema.safeParse(input)
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input')
  const site = parseSiteInput(parsed.data.url)
  if (!site) return err('Enter a valid website address, like example.com')

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active organization')

  const { data, error } = await supabase
    .from('seo_sites')
    .insert({
      org_id: orgId as string,
      name: parsed.data.name || site.host.replace(/^www\./, ''),
      root_url: site.rootUrl,
      host: site.host,
      audit_schedule: parsed.data.schedule,
      crawl_max_pages: parsed.data.maxPages,
      next_audit_at: nextAuditAt(parsed.data.schedule),
      created_by: guard.userId,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return err('This site is already being tracked.')
    return err(error.message)
  }

  // Kick off the first audit right away; the next cron tick starts it.
  await supabase.from('seo_audits').insert({
    org_id: orgId as string,
    site_id: data.id,
    trigger: 'manual',
    max_pages: parsed.data.maxPages,
    created_by: guard.userId,
  })

  revalidatePath('/seo')
  return ok({ id: data.id })
}

export async function updateSite(siteId: string, input: z.input<typeof updateSiteSchema>): Promise<ActionResult<SiteRow>> {
  const guard = await guardManage()
  if ('error' in guard) return err(guard.error)
  const parsed = updateSiteSchema.safeParse(input)
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid input')

  const supabase = await createClient()
  const { data: current } = await supabase.from('seo_sites').select('audit_schedule, next_audit_at').eq('id', siteId).maybeSingle()
  if (!current) return err('Site not found')

  // Keep the existing due date unless the cadence changed.
  const scheduleChanged = current.audit_schedule !== parsed.data.schedule
  const { data, error } = await supabase
    .from('seo_sites')
    .update({
      name: parsed.data.name,
      audit_schedule: parsed.data.schedule,
      crawl_max_pages: parsed.data.maxPages,
      next_audit_at: scheduleChanged ? nextAuditAt(parsed.data.schedule) : current.next_audit_at,
    })
    .eq('id', siteId)
    .select('*')
    .single()
  if (error) return err(error.message)

  revalidatePath('/seo')
  revalidatePath(`/seo/${siteId}`)
  return ok(data)
}

export async function deleteSite(siteId: string): Promise<ActionResult> {
  const guard = await guardManage()
  if ('error' in guard) return err(guard.error)
  const supabase = await createClient()
  const { error } = await supabase.from('seo_sites').delete().eq('id', siteId)
  if (error) return err(error.message)
  revalidatePath('/seo')
  return ok(undefined)
}

export async function runAudit(siteId: string): Promise<ActionResult<{ id: string }>> {
  const guard = await guardManage()
  if ('error' in guard) return err(guard.error)

  const supabase = await createClient()
  const { data: site } = await supabase.from('seo_sites').select('id, org_id, crawl_max_pages').eq('id', siteId).maybeSingle()
  if (!site) return err('Site not found')

  const { data, error } = await supabase
    .from('seo_audits')
    .insert({ org_id: site.org_id, site_id: site.id, trigger: 'manual', max_pages: site.crawl_max_pages, created_by: guard.userId })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return err('An audit is already running for this site.')
    return err(error.message)
  }

  revalidatePath('/seo')
  revalidatePath(`/seo/${siteId}`)
  return ok({ id: data.id })
}

export async function cancelAudit(auditId: string): Promise<ActionResult> {
  const guard = await guardManage()
  if ('error' in guard) return err(guard.error)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('seo_audits')
    .update({ status: 'failed', stage: 'done', error_message: 'Cancelled', finished_at: new Date().toISOString(), sitemap_urls: null })
    .eq('id', auditId)
    .in('status', ['pending', 'running'])
    .select('site_id')
    .maybeSingle()
  if (error) return err(error.message)
  if (data) revalidatePath(`/seo/${data.site_id}`)
  revalidatePath('/seo')
  return ok(undefined)
}
