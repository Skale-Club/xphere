'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createCampaign } from '@/app/(dashboard)/outbound/actions'
import { getAssistantOptions } from '@/app/(dashboard)/calls/actions'
import { buildUTMLink } from '@/lib/traffic/utm'

interface VapiPhoneNumber {
  id: string
  number?: string
  name?: string
}

export function CampaignForm() {
  const router = useRouter()

  const [name, setName] = useState('')
  const [vapiAssistantId, setVapiAssistantId] = useState('')
  const [vapiPhoneNumberId, setVapiPhoneNumberId] = useState('')
  const [scheduledStartAt, setScheduledStartAt] = useState('')
  const [callsPerMinute, setCallsPerMinute] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // UTM fields
  const [utmOpen, setUtmOpen] = useState(false)
  const [landingPageUrl, setLandingPageUrl] = useState('')
  const [utmSource, setUtmSource] = useState('xphere')
  const [utmMedium, setUtmMedium] = useState('voice')
  const [utmCampaignTag, setUtmCampaignTag] = useState('')
  const [utmContent, setUtmContent] = useState('')
  const [utmTerm, setUtmTerm] = useState('')

  const [assistants, setAssistants] = useState<Array<{ vapi_assistant_id: string; name: string | null }>>([])
  const [phoneNumbers, setPhoneNumbers] = useState<VapiPhoneNumber[]>([])
  const [loadingAssistants, setLoadingAssistants] = useState(true)
  const [loadingPhones, setLoadingPhones] = useState(true)

  useEffect(() => {
    getAssistantOptions()
      .then(setAssistants)
      .catch(() => setAssistants([]))
      .finally(() => setLoadingAssistants(false))

    fetch('/api/vapi/phone-numbers')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setPhoneNumbers(data)
        else setPhoneNumbers([])
      })
      .catch(() => setPhoneNumbers([]))
      .finally(() => setLoadingPhones(false))
  }, [])

  const trackedLink = useMemo(() => {
    if (!landingPageUrl) return null
    try {
      new URL(landingPageUrl)
      return buildUTMLink(landingPageUrl, {
        utm_source: utmSource || 'xphere',
        utm_medium: utmMedium || 'voice',
        utm_campaign: utmCampaignTag || undefined,
        utm_content: utmContent || undefined,
        utm_term: utmTerm || undefined,
      })
    } catch {
      return null
    }
  }, [landingPageUrl, utmSource, utmMedium, utmCampaignTag, utmContent, utmTerm])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || name.trim().length < 2) {
      setError('Name must be at least 2 characters')
      return
    }
    if (!vapiAssistantId) {
      setError('Please select an assistant')
      return
    }
    if (!vapiPhoneNumberId) {
      setError('Please select a phone number')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await createCampaign({
        name: name.trim(),
        vapi_assistant_id: vapiAssistantId,
        vapi_phone_number_id: vapiPhoneNumberId,
        scheduled_start_at: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : null,
        calls_per_minute: callsPerMinute,
        landing_page_url: landingPageUrl || null,
        utm_source: utmSource || null,
        utm_medium: utmMedium || null,
        utm_campaign_tag: utmCampaignTag || null,
        utm_content: utmContent || null,
        utm_term: utmTerm || null,
      })
      router.push('/outbound')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Campaign Name <span className="text-destructive">*</span></Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q1 Follow-up Campaign"
          minLength={2}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="assistant">Assistant <span className="text-destructive">*</span></Label>
        <select
          id="assistant"
          value={vapiAssistantId}
          onChange={(e) => setVapiAssistantId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          required
        >
          <option value="">
            {loadingAssistants ? 'Loading assistants...' : 'Select an assistant'}
          </option>
          {assistants.map((a) => (
            <option key={a.vapi_assistant_id} value={a.vapi_assistant_id}>
              {a.name ?? a.vapi_assistant_id}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phoneNumber">Phone Number <span className="text-destructive">*</span></Label>
        <select
          id="phoneNumber"
          value={vapiPhoneNumberId}
          onChange={(e) => setVapiPhoneNumberId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          required
        >
          <option value="">
            {loadingPhones ? 'Loading phone numbers...' : 'Select a phone number'}
          </option>
          {phoneNumbers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.number ?? p.name ?? p.id}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="schedule">Scheduled Start (optional)</Label>
        <Input
          id="schedule"
          type="datetime-local"
          value={scheduledStartAt}
          onChange={(e) => setScheduledStartAt(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="callsPerMinute">Calls Per Minute (1-20)</Label>
        <Input
          id="callsPerMinute"
          type="number"
          min={1}
          max={20}
          value={callsPerMinute}
          onChange={(e) => setCallsPerMinute(Number(e.target.value))}
        />
      </div>

      {/* UTM / Tracked Link section */}
      <div className="rounded-md border border-border">
        <button
          type="button"
          onClick={() => setUtmOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-bg-secondary transition-colors"
        >
          <span>UTM Tracking &amp; Landing Page</span>
          {utmOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {utmOpen && (
          <div className="flex flex-col gap-4 px-4 pb-4 border-t border-border pt-4">
            <p className="text-[12.5px] text-text-secondary">
              Optional. Add a landing page URL and UTM parameters to generate a tracked link for SMS/email follow-ups after the voice call.
            </p>

            <div className="flex flex-col gap-2">
              <Label htmlFor="landingPageUrl">Landing Page URL</Label>
              <Input
                id="landingPageUrl"
                type="url"
                value={landingPageUrl}
                onChange={(e) => setLandingPageUrl(e.target.value)}
                placeholder="https://yoursite.com/offer"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="utmSource">UTM Source</Label>
                <Input
                  id="utmSource"
                  value={utmSource}
                  onChange={(e) => setUtmSource(e.target.value)}
                  placeholder="xphere"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="utmMedium">UTM Medium</Label>
                <Input
                  id="utmMedium"
                  value={utmMedium}
                  onChange={(e) => setUtmMedium(e.target.value)}
                  placeholder="voice"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="utmCampaignTag">UTM Campaign</Label>
                <Input
                  id="utmCampaignTag"
                  value={utmCampaignTag}
                  onChange={(e) => setUtmCampaignTag(e.target.value)}
                  placeholder="q1-followup"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="utmContent">UTM Content</Label>
                <Input
                  id="utmContent"
                  value={utmContent}
                  onChange={(e) => setUtmContent(e.target.value)}
                  placeholder="optional"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="utmTerm">UTM Term</Label>
                <Input
                  id="utmTerm"
                  value={utmTerm}
                  onChange={(e) => setUtmTerm(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </div>

            {trackedLink && (
              <div className="rounded-md bg-bg-secondary border border-border p-3">
                <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Preview</p>
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-[12.5px] text-text-primary break-all font-mono">{trackedLink}</p>
                  <a
                    href={trackedLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-text-tertiary hover:text-text-primary"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Campaign'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
