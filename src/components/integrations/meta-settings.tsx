'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  AtSign,
  Bot,
  CheckCircle2,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  Unplug,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  connectMeta,
  disconnectMetaChannel,
  updateMetaChannelAutomation,
} from '@/app/(dashboard)/integrations/meta/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type MetaChannelView = {
  id: string
  pageId: string
  pageName: string
  channelType: 'messenger' | 'instagram'
  igUsername: string | null
  isActive: boolean
  lastSyncedAt: string | null
  connectionError: string | null
  automationId: string | null
}

type AutomationOption = {
  id: string
  toolName: string
  actionType: string
}

type MetaSettingsProps = {
  channels: MetaChannelView[]
  automationOptions: AutomationOption[]
}

const NONE_AUTOMATION_VALUE = '__none__'

function getChannelPresentation(channelType: MetaChannelView['channelType']) {
  if (channelType === 'instagram') {
    return {
      label: 'Instagram',
      icon: AtSign,
      capability: 'Direct messages',
    }
  }

  return {
    label: 'Messenger',
    icon: MessageCircle,
    capability: 'Page messages',
  }
}

function isReconnectState(channel: MetaChannelView) {
  if (!channel.connectionError) {
    return false
  }

  return /(^|\D)190(\D|$)/.test(channel.connectionError)
}

function formatLastSynced(lastSyncedAt: string | null) {
  if (!lastSyncedAt) {
    return 'Never synced yet'
  }

  return `Synced ${formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })}`
}

export function MetaSettings({ channels, automationOptions }: MetaSettingsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isConnecting, startConnectTransition] = useTransition()
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [savingAutomationId, setSavingAutomationId] = useState<string | null>(null)
  const [automationSelections, setAutomationSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      channels.map((channel) => [channel.id, channel.automationId ?? NONE_AUTOMATION_VALUE])
    )
  )

  const connectedMessage = searchParams.get('connected')
  const errorMessage = searchParams.get('error')

  const banner = useMemo(() => {
    if (connectedMessage === 'true') {
      return {
        tone: 'success' as const,
        title: 'Meta channels connected',
        body: 'Messenger pages and linked Instagram accounts are ready for automation binding.',
      }
    }

    if (!errorMessage) {
      return null
    }

    const bodyByError: Record<string, string> = {
      csrf: 'The Facebook login state could not be verified. Please try connecting again.',
      missing_code: 'Facebook returned without an authorization code. Try the connection flow again.',
      oauth_exchange: 'Facebook returned an OAuth error before channels could be saved.',
      no_org: 'Select an active organization before starting the Meta connection flow.',
    }

    return {
      tone: 'error' as const,
      title: 'Connection needs attention',
      body: bodyByError[errorMessage] ?? 'Meta connection could not be completed. Try again.',
    }
  }, [connectedMessage, errorMessage])

  function handleConnect() {
    startConnectTransition(async () => {
      await connectMeta()
    })
  }

  async function handleDisconnect(channelId: string) {
    setDisconnectingId(channelId)

    try {
      const result = await disconnectMetaChannel(channelId)

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success('Meta channel disconnected.')
      router.refresh()
    } catch {
      toast.error('Failed to disconnect Meta channel. Try again.')
    } finally {
      setDisconnectingId(null)
    }
  }

  async function handleSaveAutomation(channelId: string) {
    const selectedValue = automationSelections[channelId] ?? NONE_AUTOMATION_VALUE
    const automationId = selectedValue === NONE_AUTOMATION_VALUE ? null : selectedValue

    setSavingAutomationId(channelId)

    try {
      const result = await updateMetaChannelAutomation(channelId, automationId)

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success('Automation binding updated.')
      router.refresh()
    } catch {
      toast.error('Failed to update automation binding. Try again.')
    } finally {
      setSavingAutomationId(null)
    }
  }

  if (channels.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect with Facebook</CardTitle>
          <CardDescription>
            Start one Facebook Login flow to register Messenger pages and any linked Instagram professional accounts for this organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {banner && (
            <div className={banner.tone === 'success' ? 'rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200' : 'rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100'}>
              <p className="font-medium">{banner.title}</p>
              <p className="mt-1 text-current/90">{banner.body}</p>
            </div>
          )}

          <Button onClick={handleConnect} disabled={isConnecting}>
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirecting...
              </>
            ) : (
              <>
                <MessageCircle className="mr-2 h-4 w-4" />
                Connect with Facebook
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {banner && (
        <div className={banner.tone === 'success' ? 'rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200' : 'rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100'}>
          <p className="font-medium">{banner.title}</p>
          <p className="mt-1 text-current/90">{banner.body}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Connected channels</h2>
          <p className="text-sm text-muted-foreground">
            Messenger and Instagram rows stay separate so each channel can have its own automation.
          </p>
        </div>

        <Button variant="outline" onClick={handleConnect} disabled={isConnecting}>
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Redirecting...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Connect with Facebook
            </>
          )}
        </Button>
      </div>

      <div className="grid gap-4">
        {channels.map((channel) => {
          const presentation = getChannelPresentation(channel.channelType)
          const Icon = presentation.icon
          const reconnectNeeded = isReconnectState(channel) || !channel.isActive
          const isDisconnecting = disconnectingId === channel.id
          const isSavingAutomation = savingAutomationId === channel.id
          const selectedAutomation = automationSelections[channel.id] ?? NONE_AUTOMATION_VALUE

          return (
            <Card key={channel.id}>
              <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
                      <Icon className="h-3.5 w-3.5" />
                      {presentation.label}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={reconnectNeeded ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'}
                    >
                      {reconnectNeeded ? 'Reconnect needed' : 'Active'}
                    </Badge>
                    <Badge variant="secondary">{presentation.capability}</Badge>
                  </div>

                  <div>
                    <CardTitle className="text-base">{channel.pageName}</CardTitle>
                    <CardDescription className="mt-1">
                      {channel.channelType === 'instagram' && channel.igUsername
                        ? `Linked Instagram @${channel.igUsername}`
                        : `Page ID ${channel.pageId}`}
                    </CardDescription>
                  </div>
                </div>

                <div className="text-sm text-muted-foreground">{formatLastSynced(channel.lastSyncedAt)}</div>
              </CardHeader>

              <CardContent className="space-y-4">
                {reconnectNeeded ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                    <div className="flex gap-3">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="space-y-2">
                        <p className="font-medium">Reconnect required</p>
                        <p>
                          {channel.connectionError ?? 'This channel is not currently active. Reconnect with Facebook to restore message delivery.'}
                        </p>
                        <Button size="sm" variant="secondary" onClick={handleConnect} disabled={isConnecting}>
                          {isConnecting ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Redirecting...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Reconnect with Facebook
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    <CheckCircle2 className="h-4 w-4" />
                    Channel is connected and available for inbound message automation.
                  </div>
                )}

                <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
                  <div className="space-y-2">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Bot className="h-4 w-4" />
                      Automation binding
                    </p>
                    <Select
                      value={selectedAutomation}
                      onValueChange={(value) =>
                        setAutomationSelections((current) => ({
                          ...current,
                          [channel.id]: value,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select an automation" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE_AUTOMATION_VALUE}>No automation</SelectItem>
                        {automationOptions.map((automation) => (
                          <SelectItem key={automation.id} value={automation.id}>
                            {automation.toolName} - {automation.actionType}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => handleSaveAutomation(channel.id)}
                    disabled={isSavingAutomation}
                  >
                    {isSavingAutomation ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save automation'
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDisconnect(channel.id)}
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      <>
                        <Unplug className="mr-2 h-4 w-4" />
                        Disconnect
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
