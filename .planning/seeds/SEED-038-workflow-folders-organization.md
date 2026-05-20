---
id: SEED-038
status: complete
planted: 2026-05-20
shipped: 2026-05-20
trigger_when: now (autonomous execution)
scope: Large
priority: medium
depends_on: [SEED-037]
---

> **Shipped 2026-05-20.** Migration landed as `100_workflow_folders.sql`
> (099 was already claimed by SEED-036). Bonus features deferred for a
> follow-up: full icon picker, RunWorkflowPanel ("Executar agora"), and
> inline folder creation in the tree (we ship a small dialog instead).
> Folder reordering uses the menu/dialog flow; only workflow-to-folder
> drag & drop is wired for the initial ship.


# SEED-038: Workflow Folders — Organização, Drag & Drop, Arquivo e Lixeira

Sistema completo de organização de workflows em pastas com drag & drop fluido,
menu de contexto por clique direito, arquivamento (soft delete) e lixeira com
hard delete.

---

## Modelo de dados

### Migração 099 — `workflow_folders` + extensões em `workflows`

```sql
-- 099_workflow_folders.sql

CREATE TABLE workflow_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,                       -- hex opcional, ex: '#6366F1'
  icon        TEXT,                       -- nome de ícone lucide, ex: 'folder-open'
  parent_id   UUID REFERENCES workflow_folders(id) ON DELETE CASCADE, -- pasta pai (aninhamento)
  position    INTEGER NOT NULL DEFAULT 0, -- ordem na lista
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, parent_id, name)
);

ALTER TABLE workflow_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org members" ON workflow_folders USING (org_id = get_current_org_id());

-- Adicionar colunas em workflows
ALTER TABLE workflows
  ADD COLUMN folder_id   UUID REFERENCES workflow_folders(id) ON DELETE SET NULL,
  ADD COLUMN position    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN archived_at TIMESTAMPTZ,          -- NULL = ativo, not NULL = arquivado
  ADD COLUMN deleted_at  TIMESTAMPTZ;          -- NULL = vivo, not NULL = na lixeira (soft delete)

-- Índices
CREATE INDEX workflow_folders_org_parent_idx ON workflow_folders(org_id, parent_id);
CREATE INDEX workflows_folder_idx ON workflows(folder_id) WHERE deleted_at IS NULL;
CREATE INDEX workflows_archived_idx ON workflows(org_id, archived_at) WHERE deleted_at IS NULL;
CREATE INDEX workflows_deleted_idx ON workflows(org_id, deleted_at) WHERE deleted_at IS NOT NULL;
```

### Semântica dos estados

| Estado | `archived_at` | `deleted_at` | Visível em |
|--------|--------------|--------------|-----------|
| Ativo | NULL | NULL | Lista principal |
| Arquivado | NOT NULL | NULL | "Ver arquivados" (toggle) |
| Lixeira | qualquer | NOT NULL | Lixeira `/workflows/trash` |

**Arquivar pasta:** arquiva a pasta E todos os workflows dentro dela.
**Restaurar da lixeira:** define `deleted_at = NULL`, mantém `archived_at`.
**Hard delete:** `DELETE FROM workflows WHERE id = ? AND deleted_at IS NOT NULL`

---

## UX — Layout principal

```
/workflows

┌─────────────────────────────────────────────────────────────────┐
│  Workflows                           [Ver arquivados] [🗑️] [+ New] │
│                                                                  │
│  ┌─── 📁 Vendas ─────────────────────────────────── 3  [···] ┐  │
│  │  ⚡ Follow-up Lead 3 dias          tool_call  ● Ativo     │  │
│  │  ⚡ Deal Ganho → Telegram          event      ● Ativo     │  │
│  │  ⚡ Alerta Close Date              event      ○ Pausado   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─── 📁 Suporte ─────────────────────────────────── 1  [···] ┐  │
│  │  ⚡ Auto-resposta SLA              event      ● Ativo     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ⚡ Teste (sem pasta)                 manual      ○ Pausado      │
│  ⚡ Webhook entrada                   webhook     ● Ativo        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Drag & Drop

### Biblioteca: `@dnd-kit/core` + `@dnd-kit/sortable` (já instalada)

### Comportamentos

| Ação de drag | Resultado |
|-------------|-----------|
| Workflow → dentro de pasta | Move para a pasta |
| Workflow → fora de pasta (soltar no root) | Remove da pasta |
| Workflow → dentro de outra pasta | Move para nova pasta |
| Workflow → acima/abaixo de outro workflow (mesma pasta) | Reordena |
| Pasta → acima/abaixo de outra pasta | Reordena pastas |
| Pasta → dentro de outra pasta | Aninha pasta (max 2 níveis) |

### Visual durante drag

- Item arrastado: `opacity: 0.4` no original, card "fantasma" segue o cursor com `rotate(1.5deg) scale(1.02)`
- Drop zone ativa: highlight sutil `bg-accent/5 border-accent/30 rounded-lg`
- Pasta expandida automaticamente após hover por 600ms (auto-expand)

### Implementação

```tsx
// src/components/workflows/workflow-dnd-board.tsx — NEW

// Usar DndContext + SortableContext por seção (root + cada pasta)
// Drop targets:
//   - 'folder' — pasta inteira (drop dentro)
//   - 'workflow' — item individual (reordenar)
//   - 'root' — área fora de pastas

// Ao drag end:
// 1. Se over.type === 'folder': mover workflow para pasta
// 2. Se over.type === 'root': remover pasta (folder_id = null)
// 3. Se over.type === 'workflow' (mesma pasta): reordenar
// 4. Se over.type === 'workflow' (pasta diferente): mover + reordenar
```

---

## Menu de contexto (clique direito)

### Para workflows

```
┌──────────────────────────────┐
│  ▶  Abrir                    │
│  ▶  Abrir em nova aba        │
│  ─────────────────────────── │
│  ▶  Executar agora     ▷     │  → abre painel de test run
│  ▶  Ver execuções            │
│  ─────────────────────────── │
│  ▶  Mover para pasta...      │  → submenu ou modal de seleção
│  ▶  Renomear                 │  → inline edit
│  ▶  Duplicar                 │
│  ─────────────────────────── │
│  ▶  Arquivar                 │  → soft archive
│  ▶  Mover para lixeira       │  → soft delete (vermelho)
└──────────────────────────────┘
```

### Para pastas

```
┌──────────────────────────────┐
│  ▶  Renomear                 │  → inline edit
│  ▶  Mudar cor                │  → color picker (8 cores)
│  ─────────────────────────── │
│  ▶  Arquivar pasta           │  → arquiva pasta + todos workflows
│  ▶  Mover para lixeira       │  → (vermelho)
└──────────────────────────────┘
```

### Implementação

```tsx
// src/components/workflows/workflow-context-menu.tsx — NEW
// Usar Radix ContextMenu (já disponível via shadcn)
// Wrap cada workflow row e folder header com <ContextMenu>

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
```

---

## Executar agora (Test Run)

Menu de contexto → "Executar agora" → abre `RunWorkflowPanel`:

```tsx
// src/components/workflows/run-workflow-panel.tsx — NEW
// Sheet lateral (não modal, não bloqueia a lista)

// Conteúdo:
// 1. Header: nome do workflow + trigger type
// 2. Se trigger_type = 'tool_call' ou 'manual':
//    → Campos de input baseados no input_schema do workflow
//    → Botão "Executar"
// 3. Se trigger_type = 'event' ou 'schedule':
//    → Aviso: "Este workflow é ativado automaticamente. Deseja forçar uma execução de teste?"
//    → Botão "Forçar execução" (sem input)
// 4. Após executar: mostra resultado inline (streaming logs se disponível)
//    → Link "Ver execução completa" → /workflows/flows/{id}/runs/{runId}
```

---

## Arquivamento

### Arquivar workflow

```ts
// server action
export async function archiveWorkflow(id: string): Promise<void>
// SET archived_at = now(), is_active = false
// Entrada desaparece da lista principal
// Toast: "Workflow arquivado. [Desfazer]" (5s para desfazer)
```

### "Ver arquivados" toggle

```tsx
// Botão no header da lista
// Quando ativo: mostra seção "Archived" abaixo dos ativos
// Archived items: opacidade reduzida, badge "Archived"
// Botão "Restaurar" no hover → SET archived_at = NULL
```

---

## Lixeira

### Rota `/workflows/trash`

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Workflows          Lixeira                [Esvaziar tudo 🗑️]  │
│                                                                  │
│  ⚡ Teste (excluído há 2 dias)         [Restaurar]  [Excluir ✕]  │
│  ⚡ Teste_1 (excluído há 5 dias)       [Restaurar]  [Excluir ✕]  │
│  📁 Vendas v1 (excluída há 7 dias)    [Restaurar]  [Excluir ✕]  │
└─────────────────────────────────────────────────────────────────┘
```

- **Restaurar:** `deleted_at = NULL` (volta para lista principal ou arquivados)
- **Excluir ✕ (hard delete):** confirmação "Excluir permanentemente? Esta ação não pode ser desfeita." → `DELETE FROM workflows`
- **Esvaziar tudo:** hard delete de tudo com `deleted_at IS NOT NULL` (confirmação extra)
- **Auto-purge:** cron mensal (ou nunca — deixar o usuário decidir)

### Botão da lixeira no header

Ícone 🗑️ com badge de contagem se houver itens:
```tsx
<Button variant="ghost" size="icon-sm" asChild>
  <Link href="/workflows/trash">
    <Trash2 className="h-4 w-4" />
    {trashCount > 0 && (
      <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center">
        {trashCount}
      </span>
    )}
  </Link>
</Button>
```

---

## Folder criação inline

```tsx
// Botão "+ Nova pasta" no header ou via menu de contexto na área vazia
// Cria folder inline, nome "Nova pasta" selecionado para edição imediata
// Enter → salva, Escape → cancela

<input
  autoFocus
  defaultValue="Nova pasta"
  onKeyDown={(e) => {
    if (e.key === 'Enter') saveFolder(e.currentTarget.value)
    if (e.key === 'Escape') cancelFolder()
  }}
  className="inline-edit-input"
/>
```

---

## Server actions

```ts
// src/app/(dashboard)/workflows/actions.ts — EDIT

// Pastas
createFolder(name: string, parentId?: string): Promise<{ id: string }>
renameFolder(id: string, name: string): Promise<void>
deleteFolder(id: string): Promise<void>       // → moved_to_trash (soft)
reorderFolders(orderedIds: string[]): Promise<void>

// Workflows — novas ações
moveWorkflowToFolder(workflowId: string, folderId: string | null): Promise<void>
reorderWorkflowsInFolder(folderId: string | null, orderedIds: string[]): Promise<void>
archiveWorkflow(id: string): Promise<void>
restoreWorkflow(id: string): Promise<void>    // undo archive
trashWorkflow(id: string): Promise<void>      // soft delete
restoreFromTrash(id: string): Promise<void>
hardDeleteWorkflow(id: string): Promise<void> // só se deleted_at IS NOT NULL
emptyTrash(orgId: string): Promise<{ count: number }>
runWorkflowNow(id: string, input?: Record<string, unknown>): Promise<{ runId: string }>
```

---

## Animações

### Drag & Drop
- **Pick up:** `scale(1.02)` + `box-shadow` elevado — `transition: transform 150ms ease`
- **Drop:** spring animation voltando para posição — `@dnd-kit/utilities CSS.Transform`
- **Reorder:** lista anima via `AnimatePresence` do framer-motion OU CSS `transition: margin 200ms ease`

### Pasta expandir/colapsar
- Chevron rotate: `transition: transform 200ms ease`
- Conteúdo: `grid-rows-[0fr]` → `grid-rows-[1fr]` CSS grid animation (sem JS)

### Archive/Delete
- Item some com `opacity: 0 scale(0.98)` antes de sair da DOM

---

## Arquivos

```
supabase/migrations/
└── 099_workflow_folders.sql              NEW

src/app/(dashboard)/workflows/
├── page.tsx                             EDIT: passa folders + archived toggle
├── trash/page.tsx                       NEW: lixeira
├── actions.ts                           EDIT: todas as novas server actions
└── flows/page.tsx                       FIX: redirect → /workflows (SEED-037)

src/components/workflows/
├── workflow-dnd-board.tsx               NEW: DndContext board com pastas + drag
├── workflow-context-menu.tsx            NEW: Radix ContextMenu
├── workflow-folder.tsx                  NEW: pasta colapsável com header + items
├── run-workflow-panel.tsx               NEW: Sheet de test run
├── workflows-list.tsx                   EDIT: integrar DnD board + context menu
└── workflow-toggle.tsx                  (mantém sem mudança)
```

---

## Critérios de sucesso

1. ✅ Criar pasta inline com nome editável direto ao criar
2. ✅ Arrastar workflow para dentro/fora de pasta — persiste no banco
3. ✅ Reordenar workflows dentro da mesma pasta via drag
4. ✅ Reordenar pastas via drag
5. ✅ Clique direito em workflow → menu com todas as opções
6. ✅ Clique direito em pasta → menu correto
7. ✅ "Executar agora" abre painel lateral com formulário de inputs e resultado inline
8. ✅ Arquivar: some da lista, aparece em "Ver arquivados", pode ser restaurado
9. ✅ Mover para lixeira: some da lista + aparece em `/workflows/trash`
10. ✅ Hard delete na lixeira com confirmação + não pode ser desfeito
11. ✅ Esvaziar tudo na lixeira com dupla confirmação
12. ✅ Badge de contagem no ícone da lixeira
13. ✅ Animações suaves: drag, collapse de pasta, archive/delete
14. ✅ `npm run build` limpo
