import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { getImport, getImportErrors } from '@/app/(dashboard)/contacts/import-history-actions'
import { ImportDetailClient } from './import-detail-client'
import { StatusPill } from '../status-pill'

interface ImportDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function ImportDetailPage({ params }: ImportDetailPageProps) {
  const { id } = await params

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-2 text-[12px] text-text-tertiary">
        <Link href="/contacts/imports" className="hover:text-text-primary flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Import History
        </Link>
      </div>

      <Suspense fallback={<div className="text-[13px] text-text-tertiary">Loading import…</div>}>
        <ImportDetailBody importId={id} />
      </Suspense>
    </div>
  )
}

async function ImportDetailBody({ importId }: { importId: string }) {
  const [importResult, errorsResult] = await Promise.all([
    getImport(importId),
    getImportErrors(importId, 1, 50),
  ])

  if (!importResult.ok) notFound()

  const imp = importResult.import
  const errors = errorsResult.ok ? errorsResult.errors : []
  const totalErrors = errorsResult.ok ? errorsResult.total : 0

  return (
    <ImportDetailClient
      initialImport={imp}
      initialErrors={errors}
      totalErrors={totalErrors}
    />
  )
}
