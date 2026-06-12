'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Bell, BellOff, Check, Loader2, Upload, Trash2, Send } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { createClient } from '@/lib/supabase/client'
import { sendTestPush, updatePassword, updateProfile } from '@/app/(dashboard)/settings/profile/actions'
import { usePushNotifications } from '@/hooks/use-push-notifications'

interface Props {
  initial: { email: string; full_name: string; avatar_url: string | null; phone: string }
}

const MAX_AVATAR_MB = 5
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

function initialsFrom(name: string, email: string): string {
  const base = name?.trim() || email?.trim() || '?'
  const parts = base.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return base[0]?.toUpperCase() ?? '?'
}

export function ProfileForm({ initial }: Props) {
  const [fullName, setFullName] = React.useState(initial.full_name)
  const [phone, setPhone] = React.useState(initial.phone)
  const [savingName, setSavingName] = React.useState(false)
  const [savedName, setSavedName] = React.useState(false)

  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(initial.avatar_url)
  const [uploadingAvatar, setUploadingAvatar] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const [password, setPassword] = React.useState('')
  const [savingPassword, setSavingPassword] = React.useState(false)

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) {
      toast.error('Name cannot be empty')
      return
    }
    setSavingName(true)
    const res = await updateProfile({ full_name: fullName.trim(), phone: phone.trim() || null })
    setSavingName(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Failed to save')
      return
    }
    setSavedName(true)
    toast.success('Profile updated')
    window.setTimeout(() => setSavedName(false), 3000)
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setSavingPassword(true)
    const res = await updatePassword({ password })
    setSavingPassword(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Failed to update password')
      return
    }
    setPassword('')
    toast.success('Password updated')
  }

  async function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // allow re-selecting same file later

    if (!ACCEPTED.includes(file.type)) {
      toast.error('Use PNG, JPEG, WEBP or GIF')
      return
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      toast.error(`Image must be smaller than ${MAX_AVATAR_MB} MB`)
      return
    }

    setUploadingAvatar(true)
    try {
      const supabase = createClient()
      // Need the user id to build the storage path (RLS enforces this prefix).
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr || !user) throw new Error('Not authenticated')

      const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 5)
      const path = `${user.id}/avatar-${Date.now()}.${ext}`

      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      const url = pub.publicUrl

      const res = await updateProfile({ avatar_url: url })
      if (!res.ok) throw new Error(res.error ?? 'Failed to save avatar')

      setAvatarUrl(url)
      toast.success('Avatar updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Avatar upload failed')
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleAvatarRemove() {
    setUploadingAvatar(true)
    try {
      const res = await updateProfile({ avatar_url: null })
      if (!res.ok) throw new Error(res.error ?? 'Failed to remove avatar')
      setAvatarUrl(null)
      toast.success('Avatar removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Avatar removal failed')
    } finally {
      setUploadingAvatar(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      {/* Left column */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Avatar</CardTitle>
            <CardDescription>
              Shown in the sidebar, comments, and anywhere your account appears.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-5">
              <Avatar className="h-20 w-20 shrink-0 ring-1 ring-border">
                {avatarUrl && <AvatarImage src={avatarUrl} alt="Your avatar" />}
                <AvatarFallback className="text-[18px] font-semibold bg-accent-muted text-accent">
                  {initialsFrom(fullName, initial.email)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar}
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {avatarUrl ? 'Change avatar' : 'Upload avatar'}
                  </Button>
                  {avatarUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleAvatarRemove}
                      disabled={uploadingAvatar}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-[11.5px] text-text-tertiary">
                  PNG, JPEG, WEBP or GIF · max {MAX_AVATAR_MB} MB · square works best
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED.join(',')}
                onChange={handleAvatarSelect}
                className="hidden"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personal info</CardTitle>
            <CardDescription>How your name appears across the workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveName} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="full_name">Full name</Label>
                <Input
                  id="full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  maxLength={120}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={initial.email} disabled className="opacity-70" />
                <p className="text-[11px] text-text-tertiary">
                  Email changes happen via your provider | coming soon.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 000 0000"
                  maxLength={30}
                />
                <p className="text-[11px] text-text-tertiary">
                  Visible to org admins in the Members page.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={savingName || (fullName.trim() === initial.full_name && phone.trim() === initial.phone)}>
                  {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save
                </Button>
                {savedName && (
                  <span className="flex items-center gap-1 text-[11.5px] text-success">
                    <Check className="h-3 w-3" /> Saved
                  </span>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Right column */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>Set a new password. At least 8 characters.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={savePassword} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" disabled={savingPassword || password.length < 8}>
                {savingPassword ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Update password
              </Button>
            </form>
          </CardContent>
        </Card>

        <PushNotificationsCard />
      </div>
    </div>
  )
}

function PushNotificationsCard() {
  const { supported, permission, subscribed, loading, subscribe, unsubscribe } =
    usePushNotifications()
  const [sendingTest, setSendingTest] = React.useState(false)

  async function handleToggle() {
    if (subscribed) {
      await unsubscribe()
      toast.success('Push notifications disabled')
    } else {
      const granted = await subscribe()
      if (granted) {
        toast.success('Push notifications enabled')
      } else if (permission === 'denied') {
        toast.error('Notifications are blocked | update your browser site settings')
      } else {
        toast.error('Could not enable notifications')
      }
    }
  }

  async function handleTest() {
    setSendingTest(true)
    try {
      const res = await sendTestPush()
      if (res.ok) {
        toast.success('Test notification sent to all your devices')
      } else {
        toast.error(res.error ?? 'Could not send test notification')
      }
    } finally {
      setSendingTest(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push notifications</CardTitle>
        <CardDescription>
          Get notified about new messages and missed calls, even when the app is in the background.
          {' '}
          On iOS, the app must be installed to your home screen first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!supported ? (
          <p className="text-sm text-text-tertiary">
            Push notifications are not supported in this browser.
          </p>
        ) : permission === 'denied' ? (
          <p className="text-sm text-text-tertiary">
            Notifications are blocked. Open your browser site settings to allow them, then reload.
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {subscribed ? (
                <Bell className="h-4 w-4 text-accent" />
              ) : (
                <BellOff className="h-4 w-4 text-text-tertiary" />
              )}
              <span className="text-sm text-text-primary">
                {subscribed ? 'Enabled on this device' : 'Disabled'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {subscribed && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={sendingTest}
                  onClick={handleTest}
                >
                  {sendingTest ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Send test
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={subscribed ? 'outline' : 'default'}
                disabled={loading}
                onClick={handleToggle}
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {subscribed ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
