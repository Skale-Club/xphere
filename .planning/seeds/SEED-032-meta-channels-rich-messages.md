---
id: SEED-032
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Medium-Large
priority: high
depends_on: [SEED-030]
---

# SEED-032: Meta Channels — Messenger + Instagram DM Ricos

Corrige os gaps de mídia e estrutura do Messenger e Instagram DM: inbound de
imagens/áudio/vídeo/stickers, outbound de mídia, e consolidação de múltiplos
providers Meta (Direct API vs ManyChat) em uma camada única.

---

## Por que é diferente do WhatsApp (SEED-031)

No WhatsApp existem providers **não-oficiais** concorrentes (Evolution, Z-API, W-API).  
No Meta **não existe alternativa** — a Meta Graph API é o único caminho oficial para
Messenger e Instagram DM.

O que existe como "provider alternativo" é o **ManyChat** — uma plataforma autorizada
pelo Meta que expõe sua própria API por cima da Graph API. O ManyChat já existe no
codebase como integração separada (`/api/manychat/webhook`), mas os dois sistemas
não compartilham código nem pipeline.

**A questão de providers aqui é:** direto via Graph API (atual) vs roteado via ManyChat
(legado em alguns clientes). Um org não deveria precisar dos dois ativos para o mesmo
canal — a regra é a mesma: **um provider ativo por canal por org**.

---

## Diagnóstico atual (Auditoria 2026-05-20)

### Gaps críticos

| Gap | Localização | Impacto |
|-----|------------|---------|
| `message.attachments[]` nunca lido no webhook | `process-event.ts` | Fotos/vídeos/stickers do cliente somem |
| `if (!event.message?.text) continue` descarta qualquer msg sem texto | `process-event.ts` linha ~45 | Sticker, áudio, reação = silencioso |
| `sendMetaMessage()` text-only | `send-message.ts` | Admin não pode mandar foto/arquivo |
| Payload type não define `attachments` | Tipo `MetaWebhookPayload` | TypeScript não vê o campo |
| ManyChat e Meta Graph API em silos separados | Nenhum código compartilhado | Lógica duplicada, sem unificação |
| `webhook_verified` armazenado mas nunca usado | `meta_channels` | Coluna órfã |
| Echo de-dup só por `is_echo` flag, sem checar `mid` | `process-event.ts` | Mensagens duplicadas possíveis |

### O que funciona (não quebrar)

- HMAC-SHA256 signature verification — ✅
- Webhook GET (hub.challenge) — ✅
- OAuth com exchange de token longo — ✅
- 24h messaging window enforcement — ✅
- Multi-page por org (uma row por page + channel_type) — ✅
- v2.0 agent dispatch (agent_id na meta_channels) — ✅
- `after()` para resposta imediata ao Meta — ✅

---

## Estrutura de payload Meta que está sendo ignorada

### Messenger inbound com mídia

```json
{
  "object": "page",
  "entry": [{
    "id": "PAGE_ID",
    "messaging": [{
      "sender": { "id": "PSID" },
      "recipient": { "id": "PAGE_ID" },
      "timestamp": 1234567890,
      "message": {
        "mid": "m_abc123",
        "text": "legenda opcional",
        "attachments": [
          {
            "type": "image",
            "payload": { "url": "https://cdn.fbsbx.com/...", "is_reusable": false }
          },
          {
            "type": "audio",
            "payload": { "url": "https://cdn.fbsbx.com/..." }
          },
          {
            "type": "video",
            "payload": { "url": "https://cdn.fbsbx.com/..." }
          },
          {
            "type": "file",
            "payload": { "url": "https://cdn.fbsbx.com/...", "name": "doc.pdf" }
          },
          {
            "type": "sticker",
            "payload": { "url": "https://...", "sticker_id": 369239263222822 }
          }
        ]
      }
    }]
  }]
}
```

### Instagram DM inbound com mídia

```json
{
  "object": "instagram",
  "entry": [{
    "id": "IG_ACCOUNT_ID",
    "messaging": [{
      "sender": { "id": "IGSID" },
      "recipient": { "id": "IG_ACCOUNT_ID" },
      "timestamp": 1234567890,
      "message": {
        "mid": "m_xyz456",
        "text": null,
        "attachments": [
          {
            "type": "image",
            "payload": { "url": "https://scontent.cdninstagram.com/..." }
          }
        ]
      }
    }]
  }]
}
```

### Instagram: reações e referências a stories

```json
// Reação a mensagem
{
  "message": {
    "mid": "m_abc",
    "reaction": {
      "action": "react",
      "emoji": "❤️"
    }
  }
}

// Reply a story (Instagram)
{
  "message": {
    "mid": "m_abc",
    "reply_to": { "story": { "id": "17...", "url": "..." } },
    "text": "que foto incrível!"
  }
}
```

---

## Solução

### Parte 1 — Inbound media (Messenger + Instagram)

#### 1A — Tipo `MetaWebhookPayload` atualizado

```ts
// src/lib/meta/types.ts — NEW (extraído de process-event.ts)

export interface MetaAttachment {
  type: 'image' | 'audio' | 'video' | 'file' | 'sticker' | 'location' | 'template' | 'fallback'
  payload?: {
    url?: string
    is_reusable?: boolean
    sticker_id?: number
    name?: string            // file attachments
    coordinates?: { lat: number; long: number }  // location
  }
}

export interface MetaMessage {
  mid: string
  text?: string
  is_echo?: boolean
  attachments?: MetaAttachment[]
  reaction?: { action: 'react' | 'unreact'; emoji?: string }
  reply_to?: { story?: { id: string; url: string }; mid?: string }
}

export interface MetaMessagingEntry {
  sender: { id: string }
  recipient: { id: string }
  timestamp?: number
  message?: MetaMessage
  postback?: { title: string; payload: string; mid: string }
}

export interface MetaWebhookPayload {
  object: 'page' | 'instagram' | string
  entry: Array<{
    id: string
    time?: number
    messaging: MetaMessagingEntry[]
  }>
}
```

#### 1B — `downloadMetaMedia()` helper

```ts
// src/lib/meta/media.ts — NEW

/**
 * URLs do Meta CDN exigem o page access token como ?access_token=
 * OU podem ser acessadas diretamente dependendo da configuração do app.
 * Baixa o arquivo, faz re-host no Supabase Storage, retorna URL pública.
 */
export async function downloadMetaMedia(params: {
  url: string
  mimeType: string          // inferido do tipo de attachment
  pageToken: string
  orgId: string
  conversationId: string
  messageId: string
  index: number
}): Promise<{ url: string; mimeType: string; size: number } | null>
```

**Inferência de MIME type:** Meta nem sempre envia Content-Type.
Estratégia: verificar `Content-Type` da resposta HTTP; fallback por tipo do attachment:
- `image` → `image/jpeg`
- `audio` → `audio/mpeg`
- `video` → `video/mp4`
- `file` → `application/octet-stream`

#### 1C — `process-event.ts` atualizado

```ts
// Antes:
const text = event.message?.text ?? ''
if (!text) continue                         // ← bug: descarta mídia

// Depois:
const msg = event.message
if (!msg || msg.is_echo) continue
if (msg.reaction) continue                  // ignorar reações por ora

// De-dup por mid (mais robusto que só is_echo)
const isDup = await checkDuplicateByMid(conversationId, msg.mid)
if (isDup) continue

const text = msg.text ?? ''
const attachments = msg.attachments ?? []

// Download + store media
const mediaItems: WhatsAppMediaAttachment[] = []
for (let i = 0; i < attachments.length; i++) {
  const att = attachments[i]
  if (!att.payload?.url) continue
  const stored = await downloadMetaMedia({
    url: att.payload.url,
    mimeType: inferMimeFromAttachmentType(att.type),
    pageToken,
    orgId, conversationId, messageId: newMsgId, index: i,
  })
  if (stored) mediaItems.push(stored)
}

const messageType = mediaItems.length > 0
  ? (text ? 'mixed' : attachments[0]?.type === 'sticker' ? 'sticker' : attachments[0]?.type ?? 'image')
  : 'text'

// Inserir mensagem com mídia
await insertMessage({
  id: newMsgId,
  role: 'user',
  content: text,
  message_type: messageType,
  metadata: {
    channel,
    meta_mid: msg.mid,
    ...(mediaItems.length > 0 ? { media: mediaItems } : {}),
  },
})
```

#### 1D — Story reply como contexto

Quando `msg.reply_to?.story` existe, adicionar ao metadata:
```ts
metadata: {
  ...
  story_reply: {
    story_id: msg.reply_to.story.id,
    story_url: msg.reply_to.story.url,
  }
}
```
Exibir no chat como citação: "↩ respondeu a um story" com link.

---

### Parte 2 — Outbound media

#### 2A — `sendMetaMessage()` com anexo

```ts
// src/lib/meta/send-message.ts — EDIT

export async function sendMetaMessage(
  pageToken: string,
  recipientId: string,
  text: string,
  media?: { url: string; type: 'image' | 'audio' | 'video' | 'file' },
): Promise<{ messageId?: string; error?: string }>

// Para texto com imagem:
// POST /me/messages
// {
//   "recipient": { "id": "..." },
//   "message": {
//     "attachment": {
//       "type": "image",
//       "payload": { "url": "https://...", "is_reusable": true }
//     }
//   }
// }

// Para texto + imagem juntos:
// Enviar dois requests separados (Meta não suporta text + attachment em um request)
```

---

### Parte 3 — ManyChat como provider alternativo

#### 3A — Conceito

ManyChat é uma plataforma autorizada pelo Meta que:
- Recebe eventos do Messenger/Instagram via sua própria infraestrutura
- Expõe webhooks de saída para o Xphere (já implementado em `/api/manychat/webhook`)
- Permite enviar mensagens via API ManyChat (diferente da Graph API)

Problema atual: ManyChat e Direct são silos. Uma org pode ter os dois ativos para o mesmo
canal (Messenger), o que cria mensagens duplicadas no inbox.

#### 3B — `meta_channel_provider` enum

```sql
-- Adicionar à tabela meta_channels:
ALTER TABLE meta_channels
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'direct'
  CHECK (provider IN ('direct', 'manychat'));

-- Garantir que só um provider está ativo por canal por org:
CREATE UNIQUE INDEX meta_channels_org_channel_active_idx
  ON meta_channels(org_id, channel_type)
  WHERE is_active = true;
```

#### 3C — Dispatch por provider

Quando admin envia mensagem:
```ts
// src/lib/meta/send.ts — NEW (wrapper)

export async function sendMetaChannelMessage(params: {
  orgId: string
  channel: 'messenger' | 'instagram'
  recipientId: string
  text: string
  media?: MetaMediaAttachment
}): Promise<{ ok: boolean; error?: string }> {
  const channelRow = await resolveActiveMetaChannel(orgId, channel)
  if (!channelRow) return { ok: false, error: 'No active Meta channel' }

  if (channelRow.provider === 'manychat') {
    return sendViaManyChat(params, channelRow)
  }
  return sendViaDirect(params, channelRow)
}
```

---

### Parte 4 — UI settings

#### Localização

`/integrations/meta` já existe. Adicionar:
- Badge "provider: Direct" ou "provider: ManyChat" por canal
- Seção "Trocar para ManyChat" (toggle + campo de API key ManyChat)
- Aviso de conflito se ambos estiverem configurados

---

## Arquivos

```
supabase/migrations/
└── 094_meta_channels_provider.sql        NEW: provider column + unique active index

src/lib/meta/
├── types.ts                              NEW: MetaWebhookPayload, MetaAttachment, etc.
├── media.ts                              NEW: downloadMetaMedia()
├── send.ts                               NEW: sendMetaChannelMessage() (provider dispatch)
├── process-event.ts                      EDIT: attachments handling, de-dup por mid, story reply
└── send-message.ts                       EDIT: suporte a media param

src/app/api/meta/webhook/route.ts         EDIT: passa pageToken ao process-event
src/app/(dashboard)/integrations/meta/
└── page.tsx                              EDIT: badge de provider, toggle ManyChat
```

---

## Diferença fundamental vs SEED-031 (WhatsApp)

| | WhatsApp (SEED-031) | Meta (SEED-032) |
|---|---|---|
| Providers | 3 opções unofficial concorrentes | 1 oficial (Graph API) + 1 platform partner (ManyChat) |
| Troca de provider | Frequente (custo/preferência) | Raro (migração de plataforma) |
| Media fetch | Cada provider tem API diferente | Mesmo CDN Meta, mesmo token de página |
| Multi-instância | Sim (uma por número) | Não (uma por page + channel_type) |
| Regra de unicidade | 1 ativo por org | 1 ativo por org + channel_type |

---

## Critérios de sucesso

1. ✅ Cliente manda foto no Messenger → aparece no chat inbox
2. ✅ Cliente manda áudio no Instagram DM → player de áudio aparece
3. ✅ Cliente manda sticker → exibido como imagem (sem cravar no fluxo)
4. ✅ Cliente responde story do Instagram → contexto aparece como citação
5. ✅ Admin pode enviar imagem via chat → chega via Graph API attachment
6. ✅ Mensagem sem texto (só sticker) não é mais descartada silenciosamente
7. ✅ De-dup por `mid` evita inserções duplicadas
8. ✅ Org com ManyChat ativo não recebe duplicatas do Meta Direct
9. ✅ `npm run build` passa sem erros de tipo
