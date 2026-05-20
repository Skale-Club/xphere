---
id: SEED-033
status: planted
planted: 2026-05-20
trigger_when: now (autonomous execution)
scope: Large
priority: critical
depends_on: [SEED-025]
blocks: []
---

# SEED-033: Agentes + Workflows — Autorização, Resolução e Execução

Conecta o agent runtime ao workflow engine para que agentes possam descobrir,
ser autorizados a usar, e executar workflows como ferramentas nativas.
Cobre tanto `kind='tool'` (single-action) quanto `kind='flow'` (DAG multi-step).

---

## Contexto: o que já existe e o que falta

### O que existe (base sólida)

| Componente | Estado |
|-----------|--------|
| `resolveWorkflowAsTool()` — converte workflow em shape de tool_config | ✅ existe em `resolve.ts` |
| `resolveTool()` — feature-flagged bridge (UNIFIED_WORKFLOW_ENGINE) | ✅ existe em `resolve-tool.ts` |
| `executeAction()` — dispatcher que já executa workflows | ✅ existe |
| `kind='tool'` workflows — invocáveis por nome | ✅ schema definido |
| `kind='flow'` workflows — DAG multi-step | ✅ schema definido (engine parcial) |
| `agent_tools(agent_id, tool_config_id)` — autorização legada | ✅ existe |

### O que falta (o gap)

| Gap | Impacto |
|----|---------|
| `agent_tools` não tem coluna `workflow_id` | Não dá para autorizar um workflow a um agente |
| `resolveAgentTool()` não consulta `workflows` | Mesmo que autorizado, tool não resolve |
| Build de tools no LLM não inclui workflows | Agente não "vê" workflows como tools |
| Nenhuma UI para anexar workflow a agente | Não tem como configurar pelo painel |
| Sistema não injeta workflows disponíveis no system prompt | Agente não sabe que workflows existem |
| `kind='flow'` sem mecanismo de input/output para agents | DAGs não podem ser chamados por agentes |

---

## Arquitetura da solução

### Modelo mental

```
Agente começa um turno
    │
    ├─ Build de tools para o LLM
    │    ├─ [legacy] tool_configs com agent_tools.tool_config_id
    │    └─ [novo]   workflows (kind='tool' | kind='flow') com agent_tools.workflow_id
    │
    ├─ LLM decide chamar uma tool
    │    └─ tool name = workflow.tool_name
    │
    ├─ resolveAgentTool(agentId, toolName, channel)
    │    ├─ Tenta em agent_tools → tool_configs (legacy, sem mudança)
    │    └─ [novo] Tenta em agent_tools → workflows
    │
    └─ executeAction() / runWorkflow()
         ├─ kind='tool' → action single-step (já funciona)
         └─ kind='flow' → flow engine (novo executor com retorno)
```

---

## Modelo de dados

### Migração 095 — Estender `agent_tools`

```sql
-- 095_agent_workflow_tools.sql

-- 1. Adicionar coluna workflow_id à tabela agent_tools
ALTER TABLE agent_tools
  ADD COLUMN workflow_id UUID REFERENCES workflows(id) ON DELETE CASCADE;

-- 2. Garantir que cada linha tem exatamente um dos dois FKs (XOR)
ALTER TABLE agent_tools
  ADD CONSTRAINT agent_tools_xor_source
  CHECK (
    (tool_config_id IS NOT NULL AND workflow_id IS NULL) OR
    (tool_config_id IS NULL AND workflow_id IS NOT NULL)
  );

-- 3. Unicidade por agente (um workflow, uma vez)
CREATE UNIQUE INDEX agent_tools_workflow_unique
  ON agent_tools(agent_id, workflow_id)
  WHERE workflow_id IS NOT NULL;

-- 4. View unificada para queries simples
CREATE OR REPLACE VIEW agent_tools_resolved AS
SELECT
  at.id,
  at.organization_id,
  at.agent_id,
  at.allowed_channels,
  at.created_at,
  'tool_config' AS source,
  tc.tool_name,
  tc.action_type::text,
  tc.config,
  tc.is_active,
  tc.id AS source_id,
  NULL::uuid AS workflow_id
FROM agent_tools at
JOIN tool_configs tc ON tc.id = at.tool_config_id
WHERE at.tool_config_id IS NOT NULL

UNION ALL

SELECT
  at.id,
  at.organization_id,
  at.agent_id,
  at.allowed_channels,
  at.created_at,
  'workflow' AS source,
  w.tool_name,
  w.kind::text AS action_type,
  wv.definition AS config,
  w.is_active,
  w.id AS source_id,
  w.id AS workflow_id
FROM agent_tools at
JOIN workflows w ON w.id = at.workflow_id
JOIN workflow_versions wv ON wv.id = w.current_version_id
WHERE at.workflow_id IS NOT NULL;
```

### Backfill: tool_configs com `legacy_tool_config_id` em workflows

```sql
-- Para agentes que já usam uma tool_config que foi migrada para workflow
-- (existe correspondência por legacy_tool_config_id), criar entrada dual
-- agent_tools apontando para o workflow.
-- Rodar como migração one-shot, idempotente.

INSERT INTO agent_tools (organization_id, agent_id, workflow_id, allowed_channels, created_at)
SELECT
  at.organization_id,
  at.agent_id,
  w.id AS workflow_id,
  at.allowed_channels,
  now()
FROM agent_tools at
JOIN workflows w ON w.legacy_tool_config_id = at.tool_config_id
WHERE NOT EXISTS (
  SELECT 1 FROM agent_tools at2
  WHERE at2.agent_id = at.agent_id AND at2.workflow_id = w.id
);
```

---

## Resolução de tools

### `resolveAgentTool()` atualizado

```ts
// src/lib/agent-runtime/resolve-agent-tool.ts — EDIT

export async function resolveAgentTool(
  agentId: string,
  toolName: string,
  channel: AgentChannel,
): Promise<ResolvedToolConfig | null> {

  // ── 1. Tenta caminho legado (tool_configs) ──────────────────────────────
  const { data: legacyRow } = await supabase
    .from('agent_tools')
    .select(`
      id, allowed_channels,
      tool_configs!inner(
        id, tool_name, action_type, config, is_active,
        integrations(id, encrypted_api_key, location_id, provider, config)
      )
    `)
    .eq('agent_id', agentId)
    .eq('tool_configs.tool_name', toolName)
    .eq('tool_configs.is_active', true)
    .is('workflow_id', null)
    .maybeSingle()

  if (legacyRow) {
    if (!isChannelAllowed(legacyRow.allowed_channels, channel)) return null
    return mapToolConfigToResolved(legacyRow.tool_configs)
  }

  // ── 2. Tenta caminho workflow ───────────────────────────────────────────
  const { data: workflowRow } = await supabase
    .from('agent_tools')
    .select(`
      id, allowed_channels,
      workflows!inner(
        id, tool_name, kind, is_active, health_blocked,
        workflow_versions!current_version_id(definition)
      )
    `)
    .eq('agent_id', agentId)
    .eq('workflows.tool_name', toolName)
    .eq('workflows.is_active', true)
    .eq('workflows.health_blocked', false)
    .is('tool_config_id', null)
    .maybeSingle()

  if (workflowRow) {
    if (!isChannelAllowed(workflowRow.allowed_channels, channel)) return null
    return mapWorkflowToResolved(workflowRow.workflows)
  }

  return null
}
```

### `mapWorkflowToResolved()` — workflow → ResolvedToolConfig

```ts
function mapWorkflowToResolved(workflow: WorkflowRow): ResolvedToolConfig {
  const definition = workflow.workflow_versions.definition

  return {
    toolConfigId: workflow.id,
    toolName: workflow.tool_name,
    // Para kind='tool': mapeia para action_type do node principal
    // Para kind='flow': action_type especial 'run_flow'
    actionType: workflow.kind === 'tool'
      ? extractActionTypeFromDefinition(definition)
      : 'run_flow',
    config: definition,
    integrationId: null,         // credentials são resolvidas dentro do flow engine
    integrationProvider: null,
    credentialsEncrypted: null,
    workflowId: workflow.id,
    workflowKind: workflow.kind,
  }
}
```

---

## Build de tools para o LLM

### Geração de `dynamicTool()` para workflows

```ts
// src/lib/agent-runtime/run-agent.ts — EDIT (na seção de build de tools)

// Fetch workflows autorizados para este agente
const { data: workflowTools } = await supabase
  .from('agent_tools')
  .select(`
    id, allowed_channels,
    workflows!inner(
      id, name, tool_name, description, kind,
      workflow_versions!current_version_id(definition)
    )
  `)
  .eq('agent_id', agentId)
  .eq('workflows.is_active', true)
  .eq('workflows.health_blocked', false)
  .is('tool_config_id', null)

for (const wt of workflowTools ?? []) {
  if (!isChannelAllowed(wt.allowed_channels, channel)) continue
  const wf = wt.workflows

  // Derivar input schema a partir do trigger.variables do workflow
  const inputSchema = deriveWorkflowInputSchema(wf.workflow_versions.definition)

  tools[wf.tool_name] = dynamicTool({
    description: wf.description ?? `Execute the workflow: ${wf.name}`,
    parameters: inputSchema,
    async execute(args) {
      // Verificar autorização (mesmo fluxo dos tool_configs)
      const resolved = await resolveAgentTool(agentId, wf.tool_name, channel)
      if (!resolved) return { error: 'Workflow not authorized for this channel.' }

      // Idempotência para flows com side-effects
      if (wf.kind === 'flow') {
        const idempKey = deriveIdempotencyKey(invocationId, toolCallIndex)
        const cached = await lookupIdempotency(idempKey)
        if (cached) return cached
      }

      // Executar
      const result = await executeWorkflowTool({
        workflowId: wf.id,
        kind: wf.kind,
        definition: wf.workflow_versions.definition,
        input: args,
        context: { orgId, conversationId, channel, agentId },
      })

      if (wf.kind === 'flow') {
        await recordIdempotency(idempKey, result)
      }

      return result
    }
  })
}
```

### `deriveWorkflowInputSchema()` — schema de input para o LLM

```ts
// Lê o trigger.variables do workflow definition
// Transforma em Zod schema para o ai-sdk

function deriveWorkflowInputSchema(definition: WorkflowDefinition): z.ZodObject<...> {
  const triggerVars = definition.trigger?.input_schema ?? {}
  // input_schema: { to: { type: 'string', description: '...', required: true }, ... }

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, meta] of Object.entries(triggerVars)) {
    let field: z.ZodTypeAny = meta.type === 'number' ? z.number() : z.string()
    if (meta.description) field = field.describe(meta.description)
    if (!meta.required) field = field.optional()
    shape[key] = field
  }
  return z.object(shape)
}
```

**Implicação:** O workflow definition precisa declarar um `input_schema` no trigger quando `kind='tool'` ou `kind='flow'`. O validator já pode ser atualizado para exigir isso quando `trigger.type = 'tool_call'`.

---

## Execução de workflows pelo agente

### `executeWorkflowTool()` — dispatcher

```ts
// src/lib/agent-runtime/execute-workflow-tool.ts — NEW

export async function executeWorkflowTool(params: {
  workflowId: string
  kind: 'tool' | 'flow'
  definition: WorkflowDefinition
  input: Record<string, unknown>
  context: AgentContext
}): Promise<WorkflowToolResult> {

  if (params.kind === 'tool') {
    // === kind='tool' ===
    // Single-action: delega direto ao action engine
    // Caminho idêntico ao legado, sem mudança
    const actionNode = params.definition.nodes.find(n => n.id !== 'trigger')
    return executeAction({
      actionType: actionNode.kind,
      config: { ...actionNode, ...params.input },
      context: params.context,
    })
  }

  if (params.kind === 'flow') {
    // === kind='flow' ===
    // Multi-step DAG: executa o flow engine de forma síncrona (timeout: 30s)
    // Retorna resultado do nó terminal ou status intermediário
    return runFlowSync({
      workflowId: params.workflowId,
      definition: params.definition,
      triggerInput: params.input,
      context: params.context,
      timeoutMs: 30_000,
    })
  }
}
```

### `runFlowSync()` — execução síncrona de DAG

Para flows chamados por agentes, precisamos de execução síncrona com timeout razoável.
Flows longos (com nó `wait`) não são adequados para chamada por agente.

```ts
// src/lib/workflows/run-flow-sync.ts — NEW

export async function runFlowSync(params: {
  workflowId: string
  definition: WorkflowDefinition
  triggerInput: Record<string, unknown>
  context: AgentContext
  timeoutMs: number
}): Promise<{ ok: boolean; result?: unknown; error?: string; timed_out?: boolean }>

// Pipeline:
// 1. Construir grafo de execução (topological sort)
// 2. Executar nós em ordem, passando variáveis entre eles
// 3. Nó 'wait' dentro de um flow chamado por agente → retornar imediatamente
//    com { ok: true, result: "Workflow started, will continue in background.", run_id }
// 4. Timeout via Promise.race(runGraph(), delay(timeoutMs))
// 5. Registrar workflow_run no banco (para auditoria)
```

**Contratos de resultado:**
```ts
// Sucesso síncrono (flow curto, < 30s):
{ ok: true, result: { ... } }

// Flow tem nó 'wait' ou timeout:
{ ok: true, result: "Workflow started. Run ID: {run_id}. It will complete in the background." }

// Erro de validação de input:
{ ok: false, error: "Missing required field: to" }

// Erro de execução:
{ ok: false, error: "SMS send failed: invalid number" }
```

---

## Sistema prompt — injeção de workflows disponíveis

### Contexto injetado automaticamente

```ts
// src/lib/agent-runtime/run-agent.ts — EDIT (na seção de system prompt)

// Após fetch dos workflow tools:
if (workflowTools && workflowTools.length > 0) {
  const workflowSummary = workflowTools.map(wt => {
    const wf = wt.workflows
    return `- **${wf.tool_name}**: ${wf.description ?? wf.name} (${wf.kind === 'flow' ? 'multi-step flow' : 'action'})`
  }).join('\n')

  systemPromptSuffix += `

## Available Workflows
You have access to the following workflows as tools. Call them when appropriate:
${workflowSummary}

When calling a workflow tool, provide only the required input fields. The system handles execution and will return the result.`
}
```

Este bloco é **append-only** — vai depois do system prompt base + channel override + KB.

---

## UI — Painel de agentes

### Aba "Tools" no editor de agente

```
┌─────────────────────────────────────────────────────────────────┐
│  Tools & Workflows                                              │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Attached (5)                                             │  │
│  │                                                           │  │
│  │  [🔧] send_sms         tool_config  · All channels  [×]  │  │
│  │  [⚡] send_appt_sms    workflow     · All channels  [×]  │  │
│  │  [⚡] qualify_lead     workflow     · SMS, WA       [×]  │  │
│  │  [🔧] create_contact   tool_config  · All channels  [×]  │  │
│  │  [⚡] book_appointment  flow        · All channels  [×]  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [+ Add tool]  [+ Add workflow]                                 │
└─────────────────────────────────────────────────────────────────┘
```

- `[🔧]` = tool_config legado
- `[⚡]` = workflow kind='tool'
- `[⚡]` (negrito) = workflow kind='flow'
- `[×]` remove a autorização
- `+ Add workflow` abre combobox com workflows `kind='tool'` e `kind='flow'` disponíveis no org

### Server actions

```ts
// src/app/(dashboard)/agents/[id]/actions.ts — EDIT

export async function attachWorkflowToAgent(
  agentId: string,
  workflowId: string,
  allowedChannels?: AgentChannel[],
): Promise<{ error?: string } | void>

export async function detachWorkflowFromAgent(
  agentId: string,
  workflowId: string,
): Promise<{ error?: string } | void>
```

---

## Alterações no workflow authoring

### `input_schema` no trigger (obrigatório para tool_call)

Quando um workflow tem `trigger.type = 'tool_call'`, o validator passa a exigir `input_schema`:

```yaml
# Antes (sem input_schema):
trigger:
  type: tool_call
  config:
    tool_name: send_appointment_sms

# Depois:
trigger:
  type: tool_call
  config:
    tool_name: send_appointment_sms
    input_schema:
      to:
        type: string
        description: Phone number in E.164 format
        required: true
      body:
        type: string
        description: SMS text content
        required: true
```

O `input_schema` alimenta:
1. `deriveWorkflowInputSchema()` → Zod schema para o LLM
2. Validação de variáveis (`{{input.to}}`, `{{input.body}}`) no validator
3. Documentação na spec (`GET /api/workflows/spec`)

### `output_schema` (opcional, recomendado para flows)

```yaml
trigger:
  type: tool_call
  config:
    tool_name: book_appointment
    input_schema:
      contact_id: { type: string, required: true }
      slot_iso: { type: string, required: true, description: "ISO 8601 datetime" }
    output_schema:
      booking_id: { type: string }
      confirmation_url: { type: string }
      status: { type: string, enum: [confirmed, pending] }
```

O `output_schema` é informativo para o LLM e para documentação — não valida o resultado em runtime nessa versão.

---

## Guardrails específicos para workflow tools

### Timeout por kind

| Kind | Timeout | Comportamento no estouro |
|------|---------|--------------------------|
| `tool` | 8s (herda do agente) | Erro retornado ao LLM |
| `flow` (sem wait) | 30s | Erro retornado ao LLM |
| `flow` (com wait) | Imediato | Retorna run_id, background |

### Loop cap

`kind='flow'` conta como **um** LLM call para fins do `MAX_LLM_CALLS_PER_TURN` (default 6), independente de quantos nós tem.

### health_blocked

Se `workflows.health_blocked = true`, o tool não é nem incluído no build — não aparece para o LLM. O sistema prompt não menciona o workflow nesse caso.

### Idempotência para flows

`kind='flow'` com side-effects (send_sms, create_contact, etc.) fica sujeito ao mesmo `tool_call_idempotency` já existente. Key = `deriveIdempotencyKey(invocationId, toolCallIndex)`.

---

## Arquivos

```
supabase/migrations/
└── 095_agent_workflow_tools.sql           NEW: workflow_id em agent_tools + view unificada

src/lib/agent-runtime/
├── run-agent.ts                           EDIT: build tools inclui workflows + system prompt suffix
├── resolve-agent-tool.ts                  EDIT: tenta workflow se tool_config não encontrar
├── execute-workflow-tool.ts               NEW: dispatcher kind='tool' | kind='flow'
└── types.ts                               EDIT: ResolvedToolConfig + workflowId, workflowKind

src/lib/workflows/
├── run-flow-sync.ts                       NEW: executor síncrono de DAG com timeout
├── validate.ts                            EDIT: input_schema obrigatório para tool_call trigger
└── spec.ts                                EDIT: incluir input_schema/output_schema na spec

src/app/(dashboard)/agents/[id]/
├── actions.ts                             EDIT: attachWorkflowToAgent, detachWorkflowFromAgent
└── components/tools-tab.tsx              EDIT: lista unificada tool_config + workflow, badge kind

WORKFLOWS.md                               EDIT: documentar input_schema, output_schema, uso por agentes
```

---

## Sequência de execução completa (exemplo)

```
Usuário envia "Quero agendar uma consulta para amanhã às 14h"

runAgent({channel:'whatsapp', ...})
  │
  ├─ Build tools:
  │    • send_sms (tool_config)
  │    • book_appointment (workflow, kind='flow')   ← NOVO
  │
  ├─ System prompt inclui:
  │    "## Available Workflows
  │     - book_appointment: Books a consultation slot (multi-step flow)"
  │
  ├─ LLM decide: tool_call book_appointment
  │    args: { contact_id: "abc", slot_iso: "2026-05-21T14:00:00-03:00" }
  │
  ├─ resolveAgentTool(agentId, 'book_appointment', 'whatsapp')
  │    → encontra via agent_tools.workflow_id → workflow row
  │
  ├─ executeWorkflowTool({ kind:'flow', input: args, ... })
  │    │
  │    └─ runFlowSync(definition, input, timeout=30s)
  │         ├─ Node: check_slot → disponível ✅
  │         ├─ Node: create_booking → booking_id=xyz
  │         ├─ Node: send_confirmation_sms → ok
  │         └─ Node: end → result: { booking_id, status:'confirmed' }
  │
  ├─ Tool result: { ok:true, result: { booking_id:'xyz', status:'confirmed' } }
  │
  └─ LLM responde: "Consulta agendada para amanhã às 14h! 
                    Você receberá uma confirmação por SMS."
```

---

## Critérios de sucesso

1. ✅ `agent_tools` aceita `workflow_id` com constraint XOR (um ou outro, nunca ambos)
2. ✅ `resolveAgentTool()` encontra workflows corretamente após tool_configs falhar
3. ✅ LLM recebe tools de workflows com schema de input correto
4. ✅ System prompt menciona workflows disponíveis automaticamente
5. ✅ `kind='tool'` workflow executado via agente produz mesmo resultado que chamada direta
6. ✅ `kind='flow'` workflow executado sincronamente retorna resultado ou run_id (se tem wait)
7. ✅ UI lista tool_configs e workflows juntos na aba Tools do agente
8. ✅ Attach/detach workflow via UI persiste corretamente em `agent_tools`
9. ✅ `health_blocked=true` remove workflow da lista de tools disponíveis
10. ✅ Workflows com `trigger.type='tool_call'` sem `input_schema` bloqueados pelo validator
11. ✅ Backfill migra agent_tools para workflows equivalentes (via legacy_tool_config_id)
12. ✅ `npm run build` passa sem erros de tipo
