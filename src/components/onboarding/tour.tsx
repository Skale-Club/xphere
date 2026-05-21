'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { ArrowRight, Sparkles, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const COOKIE = 'vo_tour_dismissed'

interface Step {
  /** CSS selector to anchor the tooltip to. If null, renders centered. */
  selector: string | null
  /** Where the tooltip sits relative to the target. */
  side?: 'top' | 'right' | 'bottom' | 'left' | 'center'
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    selector: null,
    side: 'center',
    title: 'Welcome to Xphere',
    body: "Let's walk you through the main areas of the product in 30 seconds. You can skip at any time.",
  },
  {
    selector: 'aside nav',
    side: 'right',
    title: 'All your workspace areas live here',
    body: 'The sidebar organises everything into Overview, Engage, Sales, Build, and Manage. Click any item to navigate.',
  },
  {
    selector: '[data-tour="command-palette-trigger"], [data-tour="topbar"]',
    side: 'bottom',
    title: 'Press Cmd+K for everything',
    body: 'The command palette opens search, jumps between areas, and runs common actions. The most useful shortcut in the product.',
  },
  {
    selector: 'a[href="/agents"]',
    side: 'right',
    title: 'Create your first agent',
    body: 'Agents are the AI workers that handle your conversations. Spin one up in just a few clicks.',
  },
  {
    selector: 'a[href="/integrations"]',
    side: 'right',
    title: 'Connect WhatsApp, Twilio, and more',
    body: 'In Integrations you connect channels (WhatsApp via Evolution Go, SMS via Twilio, Vapi for voice). Each channel shows up automatically.',
  },
]

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.split('=')[1]) : null
}

function setCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return
  const exp = new Date(Date.now() + days * 86_400_000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`
}

export function OnboardingTour() {
  const pathname = usePathname()
  const [active, setActive] = React.useState(false)
  const [step, setStep] = React.useState(0)
  const [rect, setRect] = React.useState<DOMRect | null>(null)

  React.useEffect(() => {
    if (pathname !== '/') return
    if (readCookie(COOKIE) === '1') return
    const id = window.setTimeout(() => setActive(true), 600)
    return () => window.clearTimeout(id)
  }, [pathname])

  React.useEffect(() => {
    if (!active) return
    const current = STEPS[step]
    if (!current?.selector) {
      setRect(null)
      return
    }
    const compute = () => {
      const el = document.querySelector(current.selector!) as HTMLElement | null
      if (!el) {
        setRect(null)
        return
      }
      setRect(el.getBoundingClientRect())
    }
    compute()
    const id = window.setInterval(compute, 500)
    window.addEventListener('resize', compute)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', compute)
    }
  }, [active, step])

  React.useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  function dismiss() {
    setActive(false)
    setCookie(COOKIE, '1')
  }

  function next() {
    if (step >= STEPS.length - 1) {
      dismiss()
      return
    }
    setStep((s) => s + 1)
  }

  if (!active) return null

  const current = STEPS[step]
  const isCenter = !current.selector || !rect
  const tooltipPos = computeTooltipPosition(rect, current.side ?? 'bottom')

  const tooltipCard = (
    <div
      className={cn(
        'pointer-events-auto w-[320px] max-w-[calc(100vw-32px)] rounded-[12px] border border-border bg-bg-elevated p-4 shadow-lg relative',
        'animate-fade-in',
      )}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Skip tour"
        className="absolute top-2 right-2 p-1 rounded-[6px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-accent mb-1">
        <Sparkles className="h-3 w-3" />
        <span>Tour · {step + 1}/{STEPS.length}</span>
      </div>
      <h3 className="text-[15px] font-semibold text-text-primary mb-1">{current.title}</h3>
      <p className="text-[12.5px] text-text-secondary leading-relaxed">{current.body}</p>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={dismiss}
          className="text-[12px] text-text-tertiary hover:text-text-secondary"
        >
          Skip tour
        </button>
        <div className="flex items-center gap-1">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === step ? 'w-4 bg-accent' : 'w-1.5 bg-border',
              )}
            />
          ))}
        </div>
        <Button size="sm" onClick={next}>
          {step >= STEPS.length - 1 ? 'Finish' : 'Next'}
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Onboarding tour"
      className="fixed inset-0 z-[1000] pointer-events-none"
    >
      {/* Dim backdrop with hole for the highlighted element */}
      {rect ? (
        <svg className="absolute inset-0 w-full h-full pointer-events-auto" onClick={dismiss}>
          <defs>
            <mask id="tour-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={rect.x - 6}
                y={rect.y - 6}
                width={rect.width + 12}
                height={rect.height + 12}
                rx="10"
                fill="black"
              />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#tour-mask)" />
          <rect
            x={rect.x - 6}
            y={rect.y - 6}
            width={rect.width + 12}
            height={rect.height + 12}
            rx="10"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            className="animate-pulse"
          />
        </svg>
      ) : (
        <div className="absolute inset-0 bg-black/55 pointer-events-auto" onClick={dismiss} />
      )}

      {/* Tooltip | flex-centered when no anchor (perfect viewport center) */}
      {isCenter ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {tooltipCard}
        </div>
      ) : (
        <div
          className="absolute pointer-events-none"
          style={{ top: `${tooltipPos.top}px`, left: `${tooltipPos.left}px` }}
        >
          {tooltipCard}
        </div>
      )}
    </div>
  )
}

function computeTooltipPosition(
  rect: DOMRect | null,
  side: 'top' | 'right' | 'bottom' | 'left' | 'center',
): { top: number; left: number } {
  if (!rect || side === 'center') return { top: 0, left: 0 }
  const W = 320
  const H = 160
  const pad = 12
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800

  let top = 0
  let left = 0
  switch (side) {
    case 'top':
      top = rect.top - H - pad
      left = rect.left + rect.width / 2 - W / 2
      break
    case 'bottom':
      top = rect.bottom + pad
      left = rect.left + rect.width / 2 - W / 2
      break
    case 'left':
      top = rect.top + rect.height / 2 - H / 2
      left = rect.left - W - pad
      break
    case 'right':
    default:
      top = rect.top + rect.height / 2 - H / 2
      left = rect.right + pad
      break
  }
  top = Math.max(pad, Math.min(vh - H - pad, top))
  left = Math.max(pad, Math.min(vw - W - pad, left))
  return { top, left }
}
