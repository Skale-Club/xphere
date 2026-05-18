---
id: SEED-014
status: active
planted: 2026-05-18
planted_during: post-Xphere-rename
trigger_when: now (autonomous execution)
scope: Medium-Large
priority: high
---

# SEED-014: Unified Calls Hub — Phone + Voice Merger

Mesclar os módulos `/phone` (Vapi/IA) e `/voice` (Twilio/humano) em uma única seção `/calls` com timeline unificada, sub-navegação consistente, e roteamento de chamadas integrado.

---

## Motivação

Estado atual:
- `/phone` (Vapi): IA-driven calls + campanhas + assistentes — visível na sidebar
- `/voice` (Twilio): chamadas humanas + roteamento + gravações — **não está na sidebar, órfão**

Problemas:
1. Voice está praticamente escondido — usuário não acha
2. Conceitualmente são "ligações" do mesmo workspace
3. Dados complementares: AI tem transcript+custo, Human tem recording+contato
4. Settings de roteamento (call_settings) ficam isolados em /voice
5. Para ver o histórico completo o usuário precisa visitar 2 telas

---

## Filosofia

**P1 — Tipo de call é um filtro, não uma área**
Tanto IA quanto humano são ligações. Mostrar tudo em um timeline, deixar o user filtrar.

**P2 — Detail page se adapta ao tipo**
Mesmo shell visual, conteúdo específico (transcript para IA, recording player para humano).

**P3 — Não quebrar webhooks existentes**
`/api/twilio/*` e `/api/vapi/*` continuam intactos. Mudança é só na camada de UI.

**P4 — DB preservado**
Tabelas `calls` e `call_logs` continuam — adiciona-se uma `VIEW` unificada por cima.

---

## Modelo de dados — Unified View

```sql
CREATE VIEW unified_calls AS
SELECT
  id,
  'ai'::text                    AS call_type,
  organization_id               AS org_id,
  vapi_call_id                  AS external_id,
  customer_number               AS counterpart_number,
  customer_name                 AS counterpart_name,
  NULL::uuid                    AS contact_id,
  'inbound'::text               AS direction,
  duration_seconds,
  status,
  ended_reason                  AS substatus,
  NULL::text                    AS recording_url,
  transcript,
  summary                       AS notes,
  cost,
  assistant_id,
  NULL::text                    AS routing_mode,
  created_at                    AS started_at,
  created_at
FROM public.calls
UNION ALL
SELECT
  id,
  'human'::text                 AS call_type,
  org_id,
  call_sid                      AS external_id,
  CASE WHEN direction = 'inbound' THEN from_number ELSE to_number END
                                AS counterpart_number,
  NULL::text                    AS counterpart_name,
  contact_id,
  direction,
  duration_seconds,
  status,
  NULL::text                    AS substatus,
  recording_url,
  NULL::text                    AS transcript,
  notes,
  NULL::numeric                 AS cost,
  NULL::uuid                    AS assistant_id,
  routing_mode,
  COALESCE(started_at, created_at) AS started_at,
  created_at
FROM public.call_logs;
```

RLS funciona automaticamente (VIEWs com `SECURITY INVOKER` herdam RLS das tabelas-base).

---

## Roteamento de URLs

```
/calls                       ← timeline unificado (era /phone?tab=calls + /voice)
/calls/campaigns             ← campanhas (era /phone?tab=campaigns)
/calls/assistants            ← assistentes Vapi (era /phone?tab=assistants)
/calls/settings              ← routing modes + Dialer (era /voice + call-settings-form)
/calls/[id]                  ← detail page com type detection

/phone                       ← 301 redirect → /calls
/phone?tab=campaigns         ← 301 → /calls/campaigns
/phone?tab=assistants        ← 301 → /calls/assistants
/voice                       ← 301 → /calls
/voice/[id]                  ← 301 → /calls/[id]
```

---

## File structure

```
src/app/(dashboard)/calls/
├── page.tsx                  ← timeline unificada
├── layout.tsx                ← tabs nav (Timeline/Campaigns/Assistants/Settings)
├── actions.ts                ← getUnifiedCalls, getUnifiedCall server actions
├── campaigns/
│   ├── page.tsx              ← (move de /phone)
│   └── [id]/page.tsx         ← (se houver)
├── assistants/
│   └── page.tsx              ← (move de /phone)
├── settings/
│   └── page.tsx              ← routing modes + dialer
└── [id]/
    └── page.tsx              ← smart detail router

src/components/calls/
├── unified-call-timeline.tsx ← NEW: timeline com badges AI/Human
├── unified-call-row.tsx      ← NEW: linha de chamada com type-aware rendering
├── unified-call-filters.tsx  ← NEW: filter bar (type, direction, status)
├── call-detail-ai.tsx        ← NEW: variant para AI (transcript, summary, cost)
├── call-detail-human.tsx     ← NEW: variant para Human (recording, notes, contact)
└── (reaproveita CallWaveformPlayer, CallNotesEditor, Dialer, etc.)

src/app/(dashboard)/phone/page.tsx  ← redirect to /calls
src/app/(dashboard)/voice/page.tsx  ← redirect to /calls
```

---

## Decomposição — 6 fases

### Phase C1 — DB foundation
- Migration 063_unified_calls_view.sql (cria a VIEW)
- Tipo `UnifiedCall` em src/types/database.ts (manual entry para a view)
- Server actions: `getUnifiedCalls`, `getUnifiedCall` em `src/app/(dashboard)/calls/actions.ts`
- npm run build

### Phase C2 — Unified timeline page
- `src/app/(dashboard)/calls/layout.tsx` com tabs nav
- `src/app/(dashboard)/calls/page.tsx` (timeline default tab)
- `src/components/calls/unified-call-timeline.tsx`
- `src/components/calls/unified-call-filters.tsx`
- Substitui o redirect atual de /calls
- Mantém /phone e /voice funcionando em paralelo

### Phase C3 — Sub-routes (campaigns, assistants)
- `src/app/(dashboard)/calls/campaigns/page.tsx` (copia lógica de /phone tab=campaigns)
- `src/app/(dashboard)/calls/assistants/page.tsx` (copia lógica de /phone tab=assistants)

### Phase C4 — Settings (routing + dialer)
- `src/app/(dashboard)/calls/settings/page.tsx` 
- Pulls in CallSettingsForm + ZoiperSetupGuide + Dialer

### Phase C5 — Unified detail router
- `src/app/(dashboard)/calls/[id]/page.tsx`
- Detecta tipo: primeiro tenta `unified_calls` view, depois separa em variant
- `call-detail-ai.tsx` (transcript, summary, cost, assistant)
- `call-detail-human.tsx` (recording player, notes, contact)
- Shared shell: header + sidebar

### Phase C6 — Sidebar + redirects + cleanup
- Sidebar: remove "Phone" + "Voice", adiciona "Calls" único
- /phone/page.tsx → `redirect('/calls' + tab→subroute)`
- /voice/page.tsx → `redirect('/calls')`
- /voice/[id]/page.tsx → `redirect('/calls/' + id)`
- /calls (antigo redirect) já foi substituído na phase C2
- Remove componentes não mais usados (CallsTable é absorvida, CallTimeline é absorvida)
- Atualiza command-palette, onboarding tour, links internos
- CLAUDE.md update

---

## Critérios de sucesso

1. ✅ `/calls` mostra timeline unificada com calls de ambos os tipos
2. ✅ Filtros funcionam: All / AI / Human / Inbound / Outbound / Missed
3. ✅ Badge visual distingue tipo (🤖 AI vs 📞 Human)
4. ✅ Detail page renderiza variant correto baseado no tipo
5. ✅ Campanhas e assistentes funcionando em /calls/campaigns e /calls/assistants
6. ✅ Routing settings funcionando em /calls/settings
7. ✅ /phone e /voice redirecionam para /calls (preservando links antigos)
8. ✅ Sidebar mostra UM item "Calls" com sub-nav
9. ✅ Webhooks /api/twilio/* e /api/vapi/* intactos
10. ✅ `npm run build` passa sem erros

---

## Anti-patterns

❌ Materializar VIEW em tabela física — usar VIEW pura, deixa o DB resolver  
❌ Quebrar URLs antigas sem redirect — sempre 301  
❌ Detail page que tenta unificar conteúdo — variants por tipo, ok ter visuais diferentes  
❌ Filter "by call type" como rota separada — é só filtro no timeline  
❌ Esquecer de remover componentes antigos — fase C6 faz cleanup
