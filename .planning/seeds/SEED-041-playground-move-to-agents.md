---
id: SEED-041
status: complete
planted: 2026-05-20
shipped: 2026-05-21
trigger_when: now (autonomous execution)
scope: Small
priority: high
depends_on: []
---

# SEED-041: Mover Playground para Agentes — Remover do Chat

O playground de teste de IA não pertence ao Chat (inbox de atendimento humano).
Ele pertence aos Agentes, onde o usuário configura e testa cada bot.

---

## Situação atual

### Dois playgrounds existem em paralelo

| Localização | Componente | Status |
|------------|-----------|--------|
| `/chat?tab=playground` | `PlaygroundChat` (genérico, usa widget token) | ❌ Lugar errado |
| `/agents/{id}/playground` | `AgentPlayground` (por agente) | ✅ Lugar certo |

O screenshot mostra a aba "Playground" no Chat ao lado do "Inbox" — sem contexto
de qual agente está sendo testado e misturado com o inbox de clientes reais.

---

## O que mudar

### 1 — Remover aba Playground do Chat

```tsx
// src/app/(dashboard)/chat/page.tsx — EDIT

// Remover:
// - import { FlaskConical } from 'lucide-react'       (manter Inbox)
// - import { PlaygroundChat }                          (remover import)
// - getPlaygroundConfig()                              (remover fetch)
// - ChatTab href="?tab=playground"                     (remover tab)
// - PlaygroundTab component                            (remover função)
// - searchParams.tab logic                             (remover param)

// Resultado: /chat renderiza só o ChatLayout (inbox), sem tabs
```

Antes:
```tsx
export default async function ChatPage({ searchParams }) {
  const tab = params.tab === 'playground' ? 'playground' : 'inbox'
  return (
    <>
      <Tabs>
        <ChatTab href="?tab=inbox">Inbox</ChatTab>
        <ChatTab href="?tab=playground">Playground</ChatTab>   // ← remover
      </Tabs>
      {tab === 'inbox' ? <ChatLayout /> : <PlaygroundTab />}   // ← simplificar
    </>
  )
}
```

Depois:
```tsx
export default async function ChatPage() {
  // sem tabs, sem searchParams, direto para o inbox
  return <ChatLayout ... />
}
```

### 2 — Enriquecer o Playground nos Agentes

O `/agents/{id}/playground` já existe e funciona. Melhorar a experiência:

#### 2A — Botão "Testar" na página do agente

```tsx
// src/app/(dashboard)/agents/[id]/page.tsx — EDIT

// No header de ações do agente, adicionar botão de atalho:
<Button asChild variant="outline" size="sm">
  <Link href={`/agents/${id}/playground`}>
    <FlaskConical className="h-3.5 w-3.5" />
    Testar agente
  </Link>
</Button>
```

#### 2B — Card de atalho na lista de agentes

```tsx
// src/components/agents/agent-card.tsx (ou equivalente) — EDIT

// No hover do card de agente, mostrar botão rápido:
<div className="opacity-0 group-hover:opacity-100 transition-opacity">
  <Button asChild size="sm" variant="ghost">
    <Link href={`/agents/${agent.id}/playground`}>
      <FlaskConical className="h-3.5 w-3.5" />
      Testar
    </Link>
  </Button>
</div>
```

#### 2C — Playground com seletor de canal

O playground atual testa o agente em modo genérico. Adicionar seletor de canal
para simular como o agente responderia em cada canal (whatsapp, sms, widget, etc.):

```tsx
// src/components/agents/agent-playground.tsx — EDIT

// Header do playground:
<div className="flex items-center gap-3">
  <span className="text-sm text-text-secondary">Simular canal:</span>
  <Select value={channel} onValueChange={setChannel}>
    <SelectItem value="widget">Web Widget</SelectItem>
    <SelectItem value="whatsapp">WhatsApp</SelectItem>
    <SelectItem value="sms">SMS</SelectItem>
    <SelectItem value="messenger">Messenger</SelectItem>
    <SelectItem value="instagram">Instagram</SelectItem>
    <SelectItem value="telegram">Telegram</SelectItem>
  </Select>
  <Button variant="ghost" size="sm" onClick={clearSession}>
    <RotateCcw className="h-3.5 w-3.5" />
    Nova sessão
  </Button>
</div>
```

O canal selecionado é passado para `POST /api/playground/{agentId}` como
`channel` no body — o agente usa `channel_overrides` correspondente.

#### 2D — Breadcrumb correto

```tsx
// Breadcrumb: Agentes → {Nome do Agente} → Playground
// Já existe via nav-items, mas confirmar que o app-breadcrumb
// mostra corretamente a hierarquia de 3 níveis
```

### 3 — Limpar arquivo `playground-chat.tsx`

```
src/components/chat/playground-chat.tsx → DELETAR
// Não é mais referenciado por ninguém após remover a tab do chat
```

### 4 — Redirect para quem tiver a URL antiga bookmarkada

```ts
// src/app/(dashboard)/chat/page.tsx — EDIT
// Se alguém acessar /chat?tab=playground, redirecionar para /agents
import { redirect } from 'next/navigation'

export default async function ChatPage({ searchParams }) {
  const sp = await searchParams
  if (sp.tab === 'playground') redirect('/agents')

  return <ChatLayout ... />
}
```

---

## Arquivos

```
src/app/(dashboard)/chat/page.tsx              EDIT: remover aba + redirect param legacy
src/app/(dashboard)/chat/actions.ts            EDIT: remover getPlaygroundConfig() se só usado aqui
src/components/chat/playground-chat.tsx        DELETE: componente não usado após remoção
src/components/agents/agent-playground.tsx     EDIT: seletor de canal
src/app/(dashboard)/agents/[id]/page.tsx       EDIT: botão "Testar agente" no header
```

---

## Critérios de sucesso

1. ✅ `/chat` não tem mais aba "Playground" — só o Inbox
2. ✅ `/chat?tab=playground` redireciona para `/agents`
3. ✅ `playground-chat.tsx` deletado, sem referências órfãs
4. ✅ Página do agente tem botão "Testar agente" que leva para `/agents/{id}/playground`
5. ✅ Playground do agente tem seletor de canal (widget, whatsapp, sms, etc.)
6. ✅ Canal selecionado é passado para o runtime do agente
7. ✅ `npm run build` passa sem erros de tipo
