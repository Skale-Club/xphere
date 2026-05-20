---
id: SEED-037
status: complete
planted: 2026-05-20
shipped: 2026-05-20
trigger_when: now (autonomous execution)
scope: Small-Medium
priority: critical
depends_on: []
---

# SEED-037: Workflow Routing — Auditoria e Correção Completa

Auditar e corrigir todos os problemas de navegação, routing e linking no
sistema de workflows. O bug raiz já foi corrigido (dc97320), mas há mais
inconsistências de arquitetura que precisam ser resolvidas.

---

## Bug raiz — corrigido em dc97320

**Problema:** `WorkflowsList` linkava TODOS os itens para `/workflows/{id}` (rota
de tool_config legada). Flows (`kind='flow'`) precisam ir para `/workflows/flows/{id}`.

**Fix:** Link condicional por `kind`. Empty state link também corrigido
(`/workflows/new` → `/workflows/flows/new`).

---

## Problemas remanescentes a auditar e corrigir

### P1 — Duas listas paralelas, UX inconsistente

**Situação:**
- `/workflows` → lista unificada (tools + flows) via `listUnifiedWorkflows()`
- `/workflows/flows` → lista só flows via `listWorkflows()`

O usuário tem duas entradas para o mesmo conteúdo. A sidebar aponta para `/workflows`
mas o breadcrumb de "New flow" volta para `/workflows/flows`. Confuso.

**Fix:**
- Redirecionar `/workflows/flows` → `/workflows` (consolidar em uma única lista)
- Ou eliminar `/workflows` e usar `/workflows/flows` como canônico
- Decisão: **`/workflows` é a raiz canônica** — `/workflows/flows` vira redirect

### P2 — `/workflows/new` não existe

`/workflows/new` não é uma rota válida mas aparecia no link do empty state.
Corrigido em dc97320, mas verificar se há outros lugares linkando para essa rota.

```bash
grep -r "/workflows/new" src/ --include="*.tsx" --include="*.ts"
```

### P3 — `[toolConfigId]` catch-all conflita com `flows/`

A estrutura de rotas atual:
```
/workflows/[toolConfigId]   ← captura qualquer segmento
/workflows/flows            ← rota específica
```

Next.js App Router resolve `/workflows/flows` antes de `[toolConfigId]` (rotas
estáticas têm precedência), mas `/workflows/logs` pode ser capturado por `[toolConfigId]`
dependendo da ordem de resolução. **Verificar se `/workflows/logs` funciona corretamente.**

**Fix:** Renomear `[toolConfigId]` para `[id]` e adicionar verificação explícita
de `kind` ao carregar — se for flow, redirecionar para `/workflows/flows/{id}`.

### P4 — Breadcrumb não reflete a hierarquia correta

Ao editar um flow em `/workflows/flows/{id}`, o breadcrumb mostra:
`Workflows → Flows → {nome}` mas deveria mostrar `Workflows → {nome}` se
consolidarmos as rotas.

### P5 — "Back" buttons com destinos mistos

- `/workflows/flows/new` → back para `/workflows/flows` (deveria ser `/workflows`)
- `/workflows/flows/{id}` → back para `/workflows/flows` (deveria ser `/workflows`)

### P6 — Runs link fora do contexto correto

`/workflows/flows/runs/[runId]` existe mas não há link de volta para o flow pai.
O run detail page precisa de um breadcrumb com link para `/workflows/flows/{workflow_id}`.

### P7 — `/workflows/[toolConfigId]` carrega sem verificar `kind`

Se um `workflow.id` (kind='flow') for passado para `/workflows/[toolConfigId]`,
a página tenta buscar em `tool_configs` → 404. Deve detectar isso e redirecionar.

---

## Arquivos a auditar e modificar

```
src/app/(dashboard)/workflows/
├── page.tsx                      AUDIT: links, breadcrumb
├── [toolConfigId]/page.tsx       FIX: redirecionar se id pertence a workflow kind='flow'
├── flows/
│   ├── page.tsx                  FIX: redirect → /workflows
│   ├── new/page.tsx              FIX: back link → /workflows
│   ├── [id]/page.tsx             FIX: back link → /workflows
│   └── [id]/runs/page.tsx        FIX: back link + breadcrumb com link para flow pai
└── flows/runs/[runId]/page.tsx   FIX: breadcrumb correto

src/components/workflows/
└── workflows-list.tsx            AUDIT: outros links quebrados
```

---

## Critérios de sucesso

1. ✅ Clicar em qualquer workflow na lista navega para a página correta (sem 404)
2. ✅ `/workflows/flows` redireciona para `/workflows` (sem lista duplicada)
3. ✅ `/workflows/new` redireciona para `/workflows/flows/new`
4. ✅ Todos os botões "back" levam para `/workflows`
5. ✅ Breadcrumb em `/workflows/flows/{id}` mostra `Workflows → {nome do flow}`
6. ✅ `/workflows/logs` não é capturado por `[toolConfigId]`
7. ✅ Carregar flow ID em `/workflows/{id}` redireciona automaticamente para `/workflows/flows/{id}`
8. ✅ `npm run build` sem erros de tipo
