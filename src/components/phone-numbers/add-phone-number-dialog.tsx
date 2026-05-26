'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Phone } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

import { TwilioLogo } from '@/components/brand/twilio-logo'
import { saveTwilioIntegration } from '@/app/(dashboard)/integrations/twilio/actions'
import {
  createTwilioNumber,
  listIncomingTwilioNumbers,
} from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { buildCreatePayload } from '@/lib/phone-numbers/import'
import type { TwilioRemoteNumber } from '@/lib/phone-numbers/import'

type Step = 'credentials' | 'pick' | 'manual' | 'configure' | 'saving'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** True when the org already has Twilio account_sid + auth_token saved. */
  twilioConnected: boolean
}

const E164_REGEX = /^\+[1-9]\d{6,14}$/

interface ManualForm {
  e164: string
  friendlyName: string
  capVoice: boolean
  capSms: boolean
  capMms: boolean
}

const EMPTY_MANUAL: ManualForm = {
  e164: '',
  friendlyName: '',
  capVoice: true,
  capSms: true,
  capMms: false,
}

interface ConfigureForm {
  friendlyName: string
  capVoice: boolean
  capSms: boolean
  capMms: boolean
  isDefault: boolean
}

export function AddPhoneNumberDialog({ open, onOpenChange, twilioConnected }: Props) {
  const router = useRouter()
  const [step, setStep] = React.useState<Step>('credentials')
  const [error, setError] = React.useState<string | null>(null)

  // Credentials
  const [accountSid, setAccountSid] = React.useState('')
  const [authToken, setAuthToken] = React.useState('')

  // Remote-list state
  const [remoteNumbers, setRemoteNumbers] = React.useState<TwilioRemoteNumber[] | null>(null)
  const [remoteLoading, setRemoteLoading] = React.useState(false)
  const [selectedSid, setSelectedSid] = React.useState<string | null>(null)

  // Manual + Configure forms
  const [manual, setManual] = React.useState<ManualForm>(EMPTY_MANUAL)
  const [configure, setConfigure] = React.useState<ConfigureForm | null>(null)

  function resetState(targetStep: Step) {
    setStep(targetStep)
    setError(null)
    setAccountSid('')
    setAuthToken('')
    setRemoteNumbers(null)
    setRemoteLoading(false)
    setSelectedSid(null)
    setManual(EMPTY_MANUAL)
    setConfigure(null)
  }

  function handleOpenChange(next: boolean) {
    if (step === 'saving') return
    if (!next) {
      resetState(twilioConnected ? 'pick' : 'credentials')
    }
    onOpenChange(next)
  }

  // Auto-load the remote list whenever we enter the pick step with creds ready.
  React.useEffect(() => {
    if (!open) return
    if (step !== 'pick') return
    if (remoteNumbers !== null || remoteLoading) return
    void loadRemoteNumbers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step])

  // When the dialog opens, jump straight to pick step if Twilio is connected.
  React.useEffect(() => {
    if (open) {
      setStep(twilioConnected ? 'pick' : 'credentials')
      setError(null)
    }
  }, [open, twilioConnected])

  async function loadRemoteNumbers() {
    setRemoteLoading(true)
    setError(null)
    const res = await listIncomingTwilioNumbers()
    setRemoteLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setRemoteNumbers(res.data ?? [])
  }

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!accountSid.trim() || !authToken.trim()) {
      setError('Account SID and Auth Token are required.')
      return
    }
    setStep('saving')
    const res = await saveTwilioIntegration({
      accountSid: accountSid.trim(),
      authToken: authToken.trim(),
    })
    if (res.error) {
      setError(res.error)
      setStep('credentials')
      return
    }
    setStep('pick')
  }

  function handlePickConfirm() {
    if (!selectedSid || !remoteNumbers) return
    const picked = remoteNumbers.find((n) => n.sid === selectedSid)
    if (!picked) return
    setConfigure({
      friendlyName: picked.friendlyName,
      capVoice: picked.capabilities.voice,
      capSms: picked.capabilities.sms,
      capMms: picked.capabilities.mms,
      isDefault: false,
    })
    setStep('configure')
  }

  async function handleConfigureSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSid || !remoteNumbers || !configure) return
    const picked = remoteNumbers.find((n) => n.sid === selectedSid)
    if (!picked) return

    if (!configure.capVoice && !configure.capSms && !configure.capMms) {
      setError('Enable at least one capability.')
      return
    }

    setStep('saving')
    setError(null)
    const payload = buildCreatePayload(
      {
        sid: picked.sid,
        e164: picked.e164,
        friendlyName: picked.friendlyName,
        capabilities: picked.capabilities,
      },
      {
        friendlyName: configure.friendlyName,
        capabilities: { voice: configure.capVoice, sms: configure.capSms, mms: configure.capMms },
        isDefault: configure.isDefault,
      },
    )
    const res = await createTwilioNumber(payload)
    if (res.error) {
      setError(res.error)
      setStep('configure')
      return
    }
    toast.success(`Phone number ${res.data?.e164} connected.`)
    onOpenChange(false)
    resetState(twilioConnected ? 'pick' : 'credentials')
    router.refresh()
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const e164 = manual.e164.trim()
    if (!E164_REGEX.test(e164)) {
      setError('Use E.164 format, e.g. +14155552671.')
      return
    }
    if (!manual.friendlyName.trim()) {
      setError('Give the number a friendly name.')
      return
    }
    if (!manual.capVoice && !manual.capSms && !manual.capMms) {
      setError('Enable at least one capability.')
      return
    }
    setStep('saving')
    const res = await createTwilioNumber({
      e164,
      friendly_name: manual.friendlyName.trim(),
      capability_voice: manual.capVoice,
      capability_sms: manual.capSms,
      capability_mms: manual.capMms,
      is_default: false,
    })
    if (res.error) {
      setError(res.error)
      setStep('manual')
      return
    }
    toast.success(`Phone number ${res.data?.e164} connected.`)
    onOpenChange(false)
    resetState(twilioConnected ? 'pick' : 'credentials')
    router.refresh()
  }

  const dialogTitle: Record<Step, string> = {
    credentials: 'Connect Twilio',
    pick: 'Pick a number from your Twilio account',
    manual: 'Enter a number manually',
    configure: 'Configure number',
    saving: 'Saving…',
  }
  const dialogDescription: Record<Step, string> = {
    credentials:
      'Your credentials are encrypted (AES-256-GCM) and scoped to this org. Twilio is required because Vapi assistants run on top of Twilio numbers.',
    pick: "Choose one of the numbers already on your Twilio account. We'll import it and you can configure routing afterwards.",
    manual:
      "Enter an existing Twilio number by hand. Use this only if your API token can't list IncomingPhoneNumbers.",
    configure: 'Confirm the label, capabilities, and whether this is your default outbound number.',
    saving: 'Talking to Twilio…',
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 'credentials' ? (
              <TwilioLogo className="h-4 w-4" brandColor />
            ) : (
              <Phone className="h-4 w-4" />
            )}
            {dialogTitle[step]}
          </DialogTitle>
          <DialogDescription>{dialogDescription[step]}</DialogDescription>
        </DialogHeader>

        {step === 'credentials' && (
          <form onSubmit={handleSaveCredentials} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="add-phone-acct-sid">Account SID</Label>
              <Input
                id="add-phone-acct-sid"
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-phone-auth-token">Auth Token</Label>
              <Input
                id="add-phone-auth-token"
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder="••••••••••••••••••••••••••••••••"
                autoComplete="off"
                required
              />
            </div>
            {error && <p className="text-[12.5px] text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Connect &amp; continue</Button>
            </DialogFooter>
          </form>
        )}

        {step === 'pick' && (
          <div className="space-y-4">
            {remoteLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading numbers from Twilio…
              </div>
            )}

            {!remoteLoading && remoteNumbers && remoteNumbers.length === 0 && (
              <div className="rounded-[10px] border border-dashed border-border p-4 text-[12.5px] text-text-secondary">
                No numbers found on this Twilio account.{' '}
                <a
                  href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  Open Twilio console <ExternalLink className="h-3 w-3" />
                </a>
                {' '}to buy or transfer one, then reload.
              </div>
            )}

            {!remoteLoading && remoteNumbers && remoteNumbers.length > 0 && (
              <ul className="max-h-[280px] space-y-1.5 overflow-auto pr-1">
                {remoteNumbers.map((row) => {
                  const disabled = row.alreadyImported
                  const selected = selectedSid === row.sid
                  return (
                    <li key={row.sid}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setSelectedSid(row.sid)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                          disabled
                            ? 'cursor-not-allowed border-border-subtle bg-bg-secondary/60 opacity-60'
                            : selected
                              ? 'border-accent bg-accent-muted'
                              : 'border-border-subtle bg-bg-primary hover:border-border',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-medium text-text-primary">
                            {row.friendlyName}
                          </div>
                          <div className="flex items-center gap-2 text-[11.5px] text-text-tertiary">
                            <span className="font-mono">{row.e164}</span>
                            <span>·</span>
                            <span>
                              {[
                                row.capabilities.voice && 'Voice',
                                row.capabilities.sms && 'SMS',
                                row.capabilities.mms && 'MMS',
                              ]
                                .filter(Boolean)
                                .join(' · ') || 'No capabilities'}
                            </span>
                          </div>
                        </div>
                        {disabled ? (
                          <span className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[10.5px] font-medium text-text-tertiary">
                            Already imported
                          </span>
                        ) : selected ? (
                          <CheckCircle2 className="h-4 w-4 text-accent" />
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {error && <p className="text-[12.5px] text-danger">{error}</p>}

            <div className="flex items-center justify-between text-[12px]">
              <button
                type="button"
                className="text-text-tertiary hover:text-text-primary hover:underline"
                onClick={() => {
                  setError(null)
                  setStep('manual')
                }}
              >
                Enter manually instead
              </button>
              <button
                type="button"
                className="text-text-tertiary hover:text-text-primary hover:underline disabled:opacity-50"
                onClick={() => {
                  setRemoteNumbers(null)
                  void loadRemoteNumbers()
                }}
                disabled={remoteLoading}
              >
                Refresh list
              </button>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!selectedSid || remoteLoading}
                onClick={handlePickConfirm}
              >
                Next
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'manual' && (
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="add-phone-e164">Number (E.164)</Label>
              <Input
                id="add-phone-e164"
                value={manual.e164}
                onChange={(e) => setManual((m) => ({ ...m, e164: e.target.value }))}
                placeholder="+14155552671"
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-phone-name">Friendly name</Label>
              <Input
                id="add-phone-name"
                value={manual.friendlyName}
                onChange={(e) => setManual((m) => ({ ...m, friendlyName: e.target.value }))}
                placeholder="Main line"
                maxLength={64}
                required
              />
            </div>
            <CapabilitiesRow
              voice={manual.capVoice}
              sms={manual.capSms}
              mms={manual.capMms}
              onChange={(caps) => setManual((m) => ({ ...m, ...caps }))}
              idPrefix="manual"
            />
            {error && <p className="text-[12.5px] text-danger">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setError(null)
                  setStep('pick')
                }}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button type="submit">Connect number</Button>
            </DialogFooter>
          </form>
        )}

        {step === 'configure' && configure && (
          <form onSubmit={handleConfigureSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="add-phone-friendly">Friendly name</Label>
              <Input
                id="add-phone-friendly"
                value={configure.friendlyName}
                onChange={(e) =>
                  setConfigure((c) => (c ? { ...c, friendlyName: e.target.value } : c))
                }
                maxLength={64}
                required
              />
            </div>
            <CapabilitiesRow
              voice={configure.capVoice}
              sms={configure.capSms}
              mms={configure.capMms}
              onChange={(caps) => setConfigure((c) => (c ? { ...c, ...caps } : c))}
              idPrefix="configure"
            />
            <div className="flex items-center gap-2 text-[13px]">
              <Checkbox
                id="add-phone-default"
                checked={configure.isDefault}
                onCheckedChange={(v) =>
                  setConfigure((c) => (c ? { ...c, isDefault: Boolean(v) } : c))
                }
              />
              <Label htmlFor="add-phone-default" className="cursor-pointer font-normal">
                Set as the org&apos;s default outbound number
              </Label>
            </div>
            {error && <p className="text-[12.5px] text-danger">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setError(null)
                  setStep('pick')
                }}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button type="submit">Connect number</Button>
            </DialogFooter>
          </form>
        )}

        {step === 'saving' && (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving…
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface CapabilitiesRowProps {
  voice: boolean
  sms: boolean
  mms: boolean
  onChange: (caps: { capVoice?: boolean; capSms?: boolean; capMms?: boolean }) => void
  idPrefix: string
}

function CapabilitiesRow({ voice, sms, mms, onChange, idPrefix }: CapabilitiesRowProps) {
  return (
    <div className="space-y-2">
      <Label>Capabilities</Label>
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2 text-[13px]">
          <Checkbox
            id={`${idPrefix}-cap-voice`}
            checked={voice}
            onCheckedChange={(v) => onChange({ capVoice: Boolean(v) })}
          />
          <Label htmlFor={`${idPrefix}-cap-voice`} className="cursor-pointer font-normal">
            Voice
          </Label>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <Checkbox
            id={`${idPrefix}-cap-sms`}
            checked={sms}
            onCheckedChange={(v) => onChange({ capSms: Boolean(v) })}
          />
          <Label htmlFor={`${idPrefix}-cap-sms`} className="cursor-pointer font-normal">
            SMS
          </Label>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <Checkbox
            id={`${idPrefix}-cap-mms`}
            checked={mms}
            onCheckedChange={(v) => onChange({ capMms: Boolean(v) })}
          />
          <Label htmlFor={`${idPrefix}-cap-mms`} className="cursor-pointer font-normal">
            MMS
          </Label>
        </div>
      </div>
    </div>
  )
}
