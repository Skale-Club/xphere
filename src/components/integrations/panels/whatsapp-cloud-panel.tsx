'use client'

/**
 * WhatsAppCloudPanel — manual-paste onboarding for the official Meta Cloud API.
 *
 * Workflow:
 *   1. User pastes WABA ID, Phone Number ID, Access Token, App Secret
 *   2. "Test connection" calls verifyCredentials() on the server
 *   3. "Connect" saves encrypted credentials and subscribes the App to
 *      receive webhooks for this WABA
 *   4. Once connected: panel switches to a summary card with template sync,
 *      Coexistence informational block, and disconnect button.
 *
 * This is COMPLETELY SEPARATE from the legacy whatsapp-panel.tsx, which
 * handles non-official providers (Evolution/Z-API/W-API). They coexist:
 * inbox via non-official, campaigns via Cloud.
 */

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, RefreshCw, Link2Off, ExternalLink, Info, Copy, Eye, EyeOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { IntegrationLogo } from '@/components/integrations/integration-logo'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import {
  getActiveCloudAccountSummary,
  getWebhookConfig,
  testCloudCredentials,
  connectCloudAccount,
  syncCloudTemplates,
  disconnectCloudAccount,
  type CloudAccountSummary,
  type WebhookConfig,
} from '@/app/(dashboard)/integrations/whatsapp/actions'
import type { CustomPanelProps } from '@/lib/integrations/registry'

export function WhatsAppCloudPanel({ definition, onClose }: CustomPanelProps) {
  const [active, setActive] = useState<CloudAccountSummary | null>(null)
  const [webhook, setWebhook] = useState<WebhookConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()

  // Form fields (used only when not yet connected)
  const [displayName, setDisplayName] = useState('WhatsApp Official')
  const [wabaId, setWabaId] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [testResult, setTestResult] = useState<
    | { ok: true; displayPhoneNumber: string | null; verifiedName: string | null; qualityRating: string | null }
    | { ok: false; error: string }
    | null
  >(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getActiveCloudAccountSummary(), getWebhookConfig()])
      .then(([summary, hook]) => {
        if (cancelled) return
        setActive(summary)
        setWebhook(hook)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  async function refreshAll() {
    const [summary, hook] = await Promise.all([
      getActiveCloudAccountSummary(),
      getWebhookConfig(),
    ])
    setActive(summary)
    setWebhook(hook)
  }

  function handleTest() {
    if (!wabaId || !phoneNumberId || !accessToken) {
      toast.error('Fill WABA ID, Phone Number ID, and Access Token first')
      return
    }
    startTransition(async () => {
      const res = await testCloudCredentials({ wabaId, phoneNumberId, accessToken })
      setTestResult(res)
      if (res.ok) {
        toast.success(`Connected to ${res.displayPhoneNumber ?? 'phone number'}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  function handleConnect() {
    if (!appSecret.trim()) {
      toast.error('App Secret is required to validate webhook events')
      return
    }
    startTransition(async () => {
      const res = await connectCloudAccount({
        displayName,
        wabaId,
        phoneNumberId,
        accessToken,
        appSecret,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('WhatsApp Cloud connected')
      await refreshAll()
    })
  }

  function handleSync() {
    startTransition(async () => {
      const res = await syncCloudTemplates()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Templates synced: +${res.inserted} new, ${res.updated} updated, -${res.deleted} removed`)
      await refreshAll()
    })
  }

  function handleDisconnect() {
    if (!confirm('Disconnect WhatsApp Cloud? Active campaigns will stop sending.')) return
    startTransition(async () => {
      const res = await disconnectCloudAccount()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Disconnected')
      setActive(null)
      setWebhook(null)
    })
  }

  return (
    <div className="flex h-full flex-col px-6 pt-6 pb-4">
      <SheetHeader className="space-y-3 pb-4">
        <div className="flex items-center gap-3">
          <IntegrationLogo logo={definition.logo} name={definition.name} size={40} />
          <div className="min-w-0">
            <SheetTitle className="text-[15px]">{definition.name}</SheetTitle>
            <p className="text-[12px] text-text-tertiary">{definition.description}</p>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto space-y-5 py-2">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : active ? (
          <ConnectedState
            account={active}
            webhook={webhook}
            onSync={handleSync}
            onDisconnect={handleDisconnect}
            pending={pending}
          />
        ) : (
          <ConnectForm
            displayName={displayName}
            setDisplayName={setDisplayName}
            wabaId={wabaId}
            setWabaId={setWabaId}
            phoneNumberId={phoneNumberId}
            setPhoneNumberId={setPhoneNumberId}
            accessToken={accessToken}
            setAccessToken={setAccessToken}
            appSecret={appSecret}
            setAppSecret={setAppSecret}
            testResult={testResult}
            onTest={handleTest}
            onConnect={handleConnect}
            pending={pending}
          />
        )}
      </div>

      <div className="flex justify-end pt-4 border-t border-border">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}

function ConnectedState({
  account,
  webhook,
  onSync,
  onDisconnect,
  pending,
}: {
  account: CloudAccountSummary
  webhook: WebhookConfig | null
  onSync: () => void
  onDisconnect: () => void
  pending: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border border-border bg-bg-secondary p-4 space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="text-[13px] font-medium text-text-primary">
            {account.phoneNumberE164 ? formatPhoneDisplay(account.phoneNumberE164) : account.displayName}
          </span>
          <Badge variant="outline" className="ml-auto text-[10px]">
            {account.status}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11.5px] text-text-tertiary">
          <div>
            <span className="block text-text-secondary">WABA ID</span>
            <span className="font-mono">{account.wabaId}</span>
          </div>
          <div>
            <span className="block text-text-secondary">Phone Number ID</span>
            <span className="font-mono">{account.phoneNumberId}</span>
          </div>
        </div>
        {account.lastError && (
          <p className="text-[11.5px] text-rose-400">{account.lastError}</p>
        )}
      </div>

      {webhook && <WebhookConfigCard webhook={webhook} />}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[12px]">Templates</Label>
          <span className="text-[11px] text-text-tertiary">
            {account.lastSyncedAt
              ? `Last synced ${new Date(account.lastSyncedAt).toLocaleString()}`
              : 'Never synced'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onSync} disabled={pending} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Sync from Meta
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/integrations/whatsapp/templates">
              Manage templates <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-[10px] border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-emerald-400" />
          <span className="text-[12.5px] font-medium text-text-primary">
            Keep your team on the WhatsApp Business app
          </span>
        </div>
        <p className="text-[11.5px] text-text-secondary leading-relaxed">
          Enable <strong>Coexistence</strong> in your Meta Business Manager and your team can keep
          answering customers from the WhatsApp Business app on mobile — while xphere handles
          campaigns and automations from the Cloud API. Messages sync in real time both ways.
        </p>
        <a
          href="https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users/"
          target="_blank"
          rel="noreferrer"
          className="text-[11.5px] text-emerald-400 hover:underline inline-flex items-center gap-1"
        >
          Setup guide <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <Button
        variant="ghost"
        onClick={onDisconnect}
        disabled={pending}
        className="text-rose-400 hover:text-rose-300 gap-1.5"
      >
        <Link2Off className="h-3.5 w-3.5" />
        Disconnect
      </Button>
    </div>
  )
}

interface ConnectFormProps {
  displayName: string
  setDisplayName: (v: string) => void
  wabaId: string
  setWabaId: (v: string) => void
  phoneNumberId: string
  setPhoneNumberId: (v: string) => void
  accessToken: string
  setAccessToken: (v: string) => void
  appSecret: string
  setAppSecret: (v: string) => void
  testResult:
    | { ok: true; displayPhoneNumber: string | null; verifiedName: string | null; qualityRating: string | null }
    | { ok: false; error: string }
    | null
  onTest: () => void
  onConnect: () => void
  pending: boolean
}

function ConnectForm(props: ConnectFormProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border border-border-subtle bg-bg-tertiary/40 p-3 text-[11.5px] text-text-secondary leading-relaxed">
        Get these from <strong>Meta Business Manager → WhatsApp → API Setup</strong>. The Access
        Token must be a <strong>System User Token</strong> with the
        <code className="mx-1">whatsapp_business_messaging</code> permission.
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cloud-display-name" className="text-[12px]">
          Display name
        </Label>
        <Input
          id="cloud-display-name"
          value={props.displayName}
          onChange={(e) => props.setDisplayName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cloud-waba-id" className="text-[12px]">
          WABA ID
        </Label>
        <Input
          id="cloud-waba-id"
          value={props.wabaId}
          onChange={(e) => props.setWabaId(e.target.value)}
          placeholder="123456789012345"
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cloud-phone-id" className="text-[12px]">
          Phone Number ID
        </Label>
        <Input
          id="cloud-phone-id"
          value={props.phoneNumberId}
          onChange={(e) => props.setPhoneNumberId(e.target.value)}
          placeholder="123456789012345"
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cloud-access-token" className="text-[12px]">
          Access Token (System User)
        </Label>
        <Textarea
          id="cloud-access-token"
          value={props.accessToken}
          onChange={(e) => props.setAccessToken(e.target.value)}
          placeholder="EAAB..."
          rows={3}
          className="font-mono text-[11.5px]"
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cloud-app-secret" className="text-[12px]">
          App Secret <span className="text-rose-400">*</span>
        </Label>
        <Input
          id="cloud-app-secret"
          type="password"
          value={props.appSecret}
          onChange={(e) => props.setAppSecret(e.target.value)}
          placeholder="app_secret"
          autoComplete="off"
        />
        <p className="text-[10.5px] text-text-tertiary leading-relaxed">
          Required. Used to validate webhook signatures. Find it in Meta Business Manager →
          App Settings → Basic → App Secret.
        </p>
      </div>

      <div className="rounded-[8px] border border-border-subtle bg-bg-tertiary/40 p-3 text-[11px] text-text-secondary">
        <p className="font-medium text-text-primary mb-1">Webhook setup</p>
        <p className="leading-relaxed">
          After you click <strong>Connect</strong>, this panel will show a unique webhook URL and
          verify token for your account. Paste both into your Meta Business Manager → WhatsApp →
          Configuration → Callback URL.
        </p>
      </div>

      {props.testResult && (
        <div
          className={`rounded-[8px] border p-3 text-[12px] ${
            props.testResult.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          }`}
        >
          {props.testResult.ok ? (
            <span>
              ✓ {props.testResult.verifiedName ?? 'Phone number'} ({props.testResult.displayPhoneNumber ?? '—'})
              {props.testResult.qualityRating && ` · quality ${props.testResult.qualityRating}`}
            </span>
          ) : (
            <span>✗ {props.testResult.error}</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" variant="secondary" onClick={props.onTest} disabled={props.pending} className="gap-1.5">
          {props.pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Test connection
        </Button>
        <Button
          size="sm"
          onClick={props.onConnect}
          disabled={props.pending || !(props.testResult?.ok)}
          className="gap-1.5"
        >
          {props.pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Connect
        </Button>
      </div>
    </div>
  )
}

// ── Per-tenant webhook configuration card ──────────────────────────────────

function WebhookConfigCard({ webhook }: { webhook: WebhookConfig }) {
  const [showToken, setShowToken] = useState(false)

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Copy failed')
    }
  }

  const maskedToken = webhook.verifyToken.slice(0, 4) + '••••••••••••' + webhook.verifyToken.slice(-4)

  return (
    <div className="rounded-[10px] border border-border bg-bg-secondary p-4 space-y-3">
      <div>
        <p className="text-[12.5px] font-medium text-text-primary mb-0.5">Webhook configuration</p>
        <p className="text-[11.5px] text-text-tertiary leading-relaxed">
          Paste both values into Meta Business Manager → WhatsApp → Configuration → Callback URL.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-text-tertiary">Callback URL</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 break-all rounded-[6px] border border-border-subtle bg-bg-tertiary/40 px-2 py-1.5 text-[11px] font-mono text-text-primary">
            {webhook.url}
          </code>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => copy(webhook.url, 'Webhook URL')}
            title="Copy URL"
            className="h-7 w-7 shrink-0"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-text-tertiary">Verify Token</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 break-all rounded-[6px] border border-border-subtle bg-bg-tertiary/40 px-2 py-1.5 text-[11px] font-mono text-text-primary">
            {showToken ? webhook.verifyToken : maskedToken}
          </code>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setShowToken((v) => !v)}
            title={showToken ? 'Hide' : 'Show'}
            className="h-7 w-7 shrink-0"
          >
            {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => copy(webhook.verifyToken, 'Verify token')}
            title="Copy token"
            className="h-7 w-7 shrink-0"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <p className="text-[10.5px] text-text-tertiary leading-relaxed">
        Subscribe events: <code>messages</code>, <code>message_status</code>,{' '}
        <code>message_template_status_update</code>. For Coexistence add{' '}
        <code>smb_message_echoes</code> and <code>smb_app_state_sync</code>.
      </p>
    </div>
  )
}
