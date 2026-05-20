'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Copy, Loader2, Zap } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  createManychatChannel,
  deleteManychatChannel,
  testManychatConnection,
  type ManychatChannelForDisplay,
} from '@/app/(dashboard)/integrations/manychat/actions'

const schema = z.object({
  channelName: z.string().min(1, 'Bot name is required'),
  apiKey: z.string().min(1, 'API key is required'),
})

type FormValues = z.infer<typeof schema>

const WEBHOOK_URL = 'https://xphere.app/api/manychat/webhook'

// Payload template defined inline to avoid importing a non-function from a 'use server' module
const PAYLOAD_TEMPLATE = {
  subscriber_id: '{{user.id}}',
  first_name: '{{user.first_name}}',
  last_name: '{{user.last_name}}',
  email: '{{user.email}}',
  phone: '{{user.phone}}',
  tags: '{{user.tags}}',
  event_type: 'flow_completed',
  flow_id: '{{flow_id}}',
}

const payloadJson = JSON.stringify(PAYLOAD_TEMPLATE, null, 2)

async function handleCopy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied.`)
  } catch {
    toast.error('Failed to copy. Please copy manually.')
  }
}

type ManychatSettingsProps = {
  channel: ManychatChannelForDisplay | null
}

export function ManychatSettings({ channel }: ManychatSettingsProps) {
  const router = useRouter()
  const [isTesting, setIsTesting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(values: FormValues) {
    const result = await createManychatChannel({
      channelName: values.channelName,
      apiKey: values.apiKey,
    })

    if (result && result.error) {
      toast.error(result.error)
      return
    }

    router.refresh()
  }

  async function handleTestConnection() {
    setIsTesting(true)
    try {
      const result = await testManychatConnection()
      if (result.success) {
        toast.success('Connection successful — ManyChat API key is valid.')
      } else {
        toast.error(result.error ?? 'Connection test failed.')
      }
    } finally {
      setIsTesting(false)
    }
  }

  async function handleDisconnect() {
    if (!channel) return
    setIsDeleting(true)
    try {
      await deleteManychatChannel(channel.id)
      router.refresh()
    } finally {
      setIsDeleting(false)
    }
  }

  // Not connected state
  if (channel === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect ManyChat</CardTitle>
          <CardDescription>
            Enter your ManyChat API key to start receiving subscriber events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="channelName">Bot name</Label>
              <Input
                id="channelName"
                placeholder="Main Bot"
                {...register('channelName')}
              />
              {errors.channelName && (
                <p className="text-sm text-destructive">{errors.channelName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">ManyChat API key</Label>
              <Input
                id="apiKey"
                type="password"
                {...register('apiKey')}
              />
              {errors.apiKey && (
                <p className="text-sm text-destructive">{errors.apiKey.message}</p>
              )}
            </div>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  // Connected state
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{channel.channelName}</CardTitle>
          {channel.isActive && <Badge variant="secondary">Active</Badge>}
        </div>
        <CardDescription>Key: {channel.keyHint}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Webhook URL */}
        <div className="space-y-2">
          <Label>Webhook URL</Label>
          <div className="flex gap-2">
            <Input value={WEBHOOK_URL} readOnly className="font-mono text-xs" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCopy(WEBHOOK_URL, 'Webhook URL')}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy URL
            </Button>
          </div>
        </div>

        {/* Webhook Secret */}
        <div className="space-y-2">
          <Label>Webhook Secret</Label>
          <div className="flex gap-2">
            <Input value={channel.webhookSecret} readOnly className="font-mono text-xs" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCopy(channel.webhookSecret, 'Webhook secret')}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Secret
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Add as X-Operator-Secret header in ManyChat External Request
          </p>
        </div>

        {/* Payload Template */}
        <div className="space-y-2">
          <Label>Payload Template</Label>
          <p className="text-xs text-muted-foreground">
            Copy this JSON into your External Request body config in ManyChat.
          </p>
          <Textarea
            className="font-mono text-xs"
            rows={12}
            value={payloadJson}
            readOnly
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleCopy(payloadJson, 'Payload template')}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy JSON
          </Button>
        </div>

        {/* Test Connection */}
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={isTesting}
          >
            {isTesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Test Connection
              </>
            )}
          </Button>
        </div>

        <Separator />

        {/* Danger zone */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Danger zone</p>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDisconnect}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Disconnecting...
              </>
            ) : (
              'Disconnect'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
