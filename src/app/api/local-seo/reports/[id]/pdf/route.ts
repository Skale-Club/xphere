// Download a Local SEO report as PDF (dashboard session, local_seo.view).

import { renderReportPdf } from '@/lib/local-seo/reports'
import { localSeoContext } from '@/lib/local-seo/action-context'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await localSeoContext('local_seo.view')
  if ('error' in ctx) return Response.json({ error: ctx.error }, { status: 403 })
  const { id } = await params
  const admin = createServiceRoleClient()
  const { data: report } = await admin.from('local_seo_reports').select('*').eq('id', id).eq('org_id', ctx.orgId).maybeSingle()
  if (!report) return Response.json({ error: 'Not found' }, { status: 404 })
  try {
    const pdf = await renderReportPdf(admin, report)
    const name = `${report.name.replace(/[^\w-]+/g, '-').toLowerCase()}.pdf`
    return new Response(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'PDF failed' }, { status: 503 })
  }
}
