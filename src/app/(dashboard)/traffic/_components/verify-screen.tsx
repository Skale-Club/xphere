'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, Clock, BarChart3, Copy, Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  setup: {
    script_token: string
    primary_website_url: string | null
    verification_state: string
  }
}

type VerifyResult = 'verified' | 'script_not_found' | 'no_events_yet' | 'url_unreachable' | 'failed' | null

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="absolute right-2 top-2 rounded p-1 text-text-tertiary hover:text-text-primary transition-colors"
      aria-label="Copy"
    >
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

const RESULT_CONFIG: Record<NonNullable<VerifyResult>, { icon: React.ReactNode; label: string; description: string }> = {
  verified: {
    icon: <CheckCircle2 className="h-5 w-5 text-green-500" />,
    label: 'Script found',
    description: 'The tracking script is installed. Waiting for the first event to arrive.',
  },
  no_events_yet: {
    icon: <Clock className="h-5 w-5 text-yellow-500" />,
    label: 'Script found — waiting for events',
    description: 'The script is installed. Visit your website to send the first event, then refresh.',
  },
  script_not_found: {
    icon: <XCircle className="h-5 w-5 text-red-500" />,
    label: 'Script not found',
    description: 'The tracking script was not found on your website. Make sure you saved and published the changes.',
  },
  url_unreachable: {
    icon: <XCircle className="h-5 w-5 text-red-500" />,
    label: 'URL unreachable',
    description: 'Could not connect to your website. Check that the URL is correct and the site is live.',
  },
  failed: {
    icon: <XCircle className="h-5 w-5 text-red-500" />,
    label: 'Verification failed',
    description: 'Something went wrong during verification. Try again in a moment.',
  },
}

export function VerifyScreen({ setup }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<VerifyResult>(null)

  const scriptSrc = `https://xphere.app/api/traffic/script?t=${setup.script_token}`
  const snippet = `<script async src="${scriptSrc}"></script>`

  function handleVerify() {
    if (!setup.primary_website_url) {
      toast.error('No website URL configured')
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/traffic/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: setup.primary_website_url }),
        })
        const json = await res.json() as { ok: boolean; result: VerifyResult }
        setResult(json.result)
        if (json.result === 'verified' || json.result === 'no_events_yet') {
          toast.success('Script found!')
          setTimeout(() => router.refresh(), 800)
        }
      } catch {
        setResult('failed')
      }
    })
  }

  const resultCfg = result ? RESULT_CONFIG[result] : null

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
          <BarChart3 className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Verify installation</h1>
          <p className="text-sm text-text-tertiary">
            Check that the tracking script is installed on{' '}
            <span className="font-medium text-text-secondary">{setup.primary_website_url}</span>.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Your tracking snippet</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-bg-tertiary p-4 pr-10 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
              {snippet}
            </pre>
            <CopyButton text={snippet} />
          </div>
        </CardContent>
      </Card>

      {resultCfg && (
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              {resultCfg.icon}
              <div>
                <p className="text-sm font-medium text-text-primary">{resultCfg.label}</p>
                <p className="mt-0.5 text-xs text-text-tertiary">{resultCfg.description}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button onClick={handleVerify} disabled={isPending} className="flex-1">
          <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? 'animate-spin' : ''}`} />
          {isPending ? 'Checking…' : 'Check installation'}
        </Button>
        <Button variant="outline" onClick={() => router.push('/traffic')}>
          Back to setup
        </Button>
      </div>
    </div>
  )
}
