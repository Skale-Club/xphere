---
id: SEED-035
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Medium
priority: high
depends_on: []
---

# SEED-035: Conversation Inbox UX — Lido/Não-lido, Labels, Status Rico, Filtros

Completa o sistema de gestão do inbox de conversas com lido/não-lido real,
sistema de labels, status expandido além de open/closed, e filtros avançados.

---

## Diagnóstico atual

### O que já existe (não mexer)

| Feature | Coluna | UI |
|---------|--------|---|
| Pinned | `pinned BOOLEAN` | ✅ Pin button no hover, seção "Pinned" na lista |
| Priority | `priority TEXT (normal\|high\|urgent)` | ✅ Borda colorida esquerda + cycle button |
| Status | `status TEXT (open\|closed)` | ✅ "Archive" action, filtro de status |
| Assigned | `assigned_user_id UUID` | ✅ Assign dropdown no header, filtro "Mine" |
| Bot toggle | `bot_status TEXT` | ✅ Botão no header, status pill |
| Channel filter | — | ✅ Pills por canal no topo da lista |

### O que está quebrado ou faltando

| Feature | Problema |
|---------|---------|
| **Lido/Não-lido** | `is_read` não existe — filtro "Unread" atual mapeia para `status='open'` (errado) |
| **Starred/favorito** | Não existe — pin é diferente (pin = fixar no topo; star = marcar como importante) |
| **Labels** | Não existe para conversas (existe para contacts/opportunities) |
| **Status expandido** | Só `open` e `closed` — falta `pending`, `waiting`, `resolved` |
| **Filtro por prioridade** | Sem UI para filtrar por normal/high/urgent |
| **Filtro por label** | Sem labels, sem filtro |
| **Filtro por assigned user** | "Mine" existe mas não "filtrar por qualquer usuário" |
| **Contador unread real** | Badge no tab/favicon não reflete não-lidos reais |

---

## Modelo de dados

### Migração 097 — Extensões na tabela `conversations`

```sql
-- 097_conversation_inbox_ux.sql

-- 1. Lido/Não-lido por usuário (tabela separada — multi-user)
CREATE TABLE conversation_reads (
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

ALTER TABLE conversation_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reads" ON conversation_reads
  USING (user_id = auth.uid());

-- Índice para lookup rápido "quais conversas esse user não leu?"
CREATE INDEX conversation_reads_user_idx ON conversation_reads(user_id);

-- 2. Starred (favorito) — independente de pinned
ALTER TABLE conversations
  ADD COLUMN starred BOOLEAN NOT NULL DEFAULT false;

-- 3. Status expandido
-- open: ativa, aguardando resposta
-- pending: aguardando cliente (bot pausado, aguardando input)
-- waiting: snooze / aguardar até data (ex: "voltar em 2 dias")
-- resolved: resolvida mas auditável (diferente de closed/archived)
-- closed: arquivada permanentemente
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('open', 'pending', 'waiting', 'resolved', 'closed'));

-- 4. wait_until — para status 'waiting' (snooze)
ALTER TABLE conversations
  ADD COLUMN wait_until TIMESTAMPTZ;

-- 5. Labels — tabela normalizada (reusa infra de tags mas separada para conversas)
CREATE TABLE conversation_labels (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  color     TEXT NOT NULL DEFAULT '#6366F1',
  position  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

CREATE TABLE conversation_label_assignments (
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id         UUID NOT NULL REFERENCES conversation_labels(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, label_id)
);

ALTER TABLE conversation_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_label_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members labels" ON conversation_labels
  USING (org_id = get_current_org_id());
CREATE POLICY "org members label assignments" ON conversation_label_assignments
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND c.org_id = get_current_org_id()
    )
  );
```

---

## Read/Unread — design detalhado

### Por que tabela separada e não coluna

Vários usuários podem estar no mesmo inbox. "Lido" é por usuário, não por conversa.
`conversation_reads(conversation_id, user_id)` é a abordagem correta (como email multi-user).

### Como marcar como lido

```ts
// Automaticamente ao abrir a conversa:
// POST /api/chat/conversations/{id}/read

// API route:
await supabase.from('conversation_reads').upsert({
  conversation_id: id,
  user_id: currentUserId,
  read_at: new Date().toISOString(),
})
```

- **Trigger:** quando usuário seleciona/abre a conversa no inbox
- **Nova mensagem chega:** remove o read (INSERT na conversation_messages invalida o read do usuário)
  - Via DB trigger: `AFTER INSERT ON conversation_messages → DELETE FROM conversation_reads WHERE conversation_id = NEW.conversation_id AND user_id != NEW.created_by`

### Como saber se está não-lido

```ts
// Na query de listagem, fazer LEFT JOIN:
SELECT c.*,
  CASE WHEN cr.conversation_id IS NULL THEN true ELSE false END AS is_unread
FROM conversations c
LEFT JOIN conversation_reads cr
  ON cr.conversation_id = c.id AND cr.user_id = auth.uid()
WHERE c.org_id = get_current_org_id()
```

### Filtro "Unread" corrigido

```ts
// Antes (errado):
if (activeFilter === 'unread') status = 'open'

// Depois (correto):
if (activeFilter === 'unread') params.append('unread', 'true')
// → API aplica LEFT JOIN + WHERE cr.conversation_id IS NULL
```

### Badge de não-lidos

```tsx
// Título da tab + favicon badge
// Reutilizar infraestrutura do document.title que já existe no chat-layout
// Adicionar: contagem de conversas não-lidas no título

useEffect(() => {
  const unreadCount = conversations.filter(c => c.is_unread).length
  document.title = unreadCount > 0 ? `(${unreadCount}) Inbox — Xphere` : 'Inbox — Xphere'
}, [conversations])
```

---

## Status expandido — design

### Semântica dos status

| Status | Cor | Significado | Transição típica |
|--------|-----|------------|-----------------|
| `open` | Azul | Aguardando resposta do time | Default. → pending, waiting, resolved, closed |
| `pending` | Amarelo | Aguardando resposta do cliente | Bot pausado + esperando input → open (quando cliente responder) |
| `waiting` | Roxo | Snooze até `wait_until` | Volta automaticamente para open quando `wait_until` passa |
| `resolved` | Verde | Concluída, auditável | → closed (arquivamento definitivo) |
| `closed` | Cinza | Arquivada | Final, mas reversível |

### Auto-transição de `waiting` → `open`

```sql
-- Cron job / scheduled workflow verifica a cada 5 min:
UPDATE conversations
SET status = 'open', wait_until = NULL, updated_at = now()
WHERE status = 'waiting'
  AND wait_until <= now();
```

Integrar ao cron tick existente (`/api/cron/scheduling-tick`).

### UI de seleção de status

```tsx
// No ChatHeader — substituir o atual botão "Archive" por StatusSelector:

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="sm">
      <StatusDot status={conversation.status} />
      {STATUS_LABELS[conversation.status]}
      <ChevronDown />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={() => setStatus('open')}>
      <StatusDot status="open" /> Open
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setStatus('pending')}>
      <StatusDot status="pending" /> Pending
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setStatus('waiting')}>
      <StatusDot status="waiting" /> Waiting
      {/* Ao clicar: abre DatePicker para wait_until */}
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setStatus('resolved')}>
      <StatusDot status="resolved" /> Resolved
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => setStatus('closed')}>
      <StatusDot status="closed" /> Archive
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

## Labels — design

### Gerenciamento de labels

```
/settings/workspace → aba "Labels"
- Lista de labels da org (cor + nome)
- Criar, renomear, recolorir, excluir
- Reordenar via drag
```

### Atribuição de label à conversa

```tsx
// No ChatHeader ou no hover card da conversa:
<LabelPicker
  conversationId={id}
  selectedLabelIds={conversation.label_ids}
  allLabels={orgLabels}
  onToggle={(labelId) => toggleConversationLabel(id, labelId)}
/>
```

### Labels na conversa card

```tsx
// Chips coloridos abaixo do last_message preview
// Max 3 visíveis + "+N" se tiver mais
{conversation.labels?.slice(0, 3).map(l => (
  <span key={l.id} className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
        style={{ backgroundColor: l.color + '20', color: l.color }}>
    {l.name}
  </span>
))}
{conversation.labels?.length > 3 && (
  <span className="text-[10px] text-text-tertiary">+{conversation.labels.length - 3}</span>
)}
```

---

## Sistema de filtros avançados

### Filtros existentes (manter)
- Status pill: All / Unread / Mine
- Channel pills: WhatsApp, Instagram, Messenger, SMS, Voice, Web

### Filtros novos

```tsx
// Ícone de filtro avançado no header da lista → abre FilterPanel

<FilterPanel>
  {/* Status */}
  <FilterGroup label="Status">
    <FilterCheckbox value="open" label="Open" />
    <FilterCheckbox value="pending" label="Pending" />
    <FilterCheckbox value="waiting" label="Waiting" />
    <FilterCheckbox value="resolved" label="Resolved" />
    <FilterCheckbox value="closed" label="Archived" />
  </FilterGroup>

  {/* Prioridade */}
  <FilterGroup label="Priority">
    <FilterCheckbox value="urgent" label="🔴 Urgent" />
    <FilterCheckbox value="high" label="🟠 High" />
    <FilterCheckbox value="normal" label="Normal" />
  </FilterGroup>

  {/* Bot */}
  <FilterGroup label="Bot">
    <FilterCheckbox value="active" label="Bot active" />
    <FilterCheckbox value="paused" label="Bot paused" />
  </FilterGroup>

  {/* Assigned */}
  <FilterGroup label="Assigned to">
    <FilterCheckbox value="unassigned" label="Unassigned" />
    {orgMembers.map(m => (
      <FilterCheckbox key={m.id} value={m.id} label={m.name} />
    ))}
  </FilterGroup>

  {/* Labels */}
  <FilterGroup label="Labels">
    {orgLabels.map(l => (
      <FilterCheckbox key={l.id} value={l.id} label={l.name} color={l.color} />
    ))}
  </FilterGroup>

  <FilterGroup label="Other">
    <FilterCheckbox value="starred" label="⭐ Starred" />
    <FilterCheckbox value="pinned" label="📌 Pinned" />
    <FilterCheckbox value="unread" label="🔵 Unread" />
  </FilterGroup>
</FilterPanel>
```

**Filter badge:** quando filtros avançados estão ativos, mostrar contador no ícone:
```tsx
<Button variant="ghost" size="icon-sm">
  <Filter className="h-4 w-4" />
  {activeFilterCount > 0 && (
    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-accent text-white text-[9px]">
      {activeFilterCount}
    </span>
  )}
</Button>
```

---

## Star/Favorito vs Pin

| Feature | Semântica | Comportamento na lista |
|---------|-----------|----------------------|
| **Pin** | Fixa no topo | Aparece na seção "Pinned" acima de todas as outras |
| **Star** | Marca como importante | Aparece com ⭐ no card; filtrável por "Starred" |

São independentes — uma conversa pode ser pinned + starred ao mesmo tempo.

### Star button

```tsx
// No hover do card, ao lado do Pin:
<button onClick={() => toggleStar(conv.id)}
        className={cn('...', conv.starred && 'text-amber-400')}>
  <Star className="h-3.5 w-3.5" fill={conv.starred ? 'currentColor' : 'none'} />
</button>
```

---

## Conversation card atualizado

```
┌─────────────────────────────────────────────────────────┐
│ [🟣] [AV]  João Silva              [📌] [⭐]  [···]    │ ← priority border + hover actions
│           Oi, quero saber mais sobre...    2h           │ ← preview + timestamp
│           [WA] [🔴 urgent] [🔵 unread]                  │ ← channel + priority + unread dot
│           [Atendimento] [Pré-venda]                     │ ← labels (só se tiver)
└─────────────────────────────────────────────────────────┘
```

### Indicador de não-lido

- Ponto azul `●` no lado direito do card
- Nome e preview em font-weight maior (semibold vs medium)
- Fundo ligeiramente mais escuro (`bg-bg-tertiary/60`)

---

## API routes novas/modificadas

```ts
// NOVO: marcar como lido
POST /api/chat/conversations/[id]/read
→ upsert conversation_reads(conversation_id, user_id)

// NOVO: marcar como não-lido
DELETE /api/chat/conversations/[id]/read
→ delete conversation_reads WHERE user_id = currentUser

// NOVO: toggle star
PATCH /api/chat/conversations/[id]/star
body: { starred: boolean }

// NOVO: labels
GET    /api/chat/labels               → lista labels da org
POST   /api/chat/labels               → criar label
PATCH  /api/chat/labels/[id]          → renomear/recolorir
DELETE /api/chat/labels/[id]          → remover label
POST   /api/chat/conversations/[id]/labels    → add label
DELETE /api/chat/conversations/[id]/labels/[labelId]  → remove label

// MODIFICADO: status (aceita pending, waiting, resolved além de open/closed)
POST /api/chat/conversations/[id]/status
body: { status: 'open'|'pending'|'waiting'|'resolved'|'closed', wait_until?: string }

// MODIFICADO: listagem — novos params
GET /api/chat/conversations
  ?unread=true               → conversas não-lidas pelo usuário atual
  &priority=urgent,high      → filtrar por prioridade (multi)
  &bot_status=paused         → filtrar por bot status
  &starred=true              → só starred
  &label_ids=uuid1,uuid2     → tem qualquer dessas labels
  &assigned_user_id=uuid     → filtrar por responsável específico
```

---

## Arquivos

```
supabase/migrations/
└── 097_conversation_inbox_ux.sql       NEW: reads, starred, status expand, labels

src/app/api/chat/
├── conversations/route.ts              EDIT: unread JOIN, novos filtros
├── conversations/[id]/read/route.ts    NEW: POST/DELETE
├── conversations/[id]/star/route.ts    NEW: PATCH
├── conversations/[id]/status/route.ts  EDIT: aceita 5 status + wait_until
├── conversations/[id]/labels/route.ts  NEW: POST
├── conversations/[id]/labels/[lid]/    NEW: DELETE
└── labels/route.ts                     NEW: CRUD de labels da org

src/components/chat/
├── conversation-list.tsx               EDIT: unread badge, star button, labels chips,
│                                             filter panel, unread dot no card
├── chat-layout.tsx                     EDIT: marcar como lido ao selecionar conversa,
│                                             document.title com unread count
├── chat-area/
│   └── chat-header.tsx                 EDIT: StatusSelector (5 status + DatePicker para waiting)
└── conversation-label-picker.tsx       NEW: combobox de labels no header da conversa

src/components/chat/filter-panel.tsx    NEW: filtros avançados (status, priority, bot, assigned, labels, starred)

src/app/(dashboard)/settings/workspace/
└── labels-settings.tsx                 NEW: CRUD de labels da org

src/hooks/use-paginated-conversations.ts  EDIT: novos params de filtro, is_unread field
src/types/chat.ts                          EDIT: status expandido, starred, labels, is_unread
```

---

## Critérios de sucesso

1. ✅ Nova mensagem chega → conversa aparece como não-lida (ponto azul + preview em negrito)
2. ✅ Clicar na conversa → marcada como lida automaticamente
3. ✅ Botão "Marcar como não-lido" disponível no menu ··· do card
4. ✅ Filtro "Unread" lista conversas com mensagens não-lidas pelo usuário (não `status=open`)
5. ✅ Badge no `document.title` mostra contagem real de não-lidos
6. ✅ Star ⭐ toggle visível no hover do card, persistido no banco
7. ✅ Filtro "Starred" lista só conversas com `starred=true`
8. ✅ Status selector com 5 opções: Open, Pending, Waiting, Resolved, Archived
9. ✅ Status "Waiting" abre DatePicker para `wait_until` — volta para Open automaticamente
10. ✅ Labels: criar/editar/excluir em `/settings/workspace` → aba Labels
11. ✅ Atribuir label à conversa via LabelPicker no header do chat
12. ✅ Labels aparecem como chips coloridos no card da conversa
13. ✅ Filtros avançados: priority, bot_status, assigned user, labels, starred
14. ✅ Filter badge mostra contagem de filtros ativos
15. ✅ `npm run build` passa sem erros de tipo
