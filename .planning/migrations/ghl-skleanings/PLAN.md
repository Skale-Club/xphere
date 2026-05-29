# Migração de Automações — GHL (Skleanings) → Xphere Workflows

**Org destino:** Skleanings (`24552ef3-de77-4fba-a2c3-148cd58d8750`)
**Subconta GHL:** `q6UKnlWOQwyTk82yZPAs`
**Status Xphere atual:** 0 workflows (seed pulado na criação da org)
**Status GHL:** 20 workflows

---

## Restrição que define a abordagem

A API pública do GHL **não expõe a lógica interna** dos workflows (gatilhos, condições,
delays, mensagens, ações) — apenas `name`/`status`/`version`. Todos os endpoints de
detalhe retornam **404** (`GET /workflows/{id}`, `/versions`, `/steps`, `/actions`).

➡️ **Não há migração automática.** Cada workflow precisa ter a lógica **capturada
manualmente da UI do GHL** e **re-autorada** como YAML declarativo do Xphere
(`trigger` + `nodes` + `edges`), validada por `npm run workflows:validate`.

---

## Triagem dos 20 workflows

| GHL workflow | Destino Xphere | Classe |
|---|---|---|
| Appointment Confirmation (v28) | `event:meeting.confirmed` → `send_sms` (seed existe) | ✅ Direto |
| Appointment Confirmation (v10) | duplicata legada | 🗑️ Consolidar |
| Appointment Reminder (v11) | `event:meeting.starts_in` → `send_sms` (seed existe) | ✅ Direto |
| Reminder (v3) | variante de lembrete | ✅ Direto |
| Initial Contact (v34) | `event:contact.created` → `wait`+`send_sms` | ✅ Direto |
| New Lead (v22) | `event:contact.created` → notify + `send_sms` | ✅ Direto |
| In Negotiation (v11) | `event:opportunity.stage_changed` → ações | ✅ Direto |
| Lost Contacts (v4) | `event:opportunity.lost` / `pipeline_mark_lost` | ✅ Direto |
| Form Website (v9) | `event:traffic.conversion` / `contact.created` | ✅ Direto |
| Review Request (v11) | `event:meeting.completed` → `wait` → SMS (seed existe) | ✅ Direto |
| Review Request (v6) | duplicata legada | 🗑️ Consolidar |
| New lead \| Post-Call (draft) | `event:call.missed` → `wait` → SMS | ✅ Direto (é draft) |
| Quote Sent (v32) | `stage_changed` → `send_sms` **+ tag** | ⚠️ Gap (tag) |
| Stand By (v11) | hold por stage **+ tag** | ⚠️ Gap (tag) |
| Ghosting Automation (v8) | follow-up "sem resposta" **+ tag** | ⚠️ Gap (tag + trigger de resposta) |
| Stage → Ghosting Tag (draft) | `stage_changed` → **só tag** | ⚠️ Gap (tag) |
| Call \| AI Assistant (v61) | Vapi assistant + action-engine | ⚙️ Outro subsistema |
| Call \| AI Assistant \| Vapi (v6) | idem | ⚙️ Outro subsistema |
| Chatbot \| Website (v23) | widget de chat + AI agent | ⚙️ Outro subsistema |
| Marketing Campaign (v7) | engine de campanhas | ⚙️ Outro subsistema |

**Resumo:** ~10 diretos · 4 bloqueados por gap · 4 outro subsistema · 2 duplicatas.

---

## Gaps de plataforma (pré-requisitos) — ver `GAPS.md` para o detalhe auditado

1. **Node de tag de contato** (`add_tag` / `remove_tag`) — coração de ≥4 workflows. Maior bloqueador.
2. **Node de envio de email** (`send_email` via Resend) — provável, ainda não no spec.
3. (Talvez) **trigger "contato respondeu / sem resposta"** — base do "Ghosting".

---

## Fases

- **Fase 0 — Captura da lógica (manual, GHL UI).** Documentar gatilho/condições/delays/
  mensagens/ações de cada workflow num doc por slug (template em `_capture-template.md`).
  *Bloqueante: depende de acesso/screenshots/snapshot da UI do GHL.*
- **Fase 1 — Fechar gaps de capacidade.** Implementar nodes `add_tag`/`remove_tag` e
  `send_email` (migration + engine + spec + validator + exemplo).
- **Fase 2 — Seed + re-autoria.** Rodar `seedOrgWorkflows(Skleanings)`; autorar os ~10
  diretos em YAML; validar; ativar; testar.
- **Fase 3 — Subsistemas (escopo à parte).** AI-call → Vapi assistant; chatbot → widget+agent;
  campanha → engine de campanhas.
- **Fase 4 — Cutover.** Rodar GHL + Xphere em paralelo, comparar disparos, desligar GHL.
  Consolidar duplicatas, finalizar/descartar drafts.

---

## Organização via pastas (folders) do Xphere

A tabela `workflows` tem `folder_id`. Feature de folders está completa (migration `100_workflow_folders.sql`).
**Pastas criadas na Skleanings** (atribuir `workflows.folder_id` na Fase 2):

| Pasta | folder_id |
|-------|-----------|
| 📅 Agendamento | `65e16c35-f43c-4927-9873-2106823ce2a4` |
| 📥 Leads & Intake | `a35d8eb2-f8b5-45cd-a07c-ecf4401a820b` |
| 💼 Pipeline & Nutrição | `be2d58a3-0708-4065-a38f-68f0d64dd1be` |
| ⭐ Reputação | `2e9ac483-e2aa-4cac-956f-dbfabe4b18d3` |
| ⚙️ Subsistemas (não-workflow) | `46c6d24a-c627-4856-add2-4a4f7f4ab316` |

---

## Decisões pendentes (do usuário)

1. Escopo: só os ~14 que viram workflows, ou os 4 subsistemas também?
2. Captura Fase 0: acesso/screenshots da UI do GHL ou export de snapshot?
3. Construir os nodes `add_tag` + `send_email` primeiro, ou migrar só o possível hoje?
