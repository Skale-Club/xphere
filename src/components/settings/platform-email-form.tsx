'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import {
  savePlatformEmailSettings,
  testPlatformEmailConnection,
  sendTestPlatformEmail,
} from '@/app/(dashboard)/settings/platform/email-actions'
import type { PlatformEmailSettingsRow } from '@/types/database'

type SettingsSummary = Omit<PlatformEmailSettingsRow, 'api_key_encrypted'> & { key_hint?: string }

interface Props {
  initial: SettingsSummary | null
}

export function PlatformEmailForm({ initial }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [fromName, setFromName] = useState(initial?.default_from_name ?? '')
  const [fromEmail, setFromEmail] = useState(initial?.default_from_email ?? '')
  const [replyTo, setReplyTo] = useState(initial?.default_reply_to ?? '')
  const [isActive, setIsActive] = useState(initial?.is_active ?? false)
  const [testTo, setTestTo] = useState('')

  const [isSaving, startSave] = useTransition()
  const [isTesting, startTest] = useTransition()
  const [isSendingTest, startSendTest] = useTransition()

  function onSave() {
    startSave(async () => {
      const res = await savePlatformEmailSettings({
        apiKey: apiKey || undefined,
        defaultFromName: fromName,
        defaultFromEmail: fromEmail,
        defaultReplyTo: replyTo,
        isActive,
      })
      if (res?.error) {
        toast.error(res.error)
      } else {
        toast.success('Platform email settings saved')
        setApiKey('')
      }
    })
  }

  function onTest() {
    startTest(async () => {
      const res = await testPlatformEmailConnection()
      if (res.ok) {
        toast.success('Connection verified — Resend API key is valid')
      } else {
        toast.error(res.error ?? 'Connection test failed')
      }
    })
  }

  function onSendTest() {
    if (!testTo.trim()) {
      toast.error('Enter a recipient email address')
      return
    }
    startSendTest(async () => {
      const res = await sendTestPlatformEmail(testTo.trim())
      if (res.ok) {
        toast.success(`Test email sent to ${testTo}`)
      } else {
        toast.error(res.error ?? 'Failed to send test email')
      }
    })
  }

  return (
    <div className="space-y-6 mt-8">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Platform Email (Resend)</CardTitle>
              <CardDescription className="mt-1">
                Configure the platform-wide Resend account used for system emails (invites, auth, alerts).
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {initial?.last_tested_at && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  Tested
                </span>
              )}
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                aria-label="Enable platform email"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="platform-resend-api-key">API Key</Label>
            <Input
              id="platform-resend-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={initial?.key_hint ? `Current: ${initial.key_hint}` : 're_…'}
              autoComplete="off"
            />
            {initial?.key_hint && (
              <p className="text-xs text-muted-foreground">
                Leave blank to keep the existing key ({initial.key_hint}).
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="platform-from-name">Default From Name</Label>
              <Input
                id="platform-from-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Xphere"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="platform-from-email">Default From Email</Label>
              <Input
                id="platform-from-email"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="notifications@xphere.app"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="platform-reply-to">Reply-To (optional)</Label>
            <Input
              id="platform-reply-to"
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="support@xphere.app"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} disabled={isSaving}>
              {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Save settings'}
            </Button>
            <Button variant="outline" onClick={onTest} disabled={isTesting || !initial?.key_hint}>
              {isTesting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing…</> : 'Test connection'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {initial?.is_active && (
        <Card>
          <CardHeader>
            <CardTitle>Send test email</CardTitle>
            <CardDescription>
              Send a test email via the platform Resend account to verify delivery.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="admin@example.com"
                className="max-w-sm"
              />
              <Button variant="outline" onClick={onSendTest} disabled={isSendingTest}>
                {isSendingTest ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</> : 'Send'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
