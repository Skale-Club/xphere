---
id: SEED-036
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Large
priority: high
depends_on: [SEED-025]
related: [SEED-033]
---

# SEED-036: Pipeline Workflow Automation

Conecta o sistema de pipeline ao motor de workflows, expondo todos os eventos
do ciclo de vida de uma oportunidade como triggers acionáveis — incluindo
condições temporais ("X dias no stage Y") e ações que modificam o próprio pipeline.

---

## Diagnóstico atual (Auditoria 2026-05-20)

### O que já existe

| Componente | Estado |
|-----------|--------|
| `opportunity_activities` com tipos `stage_change`, `won`, `lost`, `note`, `call`, `created` | ✅ |
| `moveOpportunity()` cria activity automaticamente | ✅ |
| `event_dispatches` table (audit trail de eventos) | ✅ |
| Infra de eventos do calendar (`emitCalendarEvent` + matching por trigger_config) | ✅ |
| `scheduled_workflow_ticks` para eventos time-based (meeting.starts_in) | ✅ |
| Workflow spec com triggers de evento (`event:meeting.*`) | ✅ |

### O que falta

| Gap | Impacto |
|-----|---------|
| Nenhum `event:opportunity.*` trigger na spec | Workflows não podem reagir ao pipeline |
| `moveOpportunity()` não emite eventos para workflow engine | Stage change não ativa nada |
| `createOpportunity()` não emite eventos | Novo lead não ativa nada |
| Sem scheduler time-based para oportunidades | "X dias no stage" impossível |
| Sem actions de pipeline nos workflows | Não dá para mover/atualizar oportunidade via workflow |
| `updateOpportunity()` não loga atividade | Mudanças de campo são silenciosas |

---

## Levantamento completo de eventos e ações

### Eventos (Triggers)

Todos os eventos naturais do pipeline que devem ser expostos como triggers:

#### Eventos imediatos (disparados no momento da ação)

| Trigger | Quando dispara | Variáveis disponíveis |
|---------|---------------|----------------------|
| `event:opportunity.created` | Nova oportunidade inserida | `opportunity.*`, `contact.*`, `account.*`, `stage.*`, `pipeline.*` |
| `event:opportunity.stage_changed` | Oportunidade movida de stage | `opportunity.*`, `stage.from.*`, `stage.to.*`, `contact.*` |
| `event:opportunity.won` | Movida para stage `is_won=true` | `opportunity.*`, `contact.*`, `account.*`, `stage.*` |
| `event:opportunity.lost` | Movida para stage `is_lost=true` | `opportunity.*`, `contact.*`, `account.*`, `stage.*` |
| `event:opportunity.updated` | Campo editado (valor, título, data, assigned, custom_field) | `opportunity.*`, `changes.*` (diff de campos alterados), `contact.*` |
| `event:opportunity.note_added` | Nota adicionada via `addNote()` | `opportunity.*`, `note.content`, `contact.*` |
| `event:opportunity.call_logged` | Ligação vinculada (DB trigger) | `opportunity.*`, `call.*` (direction, duration, recording_url), `contact.*` |
| `event:opportunity.contact_assigned` | `contact_id` alterado | `opportunity.*`, `contact.new.*`, `contact.old.*` |
| `event:opportunity.deleted` | Oportunidade excluída | `opportunity.id`, `opportunity.title`, `opportunity.value`, `stage.*` |
| `event:opportunity.assigned` | `assigned_to` alterado | `opportunity.*`, `user.new.*`, `user.old.*` |
| `event:opportunity.value_changed` | `value` alterado (subset de updated) | `opportunity.*`, `value.old`, `value.new`, `contact.*` |

#### Eventos temporais (time-based, via scheduler)

| Trigger | Quando dispara | Config | Variáveis |
|---------|---------------|--------|-----------|
| `event:opportunity.aged_in_stage` | Oportunidade está no mesmo stage há N dias | `{ days: number, stage_id?: string }` | `opportunity.*`, `days_in_stage`, `contact.*` |
| `event:opportunity.no_activity` | Sem atividade há N dias | `{ days: number }` | `opportunity.*`, `days_since_last_activity`, `contact.*` |
| `event:opportunity.close_date_approaching` | N dias antes de `expected_close_date` | `{ days_before: number }` | `opportunity.*`, `days_until_close`, `contact.*` |
| `event:opportunity.close_date_passed` | `expected_close_date` passou e status=open | `{}` | `opportunity.*`, `days_overdue`, `contact.*` |
| `event:opportunity.stale` | Não atualizada há N dias (updated_at) | `{ days: number }` | `opportunity.*`, `days_stale`, `contact.*` |

#### Eventos de pipeline (estrutura)

| Trigger | Quando |
|---------|--------|
| `event:pipeline.stage_created` | Novo stage adicionado |
| `event:pipeline.created` | Novo pipeline criado |

---

### Ações (Nodes de workflow no pipeline)

O que um workflow pode **fazer** no pipeline:

#### Mover / atualizar oportunidade

| Node | Descrição | Inputs |
|------|-----------|--------|
| `pipeline_move_opportunity` | Move para outro stage | `opportunity_id`, `stage_id` (ou `stage_name`) |
| `pipeline_update_opportunity` | Atualiza campos | `opportunity_id`, campos opcionais: `title`, `value`, `expected_close_date`, `assigned_to`, `status` |
| `pipeline_set_custom_field` | Atualiza um campo customizado | `opportunity_id`, `field_key`, `value` |
| `pipeline_mark_won` | Move para o primeiro stage `is_won=true` | `opportunity_id` |
| `pipeline_mark_lost` | Move para o primeiro stage `is_lost=true` | `opportunity_id` |
| `pipeline_add_note` | Adiciona nota à oportunidade | `opportunity_id`, `content` |
| `pipeline_assign_user` | Atribui responsável | `opportunity_id`, `user_id` |
| `pipeline_create_opportunity` | Cria nova oportunidade | `title`, `contact_id` ou `phone` (lookup), `stage_id` ou `stage_name`, `value?`, `pipeline_id?` |

#### Buscar dados do pipeline (para condições)

| Node | Descrição | Outputs |
|------|-----------|---------|
| `pipeline_get_opportunity` | Busca oportunidade por ID ou contact_id | `opportunity.*`, `stage.*` |
| `pipeline_find_opportunity` | Busca por contact phone/email | `opportunity.*` ou `null` |

#### Exemplos de fluxos completos

**"Lead parado há 3 dias → enviar WhatsApp de follow-up"**
```yaml
trigger:
  type: event
  config:
    event_type: opportunity.aged_in_stage
    days: 3
    stage_name: Lead         # opcional — só para esse stage
nodes:
  - id: check_not_won
    kind: condition
    expression: "{{opportunity.status}} == 'open'"
  - id: send_followup
    kind: send_whatsapp_message
    integration: evolution
    to: "{{contact.phone}}"
    text: |
      Olá {{contact.name}}, tudo bem?
      Vi que ainda não tivemos retorno sobre {{opportunity.title}}.
      Podemos conversar? 😊
  - id: add_note
    kind: pipeline_add_note
    opportunity_id: "{{opportunity.id}}"
    content: "Follow-up automático enviado via WhatsApp (3 dias no stage Lead)"
edges:
  - from: trigger
    to: check_not_won
  - from: check_not_won
    to: send_followup
    condition: "true"
  - from: send_followup
    to: add_note
```

**"Lead ganho → notificar Telegram + criar tarefa de onboarding"**
```yaml
trigger:
  type: event
  config:
    event_type: opportunity.won
nodes:
  - id: notify_telegram
    kind: send_telegram_notification
    integration: telegram
    text: |
      🏆 <b>Deal Ganho!</b>
      👤 {{contact.name}}
      💰 R$ {{opportunity.value}}
      📋 {{opportunity.title}}
    parse_mode: HTML
  - id: move_to_onboarding
    kind: pipeline_move_opportunity
    opportunity_id: "{{opportunity.id}}"
    stage_name: Onboarding
edges:
  - from: trigger
    to: notify_telegram
  - from: notify_telegram
    to: move_onboarding
```

**"Lead sem atividade há 7 dias → mover para 'Frio'"**
```yaml
trigger:
  type: event
  config:
    event_type: opportunity.no_activity
    days: 7
nodes:
  - id: check_open
    kind: condition
    expression: "{{opportunity.status}} == 'open'"
  - id: move_cold
    kind: pipeline_move_opportunity
    opportunity_id: "{{opportunity.id}}"
    stage_name: Frio
edges:
  - from: trigger
    to: check_open
  - from: check_open
    to: move_cold
    condition: "true"
```

---

## Implementação

### Parte 1 — Emissão de eventos

#### 1A — `emitOpportunityEvent()` helper

```ts
// src/lib/pipeline/events.ts — NEW

export type OpportunityEventType =
  | 'opportunity.created'
  | 'opportunity.stage_changed'
  | 'opportunity.won'
  | 'opportunity.lost'
  | 'opportunity.updated'
  | 'opportunity.note_added'
  | 'opportunity.call_logged'
  | 'opportunity.assigned'
  | 'opportunity.value_changed'
  | 'opportunity.deleted'

export async function emitOpportunityEvent(
  orgId: string,
  eventType: OpportunityEventType,
  payload: OpportunityEventPayload,
): Promise<void>

// Usa a mesma infra do calendar:
// 1. INSERT event_dispatches (audit)
// 2. Query workflows WHERE trigger_type='event' AND trigger_config->>event_type = eventType
// 3. Para cada workflow encontrado: runWorkflow(definition, payload)
// 4. Cascade depth check (MAX 3)
```

#### 1B — Instrumentar as server actions

```ts
// src/app/(dashboard)/pipeline/actions.ts — EDIT

// createOpportunity(): após insert bem-sucedido:
await emitOpportunityEvent(orgId, 'opportunity.created', {
  opportunity: newOpp, contact, account, stage, pipeline,
})

// moveOpportunity(): após update bem-sucedido:
const eventType = destStage.is_won ? 'opportunity.won'
  : destStage.is_lost ? 'opportunity.lost'
  : 'opportunity.stage_changed'

await emitOpportunityEvent(orgId, eventType, {
  opportunity: updatedOpp,
  stage: { from: fromStage, to: destStage },
  contact, account, pipeline,
})

// updateOpportunity(): registrar atividade + emitir evento
// (atualmente updateOpportunity não loga nenhuma atividade — corrigir aqui)
const changedFields = diffOpportunity(before, after)
if (changedFields.assigned_to) {
  await emitOpportunityEvent(orgId, 'opportunity.assigned', { ... })
}
if (changedFields.value) {
  await emitOpportunityEvent(orgId, 'opportunity.value_changed', { ... })
}
await emitOpportunityEvent(orgId, 'opportunity.updated', {
  opportunity: updatedOpp, changes: changedFields, contact,
})

// addNote(): após insert da activity:
await emitOpportunityEvent(orgId, 'opportunity.note_added', {
  opportunity, note: { content }, contact,
})

// deleteOpportunity(): antes do delete:
await emitOpportunityEvent(orgId, 'opportunity.deleted', {
  opportunity: { id, title, value }, stage, pipeline,
})
```

#### 1C — DB trigger para call_logged

O trigger de `call_logs → opportunity_activities` já existe.
Adicionar chamada ao event dispatcher após insert da activity:

```sql
-- Na função fn_call_log_to_opportunity_activity():
-- Inserir em event_dispatch_queue (nova tabela assíncrona) para processar
-- fora da transaction do call_log
```

Ou: processar via `after()` no webhook handler de call status do Twilio/Vapi.

---

### Parte 2 — Scheduler time-based

#### 2A — `scheduled_opportunity_ticks` table

```sql
-- 098_pipeline_workflow_automation.sql

CREATE TABLE scheduled_opportunity_ticks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id       UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  opportunity_id    UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  event_type        TEXT NOT NULL,
  fire_at           TIMESTAMPTZ NOT NULL,
  fired             BOOLEAN NOT NULL DEFAULT false,
  fired_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sot_fire_idx ON scheduled_opportunity_ticks(fire_at)
  WHERE fired = false;
```

#### 2B — Como os ticks são agendados

Quando um workflow com trigger `opportunity.aged_in_stage` (days: 3) está ativo,
para cada oportunidade existente + nova:

```ts
// Ao ativar o workflow OU criar nova oportunidade:
// 1. Para cada oportunidade aberta no org:
//    fire_at = opportunity.updated_at (última mudança de stage) + 3 days
//    Se fire_at > now(): INSERT scheduled_opportunity_ticks
// 2. Quando oportunidade muda de stage: cancelar ticks antigos, criar novos
```

#### 2C — Cron que processa os ticks

```ts
// src/app/api/cron/scheduling-tick/route.ts — EDIT (já existe)
// Adicionar seção para pipeline ticks:

const dueTicks = await supabase
  .from('scheduled_opportunity_ticks')
  .select('*, opportunities!inner(*), workflows!inner(*)')
  .lte('fire_at', new Date().toISOString())
  .eq('fired', false)
  .limit(50)

for (const tick of dueTicks) {
  await emitOpportunityEvent(tick.org_id, tick.event_type as OpportunityEventType, {
    opportunity: tick.opportunities,
    days_in_stage: daysSince(tick.opportunities.updated_at),
    // ...
  })
  await supabase.from('scheduled_opportunity_ticks')
    .update({ fired: true, fired_at: new Date().toISOString() })
    .eq('id', tick.id)
}
```

#### 2D — Recálculo de ticks ao mudar de stage

```ts
// No moveOpportunity(), após o update:
// 1. DELETE scheduled_opportunity_ticks WHERE opportunity_id = id AND fired = false
// 2. Para cada workflow ativo com trigger aged_in_stage:
//    Calcular novo fire_at = now() + days
//    INSERT novo tick
```

---

### Parte 3 — Nodes de pipeline na workflow spec

```ts
// src/lib/workflows/spec.ts — EDIT

// Adicionar ao NODES array:
{
  kind: 'pipeline_move_opportunity',
  label: 'Move Opportunity to Stage',
  integration: null,           // built-in, sem integration externa
  inputs: {
    opportunity_id: { type: 'string', required: true },
    stage_id: { type: 'string', required: false, description: 'Stage UUID' },
    stage_name: { type: 'string', required: false, description: 'Stage name (case-insensitive lookup)' },
    // stage_id OU stage_name — o executor resolve qual usar
  },
},
{
  kind: 'pipeline_update_opportunity',
  label: 'Update Opportunity',
  integration: null,
  inputs: {
    opportunity_id: { type: 'string', required: true },
    title: { type: 'string', required: false },
    value: { type: 'number', required: false },
    expected_close_date: { type: 'string', required: false, description: 'ISO date YYYY-MM-DD' },
    assigned_to: { type: 'string', required: false, description: 'User UUID' },
    status: { type: 'string', required: false, enum: ['open', 'won', 'lost'] },
  },
},
{
  kind: 'pipeline_add_note',
  label: 'Add Note to Opportunity',
  integration: null,
  inputs: {
    opportunity_id: { type: 'string', required: true },
    content: { type: 'string', required: true },
  },
},
{
  kind: 'pipeline_create_opportunity',
  label: 'Create Opportunity',
  integration: null,
  inputs: {
    title: { type: 'string', required: true },
    pipeline_id: { type: 'string', required: false, description: 'Defaults to org default pipeline' },
    stage_id: { type: 'string', required: false },
    stage_name: { type: 'string', required: false },
    contact_id: { type: 'string', required: false },
    contact_phone: { type: 'string', required: false, description: 'Lookup contact by phone if contact_id not known' },
    value: { type: 'number', required: false },
    assigned_to: { type: 'string', required: false },
  },
},
{
  kind: 'pipeline_mark_won',
  label: 'Mark Opportunity as Won',
  integration: null,
  inputs: {
    opportunity_id: { type: 'string', required: true },
  },
},
{
  kind: 'pipeline_mark_lost',
  label: 'Mark Opportunity as Lost',
  integration: null,
  inputs: {
    opportunity_id: { type: 'string', required: true },
    reason: { type: 'string', required: false },
  },
},
{
  kind: 'pipeline_set_custom_field',
  label: 'Set Custom Field on Opportunity',
  integration: null,
  inputs: {
    opportunity_id: { type: 'string', required: true },
    field_key: { type: 'string', required: true },
    value: { type: 'string', required: true },
  },
},
```

#### Trigger spec para eventos de pipeline

```ts
// src/lib/workflows/spec.ts — EDIT (TRIGGERS array)

// Triggers imediatos
{
  type: 'event:opportunity.created',
  label: 'Opportunity Created',
  variables: ['opportunity', 'contact', 'account', 'stage', 'pipeline', 'trigger'],
},
{
  type: 'event:opportunity.stage_changed',
  label: 'Opportunity Stage Changed',
  variables: ['opportunity', 'stage.from', 'stage.to', 'contact', 'account', 'trigger'],
},
{
  type: 'event:opportunity.won',
  label: 'Opportunity Won',
  variables: ['opportunity', 'contact', 'account', 'stage', 'trigger'],
},
{
  type: 'event:opportunity.lost',
  label: 'Opportunity Lost',
  variables: ['opportunity', 'contact', 'account', 'stage', 'trigger'],
},
{
  type: 'event:opportunity.updated',
  label: 'Opportunity Updated',
  variables: ['opportunity', 'changes', 'contact', 'trigger'],
},
{
  type: 'event:opportunity.note_added',
  label: 'Note Added to Opportunity',
  variables: ['opportunity', 'note', 'contact', 'trigger'],
},
{
  type: 'event:opportunity.call_logged',
  label: 'Call Logged to Opportunity',
  variables: ['opportunity', 'call', 'contact', 'trigger'],
},
{
  type: 'event:opportunity.assigned',
  label: 'Opportunity Assigned to User',
  variables: ['opportunity', 'user.new', 'user.old', 'contact', 'trigger'],
},

// Triggers temporais
{
  type: 'event:opportunity.aged_in_stage',
  label: 'Opportunity Aged in Stage',
  config_schema: {
    days: { type: 'number', required: true, description: 'Days in current stage' },
    stage_id: { type: 'string', required: false, description: 'Restrict to specific stage' },
    stage_name: { type: 'string', required: false, description: 'Restrict to stage by name' },
    pipeline_id: { type: 'string', required: false },
  },
  variables: ['opportunity', 'days_in_stage', 'contact', 'stage', 'trigger'],
},
{
  type: 'event:opportunity.no_activity',
  label: 'Opportunity Has No Activity',
  config_schema: {
    days: { type: 'number', required: true },
    pipeline_id: { type: 'string', required: false },
  },
  variables: ['opportunity', 'days_since_last_activity', 'contact', 'stage', 'trigger'],
},
{
  type: 'event:opportunity.close_date_approaching',
  label: 'Close Date Approaching',
  config_schema: {
    days_before: { type: 'number', required: true, description: 'Days before expected_close_date' },
  },
  variables: ['opportunity', 'days_until_close', 'contact', 'trigger'],
},
{
  type: 'event:opportunity.close_date_passed',
  label: 'Close Date Passed',
  config_schema: {},
  variables: ['opportunity', 'days_overdue', 'contact', 'trigger'],
},
{
  type: 'event:opportunity.stale',
  label: 'Opportunity Is Stale',
  config_schema: {
    days: { type: 'number', required: true, description: 'Days since last update (updated_at)' },
  },
  variables: ['opportunity', 'days_stale', 'contact', 'stage', 'trigger'],
},
```

---

### Parte 4 — Executores dos nodes de pipeline

```ts
// src/lib/action-engine/executors/pipeline/

pipeline-move-opportunity.ts    → chama moveOpportunity() (reusa server action logic)
pipeline-update-opportunity.ts  → chama updateOpportunity()
pipeline-add-note.ts            → chama addNote()
pipeline-create-opportunity.ts  → chama createOpportunity() com lookup de contact por phone
pipeline-mark-won.ts            → wrapper: encontra stage is_won, chama move
pipeline-mark-lost.ts           → wrapper: encontra stage is_lost, chama move
pipeline-set-custom-field.ts    → update direto em opportunities.custom_fields
```

**Importante:** os executores NÃO chamam as server actions diretamente (são server-only com `'use server'`).
Extrair a lógica de negócio para `src/lib/pipeline/operations.ts` e reutilizar tanto nas server actions quanto nos executores.

---

### Parte 5 — UI de automação no pipeline

#### Localização

Nova aba "Automations" em `/pipeline/settings`:
```
Tabs: [Stages] [Card Layout] [Automations]
```

#### Layout da aba

```
┌─────────────────────────────────────────────────────────────────┐
│  Automations                                          [+ New]   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ⚡ Follow-up 3 dias no Lead            [●] Ativo  [···] │   │
│  │  Trigger: Aged in stage "Lead" (3 days)               │   │
│  │  Actions: Send WhatsApp → Add note                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ⚡ Deal Ganho → Telegram              [●] Ativo  [···] │   │
│  │  Trigger: Opportunity Won                              │   │
│  │  Actions: Send Telegram notification                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Templates sugeridos:                                           │
│  [Lead parado 3 dias]  [Deal ganho → Slack]  [Close date alert] │
└─────────────────────────────────────────────────────────────────┘
```

`[+ New]` abre o editor de workflow com trigger pré-selecionado como `event:opportunity.*`.

Os templates sugeridos são seeds de workflow `kind='flow'` com placeholders.

---

### Parte 6 — Variáveis de pipeline disponíveis nos workflows

```ts
// Namespace 'opportunity' (disponível quando trigger é evento de pipeline)
opportunity.id
opportunity.title
opportunity.value             // number
opportunity.currency          // 'BRL', 'USD', etc.
opportunity.status            // 'open' | 'won' | 'lost'
opportunity.expected_close_date  // ISO date string
opportunity.assigned_to       // UUID do usuário
opportunity.created_at
opportunity.updated_at
opportunity.custom_fields.*   // campos customizados (ex: opportunity.custom_fields.prioridade)

// Namespace 'contact' (do contato vinculado à oportunidade)
contact.id
contact.name
contact.phone
contact.email
contact.company

// Namespace 'account' (da empresa vinculada, se houver)
account.id
account.name
account.domain
account.industry

// Namespace 'stage'
stage.id
stage.name
stage.color
stage.is_won
stage.is_lost

// Namespace 'stage.from' / 'stage.to' (apenas em stage_changed)
stage.from.name
stage.to.name

// Namespace 'pipeline'
pipeline.id
pipeline.name

// Namespace 'trigger' (meta)
trigger.fired_at
trigger.days_in_stage         // só em aged_in_stage
trigger.days_since_last_activity  // só em no_activity
trigger.days_until_close      // só em close_date_approaching
trigger.days_overdue          // só em close_date_passed
```

---

### Nota sobre SEED-033

SEED-033 define como **agentes** usam workflows como ferramentas.
Este seed (036) define como **eventos do pipeline** ativam workflows automaticamente.

São complementares: um agente pode chamar `pipeline_move_opportunity` como tool (SEED-033),
e um evento de pipeline pode acionar um workflow que usa `send_whatsapp_message` (SEED-036).

Se surgir necessidade de estender o contrato do SEED-033 por causa deste seed
(ex: novos tipos de variável de contexto), criar **SEED-033.1** separado.

---

## Seeds de workflow padrão

```yaml
# supabase/seeds/workflows/pipeline-aged-lead-followup.yaml
name: Follow-up Lead Parado (3 dias)
kind: flow
trigger:
  type: event:opportunity.aged_in_stage
  config:
    days: 3
    stage_name: Lead
# ... (ver exemplo completo na seção de exemplos acima)
```

```yaml
# supabase/seeds/workflows/pipeline-won-notification.yaml
name: Deal Ganho — Notificar Time
kind: flow
trigger:
  type: event:opportunity.won
# ... send_telegram_notification se telegram conectado
```

```yaml
# supabase/seeds/workflows/pipeline-close-date-alert.yaml
name: Alerta de Data de Fechamento
kind: flow
trigger:
  type: event:opportunity.close_date_approaching
  config:
    days_before: 3
# ... send_whatsapp_message ao responsável
```

---

## Arquivos

```
supabase/migrations/
└── 098_pipeline_workflow_automation.sql   NEW: scheduled_opportunity_ticks

supabase/seeds/workflows/
├── pipeline-aged-lead-followup.yaml       NEW: template
├── pipeline-won-notification.yaml         NEW: template
└── pipeline-close-date-alert.yaml         NEW: template

src/lib/pipeline/
├── events.ts                              NEW: emitOpportunityEvent()
├── operations.ts                          NEW: lógica de negócio extraída das server actions
└── tick-scheduler.ts                      NEW: agenda/cancela ticks ao criar/mover opp

src/lib/action-engine/executors/pipeline/
├── move-opportunity.ts                    NEW
├── update-opportunity.ts                  NEW
├── add-note.ts                            NEW
├── create-opportunity.ts                  NEW
├── mark-won.ts                            NEW
├── mark-lost.ts                           NEW
└── set-custom-field.ts                    NEW

src/lib/workflows/spec.ts                  EDIT: triggers + nodes de pipeline
src/lib/action-engine/execute-action.ts    EDIT: rotear novos action types

src/app/(dashboard)/pipeline/
├── actions.ts                             EDIT: emitOpportunityEvent() após cada mutação
└── settings/page.tsx                      EDIT: aba Automations

src/app/api/cron/scheduling-tick/route.ts  EDIT: processar scheduled_opportunity_ticks

src/components/pipeline/
└── automations-tab.tsx                    NEW: lista + templates de automações no pipeline
```

---

## Critérios de sucesso

1. ✅ Criar oportunidade → workflow com trigger `opportunity.created` executa
2. ✅ Mover para stage "Won" → workflow com trigger `opportunity.won` executa
3. ✅ Oportunidade 3 dias no stage "Lead" → tick dispara → WhatsApp enviado
4. ✅ `expected_close_date` em 3 dias → workflow de alerta executa
5. ✅ Node `pipeline_move_opportunity` dentro de workflow move a oportunidade corretamente
6. ✅ Node `pipeline_add_note` adiciona nota e cria activity no feed
7. ✅ Templates de automação aparecem na aba "Automations" do pipeline settings
8. ✅ Variáveis `{{opportunity.title}}`, `{{contact.phone}}` resolvidas corretamente no payload
9. ✅ Cascade depth check impede loops (workflow move → stage_changed → move → ...)
10. ✅ Tick cancelado ao mover oportunidade de stage (evita disparo tardio)
11. ✅ `npm run build` passa sem erros de tipo
