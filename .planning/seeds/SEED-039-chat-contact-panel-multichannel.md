---
id: SEED-039
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Large
priority: high
depends_on: []
---

# SEED-039: Chat — Painel de Contato Completo + UX Multi-Canal

Refaz o painel lateral direito do chat para ser o hub completo do cliente em
atendimento: dados editáveis inline, tasks, bookings, notas, canais disponíveis,
histórico unificado. Ao mesmo tempo, torna o chat explicitamente multi-canal:
indicador de canal por mensagem, seletor de canal no composer, filtro por canal.

---

## Diagnóstico atual (Auditoria 2026-05-20)

### Painel de contato — o que existe

- Seções colapsáveis: Info, Opportunities (até 5), Recent Calls (até 3), Other Conversations (até 5)
- `contacts.notes` (campo de texto plano)
- Tags inline no header
- Botões: Edit, Create Deal, Add Note

### Painel de contato — o que falta

| Gap | Impacto |
|-----|---------|
| Tasks não exibidas (existe `entity_type='contact'` na tabela `tasks`) | Admin não vê pendências do cliente |
| Bookings não exibidas (existe `linked_contact_id`) | Agendamentos invisíveis no contexto |
| Notes da tabela `notes` não exibidas (só `contacts.notes`) | Histórico de notas perdido |
| Custom fields do contato não exibidos | Dados customizados invisíveis |
| Campos não editáveis inline (precisa ir para página separada) | Fricção para atualizar |
| Nenhum link para empresa/account | Contexto B2B perdido |
| Nenhuma timeline de atividade consolidada | Precisaria abrir 3 telas |
| Nenhum botão de canal rápido (ligar, WhatsApp, SMS) | Frição para iniciar novo contato |

### Multi-canal — o que existe

- Badge de canal no card da conversa (lista)
- Badge de canal no header do chat
- Footer do composer: "Sending via SMS" (read-only)

### Multi-canal — o que falta

| Gap | Impacto |
|-----|---------|
| Nenhum indicador de canal por mensagem | Impossível saber de onde veio cada msg |
| Nenhum seletor de canal no composer | Admin não pode escolher por onde responder |
| `conversation_messages` não tem campo `channel` | Sem rastreio de canal por mensagem |
| Nenhum filtro de canal na thread | Chat com muitos canais fica confuso |
| Sem "envelopes" visuais separando canais diferentes | Thread não deixa claro as fontes |

---

## Parte 1 — Painel de Contato Completo

### Layout do painel redesenhado

```
┌─────────────────────────────────────────────────────┐
│  [AV]  João Silva                          [×] [⋮]  │
│        Skale Club · CEO                            │
│        [WhatsApp] [SMS] [Messenger]                │  ← canais disponíveis (clicáveis)
│                                                    │
│  [+ Task]  [📅 Agendar]  [📝 Nota]  [💼 Deal]     │  ← quick actions
│                                                    │
│  ─── Informações ──────────────────── [✎ Editar] ─ │
│  📱 +55 11 99999-9999                              │
│  📧 joao@empresa.com                              │
│  🏢 Skale Club                                    │
│  📍 São Paulo, SP                                 │
│  🏷️ [lead] [vip]                                  │
│  Campo custom: Origem → [Google Ads]              │
│                                                    │
│  ─── Tasks (2) ────────────────────── [+ Nova] ── │
│  ☐ Enviar proposta        🔴 Amanhã               │
│  ☐ Ligar para follow-up   🟡 Sexta                │
│                                                    │
│  ─── Agendamentos (1) ──────────────── [+ Novo] ─ │
│  📅 Demo call              Amanhã 14h ● Confirmado │
│                                                    │
│  ─── Notas (3) ─────────────────────── [+ Nova] ─ │
│  "Cliente tem urgência para fechar esse mês..."    │
│  "Retornar segunda após 14h"                      │
│                                                    │
│  ─── Oportunidades (1) ──────────────── [+ Nova] ─ │
│  💼 Plano Enterprise       R$ 4.800   [Qualificado] │
│                                                    │
│  ─── Outras conversas (3) ───────────────────────  │
│  [WA] Ontem · "Tudo certo, obrigado!"             │
│  [IG]  3 dias · "Vi seu post sobre..."            │
└─────────────────────────────────────────────────────┘
```

### Edição inline

Clicar em qualquer campo do painel (nome, phone, email, empresa, campo custom) abre um input inline:

```tsx
// Antes:
<p className="text-sm text-text-primary">{contact.phone ?? '—'}</p>

// Depois:
<InlineEditField
  value={contact.phone}
  placeholder="Adicionar telefone"
  onSave={(v) => updateContact(contact.id, { phone: v })}
  type="tel"
/>
// Clique → input aparece com autoFocus
// Enter / onBlur → salva
// Escape → cancela
// Toast on save
```

Campos editáveis inline:
- Nome, telefone, email, empresa, notas (textarea), tags (tag picker), campos customizados

### Canais disponíveis do cliente

No header do painel, botões que mostram os canais onde o cliente pode ser alcançado:

```tsx
// Derivado de conversations WHERE contact_id = contact.id
// + contato tem phone → mostra SMS + WhatsApp
// + contato tem email → mostra Email (futuro)

<ChannelReachButtons
  contact={contact}
  conversations={contact.conversations}
  onSelect={(channel) => openNewConversation(channel)}
/>
```

```
[📱 WhatsApp] [💬 SMS] [📘 Messenger] [📸 Instagram]
     ↑ verde = conversa aberta    cinza = canal disponível mas sem conversa ativa
```

Clicar em canal ativo → abre/seleciona aquela conversa no inbox.
Clicar em canal novo → abre modal de nova conversa por aquele canal.

### Tasks no painel

```ts
// Fetch ao carregar o painel com contact_id:
const tasks = await supabase
  .from('tasks')
  .select('id, title, due_date, priority, status, assigned_to')
  .eq('entity_type', 'contact')
  .eq('entity_id', contactId)
  .neq('status', 'cancelled')
  .order('due_date', { ascending: true })
  .limit(5)
```

Exibição:
- Checkbox de status (toggle done/todo inline)
- Título truncado
- Badge de data com cor: 🔴 overdue, 🟡 hoje/amanhã, cinza o resto
- `[+ Nova]` → cria task vinculada ao contato direto do painel

### Bookings no painel

```ts
const bookings = await supabase
  .from('bookings')
  .select('id, booker_name, start_at, end_at, status, event_types(name)')
  .eq('linked_contact_id', contactId)
  .gte('start_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // -7 dias
  .order('start_at', { ascending: false })
  .limit(3)
```

Exibição:
- Ícone de calendário + tipo de evento
- Data/hora relativa ("Amanhã às 14h")
- Status pill: Confirmado (verde), Cancelado (vermelho), No-show (laranja)
- Clicar → abre `/scheduling/bookings/{id}`

### Notas unificadas no painel

```ts
// Busca notas da tabela notes (entity_type='contact')
const notes = await supabase
  .from('notes')
  .select('id, content, created_at, created_by')
  .eq('entity_type', 'contact')
  .eq('entity_id', contactId)
  .order('created_at', { ascending: false })
  .limit(5)
```

Exibição:
- Preview de 2 linhas do conteúdo
- Timestamp relativo + autor
- `[+ Nova]` → textarea inline no painel, Enter + botão salvar

### Custom fields no painel

```ts
// contact.custom_fields (JSONB) + definições de getDefinitions({ entity: 'contact' })
```

Exibição:
- Campo: valor (editável inline)
- Campos vazios aparecem como "—" clicáveis para preencher
- Tipo date → date picker, tipo select → dropdown, tipo text → input

---

## Parte 2 — Multi-canal no Chat

### 2A — `channel` por mensagem no banco

```sql
-- Adicionar à migração 097 ou nova migração 100:
ALTER TABLE conversation_messages
  ADD COLUMN channel TEXT;

-- Para mensagens existentes, preencher com o channel da conversa:
UPDATE conversation_messages cm
SET channel = c.channel
FROM conversations c
WHERE cm.conversation_id = c.id
  AND cm.channel IS NULL;
```

**Quando inserir:** todo `INSERT INTO conversation_messages` deve incluir o `channel`
da conversa ou do canal de origem da mensagem (útil quando um contato responde por
um canal diferente do que iniciou a conversa).

### 2B — Indicador de canal por mensagem

```tsx
// src/components/chat/chat-area/message-list.tsx — EDIT

// Para cada mensagem, se o canal da msg for diferente do canal principal da conversa:
// Mostrar um chip de canal no topo da mensagem

{msg.channel && msg.channel !== conversation.channel && (
  <div className="flex items-center gap-1 mb-0.5">
    <ChannelIcon channel={msg.channel} className="h-3 w-3" />
    <span className="text-[10px] text-text-tertiary uppercase tracking-wide">
      {CHANNEL_LABELS[msg.channel]}
    </span>
  </div>
)}
```

**Agrupamento visual por canal:**
Quando há sequências de mensagens do mesmo canal, mostrar o chip apenas na primeira
mensagem do grupo (como o WhatsApp agrupa por data).

```
┌──────────────────────────────────────────────────────┐
│                                    [WhatsApp] ┄┄┄┄  │  ← separador de canal
│  ─────────────────────────────────────────────────── │
│  Oi, vi o anúncio de vocês no Instagram            │
│                                                      │
│  Olá! Como posso ajudar?              [você] 14:32  │
│                                                      │
│                              [Instagram] ┄┄┄┄┄┄┄┄  │  ← mudança de canal
│  ─────────────────────────────────────────────────── │
│  Mandei DM pelo instagram também                   │
└──────────────────────────────────────────────────────┘
```

### 2C — Seletor de canal no composer

Quando o contato tem múltiplos canais ativos, o composer mostra um seletor:

```tsx
// src/components/chat/chat-area/message-composer.tsx — EDIT

// Footer do composer — substituir o texto estático por:
<div className="flex items-center justify-between px-3 py-1.5 border-t border-border-subtle">
  
  {/* Seletor de canal ativo */}
  <ChannelSelector
    availableChannels={availableChannels}  // derivado das conversas do contato
    activeChannel={activeChannel}
    onChange={setActiveChannel}
  />

  {/* Botão de envio */}
  <Button size="sm" onClick={handleSend} disabled={!content.trim()}>
    <Send className="h-3.5 w-3.5" />
  </Button>
</div>
```

```tsx
// ChannelSelector component:
function ChannelSelector({ availableChannels, activeChannel, onChange }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary transition-colors">
          <ChannelIcon channel={activeChannel} className="h-3.5 w-3.5" />
          <span>Via {CHANNEL_LABELS[activeChannel]}</span>
          <ChevronDown className="h-3 w-3 text-text-tertiary" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {availableChannels.map(ch => (
          <DropdownMenuItem key={ch.channel} onClick={() => onChange(ch)}>
            <ChannelIcon channel={ch.channel} className="h-4 w-4 mr-2" />
            {CHANNEL_LABELS[ch.channel]}
            {ch.isActive && <span className="ml-auto text-emerald-400 text-xs">● ativo</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

**Canais disponíveis:** derivados de `contact.conversations` onde `status='open'`.
Se o contato não tiver conversa ativa naquele canal, mostrá-lo como "Iniciar nova conversa".

**Comportamento ao trocar de canal:**
- Trocar para canal com conversa aberta → envia mensagem para aquela conversa
- Trocar para canal sem conversa → mostra aviso "Esta mensagem iniciará uma nova conversa via {canal}"

### 2D — Filtro de canal na thread

No header do chat, ao lado do nome do contato:

```tsx
// src/components/chat/chat-area/chat-header.tsx — EDIT

{/* Filtro de canal — só aparece se a conversa tem msgs de múltiplos canais */}
{hasMultipleChannels && (
  <div className="flex items-center gap-1 text-xs">
    <span className="text-text-tertiary">Mostrar:</span>
    <button
      onClick={() => setChannelFilter(null)}
      className={cn('px-1.5 py-0.5 rounded text-[10px]', !channelFilter && 'bg-accent text-white')}
    >
      Tudo
    </button>
    {messageChannels.map(ch => (
      <button
        key={ch}
        onClick={() => setChannelFilter(ch)}
        className={cn('px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1',
          channelFilter === ch && 'bg-accent text-white')}
      >
        <ChannelIcon channel={ch} className="h-2.5 w-2.5" />
        {CHANNEL_LABELS[ch]}
      </button>
    ))}
  </div>
)}
```

Ao filtrar, as mensagens de outros canais ficam opacas ou ocultas (client-side, sem refetch).

### 2E — Separadores visuais de canal na thread

```tsx
// Quando há transição de canal entre mensagens consecutivas:

function ChannelDivider({ channel }: { channel: string }) {
  return (
    <div className="flex items-center gap-2 py-2 my-1">
      <div className="flex-1 h-px bg-border-subtle" />
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-bg-tertiary">
        <ChannelIcon channel={channel} className="h-3 w-3 text-text-tertiary" />
        <span className="text-[10px] text-text-tertiary font-medium">
          {CHANNEL_LABELS[channel]}
        </span>
      </div>
      <div className="flex-1 h-px bg-border-subtle" />
    </div>
  )
}
```

Inserido automaticamente no `MessageList` quando `messages[i].channel !== messages[i-1].channel`.

---

## Parte 3 — Dados do painel via API

### Endpoint enriquecido para o painel

```ts
// GET /api/chat/conversations/{id}/contact-panel
// Retorna todos os dados do painel em um único request:

{
  contact: {
    // campos base + custom_fields
  },
  account: { id, name, domain, industry } | null,
  tags: [{ id, name, color, slug }],
  tasks: [{ id, title, due_date, priority, status }],          // limit 5
  bookings: [{ id, start_at, end_at, status, event_type_name }], // limit 3
  notes: [{ id, content, created_at, created_by_name }],        // limit 5
  opportunities: [{ id, title, value, currency, stage_name, stage_color, status }], // limit 5
  calls: [{ id, direction, status, duration_seconds, started_at }],  // limit 3
  conversations: [{ id, channel, last_message, last_message_at, status }], // limit 5
  availableChannels: ['whatsapp', 'sms', 'messenger'],           // canais com conversa aberta
  messageChannels: ['whatsapp', 'instagram'],                    // canais que aparecem na thread
}
```

Usar `Promise.all()` para buscar em paralelo — não waterfall.

---

## Arquivos

```
supabase/migrations/
└── 100_message_channel_field.sql         NEW: channel em conversation_messages

src/app/api/chat/conversations/[id]/
├── contact-panel/route.ts                NEW: endpoint enriquecido
└── messages/route.ts                     EDIT: incluir channel no insert

src/components/chat/
├── contact-info-panel.tsx                EDIT: refactor completo
├── inline-edit-field.tsx                 NEW: campo editável inline
├── channel-reach-buttons.tsx             NEW: botões de canal do contato
├── contact-tasks-section.tsx             NEW: seção de tasks
├── contact-bookings-section.tsx          NEW: seção de bookings
├── contact-notes-section.tsx             NEW: seção de notas (tabela notes)
└── contact-custom-fields.tsx             NEW: campos customizados

src/components/chat/chat-area/
├── message-list.tsx                      EDIT: ChannelDivider + per-msg channel badge + filtro
├── message-composer.tsx                  EDIT: ChannelSelector no footer
├── chat-header.tsx                       EDIT: filtro de canal + multi-channel pills
└── channel-divider.tsx                   NEW: separador visual de canal na thread

src/components/chat/channel-selector.tsx  NEW: dropdown de seleção de canal
src/lib/chat/channel-utils.ts             NEW: CHANNEL_LABELS, ChannelIcon, availableChannels()
```

---

## Critérios de sucesso

### Painel de contato
1. ✅ Clicar em qualquer campo (nome, phone, email) abre edição inline, Enter salva
2. ✅ Tasks do contato aparecem com status, prioridade e data
3. ✅ Criar task direto do painel vincula automaticamente ao contato
4. ✅ Bookings do contato aparecem com status e horário
5. ✅ Notas da tabela `notes` aparecem (não só `contacts.notes`)
6. ✅ Custom fields do contato exibidos e editáveis
7. ✅ Botões de canal mostram quais canais o cliente está ativo
8. ✅ Clicar em canal ativo navega para aquela conversa
9. ✅ Empresa/account exibida com link para a página da empresa

### Multi-canal
10. ✅ Cada mensagem mostra de qual canal veio quando há mistura de canais
11. ✅ Separador visual aparece quando a sequência de mensagens muda de canal
12. ✅ Composer mostra seletor de canal quando contato tem múltiplas conversas ativas
13. ✅ Trocar canal no composer muda para qual conversa a mensagem vai
14. ✅ Filtro de canal no header da thread filtra mensagens client-side (sem re-fetch)
15. ✅ `channel` salvo em `conversation_messages` no insert
16. ✅ `npm run build` passa sem erros de tipo
