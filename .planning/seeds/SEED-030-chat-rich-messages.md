---
id: SEED-030
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Large
priority: high
depends_on: []
---

# SEED-030: Chat Rich Messages — Twilio MMS, Áudio, Fotos e Documentos

Estrutura o chat inbox para receber e exibir mensagens ricas (imagens, áudio, vídeo, documentos) vindas do Twilio SMS/MMS, Evolution Go (WhatsApp) e Meta (Messenger/Instagram), além de permitir que o admin envie arquivos pela UI.

---

## Diagnóstico Atual (Auditoria 2026-05-20)

### O que está quebrado / faltando

| Gap | Onde | Impacto |
|-----|------|---------|
| `NumMedia`, `MediaUrl0–9`, `MediaContentType0–9` recebidos no webhook mas **nunca lidos** | `src/app/api/twilio/sms/route.ts` + `src/lib/twilio/process-sms.ts` | Fotos/áudio do cliente sumem silenciosamente |
| `audioMessage`, `videoMessage`, `imageMessage`, `documentMessage` do Evolution Go: **só o caption é extraído** | `src/lib/evolution/process-event.ts` | WhatsApp rico tratado como texto puro |
| `sendSms()` e `sendMetaMessage()` são **text-only** | `src/lib/twilio/send-sms.ts`, `src/lib/ghl/send.ts` | Admin não pode mandar foto/arquivo |
| `MessageList` não tem nenhum componente de mídia | `src/components/chat/chat-area/message-list.tsx` | Mesmo que salvasse, não exibiria |
| Botões "Attach" / "Record" no composer são **stubs desabilitados** | `src/components/chat/chat-area/message-composer.tsx` | Admin não pode anexar nada |
| `conversation_messages` não tem coluna `message_type` | Schema DB | Tipo inferido de JSONB — frágil |
| Sem bucket de Storage no Supabase para media | — | Não há onde guardar os arquivos |
| `conversations.typing_at` existe mas **nunca é escrito** | Schema DB | Coluna órfã, confunde futuros devs |

### O que já funciona (não quebrar)

- Texto puro: SMS, WhatsApp, Messenger, Instagram, widget — ✅
- HMAC-SHA1 do Twilio — ✅
- Idempotência via `message_sid` / `evolution_message_id` — ✅
- Realtime Supabase (postgres_changes + broadcast typing) — ✅
- Bot gateway (active/paused) — ✅
- Multi-channel outbound texto — ✅

---

## Arquitetura da Solução

### Princípio: Media como attachment, não como mensagem separada

Uma mensagem MMS pode ter `NumMedia = 3` (3 fotos + 1 texto). Isso é **uma** mensagem no chat, com `media` no metadata. Não criar N mensagens separadas.

### Formato unificado de metadata de mídia

```ts
// conversation_messages.metadata (existente, JSONB)
{
  // ... campos já existentes ...
  message_type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location',
  media: Array<{
    url: string        // URL pública no Supabase Storage (não a URL temporária do Twilio)
    mime_type: string  // 'image/jpeg', 'audio/ogg; codecs=opus', 'application/pdf', ...
    size?: number      // bytes (quando disponível)
    filename?: string  // nome original do arquivo (documentos)
    duration?: number  // segundos (audio/video)
    width?: number     // px (imagens/video)
    height?: number    // px (imagens/video)
    thumbnail_url?: string  // para video preview
  }>
}
```

Esse schema funciona para Twilio, WhatsApp e Meta — mesmo campo, diferentes origens.

---

## Fase 1 — Inbound Media (Receber)

### 1A — Coluna `message_type` em `conversation_messages`

```sql
-- 092_message_type.sql
ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'
  CHECK (message_type IN ('text','image','audio','video','document','sticker','location','mixed'));

-- Drop typing_at (coluna órfã, nunca escrita)
ALTER TABLE conversations DROP COLUMN IF EXISTS typing_at;

COMMENT ON COLUMN conversation_messages.message_type IS
  'Primary content type of the message. "mixed" when text + media coexist.';
```

### 1B — Bucket de Storage `chat-media`

```sql
-- No mesmo arquivo de migração:
-- (O bucket é criado via Supabase dashboard ou via Management API no deploy)
```

Configurações do bucket:
- **Nome**: `chat-media`
- **Público**: `true` (URLs servidas diretamente, sem auth, tamanho < 25MB)
- **Allowed MIME**: `image/*`, `audio/*`, `video/*`, `application/pdf`, `application/msword`, etc.
- **Max size**: 25MB por arquivo (MMS limit do Twilio é 5MB; margem para WhatsApp/Meta)
- **Path pattern**: `{org_id}/{conversation_id}/{message_id}/{filename}`

### 1C — Helper: `downloadAndStoreTwilioMedia()`

```ts
// src/lib/twilio/media.ts — NEW FILE

/**
 * Twilio media URLs exigem Basic Auth com AccountSid:AuthToken.
 * Baixa o arquivo, faz upload pro Supabase Storage e retorna URL pública.
 */
export async function downloadAndStoreTwilioMedia(params: {
  mediaUrl: string          // Ex: https://api.twilio.com/2010-04-01/Accounts/.../Messages/.../Media/...
  mimeType: string          // Ex: 'image/jpeg'
  accountSid: string
  authToken: string
  orgId: string
  conversationId: string
  messageId: string         // UUID gerado antes do insert
}): Promise<{ url: string; size: number; filename: string } | null>
```

Passos:
1. `fetch(mediaUrl, { headers: { Authorization: 'Basic ' + btoa(...) } })`
2. Determina extensão pelo `mimeType` via `mime-types` lib (já instalada?)
3. Gera `filename = `{timestamp}-{index}.{ext}``
4. Upload para Storage bucket `chat-media` no path `{orgId}/{conversationId}/{messageId}/{filename}`
5. Retorna URL pública `{SUPABASE_URL}/storage/v1/object/public/chat-media/...`
6. Em caso de erro, log + retorna `null` (não quebra o fluxo da mensagem)

### 1D — `process-sms.ts` — extrair e processar mídia

```ts
// Antes (ignorava media):
const body = payload.Body ?? ''
await insertMessage({ role: 'user', content: body, metadata: { message_sid } })

// Depois:
const body = payload.Body ?? ''
const numMedia = parseInt(payload.NumMedia ?? '0', 10)

const mediaItems: MediaAttachment[] = []
for (let i = 0; i < numMedia; i++) {
  const mediaUrl = payload[`MediaUrl${i}`]
  const mimeType = payload[`MediaContentType${i}`]
  if (!mediaUrl || !mimeType) continue

  const stored = await downloadAndStoreTwilioMedia({
    mediaUrl, mimeType, accountSid, authToken,
    orgId, conversationId, messageId: newMsgId,
  })
  if (stored) mediaItems.push({ url: stored.url, mime_type: mimeType, size: stored.size })
}

const messageType = mediaItems.length > 0
  ? (body ? 'mixed' : mediaItems[0].mime_type.startsWith('image/') ? 'image' : 
     mediaItems[0].mime_type.startsWith('audio/') ? 'audio' :
     mediaItems[0].mime_type.startsWith('video/') ? 'video' : 'document')
  : 'text'

await insertMessage({
  id: newMsgId,
  role: 'user',
  content: body,
  message_type: messageType,
  metadata: {
    message_sid,
    ...(mediaItems.length > 0 ? { media: mediaItems } : {}),
  },
})
```

**Importante:** Se `body` está vazio mas há mídia, usar o primeiro item como representação no `last_message` da conversa: `[Foto]`, `[Áudio]`, `[Documento]`.

### 1E — Evolution Go (WhatsApp) — extrair mídia

```ts
// src/lib/evolution/process-event.ts — EDIT

// Payload do Evolution Go inclui:
// event.data.message.imageMessage = { url, mimetype, caption, fileLength, height, width, jpegThumbnail }
// event.data.message.audioMessage = { url, mimetype, fileLength, seconds }
// event.data.message.videoMessage = { url, mimetype, caption, fileLength, seconds }
// event.data.message.documentMessage = { url, mimetype, title, fileName, fileLength, pageCount }

// Evolution Go retorna URLs de mídia na API do próprio servidor Evolution.
// Não precisa de auth especial — URL é temporária (expirar após ~5 min).
// Estratégia: baixar e subir pro Storage imediatamente no webhook.

async function extractEvolutionMedia(msg: EvolutionMessage, ...): Promise<MediaAttachment[]>
```

Tipos reconhecidos: `imageMessage`, `audioMessage`, `videoMessage`, `videoMessage`, `documentMessage`, `stickerMessage`.

### 1F — Meta (Messenger/Instagram) — URLs de mídia

Meta envia `attachments[]` no payload do webhook:
```json
{
  "attachments": [{ "type": "image", "payload": { "url": "https://...", "is_reusable": false } }]
}
```

Mesma estratégia: baixar da URL + armazenar no bucket.

---

## Fase 2 — Exibição (UI)

### 2A — `MessageBubble` refatorado com suporte a mídia

```ts
// src/components/chat/chat-area/message-bubble.tsx — NEW (extraído de message-list.tsx)

interface MessageBubbleProps {
  message: ConversationMessage  // inclui message_type + metadata.media
  isVisitor: boolean
  agentName?: string
  showTimestamp?: boolean
}

function MessageBubble({ message, isVisitor, agentName, showTimestamp }: MessageBubbleProps) {
  const media = message.metadata?.media as MediaAttachment[] | undefined

  return (
    <div className={cn('flex gap-2', isVisitor ? 'flex-row' : 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn('rounded-[12px] p-2.5 max-w-[75%]', isVisitor ? 'bg-bg-secondary border border-border-subtle' : 'bg-accent text-white')}>

        {/* Media block (imagens, áudio, vídeo, documento) */}
        {media?.map((item, idx) => (
          <MediaBlock key={idx} attachment={item} isVisitor={isVisitor} />
        ))}

        {/* Texto (pode coexistir com mídia) */}
        {message.content && (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </p>
        )}
      </div>
    </div>
  )
}
```

### 2B — `MediaBlock` — renderiza cada tipo de mídia

```ts
// src/components/chat/chat-area/media-block.tsx — NEW

function MediaBlock({ attachment, isVisitor }: { attachment: MediaAttachment; isVisitor: boolean }) {
  const { url, mime_type, filename, duration } = attachment

  // IMAGE
  if (mime_type.startsWith('image/')) {
    return (
      <button onClick={() => openLightbox(url)} className="block mb-1.5">
        <img src={url} alt="Imagem" className="rounded-[8px] max-w-full max-h-[240px] object-cover cursor-zoom-in" />
      </button>
    )
  }

  // AUDIO
  if (mime_type.startsWith('audio/')) {
    return (
      <div className="flex items-center gap-2 mb-1.5 min-w-[200px]">
        <AudioPlayer src={url} duration={duration} />
      </div>
    )
  }

  // VIDEO
  if (mime_type.startsWith('video/')) {
    return (
      <video src={url} controls className="rounded-[8px] max-w-full max-h-[240px] mb-1.5" />
    )
  }

  // DOCUMENT / OTHER
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
       className="flex items-center gap-2 rounded-[8px] border border-border-subtle bg-bg-tertiary px-3 py-2 mb-1.5 hover:border-border-strong transition-colors">
      <FileText className="h-4 w-4 shrink-0 text-text-tertiary" />
      <span className="text-[12px] text-text-primary truncate">{filename ?? 'Documento'}</span>
      <Download className="h-3.5 w-3.5 shrink-0 text-text-tertiary ml-auto" />
    </a>
  )
}
```

### 2C — `AudioPlayer` — player de áudio minimalista

```ts
// src/components/chat/chat-area/audio-player.tsx — NEW

function AudioPlayer({ src, duration }: { src: string; duration?: number }) {
  // Estado: playing, currentTime, totalDuration
  // <audio> element ref
  // Play/pause button (ícone)
  // Barra de progresso clicável (seek)
  // Tempo formato mm:ss
  // Waveform estilizado: SVG estático ou barras animadas simples
}
```

Design: mesma estética do WhatsApp Web — círculo play/pause roxo + barra de progresso + tempo.

### 2D — Image Lightbox

Componente simples: `Dialog` do shadcn com imagem em fullscreen, botão download, ESC para fechar.

```ts
// src/components/chat/chat-area/image-lightbox.tsx — NEW
// Context ou state local em MessageList para controlar qual URL está aberta
```

### 2E — `last_message` formatting

Quando salvar/atualizar `conversations.last_message` para mensagens com mídia:
```ts
function formatLastMessage(content: string, media?: MediaAttachment[]): string {
  if (content) return content
  if (!media?.length) return ''
  const first = media[0]
  if (first.mime_type.startsWith('image/')) return '📷 Foto'
  if (first.mime_type.startsWith('audio/')) return '🎵 Áudio'
  if (first.mime_type.startsWith('video/')) return '🎬 Vídeo'
  return `📎 ${first.filename ?? 'Arquivo'}`
}
```

---

## Fase 3 — Outbound Media (Admin Envia Arquivo)

### 3A — FileUploadButton no `MessageComposer`

```ts
// Substitui o botão "Attach (coming soon)" por um <input type="file"> oculto
// Suporte: imagens, pdf, doc, mp3, mp4 — max 5MB (Twilio MMS limit)
// Preview antes de enviar: thumbnail para imagens, nome+tamanho para outros
// Botão X para remover o anexo antes de enviar
```

### 3B — Upload flow

```
Admin seleciona arquivo
  → Upload via route /api/chat/upload → Supabase Storage → retorna URL
  → URL fica em estado local do composer
  → Admin clica Send
  → POST /api/chat/conversations/{id}/messages com { content, media: [{url, mime_type}] }
  → Route handler decide canal:
      SMS   → Twilio MMS API (mediaUrl param)
      WA    → Evolution Go media send API
      Meta  → Meta Attachments API
  → Persiste com message_type + metadata.media
```

### 3C — Twilio MMS Outbound

```ts
// src/lib/twilio/send-sms.ts — EDIT
// Adicionar parâmetro `mediaUrl?: string[]`
// No body do form: append MediaUrl0, MediaUrl1... para cada URL
// (Twilio aceita até 10 media por MMS)
```

---

## Fase 4 — Gravação de Áudio (Voice Note)

### 4A — VoiceRecorder no MessageComposer

```ts
// Ativa o microfone via Web Audio API (MediaRecorder)
// Formato: audio/webm (Chrome) ou audio/mp4 (iOS)
// Máximo: 90 segundos (UI mostra countdown)
// Preview: AudioPlayer do 2C antes de enviar
// Botão vermelho piscante enquanto grava + timer
// Botão para cancelar (descarta) ou confirmar (coloca no composer)
```

### 4B — Transcrição (opcional, se Whisper estiver disponível)

Se a org tiver chave OpenAI configurada, transcrever o áudio e usar como `content` da mensagem. Exibir player + texto abaixo.

---

## Arquivos

```
supabase/migrations/
└── 092_message_type.sql                   NEW: message_type column, drop typing_at

src/lib/twilio/
├── media.ts                               NEW: downloadAndStoreTwilioMedia()
└── send-sms.ts                            EDIT: mediaUrl[] param para MMS outbound

src/lib/evolution/
└── process-event.ts                       EDIT: extrair media URLs + store

src/lib/meta/
└── process-event.ts                       EDIT: extrair attachments[] + store

src/app/api/twilio/sms/route.ts            EDIT: passar NumMedia/MediaUrl ao processSms
src/lib/twilio/process-sms.ts             EDIT: loop mediaItems + downloadAndStore

src/app/api/chat/
├── conversations/[id]/messages/route.ts   EDIT: aceitar media[] no body outbound
└── upload/route.ts                        NEW: upload → Supabase Storage → URL

src/components/chat/chat-area/
├── message-list.tsx                       EDIT: usa MessageBubble
├── message-bubble.tsx                     NEW: bubble extraído com mídia
├── media-block.tsx                        NEW: renderiza image/audio/video/doc
├── audio-player.tsx                       NEW: player minimalista
├── voice-recorder.tsx                     NEW: gravação com MediaRecorder
├── image-lightbox.tsx                     NEW: dialog fullscreen
└── message-composer.tsx                   EDIT: FileUploadButton + VoiceRecorder

src/types/
└── chat.ts                                EDIT: MediaAttachment type, message_type enum
```

---

## Segurança

- **Twilio media URLs**: Temporárias (~4h). **Nunca guardar a URL do Twilio no banco** — sempre baixar + re-hospedar no Storage antes de persistir.
- **Storage RLS**: Bucket `chat-media` é público para leitura mas exige autenticação para upload (apenas service role escreve via server action).
- **MIME type validation**: Verificar Content-Type do arquivo antes de upload — não confiar no mime declarado pelo cliente.
- **Tamanho máximo**: 25MB no Storage, mas validar 5MB no Twilio MMS (Twilio recusa MMS > 5MB).
- **Path traversal**: Sanitizar `filename` ao construir o path no Storage.

---

## Critérios de sucesso

1. ✅ Cliente manda foto via SMS MMS → aparece como imagem no chat inbox
2. ✅ Cliente manda áudio via WhatsApp → aparece com player de áudio
3. ✅ Cliente manda documento → aparece como card clicável com download
4. ✅ Admin pode enviar foto via interface → chega como MMS para o cliente
5. ✅ Admin pode gravar áudio e enviar como voice note
6. ✅ `last_message` mostra "📷 Foto" em vez de string vazia quando não tem texto
7. ✅ Lightbox abre ao clicar em imagem
8. ✅ `message_type` salvo corretamente no banco para todas as origens
9. ✅ Falha no download de mídia não bloqueia a mensagem de texto (graceful degradation)
10. ✅ `npm run build` passa sem erros de tipo

---

## Dependências novas

- `mime-types` ou `mime` — resolução de extensão por MIME type (verificar se já instalado)
- Nenhuma outra dependência — tudo já disponível no stack atual (Web Audio API nativa, `<audio>` / `<video>` HTML nativos, Supabase Storage JS SDK já usado)
