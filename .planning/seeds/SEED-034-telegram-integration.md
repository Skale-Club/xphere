---
id: SEED-034
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Large
priority: high
depends_on: []
---

# SEED-034: Telegram — Notificações + Bot de Automação

Integra o Telegram em dois modos distintos por org:
1. **Notificações**: workflow node `send_telegram_notification` dispara mensagens para um
   grupo/canal do Telegram (alertas de novo lead, task pendente, workflow falhou, etc.)
2. **Bot de automação**: agente responde DMs recebidos no Telegram (mesmo pipeline do WhatsApp/Messenger)

---

## Diagnóstico atual

| Componente | Estado |
|-----------|--------|
| `agent_channel` enum tem `'telegram'` | ✅ declarado em migration 034 |
| `formatTelegram()` — text chunker 4096 chars | ✅ existe em `adapters/telegram.ts` |
| `integration_provider` enum não tem `'telegram'` | ❌ faltando |
| Nenhuma tabela para configs de bot Telegram | ❌ faltando |
| Nenhum webhook handler | ❌ faltando |
| Nenhum executor/node de workflow | ❌ faltando |
| Nenhuma UI de configuração | ❌ faltando |

---

## Modelo de dados

### Migração 096 — `telegram_bots`

```sql
-- 096_telegram_bots.sql

-- Adicionar telegram ao integration_provider enum
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'telegram';

CREATE TABLE telegram_bots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bot_token_encrypted     TEXT NOT NULL,            -- AES-256-GCM via lib/crypto
  bot_username            TEXT,                     -- @MeuBot (preenchido após /getMe)
  bot_name                TEXT,                     -- "Meu Bot" (display name)

  -- Modo de notificação: mensagens saem do bot para estes targets
  notification_chat_ids   TEXT[] NOT NULL DEFAULT '{}',
  -- Ex: ["-100123456789"] (grupo/canal) ou ["123456789"] (DM direto do admin)

  -- Modo de automação: bot responde DMs (como WhatsApp/Messenger)
  automation_enabled      BOOLEAN NOT NULL DEFAULT false,
  agent_id                UUID REFERENCES agents(id),   -- agente que responde

  is_active               BOOLEAN NOT NULL DEFAULT true,
  webhook_set             BOOLEAN NOT NULL DEFAULT false,
  last_error              TEXT,
  created_by              UUID REFERENCES auth.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um bot ativo por org (simplifica lookup)
CREATE UNIQUE INDEX telegram_bots_org_active_idx
  ON telegram_bots(org_id)
  WHERE is_active = true;

ALTER TABLE telegram_bots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members" ON telegram_bots
  USING (org_id = get_current_org_id());
```

---

## Modo 1 — Notificações (Workflow Node)

### Conceito

```
Workflow trigger (lead criado, task pendente, etc.)
    │
    └─ Node: send_telegram_notification
         ├─ chat_id: {{notification_chat_id}}  (ou hardcoded na config)
         ├─ text: "🔔 Novo lead: {{contact.name}} - {{contact.phone}}"
         └─ parse_mode: "HTML" | "Markdown" | "plain"
```

### Workflow spec node `send_telegram_notification`

```ts
// src/lib/workflows/spec.ts — EDIT

{
  kind: 'send_telegram_notification',
  label: 'Send Telegram Notification',
  description: 'Sends a message to a Telegram group, channel, or DM',
  integration: 'telegram',
  inputs: {
    text: {
      type: 'string',
      description: 'Message content (supports HTML tags: <b>, <i>, <code>, <a href>)',
      required: true,
    },
    chat_id: {
      type: 'string',
      description: 'Override target chat ID. If empty, uses the bot\'s configured notification_chat_ids.',
      required: false,
    },
    parse_mode: {
      type: 'string',
      enum: ['HTML', 'Markdown', 'plain'],
      default: 'HTML',
      required: false,
    },
    disable_notification: {
      type: 'boolean',
      description: 'Send silently (no sound/vibration)',
      default: false,
      required: false,
    },
  },
}
```

### Executor `send_telegram_notification`

```ts
// src/lib/action-engine/executors/send-telegram-notification.ts — NEW

export async function executeSendTelegramNotification(params: {
  orgId: string
  text: string
  chatId?: string      // override; fallback para notification_chat_ids do bot
  parseMode?: 'HTML' | 'Markdown' | 'plain'
  disableNotification?: boolean
}): Promise<{ ok: boolean; error?: string; messageIds?: number[] }>
```

### `src/lib/telegram/client.ts` — NEW

```ts
const TELEGRAM_API = 'https://api.telegram.org/bot'

export async function sendTelegramMessage(params: {
  botToken: string
  chatId: string
  text: string
  parseMode?: 'HTML' | 'MarkdownV2'
  disableNotification?: boolean
}): Promise<{ ok: boolean; messageId?: number; error?: string }>

export async function getMe(botToken: string): Promise<{ username: string; name: string } | null>

export async function setWebhook(botToken: string, url: string): Promise<boolean>

export async function deleteWebhook(botToken: string): Promise<boolean>
```

**Chunking:** Usar o `formatTelegram()` já existente (4096 chars, sem markdown). Para notificações com HTML, enviar como `parse_mode: 'HTML'` diretamente — não passa pelo formatter.

---

## Modo 2 — Bot de Automação (Inbound/Outbound)

### Webhook handler

```ts
// src/app/api/telegram/webhook/route.ts — NEW

export const runtime = 'nodejs'

// POST https://api.telegram.org/bot{token}/setWebhook?url=https://xphere.app/api/telegram/webhook/{orgId}
// Telegram envia: { update_id, message: { message_id, from, chat, text, ... } }

export async function POST(
  request: Request,
  { params }: { params: { orgId: string } }
): Promise<Response> {
  // 1. Lookup telegram_bots por orgId (is_active=true)
  // 2. Verify request IP é Telegram (opcional mas recomendado)
  // 3. after() → processeTelegramMessage()
  // 4. return Response.json({ ok: true }) [sempre 200]
}
```

**URL pattern:** `/api/telegram/webhook/[orgId]/route.ts`
O `orgId` no path permite diferenciar webhooks de múltiplas orgs no mesmo bot token.

### Payload do Telegram (tipos relevantes)

```ts
interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from: { id: number; username?: string; first_name: string; last_name?: string }
    chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' }
    date: number           // unix
    text?: string
    photo?: TelegramPhotoSize[]     // array de resoluções, usar a maior
    audio?: TelegramAudio
    voice?: TelegramVoice           // voice note (ogg/opus)
    video?: TelegramVideo
    document?: TelegramDocument
    sticker?: TelegramSticker
    caption?: string        // legenda de mídia
    reply_to_message?: TelegramMessage
  }
}
```

### `processTelegramMessage()` — pipeline de automação

```ts
// src/lib/telegram/process-update.ts — NEW

async function processTelegramUpdate(update: TelegramUpdate, bot: TelegramBotRow): Promise<void> {
  const msg = update.message
  if (!msg) return                                    // ignorar outros update types
  if (msg.chat.type !== 'private') return             // bot de automação só responde DMs
  if (!bot.automation_enabled || !bot.agent_id) return

  const from = msg.from
  const chatId = String(msg.chat.id)
  const text = msg.text ?? msg.caption ?? ''

  // 1. Upsert conversation (channel='telegram', visitor_phone=chatId)
  // 2. Idempotência por message_id
  // 3. Download mídia se houver (SEED-030 bucket chat-media)
  // 4. Insert conversation_messages (role='user', content=text, metadata.media=[...])
  // 5. Bot gate
  // 6. runAgent({channel:'telegram', agentId: bot.agent_id, ...})
  // 7. sendTelegramMessage(reply)
}
```

**Canal `'telegram'` adicionado ao `conversations.channel` CHECK:**
```sql
-- Adicionar à migration:
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('widget','messenger','instagram','sms','voice','whatsapp','telegram'));
```

### Envio de reply (outbound)

```ts
// src/lib/telegram/send-message.ts — NEW

export async function sendTelegramReply(params: {
  orgId: string
  chatId: string        // Telegram chat ID (= visitor_phone no schema)
  text: string
  conversationId?: string
}): Promise<{ ok: boolean; messageIds: number[] }>
```

Usa `formatTelegram()` para chunking + envia cada chunk como mensagem separada.
Persiste cada chunk como `conversation_messages` (role='assistant').

---

## Templates de notificação pré-construídos

Além do node genérico, o seed inclui **templates prontos** para eventos comuns:

```ts
// src/lib/telegram/notification-templates.ts — NEW

export const TELEGRAM_TEMPLATES = {
  new_lead: (contact: Contact) =>
    `🆕 <b>Novo Lead</b>\n👤 ${contact.name ?? 'Sem nome'}\n📱 ${contact.phone ?? '—'}\n📧 ${contact.email ?? '—'}`,

  pending_task: (task: Task) =>
    `⏰ <b>Task Pendente</b>\n📋 ${task.title}\n👤 ${task.assigned_to_name ?? 'Sem responsável'}\n📅 Vence: ${formatDate(task.due_at)}`,

  workflow_failed: (wf: WorkflowRun) =>
    `❌ <b>Workflow Falhou</b>\n⚡ ${wf.workflow_name}\n🔴 Erro: ${wf.error_detail ?? 'Erro desconhecido'}`,

  new_conversation: (conv: Conversation) =>
    `💬 <b>Nova Conversa</b>\n👤 ${conv.visitor_name ?? conv.visitor_phone}\n📲 ${conv.channel.toUpperCase()}\n💬 ${conv.last_message?.slice(0, 120) ?? '—'}`,

  missed_call: (call: CallLog) =>
    `📞 <b>Ligação Perdida</b>\n👤 ${call.caller_name ?? call.customer_number}\n🕐 ${relativeTime(call.created_at)}`,
}
```

Esses templates são usados em seeds de workflow padrão (`supabase/seeds/workflows/`).

---

## Seeds de workflow padrão com Telegram

```yaml
# supabase/seeds/workflows/notify-new-lead-telegram.yaml
name: Notify new lead via Telegram
kind: flow
trigger:
  type: event
  config:
    event_type: contact.created
nodes:
  - id: notify
    kind: send_telegram_notification
    integration: telegram
    text: |
      🆕 <b>Novo Lead</b>
      👤 {{contact.name}}
      📱 {{contact.phone}}
    parse_mode: HTML
edges:
  - from: trigger
    to: notify
```

```yaml
# supabase/seeds/workflows/notify-workflow-failed-telegram.yaml
name: Notify workflow failure via Telegram
kind: flow
trigger:
  type: event
  config:
    event_type: workflow.run.failed
nodes:
  - id: notify
    kind: send_telegram_notification
    integration: telegram
    text: |
      ❌ <b>Workflow Falhou</b>
      ⚡ {{workflow.name}}
      🔴 {{workflow.error}}
    parse_mode: HTML
edges:
  - from: trigger
    to: notify
```

---

## UI — Settings

### `/integrations/telegram`

```
┌─────────────────────────────────────────────────────────────────┐
│  Telegram                                                       │
│                                                                 │
│  Bot Token  [_________________________________]  [Conectar]    │
│                                                                 │
│  ✅ Conectado — @MeuBotDeNegocios                              │
│                                                                 │
│  ── Notificações ─────────────────────────────────────────────  │
│  Grupos/Chats para notificações:                                │
│  [-100123456789  ×]  [+ Add chat ID]                           │
│                                                                 │
│  Como obter o Chat ID:                                          │
│  1. Adicione @MeuBotDeNegocios ao grupo                         │
│  2. Envie /start no grupo                                       │
│  3. O bot retorna o Chat ID automaticamente                     │
│                                                                 │
│  ── Bot de Automação ─────────────────────────────────────────  │
│  [☐] Ativar bot de automação para DMs                          │
│  Agente: [Selecionar agente ▾]                                  │
│                                                                 │
│  Webhook URL:                                                   │
│  [https://xphere.app/api/telegram/webhook/org-id ⎘]           │
│  (configurado automaticamente ao conectar)                      │
└─────────────────────────────────────────────────────────────────┘
```

### Server action: `connectTelegramBot`

```ts
// 1. Descriptografar e validar bot token via /getMe
// 2. Salvar bot_username, bot_name
// 3. Chamar setWebhook → https://xphere.app/api/telegram/webhook/{orgId}
// 4. Insert/upsert telegram_bots row
// 5. return { ok, botUsername }
```

### Comando `/start` no grupo

Quando bot recebe `/start` em um grupo, responde com:
```
✅ Bot conectado! Chat ID deste grupo: -100123456789
Copie esse ID para as configurações de notificação do Xphere.
```

---

## Arquivos

```
supabase/migrations/
└── 096_telegram_bots.sql                  NEW: tabela + provider enum

supabase/seeds/workflows/
├── notify-new-lead-telegram.yaml          NEW: template workflow
└── notify-workflow-failed-telegram.yaml   NEW: template workflow

src/lib/telegram/
├── client.ts                              NEW: sendMessage, getMe, setWebhook
├── send-message.ts                        NEW: sendTelegramReply (outbound bot)
├── process-update.ts                      NEW: inbound bot pipeline
└── notification-templates.ts             NEW: templates HTML pré-construídos

src/lib/action-engine/executors/
└── send-telegram-notification.ts          NEW: executor do node

src/lib/workflows/spec.ts                  EDIT: add send_telegram_notification node

src/app/api/telegram/webhook/[orgId]/
└── route.ts                               NEW: webhook handler (always 200)

src/app/(dashboard)/integrations/telegram/
├── page.tsx                               NEW: settings page
├── actions.ts                             NEW: connectTelegramBot, saveNotificationChats
└── telegram-settings.tsx                 NEW: settings client component
```

---

## Critérios de sucesso

1. ✅ Admin conecta bot token → webhook configurado automaticamente no Telegram
2. ✅ Workflow com node `send_telegram_notification` envia mensagem formatada com HTML
3. ✅ Bot responde `/start` em grupo com Chat ID para facilitar configuração
4. ✅ Workflow "Novo Lead → Telegram" funcionando com template pronto
5. ✅ Bot de automação recebe DM no Telegram → agente responde → mensagem aparece no inbox
6. ✅ Mídia recebida no Telegram (foto, áudio) processada pelo bucket chat-media (SEED-030)
7. ✅ `send_telegram_notification` aparece na spec quando org tem Telegram conectado
8. ✅ `npm run build` passa sem erros de tipo
