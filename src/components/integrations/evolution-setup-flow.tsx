'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Check,
  Copy,
  Loader2,
  Phone,
  QrCode,
  Server,
  Smartphone,
  Trash2,
  RefreshCcw,
  Send,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { StatusPill } from '@/components/design-system/status-pill'
import { cn } from '@/lib/utils'
import {
  createEvolutionInstance,
  disconnectEvolutionInstance,
  getEvolutionQRCode,
  saveEvolutionConfig,
  sendEvolutionTestMessage,
  type EvolutionInstanceView,
  type QRCodeView,
} from '@/app/(dashboard)/integrations/evolution/actions'

interface Props {
  initialInstance: EvolutionInstanceView | null
  webhookUrl: string
}

type Step = 'server' | 'instance' | 'qr' | 'connected'

function deriveStep(instance: EvolutionInstanceView | null, qrStatus: QRCodeView['status'] | null): Step {
  if (!instance) return 'server'
  const status = qrStatus ?? instance.status
  if (status === 'connected') return 'connected'
  if (status === 'qr_pending' || status === 'connecting') return 'qr'
  return 'instance'
}

export function EvolutionSetupFlow({ initialInstance, webhookUrl }: Props) {
  const [instance, setInstance] = useState<EvolutionInstanceView | null>(initialInstance)
  const [qr, setQr] = useState<QRCodeView | null>(null)
  const step = useMemo(() => deriveStep(instance, qr?.status ?? null), [instance, qr])

  return (
    <div className="flex flex-col gap-6">
      <Stepper step={step} />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="flex flex-col gap-4">
          {step === 'server' && (
            <ServerConfigCard
              initial={instance}
              onSaved={(saved) => setInstance(saved)}
            />
          )}

          {step === 'instance' && instance && (
            <InstanceCreateCard
              instance={instance}
              onCreated={() => setInstance({ ...instance, status: 'qr_pending' })}
              onReset={() => setInstance(null)}
            />
          )}

          {step === 'qr' && instance && (
            <QRCodeCard
              instance={instance}
              qr={qr}
              setQr={setQr}
              onDisconnect={() => {
                setInstance(null)
                setQr(null)
              }}
            />
          )}

          {step === 'connected' && instance && (
            <ConnectedCard
              instance={instance}
              onDisconnect={() => {
                setInstance(null)
                setQr(null)
              }}
            />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <WebhookCard webhookUrl={webhookUrl} />
          {instance?.lastError && (
            <Card className="border-danger/40 bg-[var(--danger-muted)]/30">
              <CardHeader>
                <CardTitle className="text-[13px] text-danger">Last error</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[12px] text-danger break-words">{instance.lastError}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

const STEPS: { id: Step; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'server',    label: 'Server',    icon: Server },
  { id: 'instance',  label: 'Instance',  icon: Smartphone },
  { id: 'qr',        label: 'Scan QR',   icon: QrCode },
  { id: 'connected', label: 'Connected', icon: Check },
]

function Stepper({ step }: { step: Step }) {
  const currentIdx = STEPS.findIndex((s) => s.id === step)
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {STEPS.map((s, idx) => {
        const isDone = idx < currentIdx
        const isActive = idx === currentIdx
        const Icon = s.icon
        return (
          <div key={s.id} className="flex items-center gap-2 shrink-0">
            <div
              className={cn(
                'flex h-8 items-center gap-2 rounded-[8px] border px-2.5 text-[12px] font-medium',
                'transition-colors duration-150',
                isActive && 'border-accent bg-accent-muted/40 text-accent',
                isDone && 'border-success/60 bg-[var(--success-muted)]/40 text-success',
                !isActive && !isDone && 'border-border-subtle bg-bg-tertiary text-text-tertiary',
              )}
            >
              {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              <span>
                <span className="text-text-tertiary/80">{idx + 1}.</span> {s.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  'h-px w-6',
                  idx < currentIdx ? 'bg-success/60' : 'bg-border-subtle',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 | Server config
// ---------------------------------------------------------------------------

function ServerConfigCard({
  initial,
  onSaved,
}: {
  initial: EvolutionInstanceView | null
  onSaved: (instance: EvolutionInstanceView) => void
}) {
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [token, setToken] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [instanceName, setInstanceName] = useState(initial?.instanceName ?? '')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const res = await saveEvolutionConfig({ baseUrl, token, webhookSecret, instanceName })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Server config saved. Now create the instance.')
      onSaved({
        id: res.id,
        instanceName,
        baseUrl,
        status: 'disconnected',
        phoneNumber: null,
        connectedAt: null,
        lastError: null,
        hasWebhookSecret: Boolean(webhookSecret),
      })
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. Connect your Evolution Go server</CardTitle>
        <CardDescription>
          Xphere validates the server by listing your instances. Tokens are AES-256-GCM encrypted at rest.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2">
          <Label htmlFor="evo-base-url">Server URL</Label>
          <Input
            id="evo-base-url"
            placeholder="https://evo.example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="evo-token">Global API token</Label>
          <Input
            id="evo-token"
            type="password"
            placeholder="••••••••"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={pending}
            autoComplete="off"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="evo-instance-name">Instance name</Label>
          <Input
            id="evo-instance-name"
            placeholder="my-org-whatsapp"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            disabled={pending}
          />
          <p className="text-[12px] text-text-tertiary">
            Used as the identifier inside Evolution Go. Must be unique per server.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="evo-webhook-secret">Webhook signing secret (optional)</Label>
          <Input
            id="evo-webhook-secret"
            type="password"
            placeholder="leave blank to skip"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            disabled={pending}
            autoComplete="off"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={submit} disabled={pending || !baseUrl || !token || !instanceName}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save and validate
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 2 | Instance create
// ---------------------------------------------------------------------------

function InstanceCreateCard({
  instance,
  onCreated,
  onReset,
}: {
  instance: EvolutionInstanceView
  onCreated: () => void
  onReset: () => void
}) {
  const [pending, start] = useTransition()

  function create() {
    start(async () => {
      const res = await createEvolutionInstance()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Instance created. Generating QR code...')
      onCreated()
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>2. Create the instance</CardTitle>
            <CardDescription>
              Provision <code className="font-mono text-text-primary">{instance.instanceName}</code> on{' '}
              <code className="font-mono text-text-primary">{instance.baseUrl}</code>.
            </CardDescription>
          </div>
          <StatusPill tone="idle">{instance.status}</StatusPill>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[13px] text-text-secondary">
          Xphere will register the instance on your Evolution Go server and subscribe it to inbound message and
          connection events. The webhook URL is shown to the right | copy it into your Evolution Go dashboard if you
          prefer manual configuration.
        </p>
        <div className="flex gap-2">
          <Button onClick={create} disabled={pending}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create instance
          </Button>
          <Button variant="outline" onClick={onReset} disabled={pending}>
            Change server
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 3 | QR scan
// ---------------------------------------------------------------------------

function QRCodeCard({
  instance,
  qr,
  setQr,
  onDisconnect,
}: {
  instance: EvolutionInstanceView
  qr: QRCodeView | null
  setQr: (qr: QRCodeView | null) => void
  onDisconnect: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)

  async function refresh() {
    setRefreshing(true)
    const res = await getEvolutionQRCode()
    setRefreshing(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setQr(res.data)
  }

  // Auto-refresh every 8s while pending
  useEffect(() => {
    refresh()
    const id = setInterval(() => {
      refresh()
    }, 8000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>3. Scan the QR code</CardTitle>
            <CardDescription>
              Open WhatsApp on your phone → Linked devices → Link a device. The QR refreshes automatically.
            </CardDescription>
          </div>
          <StatusPill tone={qr?.status === 'connecting' ? 'warning' : 'info'}>
            {qr?.status ?? instance.status}
          </StatusPill>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <div className="relative flex h-[280px] w-[280px] items-center justify-center rounded-[16px] border border-border bg-bg-tertiary">
          {qr?.base64 ? (
            <img
              src={qr.base64}
              alt="WhatsApp QR code"
              className="h-[260px] w-[260px] rounded-[12px] bg-white p-2"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-text-tertiary">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
              <span className="text-[12px]">Waiting for QR code…</span>
            </div>
          )}
        </div>
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[12px] text-text-tertiary">
            <RefreshCcw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
            <span>Auto-refresh every 8s</span>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Refresh now
          </Button>
        </div>
        <DisconnectButton onDisconnect={onDisconnect} />
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 4 | Connected
// ---------------------------------------------------------------------------

function ConnectedCard({
  instance,
  onDisconnect,
}: {
  instance: EvolutionInstanceView
  onDisconnect: () => void
}) {
  const [testTo, setTestTo] = useState('')
  const [testText, setTestText] = useState('Hello from Xphere!')
  const [sending, start] = useTransition()

  function send() {
    if (!testTo.trim() || !testText.trim()) {
      toast.error('Phone number and message are required.')
      return
    }
    start(async () => {
      const res = await sendEvolutionTestMessage(testTo.trim(), testText.trim())
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Test message sent.')
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Connected</CardTitle>
            <CardDescription>
              Inbound messages now flow into the conversations inbox.
            </CardDescription>
            {instance.phoneNumber && (
              <div className="mt-1 flex items-center gap-1.5 text-[13px] text-text-primary">
                <Phone className="h-3.5 w-3.5 text-success" />
                <span className="font-medium">{instance.phoneNumber}</span>
              </div>
            )}
          </div>
          <StatusPill tone="live">Live</StatusPill>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2">
          <Label htmlFor="evo-test-to">Test send: phone (E.164)</Label>
          <Input
            id="evo-test-to"
            placeholder="+5511999998888"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            disabled={sending}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="evo-test-text">Message</Label>
          <Input
            id="evo-test-text"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            disabled={sending}
          />
        </div>
        <div className="flex items-center justify-between gap-3 pt-2">
          <Button onClick={send} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send test message
          </Button>
          <DisconnectButton onDisconnect={onDisconnect} />
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Shared: webhook card + disconnect dialog
// ---------------------------------------------------------------------------

function WebhookCard({ webhookUrl }: { webhookUrl: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true)
      toast.success('Webhook URL copied.')
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[14px]">Webhook URL</CardTitle>
        <CardDescription>
          Xphere configures this automatically when you create an instance.
          You can also paste it manually into the Evolution Go dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-[6px] border border-border-subtle bg-bg-tertiary px-2 py-1.5 font-mono text-[11.5px]">
            {webhookUrl}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DisconnectButton({ onDisconnect }: { onDisconnect: () => void }) {
  const [pending, start] = useTransition()

  function go() {
    start(async () => {
      const res = await disconnectEvolutionInstance()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Disconnected.')
      onDisconnect()
    })
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-danger hover:text-danger">
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect WhatsApp instance?</AlertDialogTitle>
          <AlertDialogDescription>
            The instance will be logged out and removed from your Evolution Go server. You can reconnect later by
            scanning the QR code again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={go} disabled={pending}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
