'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { localSeoContext, type Fail } from '@/lib/local-seo/action-context'
import { REPORT_SECTIONS } from '@/lib/local-seo/report-sections'
import { createShareLink, sendReport } from '@/lib/local-seo/reports'
import { getSiteOriginFromHeaders } from '@/lib/site-url'
import { createServiceRoleClient } from '@/lib/supabase/admin'

const reportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  locationIds: z.array(z.string().uuid()).max(50),
  periodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  sections: z.array(z.enum(REPORT_SECTIONS)).min(1),
  intro: z.string().trim().max(2000).nullable(),
  schedule: z.enum(['none', 'monthly']),
  sendDay: z.number().int().min(1).max(28),
  recipients: z.array(z.string().trim().email()).max(20),
})

export type ReportInput = z.infer<typeof reportSchema>

export async function saveReport(input: ReportInput, reportId?: string): Promise<{ id: string } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const parsed = reportSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid report.' }
  const v = parsed.data
  if (v.schedule === 'monthly' && !v.recipients.length) return { error: 'Add at least one recipient for the monthly email.' }
  const row = {
    org_id: ctx.orgId,
    name: v.name,
    location_ids: v.locationIds,
    period_days: v.periodDays,
    sections: v.sections,
    intro: v.intro || null,
    schedule: v.schedule,
    send_day: v.sendDay,
    recipients: v.recipients,
  }
  if (reportId) {
    const { error } = await ctx.supabase.from('local_seo_reports').update(row).eq('id', reportId)
    if (error) return { error: error.message }
    revalidatePath('/local-seo/reports')
    return { id: reportId }
  }
  const { data, error } = await ctx.supabase.from('local_seo_reports').insert({ ...row, created_by: ctx.user.id }).select('id').single()
  if (error || !data) return { error: error?.message ?? 'Could not save.' }
  revalidatePath('/local-seo/reports')
  return { id: data.id }
}

export async function deleteReport(reportId: string): Promise<{ ok: true } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const { error } = await ctx.supabase.from('local_seo_reports').delete().eq('id', reportId)
  if (error) return { error: error.message }
  revalidatePath('/local-seo/reports')
  return { ok: true }
}

/** The plaintext link is returned once; only its hash is stored. */
export async function createReportLink(reportId: string, expiresInDays: number | null): Promise<{ url: string } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const { data: report } = await ctx.supabase.from('local_seo_reports').select('id').eq('id', reportId).maybeSingle()
  if (!report) return { error: 'Report not found.' }
  const res = await createShareLink(createServiceRoleClient(), { orgId: ctx.orgId, reportId, expiresInDays, userId: ctx.user.id })
  if ('error' in res) return { error: res.error }
  revalidatePath('/local-seo/reports')
  return { url: `${await getSiteOriginFromHeaders()}/r/local-seo/${res.token}` }
}

export async function revokeReportLink(shareId: string): Promise<{ ok: true } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const { error } = await createServiceRoleClient()
    .from('local_seo_report_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId)
    .eq('org_id', ctx.orgId)
  if (error) return { error: error.message }
  revalidatePath('/local-seo/reports')
  return { ok: true }
}

export async function sendReportNow(reportId: string): Promise<{ ok: true } | Fail> {
  const ctx = await localSeoContext('local_seo.manage')
  if ('error' in ctx) return { error: ctx.error }
  const admin = createServiceRoleClient()
  const { data: report } = await admin.from('local_seo_reports').select('*').eq('id', reportId).eq('org_id', ctx.orgId).maybeSingle()
  if (!report) return { error: 'Report not found.' }
  try {
    const res = await sendReport(admin, report)
    revalidatePath('/local-seo/reports')
    return res.ok ? { ok: true } : { error: res.error }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Sending failed.' }
  }
}
