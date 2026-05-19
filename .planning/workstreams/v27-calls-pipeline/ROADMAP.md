# Roadmap: v2.7 Unified Calls Hub + Pipeline UX

**Workstream:** v27-calls-pipeline
**Phases:** 8 (85–92) | **Requirements:** 18 (CALL-01..10, PIPE-01..08)

---

## Phase 85: UNIFIED-CALLS-DB

**Goal:** Migration criando a VIEW `unified_calls` unindo `calls` (AI/Vapi) e `call_logs` (Human/Twilio) em um único dataset consultável. TypeScript types + server actions base.
**Depends on:** Nothing (first phase of v2.7)
**Requirements:** CALL-01, CALL-02
**UI hint:** no
**Success Criteria:**
1. `supabase/migrations/071_unified_calls_view.sql` cria a VIEW `unified_calls` com colunas: `id, call_type (ai|human), org_id, external_id, counterpart_number, counterpart_name, contact_id, direction, duration_seconds, status, substatus, recording_url, transcript, notes, cost, assistant_id, routing_mode, started_at, created_at`
2. `src/types/database.ts` inclui tipo manual `UnifiedCall` com todos os campos da VIEW
3. `src/app/(dashboard)/calls/actions.ts` — `getUnifiedCalls(params)` e `getUnifiedCall(id)` funcionando
4. `npm run build` exits 0

**Plans:** 2/2 plans executed
- [x] 85-01-PLAN.md — Migration + VIEW SQL + TypeScript types
- [x] 85-02-PLAN.md — Vitest test suite for getUnifiedCalls + getUnifiedCall (8 tests)

---

## Phase 86: UNIFIED-TIMELINE-PAGE

**Goal:** Página `/calls` com timeline unificada mostrando AI e Human calls em uma lista com filtros e badges por tipo.
**Depends on:** Phase 85
**Requirements:** CALL-03, CALL-04
**UI hint:** yes
**Success Criteria:**
1. `src/app/(dashboard)/calls/layout.tsx` com tabs nav: Timeline / Campaigns / Assistants / Settings
2. `src/app/(dashboard)/calls/page.tsx` exibe timeline unificada usando `getUnifiedCalls`
3. `src/components/calls/unified-call-timeline.tsx` — lista de chamadas com badge AI/Human
4. `src/components/calls/unified-call-filters.tsx` — filtros: All / AI / Human / Inbound / Outbound / Missed
5. `/calls` rota funciona sem quebrar `/phone` e `/voice` existentes
6. `npm run build` exits 0

**Plans:** 2
- [ ] 86-01-PLAN.md — Layout + page + UnifiedCallTimeline component
- [ ] 86-02-PLAN.md — UnifiedCallFilters + badge visual AI vs Human

---

## Phase 87: CALLS-SUBROUTES

**Goal:** Sub-rotas `/calls/campaigns` e `/calls/assistants` movendo a lógica existente de `/phone` para as novas rotas.
**Depends on:** Phase 86
**Requirements:** CALL-05
**UI hint:** yes
**Success Criteria:**
1. `src/app/(dashboard)/calls/campaigns/page.tsx` — mesma lógica de `/phone` tab campaigns
2. `src/app/(dashboard)/calls/assistants/page.tsx` — mesma lógica de `/phone` tab assistants
3. Navegação pelo layout.tsx tabs funciona corretamente
4. `npm run build` exits 0

**Plans:** 1
- [ ] 87-01-PLAN.md — Campaigns + Assistants sub-routes

---

## Phase 88: CALLS-SETTINGS

**Goal:** Sub-rota `/calls/settings` consolidando routing modes, Dialer e configurações de chamada.
**Depends on:** Phase 87
**Requirements:** CALL-06
**UI hint:** yes
**Success Criteria:**
1. `src/app/(dashboard)/calls/settings/page.tsx` com CallSettingsForm + ZoiperSetupGuide + Dialer
2. Rota acessível via tab "Settings" no layout
3. `npm run build` exits 0

**Plans:** 1
- [ ] 88-01-PLAN.md — Settings page consolidation

---

## Phase 89: CALLS-DETAIL-ROUTER

**Goal:** Página de detalhe `/calls/[id]` que detecta o tipo da chamada e renderiza variant correto: `call-detail-ai.tsx` (transcript, summary, cost) ou `call-detail-human.tsx` (recording, notes, contact).
**Depends on:** Phase 85
**Requirements:** CALL-07, CALL-08
**UI hint:** yes
**Success Criteria:**
1. `src/app/(dashboard)/calls/[id]/page.tsx` detecta tipo via `getUnifiedCall(id).call_type`
2. `src/components/calls/call-detail-ai.tsx` — transcript, summary, cost, assistant info
3. `src/components/calls/call-detail-human.tsx` — recording player, notes, contact link
4. Shell visual compartilhado (header + metadados comuns)
5. `npm run build` exits 0

**Plans:** 2
- [ ] 89-01-PLAN.md — Detail router + shared shell
- [ ] 89-02-PLAN.md — AI variant + Human variant components

---

## Phase 90: CALLS-SIDEBAR-CLEANUP

**Goal:** Sidebar atualizada com item único "Calls", redirects de `/phone` e `/voice` para `/calls`, remoção de componentes obsoletos.
**Depends on:** Phase 89
**Requirements:** CALL-09, CALL-10
**UI hint:** no
**Success Criteria:**
1. Sidebar remove "Phone" e "Voice", adiciona "Calls" com ícone Phone
2. `src/app/(dashboard)/phone/page.tsx` → `redirect('/calls')`
3. `src/app/(dashboard)/voice/page.tsx` → `redirect('/calls')`
4. `/voice/[id]` → `redirect('/calls/' + id)`
5. Webhooks `/api/twilio/*` e `/api/vapi/*` intactos (sem alteração)
6. `npm run build` exits 0

**Plans:** 2
- [ ] 90-01-PLAN.md — Sidebar update + redirects
- [ ] 90-02-PLAN.md — Cleanup de componentes não mais referenciados

---

## Phase 91: PIPELINE-CLICK-DRAG

**Goal:** Corrigir drag & drop acidental, tornar o corpo do card clicável e implementar `OpportunityDetailSheet` com view + edit mode.
**Depends on:** Nothing (parallel to calls phases)
**Requirements:** PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-05, PIPE-06
**UI hint:** yes
**Success Criteria:**
1. `activationConstraint` do DnD kit: `{ distance: 8, delay: 100, tolerance: 4 }` — clique rápido ≠ drag
2. Corpo do card tem `role="button"` com `onClick={openSheet}` — clique abre a sheet
3. `OpportunityDetailSheet` (shadcn Sheet) com: header (título + status pill), tabs Info/Activity/Notes, modo view + modo edit
4. Modo edit: campos title, value, stage, contact (combobox), expected_close_date, tags editáveis
5. `updateOpportunity(id, patch)` chamado ao salvar edições
6. `npm run build` exits 0

**Plans:** 2
- [ ] 91-01-PLAN.md — DnD fix + card onClick body
- [ ] 91-02-PLAN.md — OpportunityDetailSheet component (view + edit + tabs)

---

## Phase 92: PIPELINE-REORDER

**Goal:** Reordenação de cards dentro da mesma coluna do kanban, persistida via server action.
**Depends on:** Phase 91
**Requirements:** PIPE-07, PIPE-08
**UI hint:** no
**Success Criteria:**
1. Server action `reorderOpportunities(stageId, orderedIds[])` atualiza coluna `position` em batch
2. `onDragEnd` no kanban detecta drop na mesma coluna e dispara reorder
3. Reorder otimista com rollback em caso de erro
4. `/pipeline/[id]` ainda funciona mostrando OpportunityDetailSheet em modo standalone
5. `npm run build` exits 0

**Plans:** 2
- [ ] 92-01-PLAN.md — reorderOpportunities server action
- [ ] 92-02-PLAN.md — kanban onDragEnd same-column reorder + standalone page update
