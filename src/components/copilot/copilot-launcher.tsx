'use client'

import { useEffect } from 'react'
import { MessageCircle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCopilotStore } from '@/stores/copilot-store'

export function CopilotShell() {
  const open = useCopilotStore((s) => s.open)
  const setOpen = useCopilotStore((s) => s.setOpen)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // Hide FAB on mobile when panel is open (panel covers the screen)
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Open Copilot (⌘I)"
      aria-label="Open Copilot"
      className={cn(
        'fixed bottom-5 right-5 z-40 flex items-center gap-2.5 rounded-2xl bg-accent px-4 py-3 text-white',
        'shadow-xl shadow-accent/30 transition-all hover:bg-accent-hover hover:scale-[1.03] hover:shadow-accent/40 active:scale-[0.98]',
        // Hide on mobile when panel is already open fullscreen
        open && 'max-md:hidden',
        // Hide on desktop when panel is already open (panel is visible inline)
        open && 'md:hidden',
      )}
    >
      <MessageCircle className="h-5 w-5 shrink-0 fill-white/20" strokeWidth={1.8} />
      <span className="text-sm font-semibold tracking-tight pr-0.5">Copilot</span>
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20">
        <Sparkles className="h-2.5 w-2.5" />
      </span>
    </button>
  )
}
