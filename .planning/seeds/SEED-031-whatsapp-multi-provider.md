---
id: SEED-031
status: complete
planted: 2026-05-20
shipped: 2026-05-20
trigger_when: now (autonomous execution)
scope: Large
priority: high
depends_on: [SEED-030]
---

# SEED-031: WhatsApp Multi-Provider — Evolution Go, Z-API e W-API

Cria uma camada de abstração que suporta três providers de WhatsApp unofficial
(Evolution Go, Z-API, W-API) com apenas **um ativo por org**. Cada provider
tem webhook handler, adapter de normalização e estratégia de mídia próprios.
O resto do sistema (agent runtime, inbox, send) só fala com a interface comum.

---

## Regra central

> **Uma org, um provider ativo.**  
> `whatsapp_providers.is_active = true` é único por `org_id`.  
> Trocar de provider desativa o anterior automaticamente (DB constraint + toggle na UI).

---

## Diagnóstico atual

| Situação | Detalhe |
|----------|---------|
| Só Evolution Go existe | Tabela `evolution_instances`, webhook `/api/evolution/webhook`, send via `sendWhatsappMessage()` |
| Z-API e W-API não integrados | Nenhum código no codebase |
| Media completamente ignorada | Coberto pelo SEED-030 — este seed se apoia nele |
| Audio sem caption → mensagem descartada | `if (!messageText) continue` em `process-event.ts` linha 141 |
| Providers são hardcoded | Nenhuma abstração — Evolution é o único caminho |

---

## Arquitetura

```
                    ┌─────────────────────────────────┐
                    │       Webhook Endpoints          │
                    ├────────────┬────────────┬────────┤
                    │ /evolution │  /zapi     │ /wapi  │
                    └─────┬──────┴─────┬──────┴───┬────┘
                          │            │           │
                    ┌─────▼────────────▼───────────▼────┐
                    │      Provider Adapters             │
                    │  normalize() → NormalizedWAMsg     │
                    │  fetchMedia() → MediaAttachment[]  │
                    └──────────────┬────────────────────┘
                                   │
                    ┌──────────────▼────────────────────┐
                    │   processWhatsAppMessage()         │
                    │   (shared pipeline — SEED-030)     │
                    │   upsert conversation              │
                    │   insert message + media           │
                    │   runAgent() if bot_status=active  │
                    └──────────────┬────────────────────┘
                                   │
                    ┌──────────────▼────────────────────┐
                    │   WhatsApp Sender                  │
                    │   sendWhatsAppMessage(orgId, ...)  │
                    │   → lookup active provider         │
                    │   → dispatch to right send()       │
                    └──────────────────────────────────-─┘
```

---

## Modelo de dados

### Migração 093 — `whatsapp_providers`

```sql
CREATE TYPE whatsapp_provider_type AS ENUM ('evolution', 'zapi', 'wapi');

CREATE TABLE whatsapp_providers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider              whatsapp_provider_type NOT NULL,
  display_name          TEXT NOT NULL DEFAULT '',          -- ex: "Instância Principal"
  phone_number          TEXT,                              -- E.164, preenchido após conexão
  status                TEXT NOT NULL DEFAULT 'disconnected'
                          CHECK (status IN ('disconnected','connecting','connected','qr_pending','error')),
  is_active             BOOLEAN NOT NULL DEFAULT false,
  config_encrypted      TEXT NOT NULL,                    -- JSON criptografado (provider-specific)
  webhook_secret_encrypted TEXT,                          -- opcional, HMAC verification
  last_error            TEXT,
  connected_at          TIMESTAMPTZ,
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Apenas um provider ativo por org
CREATE UNIQUE INDEX whatsapp_providers_org_active_idx
  ON whatsapp_providers(org_id)
  WHERE is_active = true;

-- RLS
ALTER TABLE whatsapp_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members" ON whatsapp_providers
  USING (org_id = get_current_org_id());
```

### Config por provider (JSON dentro de `config_encrypted`)

```ts
// Evolution Go
interface EvolutionProviderConfig {
  base_url: string        // ex: "https://evolution.seuservidor.com"
  token: string           // API key do Evolution
  instance_name: string   // nome da instância no Evolution
}

// Z-API
interface ZApiProviderConfig {
  instance_id: string     // ID da instância no painel Z-API
  token: string           // Client-Token
  // base_url é sempre "https://api.z-api.io" — não precisa armazenar
}

// W-API
interface WApiProviderConfig {
  instance_key: string    // chave da instância
  token: string           // Bearer token
  base_url: string        // pode variar (self-hosted ou cloud)
}
```

### Migração: compatibilidade com `evolution_instances`

A tabela `evolution_instances` existente continua funcionando durante a transição.
Ao ativar um provider na nova tabela, o sistema verifica se há instância legada ativa
e a desativa (`evolution_instances.is_active = false`).
`evolution_instances` é deprecada — será removida em migração futura após migração completa.

---

## Interface normalizada

```ts
// src/lib/whatsapp/types.ts — NEW

export type WhatsAppProvider = 'evolution' | 'zapi' | 'wapi'

export interface NormalizedWhatsAppMessage {
  provider: WhatsAppProvider
  providerId: string            // row ID em whatsapp_providers
  orgId: string
  messageId: string             // ID único no provider (para idempotência)
  fromJid: string               // "5511999999@s.whatsapp.net" ou "@c.us"
  fromPhone: string             // E.164 normalizado
  fromName: string | null       // pushName / senderName
  isGroup: boolean
  isFromMe: boolean
  timestamp: number             // unix
  text: string                  // texto/caption (pode ser vazio se só mídia)
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location'
  // Raw payload para fetchMedia() usar
  rawMessage: unknown
  instanceName?: string         // Evolution only
}

export interface WhatsAppMediaAttachment {
  url: string          // URL pública no Supabase Storage (após re-host)
  mime_type: string
  size?: number
  filename?: string
  duration?: number    // audio/video, segundos
  width?: number
  height?: number
}
```

---

## Adapters por provider

### Adapter — Evolution Go

```ts
// src/lib/whatsapp/adapters/evolution.ts

export function normalizeEvolution(
  payload: EvolutionWebhookPayload,
  instance: ResolvedProvider,
): NormalizedWhatsAppMessage[] {
  // Lógica atual do process-event.ts — extraída e generalizada
  // FIX: remover o `if (!messageText) continue`
  // Se messageType = audioMessage e sem texto → messageType='audio', text=''
}

export async function fetchEvolutionMedia(
  msg: NormalizedWhatsAppMessage,
  provider: ResolvedProvider,
): Promise<WhatsAppMediaAttachment[]> {
  // POST {base_url}/chat/getBase64FromMediaMessage/{instanceName}
  // Body: { "message": { "key": msg.rawMessage.key, "message": msg.rawMessage.message } }
  // Response: { "base64": "...", "mimetype": "image/jpeg" }
  // → decode base64 → upload Supabase Storage → return URL
}
```

**Media fetch do Evolution Go (detalhe):**
```
POST {EVOLUTION_BASE_URL}/chat/getBase64FromMediaMessage/{instanceName}
Headers: { "apikey": "{token}" }
Body: {
  "message": {
    "key": { "id": "...", "remoteJid": "...", "fromMe": false },
    "message": { "imageMessage": { ... } }
  }
}
Response: { "base64": "data:image/jpeg;base64,...", "mimetype": "image/jpeg" }
```

### Adapter — Z-API

```ts
// src/lib/whatsapp/adapters/zapi.ts

// Webhook payload Z-API (tipo "ReceivedCallback"):
// {
//   instanceId, token, type: "ReceivedCallback",
//   phone: "5511999999999@c.us",
//   fromMe: false,
//   momment: 1234567890,
//   chatName, senderName, body,
//   image: { imageId, url, caption, mimeType, width, height } | null,
//   audio: { audioId, url, mimeType, duration } | null,
//   video: { videoId, url, caption, mimeType, duration } | null,
//   document: { documentId, url, fileName, mimeType, pageCount } | null,
//   sticker: { stickerUrl, mimeType } | null,
// }

export function normalizeZApi(
  payload: ZApiWebhookPayload,
  provider: ResolvedProvider,
): NormalizedWhatsAppMessage | null {
  if (payload.fromMe) return null                         // skip echoes
  if (payload.isGroup && payload.isGroup) return null     // skip groups

  const messageType = payload.image ? 'image'
    : payload.audio ? 'audio'
    : payload.video ? 'video'
    : payload.document ? 'document'
    : payload.sticker ? 'sticker'
    : 'text'

  return {
    provider: 'zapi',
    messageId: payload.messageId ?? payload.id,
    fromPhone: normalizePhone(payload.phone),
    fromName: payload.senderName ?? null,
    text: payload.body ?? payload.image?.caption ?? payload.video?.caption ?? '',
    messageType,
    rawMessage: payload,
    ...
  }
}

export async function fetchZApiMedia(
  msg: NormalizedWhatsAppMessage,
  provider: ResolvedProvider,
): Promise<WhatsAppMediaAttachment[]> {
  const raw = msg.rawMessage as ZApiWebhookPayload
  const mediaSource = raw.image ?? raw.audio ?? raw.video ?? raw.document ?? raw.sticker
  if (!mediaSource) return []

  // Z-API URLs são diretas mas temporárias (~24h) — baixar e re-hospedar
  const url = mediaSource.url
  const res = await fetch(url, {
    headers: { 'Client-Token': provider.config.token }
  })
  // upload para Supabase Storage, retornar URL pública
}
```

**Webhook URL para Z-API:**
```
https://xphere.app/api/zapi/webhook?instance={instanceId}
```
Configurar no painel Z-API: "Webhook de Recebimento" → URL acima.

### Adapter — W-API

```ts
// src/lib/whatsapp/adapters/wapi.ts

// Webhook payload W-API (shape similar mas diferente do Z-API):
// {
//   event: "message",
//   instance_key: "...",
//   data: {
//     key: { id, remoteJid, fromMe },
//     pushName: "Nome",
//     message: {
//       conversation: "texto" | undefined,
//       imageMessage: { url, mimetype, caption, fileLength, height, width } | undefined,
//       audioMessage: { url, mimetype, fileLength, seconds, ptt } | undefined,
//       videoMessage: { url, mimetype, caption, fileLength, seconds } | undefined,
//       documentMessage: { url, mimetype, title, fileName, fileLength } | undefined,
//     },
//     messageTimestamp: 1234567890,
//     messageType: "conversation" | "imageMessage" | "audioMessage" | ...
//   }
// }

export function normalizeWApi(
  payload: WApiWebhookPayload,
  provider: ResolvedProvider,
): NormalizedWhatsAppMessage | null { ... }

export async function fetchWApiMedia(
  msg: NormalizedWhatsAppMessage,
  provider: ResolvedProvider,
): Promise<WhatsAppMediaAttachment[]> {
  // W-API usa URLs criptografadas como Evolution Go
  // Endpoint: POST {base_url}/message/download/{instanceKey}
  // Headers: { Authorization: "Bearer {token}" }
  // Body: { messageId, remoteJid }
  // Response: { data: { base64, mimetype } }
}
```

---

## Pipeline unificada

```ts
// src/lib/whatsapp/process-message.ts — NEW (substitui process-event.ts para WA)

export async function processWhatsAppMessage(
  msg: NormalizedWhatsAppMessage,
  provider: ResolvedProvider,
  adapter: WhatsAppAdapter,
): Promise<void> {
  if (msg.isFromMe || msg.isGroup) return

  // 1. Fetch media (se houver) → upload Storage
  const media = msg.messageType !== 'text'
    ? await adapter.fetchMedia(msg, provider)
    : []

  // 2. Upsert conversation
  const conversationId = await upsertWhatsAppConversation(msg, provider)

  // 3. Idempotência
  const isDuplicate = await checkDuplicate(conversationId, msg.messageId)
  if (isDuplicate) return

  // 4. Insert message
  const messageType = media.length > 0
    ? (msg.text ? 'mixed' : msg.messageType)
    : 'text'

  await insertMessage({
    conversationId,
    orgId: msg.orgId,
    role: 'user',
    content: msg.text,
    messageType,
    metadata: {
      channel: 'whatsapp',
      provider: msg.provider,
      whatsapp_message_id: msg.messageId,
      from: msg.fromPhone,
      ...(media.length > 0 ? { media } : {}),
    },
  })

  // 5. Bot gate
  if (!isBotActive(conversationId)) return

  // 6. Resolve agent + runAgent
  const agent = await resolveChannelAgent(msg.orgId, 'whatsapp')
  if (!agent) return

  const result = await runAgent({ ... userMessage: msg.text || '[mídia]' })
  if (!result.text) return

  // 7. Send reply via active provider
  await sendWhatsAppMessage({ orgId: msg.orgId, to: msg.fromPhone, text: result.text })
}
```

---

## Sender unificado

```ts
// src/lib/whatsapp/send.ts — NEW (substitui send-message.ts legado)

export async function sendWhatsAppMessage(input: {
  orgId: string
  to: string
  text: string
  media?: WhatsAppMediaAttachment[]
  conversationId?: string
}): Promise<{ ok: boolean; error?: string; messageIds: string[] }> {
  const provider = await resolveActiveProvider(input.orgId)

  if (!provider) return { ok: false, error: 'No active WhatsApp provider.', messageIds: [] }

  switch (provider.provider) {
    case 'evolution': return sendViaEvolution(input, provider)
    case 'zapi':      return sendViaZApi(input, provider)
    case 'wapi':      return sendViaWApi(input, provider)
  }
}
```

---

## Webhook Endpoints

### Existente — Evolution Go (mantém URL, refatora internamente)
```
POST /api/evolution/webhook
→ normalizeEvolution() → processWhatsAppMessage()
```

### Novo — Z-API
```ts
// src/app/api/zapi/webhook/route.ts
// Headers: x-z-api-token (Client-Token para verificação)
// Retorna 200 sempre, processa via after()
POST /api/zapi/webhook?instance={instanceId}
→ normalizeZApi() → processWhatsAppMessage()
```

### Novo — W-API
```ts
// src/app/api/wapi/webhook/route.ts
POST /api/wapi/webhook
→ normalizeWApi() → processWhatsAppMessage()
```

---

## UI — Settings

### Localização
`/settings/workspace` → seção "WhatsApp" com seletor de provider.

### Layout
```
┌─────────────────────────────────────────────────────┐
│  WhatsApp                                           │
│  Provider ativo: [Evolution Go ▾]                  │
│                                                     │
│  ● Evolution Go    ○ Z-API    ○ W-API               │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Evolution Go                                 │  │
│  │  URL da instância  [________________]         │  │
│  │  API Key           [________________]         │  │
│  │  Nome da instância [________________]         │  │
│  │                                               │  │
│  │  Status: ● Conectado (+55 11 99999-9999)      │  │
│  │                                    [Salvar]   │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Webhook URL (copiar):                              │
│  [https://xphere.app/api/evolution/webhook ⎘]      │
└─────────────────────────────────────────────────────┘
```

Ao trocar de provider:
1. Mostra confirmação: "Trocar para Z-API desativará o Evolution Go. Continuar?"
2. SET `whatsapp_providers.is_active = false` no anterior (DB constraint garante unicidade)
3. SET `is_active = true` no novo
4. Atualiza `evolution_instances.is_active = false` se houver legado

---

## Arquivos

```
supabase/migrations/
└── 093_whatsapp_providers.sql                 NEW

src/lib/whatsapp/
├── types.ts                                   NEW: NormalizedWhatsAppMessage, adapters
├── process-message.ts                         NEW: pipeline unificada
├── send.ts                                    NEW: sender com dispatch por provider
├── resolve-provider.ts                        NEW: resolveActiveProvider(orgId)
└── adapters/
    ├── evolution.ts                           NEW: normalize + fetchMedia
    ├── zapi.ts                                NEW: normalize + fetchMedia
    └── wapi.ts                                NEW: normalize + fetchMedia

src/app/api/
├── evolution/webhook/route.ts                 EDIT: usa novo adapter
├── zapi/webhook/route.ts                      NEW
└── wapi/webhook/route.ts                      NEW

src/lib/evolution/
├── process-event.ts                           DEPRECATED → wrapper para novo pipeline
└── send-message.ts                            DEPRECATED → wrapper para send.ts

src/app/(dashboard)/settings/workspace/
└── whatsapp-provider-settings.tsx             NEW: UI de seleção + config

src/app/(dashboard)/settings/workspace/
└── actions.ts                                 EDIT: saveWhatsAppProvider()
```

---

## Estratégia de mídia por provider

| Provider | URL no webhook | Como buscar | Auth |
|----------|---------------|-------------|------|
| Evolution Go | Criptografada (WhatsApp CDN) | `POST /chat/getBase64FromMediaMessage/{instance}` | `apikey` header |
| Z-API | Direta (temporária ~24h) | `GET url` direto | `Client-Token` header |
| W-API | Criptografada ou direta | `POST /message/download/{key}` | `Bearer token` |

Todos sobem para `chat-media` Storage bucket (SEED-030). URL pública é salva no banco.

---

## Compatibilidade backward

- `/api/evolution/webhook` continua na mesma URL — não quebra instâncias existentes
- `sendWhatsappMessage()` de `send-message.ts` vira wrapper que chama o novo `sendWhatsAppMessage()` de `send.ts`
- `evolution_instances` continua existindo; migração cria `whatsapp_providers` em paralelo
- `resolveEvolutionInstance()` continua funcionando; `resolveActiveProvider()` busca primeiro em `whatsapp_providers`, fallback em `evolution_instances`

---

## Critérios de sucesso

1. ✅ Org pode configurar Evolution Go, Z-API ou W-API — só um ativo por vez
2. ✅ Trocar de provider na UI desativa o anterior automaticamente
3. ✅ Mensagem de texto funciona igual com qualquer dos três providers
4. ✅ Foto recebida via Z-API aparece no chat (usa SEED-030 MediaBlock)
5. ✅ Áudio recebido via Evolution Go aparece com player (sem ser descartado)
6. ✅ Webhook URL correta exibida por provider nas settings
7. ✅ Instâncias Evolution Go legadas continuam funcionando sem reconfiguração
8. ✅ `sendWhatsAppMessage()` roteia para o provider ativo automaticamente
9. ✅ `npm run build` passa sem erros de tipo
