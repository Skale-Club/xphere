'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Globe,
  RefreshCw,
  RotateCcw,
  Tag,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { resetTrafficSetup, saveTrafficSetup } from '@/app/(dashboard)/traffic/actions'

type VerificationState = 'not_started' | 'pending' | 'verified' | 'failed' | 'no_events_yet'
type VerifyResult = 'verified' | 'script_not_found' | 'no_events_yet' | 'url_unreachable' | 'failed' | null

interface Props {
  scriptToken: string
  primaryWebsiteUrl: string | null
  gtmContainerId: string | null
  verificationState: VerificationState
  verifiedAt: string | null
}

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

const STATUS_CONFIG: Record<
  VerificationState,
  { icon: React.ReactNode; label: string; tone: string; description: string }
> = {
  verified: {
    icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    label: 'Tracking is live',
    tone: 'border-green-500/30 bg-green-500/5',
    description: 'Data is flowing into your traffic dashboard.',
  },
  no_events_yet: {
    icon: <Clock className="h-4 w-4 text-yellow-500" />,
    label: 'Script detected — waiting for the first visit',
    tone: 'border-yellow-500/30 bg-yellow-500/5',
    description: 'The tracking tag is installed but hasn’t fired yet. Open your website to send the first event.',
  },
  pending: {
    icon: <Clock className="h-4 w-4 text-yellow-500" />,
    label: 'Verification pending',
    tone: 'border-yellow-500/30 bg-yellow-500/5',
    description: 'We haven’t received any tracking data yet. Re-check below once the script is live.',
  },
  not_started: {
    icon: <XCircle className="h-4 w-4 text-text-tertiary" />,
    label: 'Not configured',
    tone: 'border-border bg-bg-tertiary/40',
    description: 'No website is being tracked yet. Run through the setup to get started.',
  },
  failed: {
    icon: <XCircle className="h-4 w-4 text-red-500" />,
    label: 'Verification failed',
    tone: 'border-red-500/30 bg-red-500/5',
    description: 'The last verification attempt failed. Check the URL and try again.',
  },
}

export function TrafficSettingsForm({
  scriptToken,
  primaryWebsiteUrl,
  gtmContainerId,
  verificationState,
  verifiedAt,
}: Props) {
  const router = useRouter()
  const [websiteUrl, setWebsiteUrl] = useState(primaryWebsiteUrl ?? '')
  const [gtmId, setGtmId] = useState(gtmContainerId ?? '')
  const [installTab, setInstallTab] = useState<'gtm' | 'manual'>(gtmContainerId ? 'gtm' : 'manual')
  const [isSaving, startSave] = useTransition()
  const [isVerifying, startVerify] = useTransition()
  const [isResetting, startReset] = useTransition()
  const [lastResult, setLastResult] = useState<VerifyResult>(null)

  const scriptSrc = `https://xphere.app/api/traffic/script?t=${scriptToken}`
  const gtmTag = `<script async src="${scriptSrc}"></script>`
  const headSnippet = `<!-- Xphere Traffic | place in <head> -->
<script async src="${scriptSrc}"></script>`

  const status = STATUS_CONFIG[verificationState]
  const isDirty =
    (websiteUrl.trim() || null) !== (primaryWebsiteUrl ?? null) ||
    (gtmId.trim() || null) !== (gtmContainerId ?? null)

  function handleSave() {
    const fd = new FormData()
    fd.append('website_url', websiteUrl)
    fd.append('gtm_container_id', installTab === 'gtm' ? gtmId : '')
    startSave(async () => {
      try {
        await saveTrafficSetup(fd)
        toast.success('Settings saved')
        router.refresh()
      } catch {
        toast.error('Failed to save settings')
      }
    })
  }

  function handleVerify() {
    const url = normalizeUrl(websiteUrl || primaryWebsiteUrl || '')
    if (!url) {
      toast.error('Enter your website URL first')
      return
    }
    startVerify(async () => {
      try {
        const res = await fetch('/api/traffic/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        const json = (await res.json()) as { ok: boolean; result: VerifyResult }
        setLastResult(json.result)
        if (json.result === 'verified') {
          toast.success('Tracking is live!')
          router.refresh()
        } else if (json.result === 'no_events_yet') {
          toast.success('Script detected — waiting for first visit')
          router.refresh()
        } else if (json.result === 'url_unreachable') {
          toast.error('Could not reach that URL')
        } else {
          toast.message('No traffic detected yet')
        }
      } catch {
        setLastResult('failed')
        toast.error('Verification failed')
      }
    })
  }

  function handleReset() {
    if (
      !confirm(
        'Reset the tracking setup? Your script token stays the same, but the install will be marked as unverified and you’ll go through the setup wizard again.',
      )
    ) {
      return
    }
    startReset(async () => {
      try {
        await resetTrafficSetup()
        toast.success('Setup reset — taking you to the wizard')
        router.push('/traffic')
      } catch {
        toast.error('Failed to reset setup')
      }
    })
  }

  function openWebsite() {
    const url = normalizeUrl(websiteUrl || primaryWebsiteUrl || '')
    if (url) window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <Card>
        <CardContent className="pt-5">
          <div className={`flex items-start gap-3 rounded-lg border p-4 ${status.tone}`}>
            <span className="mt-0.5 shrink-0">{status.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">{status.label}</p>
              <p className="mt-0.5 text-xs text-text-tertiary">{status.description}</p>
              {verifiedAt && verificationState !== 'not_started' && (
                <p className="mt-1 text-[11px] text-text-tertiary">
                  Last verified{' '}
                  {new Date(verifiedAt).toLocaleString('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Website + GTM */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Globe className="h-4 w-4" /> Website
          </CardTitle>
          <CardDescription>
            The domain you want to track. Used to verify the script install.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="website-url" className="text-xs">Website URL</Label>
            <Input
              id="website-url"
              type="url"
              placeholder="https://yourwebsite.com"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
            />
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
            />
            <p className="text-[11px] text-text-tertiary">
              Saved for your reference. Tracking still works without it as long as the script tag is deployed.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving || !isDirty} size="sm">
              {isSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Install snippet */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Tracking script</CardTitle>
          <CardDescription>
            Install this snippet on your website. The token is unique to this organization — don’t share it publicly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={installTab} onValueChange={(v) => setInstallTab(v as 'gtm' | 'manual')}>
            <TabsList>
              <TabsTrigger value="gtm">Google Tag Manager</TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>

            <TabsContent value="gtm" className="mt-4 space-y-3">
              <p className="text-sm text-text-secondary">
                Add a <strong>Custom HTML</strong> tag in GTM with this content and trigger it on <strong>All Pages</strong>.
              </p>
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg bg-bg-tertiary p-4 pr-10 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
                  {gtmTag}
                </pre>
                <CopyButton text={gtmTag} />
              </div>
            </TabsContent>

            <TabsContent value="manual" className="mt-4 space-y-3">
              <p className="text-sm text-text-secondary">
                Paste this script in the <code className="rounded bg-bg-tertiary px-1 py-0.5 text-xs">&lt;head&gt;</code> of every page you want to track.
              </p>
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg bg-bg-tertiary p-4 pr-10 text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">
                  {headSnippet}
                </pre>
                <CopyButton text={headSnippet} />
              </div>
              <p className="text-[11px] text-text-tertiary">
                For Single Page Applications (React, Next.js, Vue), place the script in your root layout.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Re-verify */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Verify installation</CardTitle>
          <CardDescription>
            Re-run the install check after deploying the script or moving to a new domain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={openWebsite} disabled={!websiteUrl && !primaryWebsiteUrl}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open website
            </Button>
            <Button onClick={handleVerify} disabled={isVerifying} size="sm">
              <RefreshCw className={`h-3.5 w-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
              {isVerifying ? 'Checking…' : 'Check installation'}
            </Button>
          </div>

          {lastResult && lastResult !== 'verified' && lastResult !== 'no_events_yet' && (
            <p className="text-xs text-text-tertiary">
              {lastResult === 'url_unreachable'
                ? 'Could not reach that URL. Make sure the site is live and try again.'
                : lastResult === 'script_not_found'
                  ? 'We haven’t received any events. If you installed via GTM, the tag only loads when someone visits — open your site in a new tab and check again.'
                  : 'Verification failed. Try again in a moment.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-red-500/30">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-red-500">Reset setup</CardTitle>
          <CardDescription>
            Marks the install as unverified and sends you back to the setup wizard. Your script token stays the same so any tag already on your website keeps working.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={handleReset} disabled={isResetting}>
            <RotateCcw className="h-3.5 w-3.5" />
            {isResetting ? 'Resetting…' : 'Reset setup'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
