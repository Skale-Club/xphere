---
id: SEED-004
status: dormant
planted: 2026-05-17
planted_during: post-v2.0 Multi-Bot Platform
trigger_when: planejamento de qualquer milestone tocando WhatsApp, envio de mensagens, campanhas WhatsApp, ou atendimento multi-canal; OU pedido explícito do usuário
scope: Medium
---

# SEED-004: W-API — WhatsApp Multi-Instância via Tool + Webhook Inbound

Integrar o **W-API** ao Operator como provider de WhatsApp — permitindo que cada org conecte sua própria instância (número WhatsApp) e use o agente para **enviar mensagens** via tool call e **receber mensagens inbound** via webhook, roteando para o agent runtime.

W-API substitui a abordagem SEED-001 (Meta Embedded Signup v4 + Coexistence), que exigia App Review da Meta e aprovação como Tech Provider — barreiras altas. W-API é multi-instância, multi-tenant by design, e não exige aprovação Meta.

## Why This Matters

### 1. WhatsApp sem burocracia Meta
Nenhuma App Review, nenhuma verificação de empresa, nenhuma aprovação de Tech Provider. Cada instância = um número WhatsApp conectado via QR code. Ideal para o modelo de agências do Operator onde cada cliente tem seu próprio número.

### 2. Encaixa no modelo multi-tenant do Operator
W-API é projetada para SaaS/white-label: você gerencia instâncias por conta de seus clientes sem que eles precisem de conta na W-API. O `instanceId` + `token` ficam criptografados por org (padrão AES-256-GCM já existente).

### 3. Complementa o agent runtime v2.0
Com W-API, o canal `whatsapp` do `runAgent()` ganha um provider real de envio. O adapter `whatsapp` (Phase 37, 1600 chars) já está pronto — falta só o dispatcher de saída e o receiver de entrada.

### 4. Tool para o agente disparar mensagens
Uma tool `send_whatsapp_message` exposta ao agent runtime permite que o agente (ou fluxo ManyChat/Meta) dispare WhatsApp proativamente — confirmações, follow-ups, alertas.

## Arquitetura no Operator

```
Inbound:  W-API webhook → POST /api/wapi/webhook → process-event → runAgent()
Outbound: runAgent() tool call → send_whatsapp_message → W-API API
Admin:    /integrations/w-api → QR code connect, status, disconnect
```

**Credenciais por org** (criptografadas via `lib/crypto.ts`):
- `instance_id` — ID da instância W-API
- `instance_token` — Bearer token da instância (per-instance)
- `master_api_key` — opcional, só se Operator for criar instâncias programaticamente

## Autenticação W-API

- **Envio:** `POST https://api.w-api.app/v1/message/send-text?instanceId={id}` com `Authorization: Bearer {token}`
- **Webhook inbound:** W-API envia `POST` para URL configurada por instância (dashboard ou API)
- URL do webhook no Operator: `https://operator.skale.club/api/wapi/webhook`

## Capacidades disponíveis

| Categoria | O que usar |
|---|---|
| Envio de texto | `POST /v1/message/send-text` |
| Envio de mídia | `POST /v1/message/send-media` (imagem, doc, áudio) |
| Receber mensagens | Webhook inbound configurado na instância |
| Status de entrega | Webhook de status (delivered, read) |
| Grupos | `/v1/group/*` — opcional, fase futura |
| Fila de mensagens | `/v1/queue/*` — controle de delay anti-spam |

## Scope Estimate

**Medium** — 3-5 fases.

### Componentes mínimos

1. **Schema** — coluna `wapi` em `integrations` + tabela `wapi_instances(org_id, instance_id, instance_token_encrypted, status)` com RLS
2. **Integration UI** — `/integrations/w-api` com QR code connect, status pill (connected/disconnected), disconnect button
3. **Webhook receiver** — `POST /api/wapi/webhook` (always-200, after() async) → `process-event.ts` → `runAgent({channel: 'whatsapp'})`
4. **Tool `send_whatsapp_message`** — executor em `lib/action-engine/executors/send-whatsapp-message.ts`, usa W-API send-text + adapter whatsapp (Phase 37 já pronto)
5. **Tool config UI** — `send_whatsapp_message` como novo action type no tool-config-form
6. **Testes** — mock W-API, webhook inbound → runAgent, tool call → W-API send

### Fora de escopo desta fase
- Grupos WhatsApp
- Mídia (imagem/doc/áudio) — fase futura
- Criação programática de instâncias (Master API Key) — admins conectam via QR no dashboard
- Campanhas WhatsApp via W-API — backlog separado

## Encaixe no Operator

Código que já existe e será reaproveitado:
- [`src/lib/agent-runtime/adapters/whatsapp.ts`](src/lib/agent-runtime/adapters/whatsapp.ts) — formatação de saída (1600 chars, markdown strip) ✅ Phase 37
- [`src/lib/meta/process-event.ts`](src/lib/meta/process-event.ts) — padrão de process-event com `runAgent()` para copiar
- [`src/lib/crypto.ts`](src/lib/crypto.ts) — AES-256-GCM para criptografar tokens
- [`src/lib/manychat/`](src/lib/manychat/) — padrão de integração com webhook + dispatcher para copiar
- `agent_channel_defaults` — canal `whatsapp` já existe no enum

## Decisões a Tomar Antes de Planejar

1. **Operator cria instâncias programaticamente** (Master API Key) ou **admin conecta via QR no dashboard** (Instance Token apenas)? → Recomendação: QR no dashboard, sem Master Key — menor superfície de ataque.
2. **Delay de envio**: usar o delay nativo do W-API (1-15s) ou controlar no Operator?
3. **Status de entrega**: processar webhooks de delivered/read? Útil para observability, mas adiciona complexidade.
4. **Número de instâncias por org**: 1 por org ou múltiplas (ex: org tem vários clientes cada um com seu número)?

## Próximo Passo Quando Retomar

1. Ler doc completa W-API: `https://docs.w-api.app`
2. Testar endpoint de envio e formato de webhook inbound com uma instância de teste
3. Rodar `/gsd:discuss-phase` ou `/gsd:plan-phase` para o milestone

## Referências

- Docs W-API: `https://docs.w-api.app/api-integration/__intro__`
- Base URL: `https://api.w-api.app/v1/`
- Padrão de integração existente: [`src/lib/manychat/`](src/lib/manychat/) e [`src/lib/meta/`](src/lib/meta/)
- Adapter WhatsApp pronto: [`src/lib/agent-runtime/adapters/whatsapp.ts`](src/lib/agent-runtime/adapters/whatsapp.ts)
