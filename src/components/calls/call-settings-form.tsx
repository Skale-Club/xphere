'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  PhoneForwarded,
  Headphones,
  Globe,
  Check,
  Copy,
  RefreshCw,
  Eye,
  EyeOff,
  Mic,
  Info,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  saveCallSettings,
  rotateSipPassword,
  type CurrentCallSettings,
} from '@/app/(dashboard)/voice/actions'
import { normaliseE164 } from '@/lib/calls/zod-schemas'
import type { CallRoutingMode } from '@/types/database'
import { ZoiperSetupGuide } from './zoiper-setup-guide'

interface CallSettingsFormProps {
  initial: CurrentCallSettings
  sipDomain: string | null
}

interface ModeMeta {
  id: CallRoutingMode
  label: string
  icon: React.ComponentType<{ className?: string }>
  tagline: string
  description: string
  pros: string[]
}

const MODES: ModeMeta[] = [
  {
    id: 'phone_forward',
    label: 'Forward to phone',
    icon: PhoneForwarded,
    tagline: 'Easiest setup',
    description: 'Inbound calls ring your real phone. Zero apps to install.',
    pros: ['Zero setup', 'Works anywhere', 'Native phone UX'],
  },
  {
    id: 'sip',
    label: 'Zoiper / SIP',
    icon: Headphones,
    tagline: 'Lowest cost',
    description: 'Use a free softphone like Zoiper on desktop or mobile.',
    pros: ['Cheapest legs', 'Desktop + mobile', 'Hands-free with headset'],
  },
  {
    id: 'browser',
    label: 'In the browser',
    icon: Globe,
    tagline: 'Most integrated',
    description: 'Pick up calls right inside Xphere with WebRTC audio.',
    pros: ['One-click answer', 'Contact name shown', 'No external app'],
  },
]

export function CallSettingsForm({ initial, sipDomain }: CallSettingsFormProps) {
  const [mode, setMode] = React.useState<CallRoutingMode>(initial.routing_mode)
  const [phoneForward, setPhoneForward] = React.useState<string>(initial.phone_forward ?? '')
  const [recordCalls, setRecordCalls] = React.useState<boolean>(initial.record_calls)
  const [saving, setSaving] = React.useState(false)
  const [phoneError, setPhoneError] = React.useState<string | null>(null)
  const [sipPassword, setSipPassword] = React.useState<string | null>(null)
  const [sipUsername, setSipUsername] = React.useState<string | null>(initial.sip_username)
  const [showPassword, setShowPassword] = React.useState(false)

  // Auto-save indicator
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null)

  function validate(): boolean {
    if (mode === 'phone_forward') {
      const n = normaliseE164(phoneForward)
      if (!n) {
        setPhoneError('Use an E.164 number, e.g. +14155551234.')
        return false
      }
    }
    setPhoneError(null)
    return true
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    const res = await saveCallSettings({
      routing_mode: mode,
      phone_forward: phoneForward || null,
      record_calls: recordCalls,
    })
    setSaving(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    if (res.settings?.sip_username) setSipUsername(res.settings.sip_username)
    setLastSavedAt(new Date())
    toast.success('Call settings saved')
  }

  async function handleRotateSip() {
    setSaving(true)
    const res = await rotateSipPassword()
    setSaving(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    setSipPassword(res.password ?? null)
    if (res.username) setSipUsername(res.username)
    setShowPassword(true)
    toast.success('SIP credentials generated | copy them now, the password is shown only once.')
  }

  return (
    <div className="space-y-8">
      {/* Mode selector | 3 BIG cards */}
      <section className="space-y-3">
        <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          Routing mode
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODES.map((m) => {
            const selected = mode === m.id
            const Icon = m.icon
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={cn(
                  'group relative flex flex-col items-start gap-3 overflow-hidden rounded-[14px] border p-5 text-left transition-all duration-200',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
                  selected
                    ? 'border-accent bg-accent/[0.06] shadow-glow'
                    : 'border-border bg-bg-secondary hover:border-border-strong hover:bg-bg-tertiary/60',
                )}
              >
                {/* Selection ring */}
                <div
                  className={cn(
                    'absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                    selected
                      ? 'border-accent bg-accent text-white'
                      : 'border-border-strong bg-bg-secondary',
                  )}
                >
                  {selected && <Check className="h-3 w-3" />}
                </div>

                <div
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-[12px] transition-colors',
                    selected
                      ? 'bg-accent text-white'
                      : 'bg-bg-tertiary text-text-secondary group-hover:text-text-primary',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-medium text-text-primary">
                      {m.label}
                    </span>
                    <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                      {m.tagline}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-text-secondary leading-relaxed">
                    {m.description}
                  </p>
                </div>

                <ul className="mt-1 space-y-1 text-[11.5px] text-text-tertiary">
                  {m.pros.map((p) => (
                    <li key={p} className="flex items-center gap-1.5">
                      <Check className="h-3 w-3 text-accent" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </button>
            )
          })}
        </div>
      </section>

      {/* Per-mode configuration */}
      <section className="rounded-[14px] border border-border bg-bg-secondary p-6 space-y-5">
        {mode === 'phone_forward' && (
          <div className="space-y-3">
            <h3 className="text-[14px] font-medium text-text-primary">
              Phone number to ring
            </h3>
            <p className="text-[12.5px] text-text-secondary">
              We&apos;ll bridge inbound calls to this number. Use international format (+country code).
            </p>
            <PhoneInput
              value={phoneForward}
              onChange={setPhoneForward}
              placeholder="Phone number"
              className="max-w-md"
              aria-invalid={Boolean(phoneError)}
            />
            {phoneError && (
              <p className="text-[12px] text-rose-400">{phoneError}</p>
            )}
          </div>
        )}

        {mode === 'sip' && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[14px] font-medium text-text-primary">SIP credentials</h3>
                <p className="mt-1 text-[12.5px] text-text-secondary">
                  Paste these into Zoiper or any SIP softphone.
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={handleRotateSip} loading={saving}>
                <RefreshCw className="h-3.5 w-3.5" />
                {sipUsername ? 'Rotate password' : 'Generate'}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <CopyField
                label="SIP domain"
                value={sipDomain ?? '| not yet configured |'}
                disabled={!sipDomain}
              />
              <CopyField label="Username" value={sipUsername ?? '| generate to view |'} disabled={!sipUsername} />
              <CopyField
                label="Password"
                value={sipPassword ?? (sipUsername ? '••••••••••••' : '| generate to view |')}
                disabled={!sipPassword && !sipUsername}
                hidden={!showPassword && Boolean(sipPassword)}
                onToggleHidden={sipPassword ? () => setShowPassword((v) => !v) : undefined}
              />
              <CopyField label="Server / Proxy" value={sipDomain ?? '|'} disabled={!sipDomain} />
            </div>

            {sipPassword && (
              <div className="rounded-[10px] border border-amber-400/40 bg-amber-400/[0.06] p-3 text-[12px] text-amber-200">
                Heads up: this password is shown only once. Copy it into Zoiper now | we&apos;ll never reveal it again.
              </div>
            )}

            <ZoiperSetupGuide
              sipDomain={sipDomain}
              username={sipUsername}
              password={sipPassword}
            />
          </div>
        )}

        {mode === 'browser' && (
          <div className="space-y-3">
            <h3 className="text-[14px] font-medium text-text-primary">In-browser calling</h3>
            <p className="text-[12.5px] text-text-secondary">
              Inbound calls show a banner inside Xphere. Place outbound calls from any contact with one click.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <BrowserTestButton />
              <span className="rounded-full bg-bg-tertiary px-2.5 py-1 text-[11px] text-text-tertiary">
                Requires Twilio API Key + TwiML App in the Twilio integration
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Recording toggle */}
      <section className="rounded-[14px] border border-border bg-bg-secondary p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-bg-tertiary text-text-secondary">
              <Mic className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[13.5px] font-medium text-text-primary">Record calls</div>
              <p className="mt-0.5 max-w-md text-[12.5px] text-text-secondary">
                Calls are stored privately in Hetzner Object Storage and linked to the contact.
                Disclose recording per your jurisdiction.
              </p>
            </div>
          </div>
          <Switch checked={recordCalls} onCheckedChange={setRecordCalls} />
        </div>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-4 flex items-center justify-between rounded-[12px] border border-border bg-bg-secondary/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-[12.5px] text-text-tertiary">
          <Info className="h-3.5 w-3.5" />
          {lastSavedAt
            ? <span>Saved {formatTime(lastSavedAt)}</span>
            : <span>Click save to apply your routing changes.</span>}
        </div>
        <Button onClick={handleSave} loading={saving} disabled={saving}>
          Save changes
        </Button>
      </div>
    </div>
  )
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function CopyField({
  label,
  value,
  disabled,
  hidden,
  onToggleHidden,
}: {
  label: string
  value: string
  disabled?: boolean
  hidden?: boolean
  onToggleHidden?: () => void
}) {
  const [copied, setCopied] = React.useState(false)

  async function handleCopy() {
    if (disabled) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast.success(`${label} copied`)
    } catch {
      toast.error('Clipboard unavailable')
    }
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-[10px] border border-border bg-bg-primary px-3 py-2 transition-colors',
          !disabled && 'hover:border-border-strong',
        )}
      >
        <code className={cn(
          'flex-1 truncate font-mono text-[12.5px]',
          disabled ? 'text-text-tertiary' : 'text-text-primary',
        )}>
          {hidden ? '•'.repeat(Math.max(value.length, 8)) : value}
        </code>
        {onToggleHidden && (
          <button
            type="button"
            onClick={onToggleHidden}
            className="text-text-tertiary hover:text-text-primary"
            aria-label={hidden ? 'Show' : 'Hide'}
          >
            {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          disabled={disabled}
          className={cn(
            'text-text-tertiary transition-colors hover:text-accent disabled:opacity-50',
          )}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}

function BrowserTestButton() {
  const [testing, setTesting] = React.useState(false)
  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/twilio/token', { method: 'POST' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(j.error ?? `Token request failed (${res.status})`)
        return
      }
      const data = (await res.json()) as { identity: string }
      toast.success(`Browser audio ready | identity ${data.identity}`)
    } finally {
      setTesting(false)
    }
  }
  return (
    <Button variant="secondary" onClick={handleTest} loading={testing}>
      <Globe className="h-3.5 w-3.5" />
      Test browser audio
    </Button>
  )
}
