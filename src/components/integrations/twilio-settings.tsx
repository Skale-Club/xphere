'use client'
/**
 * Twilio integration UI (v2.3 | per-org credentials panel + multi-number).
 *
 * Sections:
 *   1. Connection status   | summary pills (SMS / Voice SDK / SIP)
 *   2. SMS & basics        | account_sid, auth_token, SMS webhook URL
 *   3. Phone numbers       | list + CRUD dialog (TwilioPhoneNumbers component)
 *   4. Voice SDK           | api_key_sid, api_key_secret, twiml_app_sid (+ webhook URL hint)
 *   5. SIP / Zoiper        | sip_domain
 *
 * Secrets are NEVER returned to the client | the parent server component passes
 * a "view" object with masked hints + boolean presence flags. The user types a
 * new value into an empty input to rotate; leaving it blank keeps the previous
 * value.
 *
 * Phone numbers are managed via numbers-actions.ts and the TwilioPhoneNumbers
 * client component | independent of the credentials save flow.
 */

import * as React from 'react'
import { toast } from 'sonner'
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Mic2,
  Phone,
  Save,
  ShieldCheck,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusPill } from '@/components/design-system/status-pill'
import { SectionCard } from '@/components/integrations/section-card'
import { cn } from '@/lib/utils'
import {
  saveTwilioIntegration,
  testSendSms,
  testVoiceConfig,
  testSipConfig,
  type TwilioIntegrationView,
} from '@/app/(dashboard)/integrations/twilio/actions'
import { TwilioPhoneNumbers } from '@/components/integrations/twilio-phone-numbers'

interface TwilioSettingsProps {
  initial: TwilioIntegrationView
}

export function TwilioSettings({ initial }: TwilioSettingsProps) {
  const [view, setView] = React.useState<TwilioIntegrationView>(initial)
  const [saving, setSaving] = React.useState(false)

  // Form fields | secrets start blank (placeholder shows masked hint).
  const [accountSid, setAccountSid] = React.useState('')
  const [authToken, setAuthToken] = React.useState('')
  const [apiKeySid, setApiKeySid] = React.useState('')
  const [apiKeySecret, setApiKeySecret] = React.useState('')
  const [twimlAppSid, setTwimlAppSid] = React.useState(initial.twimlAppSid ?? '')
  const [sipDomain, setSipDomain] = React.useState(initial.sipDomain ?? '')

  const [showAuthToken, setShowAuthToken] = React.useState(false)
  const [showApiKeySecret, setShowApiKeySecret] = React.useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await saveTwilioIntegration({
        accountSid,
        authToken,
        apiKeySid,
        apiKeySecret,
        twimlAppSid,
        sipDomain,
      })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Twilio settings saved')
      // Clear secret inputs after save | view will refresh via revalidatePath
      setAccountSid('')
      setAuthToken('')
      setApiKeySid('')
      setApiKeySecret('')
      // Optimistically update boolean flags so the status pills flip without a reload.
      // smsConfigured / voiceConfigured also need at least one capable active number;
      // numbers state is managed separately (see TwilioPhoneNumbers component) so
      // we keep the prev.numbers slice intact.
      setView((prev) => {
        const hasAccountSid = prev.hasAccountSid || accountSid.trim().length > 0
        const hasAuthToken = prev.hasAuthToken || authToken.trim().length > 0
        const hasApiKeySid = prev.hasApiKeySid || apiKeySid.trim().length > 0
        const hasApiKeySecret = prev.hasApiKeySecret || apiKeySecret.trim().length > 0
        const newTwimlAppSid = twimlAppSid.trim() || prev.twimlAppSid
        const newSipDomain = sipDomain.trim() || prev.sipDomain
        const hasSmsCapableNumber = prev.numbers.some((n) => n.is_active && n.capability_sms)
        const hasVoiceCapableNumber = prev.numbers.some((n) => n.is_active && n.capability_voice)
        return {
          ...prev,
          hasAccountSid,
          hasAuthToken,
          hasApiKeySid,
          hasApiKeySecret,
          twimlAppSid: newTwimlAppSid,
          sipDomain: newSipDomain,
          smsConfigured: hasAccountSid && hasAuthToken && hasSmsCapableNumber,
          voiceConfigured:
            hasAccountSid && hasApiKeySid && hasApiKeySecret && Boolean(newTwimlAppSid) && hasVoiceCapableNumber,
          sipConfigured: Boolean(newSipDomain),
        }
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Connection summary */}
      <section className="rounded-[14px] border border-border bg-bg-secondary p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[14px] font-medium text-text-primary">Connection status</div>
            <p className="mt-0.5 text-[12.5px] text-text-secondary">
              Each section can be configured independently. Voice SDK is only required if you place calls from the browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SectionPill label="SMS" ready={view.smsConfigured} />
            <SectionPill label="Voice SDK" ready={view.voiceConfigured} />
            <SectionPill label="SIP" ready={view.sipConfigured} />
          </div>
        </div>
      </section>

      {/* ── 1. SMS & basics ─────────────────────────────────────────────── */}
      <SectionCard
        icon={Phone}
        title="SMS &amp; account basics"
        description="Required for inbound SMS, outbound SMS via the send_sms action, and signature validation on every Twilio webhook."
        statusReady={view.smsConfigured}
        readyLabel="SMS ready"
        emptyLabel="SMS not configured"
        helpLinks={[
          { label: 'Twilio console → Account Info', href: 'https://console.twilio.com/' },
          { label: 'Buy a phone number', href: 'https://console.twilio.com/us1/develop/phone-numbers/manage/incoming' },
        ]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Account SID"
            placeholder={view.accountSidHint ?? 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
            value={accountSid}
            onChange={setAccountSid}
            mono
            hint="Starts with AC. From the Twilio console homepage."
          />
          <SecretField
            label="Auth Token"
            placeholder={view.hasAuthToken ? '•••••••••••• (stored)' : 'Click "View" in the Twilio console'}
            value={authToken}
            onChange={setAuthToken}
            visible={showAuthToken}
            onToggle={() => setShowAuthToken((v) => !v)}
            hint="Used to validate webhook signatures on inbound SMS and voice calls."
          />
          <div className="md:col-span-2 space-y-1.5">
            <Label>Inbound SMS webhook</Label>
            <CopyRow value={view.smsWebhookUrl} />
            <p className="text-[11.5px] text-text-tertiary">
              Paste into your Twilio number&apos;s &ldquo;A message comes in&rdquo; field (HTTP POST).
            </p>
          </div>
        </div>

        <TestSmsRow defaultTo={getDefaultE164(view) ?? ''} disabled={!view.smsConfigured} />
      </SectionCard>

      {/* ── 2. Phone numbers ────────────────────────────────────────────── */}
      <TwilioPhoneNumbers initial={view.numbers} />

      {/* ── 2. Voice SDK ─────────────────────────────────────────────────── */}
      <SectionCard
        icon={Mic2}
        title="Voice SDK (browser calling)"
        description="Required only when at least one team member uses the in-browser dialer. Skip if everyone uses phone-forward or Zoiper."
        statusReady={view.voiceConfigured}
        readyLabel="Voice SDK ready"
        emptyLabel="Voice not configured"
        helpLinks={[
          { label: 'Create API Key (console)', href: 'https://console.twilio.com/us1/account/keys-credentials/api-keys' },
          { label: 'Create TwiML App', href: 'https://console.twilio.com/us1/develop/voice/manage/twiml-apps' },
        ]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="API Key SID"
            placeholder={view.apiKeySidHint ?? 'SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
            value={apiKeySid}
            onChange={setApiKeySid}
            mono
            hint="Starts with SK. Created under Account → API keys & tokens."
          />
          <SecretField
            label="API Key Secret"
            placeholder={view.hasApiKeySecret ? '•••••••••••• (stored)' : 'Shown only when the API Key is created'}
            value={apiKeySecret}
            onChange={setApiKeySecret}
            visible={showApiKeySecret}
            onToggle={() => setShowApiKeySecret((v) => !v)}
            hint="Twilio reveals this once. Store it here | Xphere never displays it again."
          />
          <Field
            label="TwiML App SID"
            placeholder="APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={twimlAppSid}
            onChange={setTwimlAppSid}
            mono
            hint="Starts with AP. Created under Voice → Manage → TwiML Apps."
          />
          <div className="space-y-1.5">
            <Label>Voice webhook URL (paste in TwiML App)</Label>
            <CopyRow value={view.voiceWebhookUrl} />
            <p className="text-[11.5px] text-text-tertiary">
              Paste into the TwiML App&apos;s &ldquo;Request URL&rdquo; under Voice Configuration (HTTP POST).
            </p>
          </div>
        </div>

        <TestVoiceRow disabled={!view.voiceConfigured} />
      </SectionCard>

      {/* ── 3. SIP / Zoiper ──────────────────────────────────────────────── */}
      <SectionCard
        icon={Globe}
        title="SIP / Zoiper domain"
        description="Required only when team members use the SIP routing mode with a softphone like Zoiper. The SIP credentials themselves are auto-generated per user in Settings → Calls."
        statusReady={view.sipConfigured}
        readyLabel="SIP ready"
        emptyLabel="SIP not configured"
        helpLinks={[
          { label: 'Create SIP Domain', href: 'https://console.twilio.com/us1/develop/voice/manage/sip-domains' },
        ]}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="SIP domain"
            placeholder="acme.sip.twilio.com"
            value={sipDomain}
            onChange={setSipDomain}
            mono
            hint="The domain you created under Voice → Manage → SIP Domains. No protocol prefix."
          />
          <div className="space-y-1.5">
            <Label>Inbound SIP voice webhook</Label>
            <CopyRow value={view.voiceWebhookUrl} />
            <p className="text-[11.5px] text-text-tertiary">
              Paste into your SIP Domain&apos;s &ldquo;A call comes in&rdquo; field (HTTP POST).
            </p>
          </div>
        </div>

        <TestSipRow disabled={!view.sipConfigured} />
      </SectionCard>

      {/* Save bar */}
      <div className="sticky bottom-4 flex items-center justify-between rounded-[12px] border border-border bg-bg-secondary/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-[12.5px] text-text-tertiary">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Secrets are encrypted with AES-256-GCM before they hit the database.</span>
        </div>
        <Button onClick={handleSave} loading={saving} disabled={saving}>
          <Save className="h-3.5 w-3.5" />
          Save changes
        </Button>
      </div>
    </div>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────────

function getDefaultE164(view: TwilioIntegrationView): string | null {
  const def = view.numbers.find((n) => n.is_default && n.is_active)
  return def?.e164 ?? null
}

// ── building blocks ─────────────────────────────────────────────────────────

function SectionPill({ label, ready }: { label: string; ready: boolean }) {
  return (
    <StatusPill tone={ready ? 'success' : 'idle'}>
      {ready ? `${label} ✓` : `${label} pending`}
    </StatusPill>
  )
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  hint,
  mono,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  hint?: string
  mono?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(mono && 'font-mono text-[12.5px]')}
        autoComplete="off"
      />
      {hint && <p className="text-[11.5px] text-text-tertiary">{hint}</p>}
    </div>
  )
}

function SecretField({
  label,
  placeholder,
  value,
  onChange,
  visible,
  onToggle,
  hint,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  visible: boolean
  onToggle: () => void
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={visible ? 'text' : 'password'}
          className="pr-9 font-mono text-[12.5px]"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
          aria-label={visible ? 'Hide' : 'Show'}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      {hint && <p className="text-[11.5px] text-text-tertiary">{hint}</p>}
    </div>
  )
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Clipboard unavailable')
    }
  }
  return (
    <div className="group flex items-center gap-2 rounded-[10px] border border-border bg-bg-primary px-3 py-2 transition-colors hover:border-border-strong">
      <code className="flex-1 truncate font-mono text-[12px] text-text-primary">{value}</code>
      <button
        type="button"
        onClick={handleCopy}
        className="text-text-tertiary transition-colors hover:text-accent"
        aria-label="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

function TestSmsRow({ defaultTo, disabled }: { defaultTo: string; disabled: boolean }) {
  const [to, setTo] = React.useState(defaultTo)
  const [running, setRunning] = React.useState(false)
  async function run() {
    if (!to.trim()) {
      toast.error('Enter a destination phone number first.')
      return
    }
    setRunning(true)
    try {
      const res = await testSendSms({ to })
      if (res.success) {
        toast.success(`SMS sent. SID: ${res.sid}`)
      } else {
        toast.error(res.error ?? 'Test failed')
      }
    } finally {
      setRunning(false)
    }
  }
  return (
    <div className="rounded-[10px] border border-border-subtle bg-bg-tertiary/50 p-3">
      <div className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">Test SMS</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="+14155551234"
          className="max-w-xs font-mono text-[12.5px]"
        />
        <Button size="sm" variant="secondary" onClick={run} loading={running} disabled={disabled || running}>
          Send test SMS
        </Button>
        {disabled && (
          <span className="text-[11.5px] text-text-tertiary">Save SMS credentials first.</span>
        )}
      </div>
    </div>
  )
}

function TestVoiceRow({ disabled }: { disabled: boolean }) {
  const [running, setRunning] = React.useState(false)
  async function run() {
    setRunning(true)
    try {
      const res = await testVoiceConfig()
      if (res.success) {
        toast.success(`Voice SDK ready. Test identity: ${res.identity}`)
      } else {
        toast.error(res.error ?? 'Test failed')
      }
    } finally {
      setRunning(false)
    }
  }
  return (
    <div className="rounded-[10px] border border-border-subtle bg-bg-tertiary/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">Test Voice SDK</div>
          <p className="mt-0.5 text-[11.5px] text-text-tertiary">Generates a short-lived token to verify the API Key + TwiML App combination works.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={run} loading={running} disabled={disabled || running}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Validate
        </Button>
      </div>
    </div>
  )
}

function TestSipRow({ disabled }: { disabled: boolean }) {
  const [running, setRunning] = React.useState(false)
  async function run() {
    setRunning(true)
    try {
      const res = await testSipConfig()
      if (res.success) {
        toast.success(`SIP domain stored: ${res.sipDomain}`)
      } else {
        toast.error(res.error ?? 'Test failed')
      }
    } finally {
      setRunning(false)
    }
  }
  return (
    <div className="rounded-[10px] border border-border-subtle bg-bg-tertiary/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">Test SIP</div>
          <p className="mt-0.5 text-[11.5px] text-text-tertiary">Confirms the SIP domain is saved. The actual SIP registration is tested via Zoiper.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={run} loading={running} disabled={disabled || running}>
          Check
        </Button>
      </div>
    </div>
  )
}
