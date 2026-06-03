'use client'

import { useRouter } from 'next/navigation'
import { RefreshCw, Wrench } from 'lucide-react'

export function BookingDebugBanner() {
  const router = useRouter()

  return (
    <div className="w-full flex items-center justify-between px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
      <div className="flex items-center gap-2 text-blue-400 text-[13px] font-medium">
        <Wrench className="h-3.5 w-3.5" />
        Troubleshooting view
      </div>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="flex items-center gap-1.5 text-[12px] text-blue-400 hover:text-blue-300 transition-colors"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </button>
    </div>
  )
}
