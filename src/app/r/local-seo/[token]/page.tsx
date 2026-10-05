// Public white-label Local SEO report. No login: the random token in the URL
// is the credential (only its SHA-256 is stored), links can expire or be
// revoked, and the page is never indexed. Renders the same markup the PDF
// prints (?print=1 hides nothing extra; it only skips the view counter).

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ReportDocument } from '@/components/local-seo/report-document'
import { buildReportData, resolveShareToken } from '@/lib/local-seo/reports'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Local SEO report',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function PublicLocalSeoReport({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ print?: string }>
}) {
  const { token } = await params
  const { print } = await searchParams
  const admin = createServiceRoleClient()
  const report = await resolveShareToken(admin, token, print !== '1')
  if (!report) notFound()
  const data = await buildReportData(admin, report)

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', colorScheme: 'light' }}>
      <style>{`
        @media print {
          @page { size: A4; }
          body { background: #fff !important; }
          .report-avoid-break { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
      <ReportDocument data={data} />
    </div>
  )
}
