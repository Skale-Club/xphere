'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3,
  Copy,
  Check,
  Globe,
  Tag,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { saveTrafficSetup } from '../actions'

interface Props {
  setup: {
    script_token: string
    primary_website_url: string | null
    gtm_container_id: string | null
    verification_state: string
  }
}

type VerifyResult = 'verified' | 'script_not_found' | 'no_events_yet' | 'url_unreachable' | 'failed' | null

const STEPS = ['Website', 'Install', 'Verify'] as const

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (!/^https?:\/\//i.test(trimmed)) return 'https://' + trimmed
  return trimmed
}

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
    label: 'Tracking is live',
    description: 'We received tracking data from your website. Taking you to your dashboard…',
  },
  no_events_yet: {
    icon: <Clock className="h-5 w-5 text-yellow-500" />,
    label: 'Script detected — waiting for the first visit',
    description: 'The script is on your page. Open your website in a new tab to send the first event.',
  },
  script_not_found: {
    icon: <Clock className="h-5 w-5 text-yellow-500" />,
    label: 'No traffic detected yet',
    description:
      'We haven’t received any events. If you installed via Google Tag Manager, the tag only loads when someone visits — open your website in a new tab, then check again.',
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

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const stepNum = i + 1
        const isDone = stepNum < current
        const isActive = stepNum === current
        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-accent text-white'
                    : isDone
                      ? 'bg-accent/15 text-accent'
                      : 'bg-bg-tertiary text-text-tertiary'
                }`}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : stepNum}
              </span>
              <span className={`text-xs font-medium ${isActive ? 'text-text-primary' : 'text-text-tertiary'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && <div className="h-px w-6 bg-border sm:w-10" />}
          </div>
        )
      })}
    </div>
  )
}

export function SetupWizard({ setup }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [step, setStep] = useState<number>(setup.primary_website_url ? 2 : 1)
  const [websiteUrl, setWebsiteUrl] = useState(setup.primary_website_url ?? '')
  const [gtmId, setGtmId] = useState(setup.gtm_container_id ?? '')
  const [installTab, setInstallTab] = useState<'gtm' | 'manual'>('gtm')
  const [result, setResult] = useState<VerifyResult>(null)

  const scriptSrc = `https://xphere.app/api/traffic/script?t=${setup.script_token}`
  const gtmTag = `<script async src="${scriptSrc}"></script>`
  const headSnippet = `<!-- Xphere Traffic | place in <head> -->
<script async src="${scriptSrc}"></script>`

  function persist(onDone?: () => void) {
    const fd = new FormData()
    fd.append('website_url', websiteUrl)
    fd.append('gtm_container_id', installTab === 'gtm' ? gtmId : '')
    startTransition(async () => {
      await saveTrafficSetup(fd)
      onDone?.()
    })
  }

  function goToInstall(e: React.FormEvent) {
    e.preventDefault()
    if (!websiteUrl.trim()) {
      toast.error('Enter your website URL')
      return
    }
    persist(() => setStep(2))
  }

  function goToVerify() {
    persist(() => setStep(3))
  }

  function openWebsite() {
    const url = normalizeUrl(websiteUrl || setup.primary_website_url || '')
    if (url) window.open(url, '_blank', 'noopener')
  }

  function handleVerify() {
    const url = normalizeUrl(websiteUrl || setup.primary_website_url || '')
    if (!url) {
      toast.error('No website URL configured')
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/traffic/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        const json = (await res.json()) as { ok: boolean; result: VerifyResult }
        setResult(json.result)
        if (json.result === 'verified') {
          toast.success('Tracking is live!')
          setTimeout(() => router.refresh(), 900)
        } else if (json.result === 'no_events_yet') {
          toast.success('Script detected')
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
          <BarChart3 className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Set up Traffic tracking</h1>
          <p className="text-sm text-text-tertiary">Three quick steps to start collecting data.</p>
        </div>
      </div>

      <Stepper current={step} />

      {/* Step 1 — Website URL */}
      {step === 1 && (
        <form onSubmit={goToInstall} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Globe className="h-4 w-4" /> Your website URL
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="https://yourwebsite.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                type="url"
                autoFocus
              />
              <p className="mt-1.5 text-xs text-text-tertiary">Used to verify that the script is installed correctly.</p>
            </CardContent>
          </Card>

          <Button type="submit" disabled={isPending || !websiteUrl.trim()} className="w-full">
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </form>
      )}

      {/* Step 2 — Install script */}
      {step === 2 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Install tracking script</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={installTab} onValueChange={(v) => setInstallTab(v as 'gtm' | 'manual')}>
                <TabsList>
                  <TabsTrigger value="gtm">Google Tag Manager</TabsTrigger>
                  <TabsTrigger value="manual">Manual</TabsTrigger>
                </TabsList>

                <TabsContent value="gtm" className="mt-4 space-y-4">
                  <ol className="space-y-4 text-sm text-text-secondary">
                    <li className="flex gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">1</span>
                      <span>Open your GTM container and click <strong>Add a new tag</strong>.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">2</span>
                      <span>Choose <strong>Custom HTML</strong> as the tag type and paste the code below.</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">3</span>
                      <span>Set the trigger to <strong>All Pages</strong> and <strong>Publish</strong> the container.</span>
                    </li>
                  </ol>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-lg bg-bg-tertiary p-4 pr-10 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
                      {gtmTag}
                    </pre>
                    <CopyButton text={gtmTag} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="gtm-id" className="flex items-center gap-1.5 text-xs">
                      <Tag className="h-3.5 w-3.5" /> GTM Container ID (optional)
                    </Label>
                    <Input
                      id="gtm-id"
                      placeholder="GTM-XXXXXXX"
                      value={gtmId}
                      onChange={(e) => setGtmId(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="manual" className="mt-4 space-y-4">
                  <p className="text-sm text-text-secondary">
                    Paste this script in the <code className="rounded bg-bg-tertiary px-1 py-0.5 text-xs">&lt;head&gt;</code> section of every page you want to track.
                  </p>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-lg bg-bg-tertiary p-4 pr-10 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
                      {headSnippet}
                    </pre>
                    <CopyButton text={headSnippet} />
                  </div>
                  <p className="text-xs text-text-tertiary">
                    For Single Page Applications (React, Next.js, Vue), place the script in your root layout or index.html.
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(1)} disabled={isPending}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button onClick={goToVerify} disabled={isPending} className="flex-1">
              {isPending ? 'Saving…' : "I've added the script"}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3 — Verify */}
      {step === 3 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Verify installation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-text-secondary">
                Open your website so the script can send its first event, then check below. We confirm the install by
                detecting real tracking data — this works for Google Tag Manager, manual, and single-page apps.
              </p>
              <Button variant="outline" onClick={openWebsite} className="w-full sm:w-auto">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open my website
              </Button>
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
            <Button variant="outline" onClick={() => setStep(2)} disabled={isPending}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button onClick={handleVerify} disabled={isPending} className="flex-1">
              <RefreshCw className={`h-4 w-4 mr-2 ${isPending ? 'animate-spin' : ''}`} />
              {isPending ? 'Checking…' : 'Check installation'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
