'use client'

// SEED-042 | Twilio custom panel.
// Tabs: Credentials · Numbers · Voice SDK · SIP. Credentials uses the
// existing saveIntegrationCredentials flow; the other tabs link to the
// existing dedicated pages (numbers, voice/SIP tests live there).

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, ExternalLink, Eye, EyeOff, Loader2, Save, X, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { IntegrationLogo } from '../integration-logo'
import {
  saveIntegrationCredentials,
  testIntegrationConnection,
  toggleIntegrationActive,
} from '@/app/(dashboard)/integrations/actions'
import type { CustomPanelProps } from '@/lib/integrations/registry'

type Tab = 'credentials' | 'numbers' | 'voice_sdk' | 'sip'

const TABS: { id: Tab; label: string }[] = [
  { id: 'credentials', label: 'Credentials' },
  { id: 'numbers', label: 'Numbers' },
  { id: 'voice_sdk', label: 'Voice SDK' },
  { id: 'sip', label: 'SIP' },
]

export function TwilioPanel({ definition, existing, onClose }: CustomPanelProps) {
  const [tab, setTab] = useState<Tab>('credentials')

  return (
    <div className="flex h-full flex-col px-6 pt-6 pb-4">
      <SheetHeader className="space-y-3 pb-3">
        <div className="flex items-center gap-3">
          <IntegrationLogo logo={definition.logo} name={definition.name} size={40} />
          <div className="min-w-0">
            <SheetTitle className="text-[15px]">{definition.name}</SheetTitle>
            <p className="text-[12px] text-text-tertiary">{definition.description}</p>
          </div>
        </div>
      </SheetHeader>

      <div className="-mx-6 border-b border-border-subtle px-6">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2.5 text-[13px] transition-colors',
                tab === t.id
                  ? 'border-accent font-medium text-text-primary'
                  : 'border-transparent text-text-tertiary hover:text-text-primary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        {tab === 'credentials' && (
          <TwilioCredentialsTab
            existing={existing}
            definitionName={definition.name}
            canActivate={definition.canActivate}
            onSaved={onClose}
          />
        )}
        {tab === 'numbers' && <TwilioNumbersTab />}
        {tab === 'voice_sdk' && <TwilioStubTab kind="voice_sdk" />}
        {tab === 'sip' && <TwilioStubTab kind="sip" />}
      </div>
    </div>
  )
}

function TwilioCredentialsTab({
  existing,
  definitionName,
  canActivate,
  onSaved,
}: {
  existing: CustomPanelProps['existing']
  definitionName: string
  canActivate: boolean
  onSaved: () => void
}) {
  const router = useRouter()
  const [accountSid, setAccountSid] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'pass' | 'fail'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isActive, setIsActive] = useState(existing?.is_active ?? false)
  const [isToggling, setIsToggling] = useState(false)

  const dirty = accountSid.length > 0 || authToken.length > 0
  const canSave = testState === 'pass'

  async function handleTest() {
    setTestState('testing')
    setTestMessage('Testing Twilio credentials…')
    const res = await testIntegrationConnection('twilio', {
      api_key: authToken,
      account_sid: accountSid,
      auth_token: authToken,
    })
    if (res.ok) {
      setTestState('pass')
      setTestMessage('Twilio account reachable.')
    } else {
      setTestState('fail')
      setTestMessage(res.error ?? 'Test failed.')
    }
  }

  async function handleSave() {
    setIsSaving(true)
    try {
      const res = await saveIntegrationCredentials('twilio', {
        api_key: authToken,
        account_sid: accountSid,
      })
      if (!res.ok) {
        toast.error(res.error ?? 'Failed to save.')
        return
      }
      toast.success(`${definitionName} saved.`)
      router.refresh()
      onSaved()
    } finally {
      setIsSaving(false)
    }
  }

  async function handleToggleActive(next: boolean) {
    if (!existing) return
    setIsToggling(true)
    const prev = isActive
    setIsActive(next)
    try {
      const res = await toggleIntegrationActive('twilio', next)
      if (!res.ok) {
        setIsActive(prev)
        toast.error(res.error ?? 'Failed to update.')
      } else {
        toast.success(next ? 'Twilio activated.' : 'Twilio deactivated.')
        router.refresh()
      }
    } finally {
      setIsToggling(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex-1 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="tw-sid">
            Account SID<span className="ml-0.5 text-rose-400">*</span>
          </Label>
          <Input
            id="tw-sid"
            placeholder={existing ? '••••••••• (saved)' : 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
            value={accountSid}
            onChange={(e) => {
              setAccountSid(e.target.value)
              setTestState('idle')
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tw-token">
            Auth Token<span className="ml-0.5 text-rose-400">*</span>
          </Label>
          <div className="relative">
            <Input
              id="tw-token"
              type={showToken ? 'text' : 'password'}
              placeholder={existing ? `••••••••• (${existing.masked_api_key})` : 'Enter Auth Token'}
              value={authToken}
              onChange={(e) => {
                setAuthToken(e.target.value)
                setTestState('idle')
              }}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
              aria-label={showToken ? 'Hide' : 'Show'}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-text-tertiary">
            Find both in console.twilio.com → Account → API keys & tokens.
          </p>
        </div>

        {testState !== 'idle' && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px]',
              testState === 'pass' && 'bg-[var(--success-muted)] text-success',
              testState === 'fail' && 'bg-rose-500/10 text-rose-400',
              testState === 'testing' && 'bg-bg-tertiary text-text-tertiary',
            )}
          >
            {testState === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {testState === 'pass' && <Check className="h-3.5 w-3.5" />}
            {testState === 'fail' && <X className="h-3.5 w-3.5" />}
            <span>{testMessage}</span>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-border-subtle pt-4">
        {canActivate && existing && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-text-primary">Active</p>
              <p className="text-[11px] text-text-tertiary">
                {isActive ? 'In use by workflows and agents.' : 'Saved but not enabled.'}
              </p>
            </div>
            <Switch checked={isActive} disabled={isToggling} onCheckedChange={handleToggleActive} />
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testState === 'testing' || isSaving || !dirty}
            className="flex-1"
          >
            {testState === 'testing' ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Testing…
              </>
            ) : (
              <>
                <Zap className="mr-1 h-3.5 w-3.5" /> Test
              </>
            )}
          </Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving} className="flex-1">
            {isSaving ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Save className="mr-1 h-3.5 w-3.5" /> Save
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TwilioNumbersTab() {
  return (
    <div className="space-y-3 text-[13px] text-text-secondary">
      <p>
        Manage phone numbers, default outbound number, voice/SMS webhooks and
        per-number settings on the dedicated Twilio page.
      </p>
      <Button asChild variant="outline" className="w-full justify-between">
        <Link href="/integrations/twilio">
          Open Twilio number manager
          <ArrowRight className="ml-2 h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  )
}

function TwilioStubTab({ kind }: { kind: 'voice_sdk' | 'sip' }) {
  const label = kind === 'voice_sdk' ? 'Voice SDK' : 'SIP'
  return (
    <div className="space-y-3 text-[13px] text-text-secondary">
      <p className="text-text-tertiary">
        {label} configuration is available on the dedicated Twilio page. The
        inline editor for {label} is coming soon.
      </p>
      <Button asChild variant="outline" className="w-full justify-between">
        <Link href="/integrations/twilio">
          Open Twilio settings
          <ExternalLink className="ml-2 h-3.5 w-3.5" />
        </Link>
      </Button>
    </div>
  )
}
