---
id: SEED-004
status: dormant
planted: 2026-05-17
planted_during: post-v2.0 Multi-Bot Platform
trigger_when: qualquer milestone tocando WhatsApp, atendimento multi-canal, ou omnichannel inbox; OU pedido explícito
scope: Medium
provider: Evolution Go (whatsmeow)
---

# SEED-004: Evolution Go — WhatsApp Multi-Instância + Inbox Unificado

Integrar o **Evolution Go** ao Operator como provider de WhatsApp — cada org conecta sua própria instância (número WhatsApp via QR code), recebe mensagens inbound no inbox unificado do Operator, e pode responder de dentro do painel ou deixar o agente responder automaticamente.

Evolution Go substitui W-API/Z-API como escolha de provider. É open source, escrito em Go (whatsmeow), auto-hospedado no mesmo VPS do Operator, sem custo de licença por instância.

## Arquitetura no Operator

```
Inbound:  Evolution Go → POST /api/evolution/webhook → process-event → runAgent() / inbox
Outbound: Admin responde no painel → lib/evolution/send-message.ts → Evolution Go REST API
Admin:    /integrations/evolution → conectar instância (QR code), status, desconectar
```

## Credenciais por org (criptografadas via lib/crypto.ts)
- `instance_name` — nome da instância no Evolution Go
- `instance_token` — API key da instância
- `evolution_base_url` — URL do servidor Evolution Go (VPS próprio)

## O que precisa ser construído

1. **Schema** — `evolution_instances(org_id, instance_name, token_encrypted, status, connected_at)` com RLS
2. **Webhook receiver** — `POST /api/evolution/webhook` (always-200, after() async) → normaliza payload → conversation + message → runAgent({channel: 'whatsapp'})
3. **Dispatcher outbound** — `lib/evolution/send-message.ts` → `POST /message/sendText/{instance}`
4. **Integration UI** — `/integrations/evolution` com QR code connect (polling status), pill de status, disconnect
5. **Inbox** — canal `whatsapp` já aparece no inbox (Phase 12); vincula `from` ao contato (SEED-006)
6. **mention-all tool** — `send_whatsapp_group_mention` como action type usando `POST /message/sendWhatsAppAudio` + `mentionsEveryOne: true` (Evolution Go v0.7.0+)
7. **Testes** — mock Evolution Go webhook, inbound → runAgent, outbound send, QR connect flow

## Referências de código existente
- [`src/lib/meta/process-event.ts`](src/lib/meta/process-event.ts) — padrão de process-event para copiar
- [`src/lib/agent-runtime/adapters/whatsapp.ts`](src/lib/agent-runtime/adapters/whatsapp.ts) — adapter 1600 chars ✅ Phase 37
- [`src/lib/crypto.ts`](src/lib/crypto.ts) — AES-256-GCM para tokens
- [`src/app/api/meta/webhook/route.ts`](src/app/api/meta/webhook/route.ts) — padrão always-200 + after()

## Decisões travadas
- **Provider:** Evolution Go (whatsmeow, self-hosted, open source)
- **Sem Chatwoot:** Operator é o inbox — não há sistema externo de mensagens
- **Sem Evo CRM:** Operator tem CRM próprio (SEED-006, SEED-007, SEED-008)
- **Ban risk:** aceito como trade-off do protocolo não-oficial; mitigar com comportamento (delays, volume)
- **R2:** mídia (fotos, áudios, docs) do WhatsApp baixada do Evolution Go e salva no Hetzner Object Storage

## Próximo passo
`/gsd:new-milestone` quando WhatsApp for prioridade → este seed vira base do milestone
