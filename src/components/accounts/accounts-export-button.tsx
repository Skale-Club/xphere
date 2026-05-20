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
      const res = await exportAccountsCsv()
      if (res.error) {
        toast.error(res.error)
        return
      }
      if (!res.csv) return
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'companies.csv'
      a.click()
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
      className="h-9 gap-2 text-[13px]"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Export CSV
    </Button>
  )
}
