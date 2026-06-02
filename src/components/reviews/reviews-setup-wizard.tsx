'use client'

import { useState, useTransition, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

import { refreshNow } from '@/app/(dashboard)/integrations/google-reviews/actions'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { SerpApiKeyForm } from './serpapi-key-form'
import { BusinessSearch } from './business-search'

type Step = 1 | 2 | 3

const STEPS: { id: Step; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 1, label: 'SerpAPI key', icon: KeyRound },
  { id: 2, label: 'Business', icon: MapPin },
  { id: 3, label: 'Done', icon: CheckCircle2 },
]

interface ReviewsSetupWizardProps {
  /** Where to start: 1 if no key yet, 2 if a key already exists. */
  startStep?: Step
  currentHint?: string | null
  triggerLabel?: string
}

export function ReviewsSetupWizard({
  startStep = 1,
  currentHint = null,
  triggerLabel = 'Set up Google Reviews',
}: ReviewsSetupWizardProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>(startStep)
  const [scraping, startScrape] = useTransition()
  const [scraped, setScraped] = useState(false)
  const router = useRouter()

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      // Reflect any progress (saved key / selected business) on the page.
      router.refresh()
    }
  }

  function finish() {
    setOpen(false)
    router.refresh()
  }

  function fetchReviews() {
    startScrape(async () => {
      const res = await refreshNow()
      if (res.error) {
        toast.error(res.error)
        return
      }
      setScraped(true)
      toast.success(`Fetched ${res.newReviews ?? 0} reviews.`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Sparkles className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Set up Google Reviews</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <ol className="flex items-center gap-2 pb-1">
          {STEPS.map((s, i) => {
            const active = s.id === step
            const done = s.id < step
            const Icon = done ? CheckCircle2 : s.icon
            return (
              <li key={s.id} className="flex flex-1 items-center gap-2">
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] transition-colors',
                    active
                      ? 'border-accent bg-accent/10 text-accent'
                      : done
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-border bg-bg-tertiary/50 text-text-tertiary',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span
                  className={cn(
                    'hidden text-[12px] font-medium sm:inline',
                    active ? 'text-text-primary' : 'text-text-tertiary',
                  )}
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 ? (
                  <span className={cn('h-px flex-1', done ? 'bg-emerald-500/40' : 'bg-border')} />
                ) : null}
              </li>
            )
          })}
        </ol>

        {/* Step body */}
        <div className="pt-2">
          {step === 1 ? (
            <div className="space-y-3">
              <p className="text-[13px] text-text-secondary">
                Connect your own free SerpAPI account — 100 searches/month at no cost. This powers the
                daily review sync.
              </p>
              <SerpApiKeyForm currentHint={currentHint} onSaved={() => setStep(2)} />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <p className="text-[13px] text-text-secondary">
                Search Google Maps and select your business to lock in the correct Place ID.
              </p>
              <BusinessSearch hasApiKey currentPlaceId={null} onSelected={() => setStep(3)} />
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-[15px] font-semibold text-text-primary">You&rsquo;re all set</h3>
                <p className="max-w-sm text-[13px] text-text-secondary">
                  Reviews sync automatically every day. Fetch them now to populate your widget right
                  away, or finish and do it later.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <Button variant="secondary" className="gap-2" onClick={fetchReviews} disabled={scraping || scraped}>
                  {scraping ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Fetching…</>
                  ) : scraped ? (
                    <><CheckCircle2 className="h-4 w-4" />Fetched</>
                  ) : (
                    <><RefreshCw className="h-4 w-4" />Fetch reviews now</>
                  )}
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/reviews">Open reviews dashboard</Link>
                </Button>
              </div>
              <Button className="mt-1 w-full sm:w-auto" onClick={finish}>
                Finish
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
