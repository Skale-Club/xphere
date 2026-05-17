'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updatePassword, updateProfile } from '@/app/(dashboard)/settings/profile/actions'

interface Props {
  initial: { email: string; full_name: string }
}

export function ProfileForm({ initial }: Props) {
  const [fullName, setFullName] = React.useState(initial.full_name)
  const [savingName, setSavingName] = React.useState(false)
  const [savedName, setSavedName] = React.useState(false)

  const [password, setPassword] = React.useState('')
  const [savingPassword, setSavingPassword] = React.useState(false)

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim()) {
      toast.error('Name cannot be empty')
      return
    }
    setSavingName(true)
    const res = await updateProfile({ full_name: fullName.trim() })
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Personal info</CardTitle>
          <CardDescription>How your name appears across the workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveName} className="space-y-3 max-w-md">
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
                Email changes happen via your provider — coming soon.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={savingName || fullName.trim() === initial.full_name}>
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

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Set a new password. At least 8 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={savePassword} className="space-y-3 max-w-md">
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
    </div>
  )
}
