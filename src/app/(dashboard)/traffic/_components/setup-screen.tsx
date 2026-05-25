'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, Copy, Check, Globe, Tag } from 'lucide-react'
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

export function SetupScreen({ setup }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [websiteUrl, setWebsiteUrl] = useState(setup.primary_website_url ?? '')
  const [gtmId, setGtmId] = useState(setup.gtm_container_id ?? '')
  const [installTab, setInstallTab] = useState<'gtm' | 'manual'>('gtm')

  const scriptSrc = `https://xphere.app/api/traffic/script?t=${setup.script_token}`

  const gtmTag = `<script async src="${scriptSrc}"></script>`

  const headSnippet = `<!-- Xphere Traffic | place in <head> -->
<script async src="${scriptSrc}"></script>`

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const fd = new FormData()
    fd.append('website_url', websiteUrl)
    fd.append('gtm_container_id', installTab === 'gtm' ? gtmId : '')
    startTransition(async () => {
      await saveTrafficSetup(fd)
      toast.success('Setup saved')
      router.refresh()
    })
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
          <BarChart3 className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Set up Traffic tracking</h1>
          <p className="text-sm text-text-tertiary">Install the tracking script on your website to start collecting data.</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
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
            />
            <p className="mt-1.5 text-xs text-text-tertiary">Used to verify that the script is installed correctly.</p>
          </CardContent>
        </Card>

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

        <Button type="submit" disabled={isPending || !websiteUrl} className="w-full">
          {isPending ? 'Saving…' : 'Save & verify installation'}
        </Button>
      </form>
    </div>
  )
}
