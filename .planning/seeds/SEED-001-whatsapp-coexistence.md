---
id: SEED-001
status: dormant
planted: 2026-05-15
planted_during: post-v1.8 (Executor Completeness completed)
trigger_when: milestone touches WhatsApp onboarding / multi-channel inbox / self-service WABA setup, OR before 2026-10-15 (Embedded Signup v2 deprecation deadline), OR user explicitly requests
scope: Large
---

# SEED-001: WhatsApp Coexistence — Embedded Signup v4 + Coexistence mode

Permite que o mesmo número opere simultaneamente no app WhatsApp Business (manual no celular) e na Cloud API (automação Operator), com sync bidirecional. Cliente não perde histórico, etiquetas, contatos — não precisa zerar o WhatsApp pra entrar na API oficial.

## Why This Matters

**Reduz drasticamente fricção de onboarding** de clientes que já usam WhatsApp Business no celular. Hoje, migrar pra Cloud API exige desinstalar o app e perder todo o histórico/etiquetas/contatos — barreira psicológica enorme. Coexistência elimina isso: escaneia QR, mantém tudo funcionando.

**Vantagem de custo única no motor de campanhas:** fora da janela de 24h, o operador humano pode chamar o cliente manualmente via celular (grátis) ao invés de pagar template (~R$0,06–0,60). Operator pode expor isso na UI ("notify human" vs "send template") como decisão informada por custo.

**Estratégia de grupos/comunidades como otimização de custo:** 1 disparo pago traz cliente pro grupo → daí em diante, mensagens dentro do grupo são grátis via celular. Padrão repetível que vale virar feature.

**Deadline regulatório:** Embedded Signup v2 será descontinuado em **2026-10-15**. Se mexermos no fluxo Meta antes disso, vale já migrar pra v4 com coexistência junto.

## When to Surface

**Trigger:** milestone que toque onboarding self-service de WhatsApp, inbox multi-canal, ou motor de campanhas WhatsApp; OU antes de 2026-10-15 (deadline v2); OU pedido explícito do usuário.

Apresentar este seed durante `/gsd:new-milestone` quando o escopo do milestone novo bater com:
- "WhatsApp", "Meta", "WABA", "embedded signup", "Cloud API"
- "Onboarding", "self-service", "ativação de cliente"
- "Inbox", "multi-canal", "atendimento"
- "Campanhas WhatsApp", "disparo", "templates"
- Qualquer milestone planejado pra depois de 2026-09-01 (1 mês antes do deadline v2)

## Scope Estimate

**Large** — É um milestone inteiro. Toca:
- Frontend (nova UI de Embedded Signup com variante coexistence)
- Backend OAuth (variante de troca de token)
- Schema do DB (flag `source` em `messages`, possivelmente nova tabela pra contatos sincronizados)
- Webhooks (3 novos campos: `history`, `smb_app_state_sync`, `smb_message_echoes`)
- Job assíncrono pro backfill de 6 meses
- Lógica de roteamento anti-double-reply
- Integração com motor de campanhas existente (decisão de janela 24h)
- App Review da Meta (formulários + vídeos por permissão)

## Requisitos Descobertos

### Pré-requisitos do app Meta (3 luzes verdes obrigatórias)
- Empresa verificada
- App aprovado em App Review
- Integração Tech Provider aprovada

Sem isso: Embedded Signup funciona só pra adicionar números novos, **coexistência falha no pareamento QR**.

### 4 permissões obrigatórias
- `business_management`
- `whatsapp_business_manage_events`
- `whatsapp_business_management`
- `whatsapp_business_messaging`

### 3 lugares onde domínio do redirect precisa estar cadastrado
1. Facebook Login → Settings → Valid OAuth Redirect URIs
2. App Settings → Basic → App Domains + Site URL
3. Embedded Signup → App Settings → Domain Management

### Webhooks novos
- `history` → backfill de até 6 meses de chats ao conectar
- `smb_app_state_sync` → contatos do business app
- `smb_message_echoes` → eco de cada mensagem enviada pelo cliente via celular **(crítico: sem digerir, agente automatizado responde inconsistente com o humano)**

### Limites
- Throughput fixo: **5 msg/s** (não serve pra campanhas de altíssimo volume)
- Tier ramp: 250 → 1k → 10k → 100k → ilimitado msg/dia
- Pricing template (BR): utility ~R$0,06 / marketing ~R$0,36–0,60
- Janela 24h é **rolling** (reseta a cada resposta do cliente, não a cada envio do business)

## Gotcha Crítico (Informação Não Documentada)

URL gerada pelo SDK do Facebook seguindo a documentação oficial sai **malformada** (falta `client_uri` no formato correto). Resultado: troca `code → token` falha silenciosamente.

**Workaround:** abrir o popup "Entrar com Facebook" do próprio painel do app Meta, copiar a URL/subdomínio dali e usar esse formato como template pra construir a URL embed no nosso frontend. Sem isso, dias perdidos debugando troca de token.

## Encaixe no Operator

Reaproveita base existente:
- [src/app/api/meta/callback/route.ts](src/app/api/meta/callback/route.ts) — fluxo OAuth atual
- [src/app/api/meta/webhook/route.ts](src/app/api/meta/webhook/route.ts) — receiver Meta atual

Mas precisa adicionar:
- Variante de UI no Embedded Signup com `feature_type=whatsapp_business_app_onboarding`
- Coluna `source` em `messages`: `'cloud_api' | 'business_app_echo' | 'inbound'`
- Roteamento anti-double-reply: se humano respondeu via celular (echo capturado), bot não responde
- Job assíncrono pra digerir backfill de 6 meses (Edge Function provável)
- Decisão sobre como representar dualidade bot/humano sem quebrar integrações Vapi/ManyChat

## Lacunas Técnicas a Fechar Antes de Planejar

- Snippet JS exato do `FB.login` com `extras.feature_type` pra coexistence
- Eventos `message` do popup (`WA_EMBEDDED_SIGNUP` com `phone_number_id`, `waba_id`)
- Endpoint/payload exato do `code → access_token` exchange
- Endpoint do `subscribed_apps` pra registrar webhook na WABA
- JSON shape de `smb_message_echoes`, `history`, `smb_app_state_sync`
- Mecânica do backfill: batch único? paginado? janela temporal configurável?

## Próximo Passo Quando Retomar

1. Buscar doc oficial Meta v4 (`developers.facebook.com/docs/whatsapp/embedded-signup`)
2. Buscar "página de apoio" do Pedrinho/ZDG mencionada no vídeo (snippets de código)
3. Ler código atual em [src/app/api/meta/](src/app/api/meta/) pra entender baseline
4. Decidir entre `/gsd:research-phase` (mais profundo, recomendado dada a complexidade) ou `/gsd:discuss-phase` (já partir pra escopo)

## Breadcrumbs

Código existente relacionado:
- [src/app/api/meta/callback/route.ts](src/app/api/meta/callback/route.ts) — OAuth callback Meta atual (a ser estendido)
- [src/app/api/meta/webhook/route.ts](src/app/api/meta/webhook/route.ts) — Receiver de webhooks Meta atual (a ser estendido)

Planning relacionado:
- [.planning/milestones/v1.3-REQUIREMENTS.md](.planning/milestones/v1.3-REQUIREMENTS.md) — Meta Messaging milestone (base)
- [.planning/phases/12-multi-channel-inbox-ui/](.planning/phases/12-multi-channel-inbox-ui/) — UI do inbox que precisará da flag `source`
- [.planning/phases/13-outbound-reply-routing/](.planning/phases/13-outbound-reply-routing/) — roteamento de respostas (lógica anti-double-reply impacta aqui)

## Fontes Estudadas

- Vídeo Pedrinho da NASA / comunidade ZDG (setup técnico do app Meta + gotcha da URL do SDK)
- Vídeo Rodrigo Soares / Rota IA (framing comercial: pricing, tier ramp, janela 24h, padrão de grupos)
- developers.facebook.com docs (alta visão geral via WebSearch — doc técnica detalhada não fetched ainda)

## Notas

Sessão de pesquisa rodada em 2026-05-15 absorveu material conceitual e admin-level via 2 transcripts de vídeo + WebSearch. Ainda **não foi feito** WebFetch da doc oficial Meta nem leitura detalhada do código `meta/` atual — esses são pré-requisitos pra qualquer planejamento real.

Custo provável: app review da Meta sozinho leva semanas (formulários + vídeos por permissão). Considerar começar a submissão em paralelo com desenvolvimento.
