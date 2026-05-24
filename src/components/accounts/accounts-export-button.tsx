'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { exportAccountsCsv } from '@/app/(dashboard)/companies/actions'

export function AccountsExportButton() {
  const [pending, setPending] = useState(false)

  async function handleExport() {
    setPending(true)
    try {
      const result = await exportAccountsCsv()
      if (result.error) {
        toast.error(result.error)
        return
      }
      if (!result.csv) return

      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'companies.csv'
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleExport}
      disabled={pending}
      className="h-10 gap-2 text-[13px]"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      Export CSV
    </Button>
  )
}
