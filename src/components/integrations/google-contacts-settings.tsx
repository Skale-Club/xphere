'use client'

import { useEffect, useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Users } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  connectGoogleContacts,
  disconnectGoogleContacts,
  type GoogleContactsIntegration,
} from '@/app/(dashboard)/integrations/google-contacts/actions'

interface Props {
  integration: GoogleContactsIntegration | null
  connected: boolean
  error?: string
}

export function GoogleContactsSettings({ integration, connected, error }: Props) {
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (connected) toast.success('Google account connected successfully.')
    if (error === 'csrf') toast.error('Connection failed: CSRF state mismatch. Please try again.')
    if (error === 'missing_code') toast.error('Connection failed: authorization code missing.')
    if (error === 'no_org') toast.error('Connection failed: no active organization found.')
    if (error === 'oauth_exchange') toast.error('Connection failed: could not exchange authorization code. Please try again.')
  }, [connected, error])

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectGoogleContacts()
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Google account disconnected.')
      }
    })
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Google Contacts</CardTitle>
          {integration ? (
            <Badge variant="secondary" className="ml-auto gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto text-muted-foreground">
              Not connected
            </Badge>
          )}
        </div>
        <CardDescription>
          {integration
            ? `Connected as ${integration.google_email ?? 'unknown account'}`
            : 'Connect a Google account to enable contact management actions.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {integration ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={handleDisconnect}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Disconnect
          </Button>
        ) : (
          <form action={connectGoogleContacts}>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Connect Google Account
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
