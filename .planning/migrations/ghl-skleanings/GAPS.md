# GAPS — Produto Workflows do Xphere (auditoria p/ migração GHL)

> Gerado por auditoria multi-agente (6 dimensões, 50 achados) em 2026-05-29.
> Objetivo: documentar dificuldades/gaps que (a) bloqueiam a migração das automações
> GHL da Skleanings e (b) são oportunidades de melhoria do produto Workflows.
> Toda afirmação está ancorada em `file:line`.

---

## 🔴 Bloqueadores críticos (resolver primeiro)

| # | Gap | Dimensão | Evidência | Impacto |
|---|-----|----------|-----------|---------|
| 1 | **`condition` não é avaliado em runtime** — sempre pega o ramo "true"/primeira aresta | controlflow | `run-flow-sync.ts:278-280, 337-351` | **Qualquer** workflow com ramificação está quebrado. Afeta In Negotiation, Lost Contacts, Ghosting, lead-routing. Sem isso, "if" não funciona. |
| 2 | **Sem node `add_tag` / `remove_tag`** | nodes | `spec.ts:291-617` (ausente); `execute-action.ts:202` só tem manychat | Bloqueia Stage→Ghosting Tag, Quote Sent, Stand By, Ghosting, Lost Contacts. Tagueamento é o núcleo do GHL. |
| 3 | **Sem node `update_contact` / set custom field** | nodes | `spec.ts:395-417` só tem `create_contact` | Bloqueia "setar campo/status do contato" — final comum de muitas automações GHL. |
| 4 | **Sem API runtime para CRIAR workflows** (só validar) | authoring_dx | `api/workflows/` só tem `spec/` e `validate/`; criação é server-action `flows/_actions/workflows.ts:79-145` | Não dá pra criar os workflows programaticamente. Migração só via **seed YAML** (commit no repo) ou UI um-a-um. |

➡️ **Consequência para o plano:** os "diretos" da triagem **não são tão diretos** — qualquer um que ramifique depende do gap #1, e a criação em massa depende do #4 (caminho real = arquivos seed YAML versionados).

---

## 🟠 Alta severidade

| Gap | Dimensão | Evidência | Bloqueia |
|-----|----------|-----------|----------|
| `send_email` existe no action-engine mas **não está no spec** (logo, indisponível p/ autor) | nodes | `execute-action.ts:304-316` impl. vs `spec.ts` sem node | Confirmações/lembretes por email |
| Sem `assign_user` / `notify_internal_user` genérico | nodes | só `pipeline_assign_user` `spec.ts:554-565` | Roteamento de lead p/ equipe, avisos internos |
| Sem trigger `contact.tag_added` / `tag_removed` | triggers | `spec.ts:34-278` só tem `contact.created:71` | Stage→Ghosting Tag, Lost Contacts, Stand By |
| Sem trigger `contact.field_changed` | triggers | sem equivalente (cf. `opportunity.updated:151`) | Branch por campo do contato |
| Sem trigger `contact.inbound_message` (canal-agnóstico) | triggers | só `inbound_sms/call_to_number` Twilio `spec.ts:205-235` | Initial Contact, New Lead, Reminder (resposta em qualquer canal) |
| Sem trigger `contact.no_activity` / ghosting | triggers | só `opportunity.no_activity/stale:175-196` | Ghosting Automation, Lost Contacts |
| **Sem condições compostas (AND/OR/NOT)** | controlflow | `spec.ts:590-598` single string; `validate.ts:271-285` | "stage=X AND dias>3" etc. |
| **Sem `wait until event`** (só duração/timestamp) | controlflow | `spec.ts:600-611`; `workflow_waits` reservada mas não implementada `075:100-130` | "espera resposta OU N dias" — Post-Call, Ghosting, Quote Sent |
| Sem loops / iteração sobre arrays | controlflow | sem node foreach `spec.ts:291-617` | "enviar p/ todos com tag X" |
| Interpolação só string, **sem linguagem de expressão** (math/data) | controlflow | `run-flow-sync.ts:154-175` | datas calculadas, "now+7d" |
| **Sem test-run / dry-run com payload de exemplo** antes de ativar | authoring_dx | `runs.ts:63-112` só execução real | Risco de subir automação quebrada |
| Observabilidade de runs incompleta na UI | authoring_dx | `workflow_runs/run_steps` existem; listagem sem agregação `runs.ts:15-33` | Sem visão de saúde após importar 20 |
| Folders **sem endpoints REST** (só server-action c/ auth) | folders | `100_workflow_folders.sql`; `api/workflows/` sem `folders/` | Criar/atribuir folders programaticamente |
| Folders: criação exige contexto de usuário (sem `org_id` direto) | folders | `_actions/folders.ts:38` usa `getUser()` | Import em massa por serviço |
| Sem `wait until event OR timeout` (race) | ghl_parity | `workflow_waits` reservada `075:100` | Post-Call (callback OU timeout) |

---

## 🟡 Média severidade

- **Sem `set_dnd` node** (engine checa DND, mas workflow não seta) — `execute-action.ts:41-79`.
- **Sem `add_to_campaign` / `remove_from_campaign`** — módulo campanhas não exposto — `spec.ts` sem nodes.
- **Sem node de IA/LLM** (`ai_step`) — bloqueia "Call AI Assistant" — `spec.ts` sem `ai_step`/`knowledge_base:455-462` só consulta.
- **Trigger `contact.stage_changed`** (estágio derivado do contato) inexistente; só `opportunity.stage_changed`.
- **Spec ⊂ action-engine**: `send_whatsapp_mention_all`, `send_tenant_email`, `send_platform_email` implementados mas fora do spec — `execute-action.ts:318-326`.
- **Sem nodes paralelos / join** — `spec.ts:282-289`.
- **Sem variáveis computadas/derivadas** — `validate.ts:59-82`.
- **Sem goal/exit conditions** (abortar sequência) — só `end` `spec.ts:612-616`.
- **Sem acesso cross-record** (consultar outros registros) — escopo só do trigger `run-flow-sync.ts:261-275`.
- **Sem templates/snippets reutilizáveis de mensagem** — corpo inline por node.
- **Sem envio respeitando horário comercial / timezone**.
- **Sem goal events que removem contato do workflow**.
- **Sem notificação interna Slack/email**.
- **Condições baseadas em tag limitadas** (sem `has_tag(...)` documentado).
- Folders: sem bulk-import; reparent só via UI; sem bypass RLS documentado p/ serviço.

## 🟢 Baixa severidade
- `contact.created` sem contexto de origem (form/campanha/opp) · sem trigger list/segment-entry · sem split A/B · `pipeline_create_opportunity` sem defaults por contexto · sem quiet-hours por step · folders sem ícones · **folders não documentado no WORKFLOWS.md** · sem isolamento/validação de colisão de nomes de variável.

---

## ✅ O que JÁ funciona bem (não inventar gap)
- **Folders: feature completa** (DB + server actions + UI + drag-drop), shipped (SEED-038 / migration `100_workflow_folders.sql`). Suporta hierarquia (`parent_id`), cores, arquivamento recursivo. → **dá pra usar já** via SQL/server-action.
- Validador maduro com códigos de erro estruturados + `suggestion` p/ auto-correção de LLM (`validate.ts:114-374`).
- 26 triggers (calendário, pipeline, tempo, traffic, inbound phone) e ~21 nodes.
- Seed YAML versionado com upsert de versão (`seed-org.ts:19-124`).
- Versionamento imutável de definições (`workflow_versions`).

---

## Implicações para o PLAN.md
1. **Fase 1 (gaps) cresceu e tem um item P0 inesperado:** corrigir avaliação de `condition` em runtime (#1) — sem isso, *nenhum* workflow com ramificação migra corretamente. Junto com `add_tag`/`update_contact`/`send_email` e (idealmente) API runtime de criação.
2. **Mecânica de criação:** sem API runtime, o caminho de migração é **seed YAML versionado** (`supabase/seeds/workflows/`), não inserts programáticos. Bom para defaults; para workflows específicos da Skleanings (não-platform-default) avaliar se viram seed por-org ou se precisamos da API #4.
3. **Folders:** usar já. Criar a árvore de pastas da Skleanings espelhando a triagem.
4. **Subsistemas** (AI call, chatbot, campanha) confirmados fora do escopo de workflow — dependem de `ai_step`, widget/agent e módulo de campanhas.
