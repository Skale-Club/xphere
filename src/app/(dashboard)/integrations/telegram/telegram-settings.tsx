'use client'

import { useState, useTransition } from 'react'
import { Check, Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

import {
  connectTelegramBot,
  disconnectTelegramBot,
  saveNotificationChats,
  toggleAutomation,
  type AgentOption,
  type TelegramBotView,
} from './actions'

interface TelegramSettingsProps {
  initialBot: TelegramBotView | null
  agents: AgentOption[]
}

export function TelegramSettings({ initialBot, agents }: TelegramSettingsProps) {
  const [bot, setBot] = useState<TelegramBotView | null>(initialBot)
  const [token, setToken] = useState('')
  const [chatIds, setChatIds] = useState<string[]>(bot?.notificationChatIds ?? [])
  const [newChatId, setNewChatId] = useState('')
  const [pendingConnect, startConnect] = useTransition()
  const [pendingChats, startChats] = useTransition()
  const [pendingAutomation, startAutomation] = useTransition()
  const [pendingDisconnect, startDisconnect] = useTransition()
  const [copied, setCopied] = useState(false)

  const isConnected = bot !== null

  function handleConnect() {
    startConnect(async () => {
      const res = await connectTelegramBot({ botToken: token.trim() })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Connected: @${res.botUsername}`)
      setToken('')
      // Optimistic refresh | server will revalidate, but reflect immediately
      window.location.reload()
    })
  }

  function handleAddChat() {
    const v = newChatId.trim()
    if (!v) return
    if (!/^-?\d+$/.test(v)) {
      toast.error('Chat ID must be a numeric value (e.g. -100123456789).')
      return
    }
    if (chatIds.includes(v)) {
      toast.message('Chat ID already present.')
      return
    }
    setChatIds([...chatIds, v])
    setNewChatId('')
  }

  function handleRemoveChat(id: string) {
    setChatIds(chatIds.filter((c) => c !== id))
  }

  function handleSaveChats() {
    startChats(async () => {
      const res = await saveNotificationChats(chatIds)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Notification chats saved.')
      if (bot) setBot({ ...bot, notificationChatIds: chatIds })
    })
  }

  function handleAutomationToggle(enabled: boolean) {
    if (!bot) return
    const nextAgentId = enabled ? bot.agentId ?? agents[0]?.id ?? null : bot.agentId
    if (enabled && !nextAgentId) {
      toast.error('Create an agent before enabling automation.')
      return
    }
    startAutomation(async () => {
      const res = await toggleAutomation({ enabled, agentId: nextAgentId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(enabled ? 'Automation enabled.' : 'Automation paused.')
      setBot({ ...bot, automationEnabled: enabled, agentId: nextAgentId })
    })
  }

  function handleAgentChange(agentId: string) {
    if (!bot) return
    startAutomation(async () => {
      const res = await toggleAutomation({ enabled: bot.automationEnabled, agentId })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Agent updated.')
      setBot({ ...bot, agentId })
    })
  }

  function handleDisconnect() {
    startDisconnect(async () => {
      const res = await disconnectTelegramBot()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Telegram bot disconnected.')
      setBot(null)
      setChatIds([])
    })
  }

  async function copyWebhook() {
    if (!bot) return
    try {
      await navigator.clipboard.writeText(bot.webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed.')
    }
  }

  return (
    <div className="space-y-6">
      {/* Connection card --------------------------------------------------- */}
      <section className="rounded-[12px] border border-border bg-bg-secondary p-5">
        <h2 className="text-[14px] font-semibold tracking-tight text-text-primary">
          Bot Connection
        </h2>
        <p className="mt-1 text-[12.5px] text-text-secondary">
          Create a bot in{' '}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            @BotFather
          </a>{' '}
          and paste the token here. We validate it with <code>/getMe</code> and
          configure the webhook automatically.
        </p>

        {isConnected ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-success/30 bg-success/5 px-4 py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-text-primary">
                Connected{bot.botUsername ? ` | @${bot.botUsername}` : ''}
              </div>
              {bot.botName ? (
                <div className="text-[12px] text-text-secondary">{bot.botName}</div>
              ) : null}
              {bot.lastError ? (
                <div className="mt-1 text-[12px] text-warning">
                  Warning: {bot.lastError}
                </div>
              ) : null}
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={pendingDisconnect}>
                  {pendingDisconnect ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Disconnect
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect Telegram bot?</AlertDialogTitle>
                  <AlertDialogDescription>
                    We will remove the webhook and mark the bot as inactive. Telegram
                    notifications will stop immediately.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDisconnect}>
                    Disconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="telegram-token">Bot token</Label>
              <Input
                id="telegram-token"
                type="password"
                placeholder="123456789:AAH..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={pendingConnect}
                autoComplete="off"
              />
            </div>
            <Button
              onClick={handleConnect}
              disabled={pendingConnect || token.trim().length === 0}
            >
              {pendingConnect ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Connect bot
            </Button>
          </div>
        )}
      </section>

      {/* Notifications card ----------------------------------------------- */}
      <section className="rounded-[12px] border border-border bg-bg-secondary p-5">
        <h2 className="text-[14px] font-semibold tracking-tight text-text-primary">
          Notifications
        </h2>
        <p className="mt-1 text-[12.5px] text-text-secondary">
          Chats that receive messages from workflows through the{' '}
          <code>send_telegram_notification</code>.
        </p>

        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            {chatIds.length === 0 ? (
              <p className="text-[12.5px] text-text-tertiary">
                No chats configured.
              </p>
            ) : (
              chatIds.map((id) => (
                <div
                  key={id}
                  className="flex items-center justify-between rounded-[8px] border border-border-subtle bg-bg-tertiary px-3 py-2"
                >
                  <code className="text-[12.5px] text-text-primary">{id}</code>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleRemoveChat(id)}
                    aria-label={`Remove ${id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder="-100123456789"
              value={newChatId}
              onChange={(e) => setNewChatId(e.target.value)}
              disabled={!isConnected}
            />
            <Button
              variant="outline"
              onClick={handleAddChat}
              disabled={!isConnected || newChatId.trim().length === 0}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          <Button
            onClick={handleSaveChats}
            disabled={!isConnected || pendingChats}
            size="sm"
          >
            {pendingChats ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Save chats
          </Button>

          <div className="rounded-[8px] border border-dashed border-border-subtle bg-bg-tertiary/40 px-3 py-2.5 text-[12px] text-text-secondary">
            <div className="font-medium text-text-primary">How to get the Chat ID</div>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>
                Add {bot?.botUsername ? `@${bot.botUsername}` : 'your bot'} to the
                desired group or channel.
              </li>
              <li>
                Send <code>/start</code> in the group.
              </li>
              <li>The bot replies with the Chat ID. Copy it and paste it here.</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Automation card -------------------------------------------------- */}
      <section className="rounded-[12px] border border-border bg-bg-secondary p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight text-text-primary">
              Automation Bot (DMs)
            </h2>
            <p className="mt-1 max-w-prose text-[12.5px] text-text-secondary">
              When enabled, an agent automatically replies to private messages received
              by the bot. Messages in groups and channels do not trigger the agent.
            </p>
          </div>
          <Switch
            checked={bot?.automationEnabled ?? false}
            onCheckedChange={handleAutomationToggle}
            disabled={!isConnected || pendingAutomation}
            aria-label="Toggle automation"
          />
        </div>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="telegram-agent">Agent</Label>
          <Select
            value={bot?.agentId ?? ''}
            onValueChange={handleAgentChange}
            disabled={!isConnected || agents.length === 0 || pendingAutomation}
          >
            <SelectTrigger id="telegram-agent">
              <SelectValue placeholder="Select agent" />
            </SelectTrigger>
            <SelectContent>
              {agents.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No agents available
                </SelectItem>
              ) : (
                agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Webhook URL card ------------------------------------------------- */}
      {isConnected ? (
        <section className="rounded-[12px] border border-border bg-bg-secondary p-5">
          <h2 className="text-[14px] font-semibold tracking-tight text-text-primary">
            Webhook URL
          </h2>
          <p className="mt-1 text-[12.5px] text-text-secondary">
            Configured automatically in Telegram when you connect the bot.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Input readOnly value={bot.webhookUrl} className="font-mono text-[12px]" />
            <Button variant="outline" size="icon" onClick={copyWebhook} aria-label="Copy webhook URL">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {!bot.webhookSet ? (
            <p className="mt-2 text-[12px] text-warning">
              Webhook not confirmed by Telegram yet. Try reconnecting the bot.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
