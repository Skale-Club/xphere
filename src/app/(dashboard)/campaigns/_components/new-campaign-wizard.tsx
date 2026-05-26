'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Phone, MessageSquare, Mail, MessageCircle, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createCampaign } from '../actions'
import type { CampaignChannel } from '@/types/database'

interface Props {
  assistants: Array<{ id: string; name: string }>
  hasTwilio: boolean
  hasResend: boolean
}

interface VapiPhoneNumber {
  id: string
  number?: string
  name?: string
}

const CHANNELS: Array<{
  value: CampaignChannel
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  gated?: boolean
  gatedMessage?: string
}> = [
  {
    value: 'calls',
    label: 'Voice Call',
    description: 'Make AI-powered outbound calls to a list of contacts.',
    icon: Phone,
  },
  {
    value: 'sms',
    label: 'SMS',
    description: 'Send text messages to your contacts via Twilio.',
    icon: MessageSquare,
  },
  {
    value: 'email',
    label: 'Email',
    description: 'Send email campaigns via Resend.',
    icon: Mail,
    gated: true,
    gatedMessage: 'Connect Resend to unlock email campaigns.',
  },
  {
    value: 'whatsapp',
    label: 'WhatsApp',
    description: 'WhatsApp campaign support is coming soon.',
    icon: MessageCircle,
    gated: true,
    gatedMessage: 'WhatsApp campaigns are coming soon.',
  },
]

export function NewCampaignWizard({ assistants, hasTwilio, hasResend }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)

  // Step 1 — channel
  const [channel, setChannel] = useState<CampaignChannel>('calls')

  // Step 2 — name & description
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Step 3 — audience (simplified)
  const [audienceType, setAudienceType] = useState<'all' | 'tagged'>('all')
  const [audienceTag, setAudienceTag] = useState('')

  // Step 4 — template
  const [vapiAssistantId, setVapiAssistantId] = useState('')
  const [vapiPhoneNumberId, setVapiPhoneNumberId] = useState('')
  const [callsPerMinute, setCallsPerMinute] = useState(5)
  const [smsBody, setSmsBody] = useState('')
  const [phoneNumbers, setPhoneNumbers] = useState<VapiPhoneNumber[]>([])
  const [loadingPhones, setLoadingPhones] = useState(false)

  // Step 5 — schedule
  const [scheduleType, setScheduleType] = useState<'now' | 'later'>('now')
  const [scheduledAt, setScheduledAt] = useState('')

  useEffect(() => {
    if (step === 4 && channel === 'calls') {
      setLoadingPhones(true)
      fetch('/api/vapi/phone-numbers')
        .then((r) => r.json())
        .then((data) => Array.isArray(data) ? setPhoneNumbers(data) : setPhoneNumbers([]))
        .catch(() => setPhoneNumbers([]))
        .finally(() => setLoadingPhones(false))
    }
  }, [step, channel])

  function isChannelGated(c: CampaignChannel): boolean {
    if (c === 'email') return !hasResend
    if (c === 'whatsapp') return true
    return false
  }

  function canProceedStep1() {
    return !isChannelGated(channel)
  }

  function canProceedStep2() {
    return name.trim().length >= 2
  }

  function canProceedStep4() {
    if (channel === 'calls') return !!vapiAssistantId && !!vapiPhoneNumberId
    if (channel === 'sms') return smsBody.trim().length >= 1
    return true
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const audience_filter: Record<string, unknown> =
        audienceType === 'tagged' && audienceTag
          ? { tag: audienceTag }
          : {}

      const { id } = await createCampaign({
        name: name.trim(),
        description: description.trim() || null,
        channel,
        vapi_assistant_id: channel === 'calls' ? vapiAssistantId : null,
        vapi_phone_number_id: channel === 'calls' ? vapiPhoneNumberId : null,
        calls_per_minute: channel === 'calls' ? callsPerMinute : undefined,
        sms_body: channel === 'sms' ? smsBody.trim() : null,
        audience_filter,
        scheduled_start_at:
          scheduleType === 'later' && scheduledAt
            ? new Date(scheduledAt).toISOString()
            : null,
      })

      toast.success('Campaign created')
      router.push(`/campaigns/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign')
      setSubmitting(false)
    }
  }

  const STEP_LABELS = ['Channel', 'Details', 'Audience', 'Template', 'Schedule']

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const num = i + 1
          const done = num < step
          const active = num === step
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={[
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
                  done ? 'bg-accent text-white' : active ? 'bg-accent/20 text-accent' : 'bg-bg-tertiary text-text-tertiary',
                ].join(' ')}
              >
                {done ? '✓' : num}
              </div>
              <span
                className={[
                  'text-[12px] font-medium',
                  active ? 'text-text-primary' : 'text-text-tertiary',
                ].join(' ')}
              >
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <ChevronRight className="h-3 w-3 text-text-tertiary mx-1" />
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-[12px] border border-border bg-bg-secondary p-6">
        {/* Step 1 — Channel */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">Choose channel</h2>
            <div className="grid grid-cols-2 gap-3">
              {CHANNELS.map((ch) => {
                const gated = isChannelGated(ch.value)
                const selected = channel === ch.value
                return (
                  <button
                    key={ch.value}
                    type="button"
                    disabled={gated}
                    onClick={() => !gated && setChannel(ch.value)}
                    className={[
                      'relative rounded-[10px] border p-4 text-left transition-all',
                      gated
                        ? 'border-border opacity-50 cursor-not-allowed'
                        : selected
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-border-strong',
                    ].join(' ')}
                  >
                    <ch.icon className={['h-5 w-5 mb-2', selected ? 'text-accent' : 'text-text-secondary'].join(' ')} />
                    <p className="text-[13px] font-semibold text-text-primary">{ch.label}</p>
                    <p className="text-[12px] text-text-tertiary mt-0.5">
                      {gated ? ch.gatedMessage : ch.description}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 2 — Name & Description */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">Name your campaign</h2>
            <div className="space-y-2">
              <Label htmlFor="name">Campaign name <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q2 Re-engagement Campaign"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this campaign's goal"
                rows={2}
              />
            </div>
          </div>
        )}

        {/* Step 3 — Audience */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">Select audience</h2>
            <div className="space-y-2">
              {['all', 'tagged'].map((type) => (
                <label
                  key={type}
                  className={[
                    'flex items-start gap-3 rounded-[8px] border p-3 cursor-pointer',
                    audienceType === type ? 'border-accent bg-accent/5' : 'border-border hover:border-border-strong',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="audienceType"
                    value={type}
                    checked={audienceType === type}
                    onChange={() => setAudienceType(type as 'all' | 'tagged')}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">
                      {type === 'all' ? 'All contacts' : 'Contacts with tag'}
                    </p>
                    <p className="text-[12px] text-text-tertiary">
                      {type === 'all'
                        ? 'Send to every contact in your workspace.'
                        : 'Only contacts matching a specific tag.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
            {audienceType === 'tagged' && (
              <div className="space-y-2">
                <Label htmlFor="audienceTag">Tag name</Label>
                <Input
                  id="audienceTag"
                  value={audienceTag}
                  onChange={(e) => setAudienceTag(e.target.value)}
                  placeholder="e.g. lead, customer, prospect"
                />
              </div>
            )}
          </div>
        )}

        {/* Step 4 — Template / Config */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">
              {channel === 'calls' ? 'Configure call settings' : channel === 'sms' ? 'Write your message' : 'Configure template'}
            </h2>

            {channel === 'calls' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="assistant">Vapi assistant <span className="text-destructive">*</span></Label>
                  <select
                    id="assistant"
                    value={vapiAssistantId}
                    onChange={(e) => setVapiAssistantId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select an assistant</option>
                    {assistants.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber">Phone number <span className="text-destructive">*</span></Label>
                  <select
                    id="phoneNumber"
                    value={vapiPhoneNumberId}
                    onChange={(e) => setVapiPhoneNumberId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">{loadingPhones ? 'Loading...' : 'Select a phone number'}</option>
                    {phoneNumbers.map((p) => (
                      <option key={p.id} value={p.id}>{p.number ?? p.name ?? p.id}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="callsPerMinute">Calls per minute (1–20)</Label>
                  <Input
                    id="callsPerMinute"
                    type="number"
                    min={1}
                    max={20}
                    value={callsPerMinute}
                    onChange={(e) => setCallsPerMinute(Number(e.target.value))}
                  />
                </div>
              </>
            )}

            {channel === 'sms' && (
              <div className="space-y-2">
                <Label htmlFor="smsBody">Message body <span className="text-destructive">*</span></Label>
                <Textarea
                  id="smsBody"
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  placeholder="Your SMS message here. Keep it concise — standard SMS is 160 chars."
                  rows={4}
                />
                <p className="text-[11.5px] text-text-tertiary">{smsBody.length} characters</p>
              </div>
            )}

            {(channel === 'email' || channel === 'whatsapp') && (
              <div className="rounded-md border border-border bg-bg-tertiary/50 p-4 text-center">
                <p className="text-[13px] text-text-secondary">
                  {channel === 'email' ? 'Email' : 'WhatsApp'} template configuration coming soon.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 5 — Schedule */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">Schedule</h2>
            <div className="space-y-2">
              {['now', 'later'].map((type) => (
                <label
                  key={type}
                  className={[
                    'flex items-start gap-3 rounded-[8px] border p-3 cursor-pointer',
                    scheduleType === type ? 'border-accent bg-accent/5' : 'border-border hover:border-border-strong',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="scheduleType"
                    value={type}
                    checked={scheduleType === type}
                    onChange={() => setScheduleType(type as 'now' | 'later')}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">
                      {type === 'now' ? 'Save as draft' : 'Schedule for later'}
                    </p>
                    <p className="text-[12px] text-text-tertiary">
                      {type === 'now'
                        ? 'Campaign is saved as draft. Launch it manually when ready.'
                        : 'Set a date and time to automatically start the campaign.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
            {scheduleType === 'later' && (
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Start date &amp; time</Label>
                <Input
                  id="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 1 && (
          <Button variant="outline" type="button" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        )}
        {step < 5 && (
          <Button
            type="button"
            disabled={
              (step === 1 && !canProceedStep1()) ||
              (step === 2 && !canProceedStep2()) ||
              (step === 4 && !canProceedStep4())
            }
            onClick={() => setStep((s) => s + 1)}
          >
            Continue
          </Button>
        )}
        {step === 5 && (
          <Button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Creating...' : scheduleType === 'later' ? 'Schedule campaign' : 'Create as draft'}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => router.push('/campaigns')}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
