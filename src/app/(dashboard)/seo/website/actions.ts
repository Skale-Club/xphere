'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { assertWritableOrThrow } from '@/lib/demo/guard'
import { requirePermission } from '@/lib/rbac/server'
import { requireFeature } from '@/lib/billing/guards'
import { parseSiteInput } from '@/lib/seo/url'
import { MAX_PAGES_OPTIONS } from '@/lib/seo/constants'
import type { Database } from '@/types/database'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getGscAccessToken } from '@/lib/seo/gsc/tokens'
import { listGscProperties, suggestProperty } from '@/lib/seo/gsc/client'
import { generateActionPlan, type ActionPlan } from '@/lib/seo/action-plan'
import { isBillingEnforced } from '@/lib/billing/config'
import { hasCopilotCredits } from '@/lib/billing/credits'

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

  revalidatePath('/seo/website')
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

  revalidatePath('/seo/website')
  revalidatePath(`/seo/website/${siteId}`)
  return ok(data)
}

export async function deleteSite(siteId: string): Promise<ActionResult> {
  const guard = await guardManage()
  if ('error' in guard) return err(guard.error)
  const supabase = await createClient()
  const { error } = await supabase.from('seo_sites').delete().eq('id', siteId)
  if (error) return err(error.message)
  revalidatePath('/seo/website')
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

  revalidatePath('/seo/website')
  revalidatePath(`/seo/website/${siteId}`)
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
  if (data) revalidatePath(`/seo/website/${data.site_id}`)
  revalidatePath('/seo/website')
  return ok(undefined)
}

// ── Google Search Console ────────────────────────────────────────────────────

export type GscPropertyOptions = {
  properties: Array<{ siteUrl: string; permissionLevel: string }>
  suggested: string | null
}

/** Properties the org's connected Google account can read, plus the best match for the site. */
export async function listGscPropertiesForSite(siteId: string): Promise<ActionResult<GscPropertyOptions>> {
  const guard = await guardManage()
  if ('error' in guard) return err(guard.error)

  const supabase = await createClient()
  const { data: site } = await supabase.from('seo_sites').select('id, org_id, host').eq('id', siteId).maybeSingle()
  if (!site) return err('Site not found')

  try {
    // Service role only to read/refresh the org's stored token; the site row
    // above was already resolved through RLS for the caller's org.
    const token = await getGscAccessToken(createServiceRoleClient(), site.org_id)
    const properties = await listGscProperties(token)
    return ok({ properties, suggested: suggestProperty(properties, site.host) })
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not load Search Console properties')
  }
}

export async function setGscProperty(siteId: string, property: string | null): Promise<ActionResult> {
  const guard = await guardManage()
  if ('error' in guard) return err(guard.error)
  if (property !== null && (property.length > 500 || !/^(sc-domain:|https?:\/\/)/.test(property))) {
    return err('Invalid Search Console property')
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('seo_sites')
    .update({
      gsc_property: property,
      // A new property means a fresh 16-month backfill on the next tick.
      gsc_backfilled_at: null,
      gsc_synced_at: null,
      gsc_last_error: null,
      gsc_next_sync_at: property ? new Date().toISOString() : null,
    })
    .eq('id', siteId)
  if (error) return err(error.message)

  revalidatePath(`/seo/website/${siteId}`)
  revalidatePath('/seo/website')
  return ok(undefined)
}

// ── AI action plan ───────────────────────────────────────────────────────────

/** Generate (or regenerate) the AI action plan for the site's latest audit. Costs Copilot credits. */
export async function generateSeoActionPlan(siteId: string): Promise<ActionResult<ActionPlan>> {
  const guard = await guardManage()
  if ('error' in guard) return err(guard.error)

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active organization')
  if (isBillingEnforced() && !(await hasCopilotCredits(orgId as string))) {
    return err('Out of AI credits. Top up in Settings → Billing to generate the plan.')
  }

  // Write the plan in the language the user's browser asks for.
  const locale = ((await headers()).get('accept-language') ?? 'en').split(',')[0].trim() || 'en'
  try {
    const plan = await generateActionPlan(supabase, orgId as string, siteId, locale)
    revalidatePath(`/seo/website/${siteId}`)
    return ok(plan)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message === 'no_openrouter_key') return err('No AI provider key is configured (OpenRouter).')
    return err(message)
  }
}
