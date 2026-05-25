---
id: SEED-015
status: shipped
shipped_in: v2.7
shipped: 2026-05-19
planted: 2026-05-18
trigger_when: now (autonomous execution)
scope: Medium
priority: high
---

# SEED-015: Pipeline UX Fixes

Corrige 3 problemas reportados pelo usuário no kanban de pipeline:
1. Drag & drop "esquisito" (cliques disparam drag acidentalmente)
2. Clique no card não abre nada (só o título-link ou o menu de 3 pontos)
3. Não há edição inline — só uma página dedicada read-only com adicionar notas

## Bugs identificados (auditoria)

- **B1**: `pointerSensor.activationConstraint = { distance: 6 }` → drag acidental ao clicar
- **B2**: Card não tem `onClick` no corpo — só Link no título
- **B3**: `updateOpportunity` server action existe mas **nenhum cliente o chama** para editar campos (só `status`)
- **B4**: Página `/pipeline/[id]` não tem UI de edição de title/value/contact/data
- **B5**: Drag dentro da mesma coluna não reordena (`return` precoce no handler)
- **B6**: Listeners de drag espalhados no corpo do card colidem com Link/DropdownMenu

## Fixes

### P1 — Drag/click fix
- `activationConstraint`: `{ distance: 8, delay: 100, tolerance: 4 }` → clique rápido vira clique, hold/drag vira drag
- Card body: `<div role="button" onClick={openSheet}>` envolvendo tudo, com `e.stopPropagation()` nas zonas internas (dropdown, drag indicator)
- Remove Link do título → o título não é mais um link, o card todo é clicável
- Drag-listeners ficam no wrapper externo; clique abre sheet

### P2 — OpportunityDetailSheet (espelha ContactDetailSheet)
Componente client-side com Sheet do shadcn:
- Header: avatar + título da oportunidade + status pill + botões Edit/Delete
- Modo view (default): mostra title, value, stage, contact, expected_close, tags, notes, activity feed
- Modo edit: form com todos os campos editáveis
- Tabs: Info | Activity | Notes
- Persistência: chama `updateOpportunity(id, patch)` que já existe
- Tags: usa o TagPicker do SEED-013
- Contact: combobox usando `searchContactsForOpportunity`
- Stage: dropdown (movimentos disparam `moveOpportunity`)

Onde abre:
- Click no card do kanban → abre sheet
- `/pipeline/[id]` → renderiza um wrapper que mostra a sheet "always open" (preserva URL share)

### P3 — Reorder within stage
Coluna `opportunities.position` já existe. Server action nova:
- `reorderOpportunities(stageId, orderedIds[])` → atualiza position em batch
- kanban-board onDragEnd: detecta drop dentro da mesma coluna e dispara reorder

## File structure

```
src/components/pipeline/
├── opportunity-detail-sheet.tsx       NEW: Sheet com view + edit + activity
├── opportunity-edit-form.tsx          NEW: form com todos os campos
├── opportunity-card.tsx               EDIT: simplifica, body clicável
├── kanban-board.tsx                   EDIT: activationConstraint + reorder + abre sheet
└── (mantém: opportunity-detail-client.tsx para a página standalone)

src/app/(dashboard)/pipeline/
├── actions.ts                         EDIT: adiciona reorderOpportunities
├── [opportunityId]/page.tsx           EDIT: usa OpportunityDetailSheet em modo standalone
```

## Critérios de sucesso

1. ✅ Clicar no corpo do card abre a sheet de detalhes
2. ✅ Drag funciona suavemente, sem falsos positivos em cliques rápidos
3. ✅ Pode arrastar para reordenar dentro da mesma coluna
4. ✅ Pode editar title, value, contact, expected_close_date, status na sheet
5. ✅ Sheet mostra activity feed e permite adicionar notas
6. ✅ Tags integradas (do SEED-013)
7. ✅ URL `/pipeline/[id]` ainda funciona (mostra a sheet aberta)
8. ✅ `npm run build` passa
