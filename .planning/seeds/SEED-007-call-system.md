---
id: SEED-007
status: dormant
planted: 2026-05-17
planted_during: post-v2.0 Multi-Bot Platform
trigger_when: milestone de CRM; OU pedido explícito de substituir sistema de chamadas do GHL
scope: Medium-Large
depends_on: SEED-006 (Contacts)
---

# SEED-007: Call System — Ligações via Twilio + 3 Modos de Atendimento + Gravação + R2

Sistema completo de chamadas dentro do Operator. Cada usuário/org escolhe como prefere atender e ligar — os 3 modos coexistem e são configuráveis por usuário nas settings.

**Substitui o sistema de ligações do GHL.** Toda a lógica de roteamento, gravação e histórico fica no Operator.

---

## Os 3 modos de atendimento (todos obrigatórios)

### Modo A — Encaminhar para celular real
```
Cliente liga → Twilio → POST /api/twilio/voice → TwiML <Dial><Number>+55119...</Number></Dial>
→ toca no celular do admin → admin atende normalmente
```
- Configuração: admin cadastra seu número pessoal nas settings
- Zero setup extra — funciona imediatamente
- Twilio grava e manda webhook quando termina

### Modo B — Zoiper / SIP (ramal VoIP)
```
Cliente liga → Twilio SIP Domain → Zoiper no PC/celular do admin toca
→ admin atende no app Zoiper
```
- Configuração: admin configura Twilio SIP Domain + credenciais SIP no Zoiper
- Mais barato (um trecho de chamada só)
- Operator gera as credenciais SIP por usuário automaticamente
- Twilio SIP domain com `record=true` para gravar

### Modo C — Atender no browser (Twilio Voice SDK)
```
Cliente liga → Twilio → Operator notifica via WebSocket → 
banner "Chamada recebida de [Nome do Contato]" aparece no painel →
admin clica "Atender" → áudio WebRTC no browser
```
- Configuração: zero — funciona no browser sem instalar nada
- Mais integrado: nome do contato aparece antes de atender, histórico automático
- Requer Twilio Voice SDK (`@twilio/voice-sdk`) no frontend
- `POST /api/twilio/token` gera Access Token por sessão

---

## Arquitetura de roteamento

```
POST /api/twilio/voice (webhook Twilio)
  ↓
Operator lê routing_mode do usuário responsável pela org/número
  ↓
  ├── Modo A → TwiML <Dial><Number>{phone_forward}</Number></Dial>
  ├── Modo B → TwiML <Dial><Sip>{sip_uri}</Sip></Dial>
  └── Modo C → TwiML <Dial><Client>{user_identity}</Client></Dial>
        ↑
        Twilio Voice SDK registrado no browser do admin
```

**Um único webhook, TwiML gerado dinamicamente** com base no modo configurado por usuário/org.

---

## Schema

```sql
-- Configuração de chamadas por usuário/org
call_settings (
  id uuid PK,
  org_id uuid FK (RLS),
  user_id uuid FK → auth.users,
  routing_mode text,          -- 'phone_forward' | 'sip' | 'browser'
  phone_forward text,         -- número real (+5511999...) para Modo A
  sip_username text,          -- gerado automaticamente para Modo B
  sip_password_encrypted text,-- AES-256-GCM para Modo B
  twilio_client_identity text,-- gerado automaticamente para Modo C
  record_calls boolean DEFAULT true,
  updated_at
)

-- Histórico de chamadas
call_logs (
  id uuid PK,
  org_id uuid FK (RLS),
  contact_id uuid FK → contacts (nullable),
  opportunity_id uuid FK → opportunities (nullable, SEED-008),
  call_sid text UNIQUE,
  direction text,             -- 'inbound' | 'outbound'
  routing_mode text,          -- qual modo foi usado
  from_number text,
  to_number text,
  status text,                -- 'completed' | 'no-answer' | 'busy' | 'failed' | 'canceled'
  duration_seconds int,
  recording_url text,         -- URL no Hetzner Object Storage
  recording_duration int,
  started_at timestamptz,
  ended_at timestamptz,
  notes text,
  created_by uuid FK → auth.users
)
```

---

## O que precisa ser construído

**Infraestrutura base:**
1. Migration `call_settings` + `call_logs` + RLS + tipos
2. `POST /api/twilio/voice` — roteamento dinâmico (lê `call_settings`, gera TwiML por modo)
3. `POST /api/twilio/recording` — webhook pós-gravação → baixa áudio → Hetzner Object Storage → insere `call_logs`
4. `POST /api/twilio/status` — webhook de status (answered, no-answer, busy) → atualiza `call_logs`

**Modo A — Encaminhar para celular:**
5. Settings UI — campo "Encaminhar para" com validação E.164
6. TwiML `<Dial><Number>` com record ativo

**Modo B — SIP / Zoiper:**
7. Geração automática de credenciais SIP por usuário (username + password criptografado)
8. Twilio SIP Domain configurado por org (lib ou manual com documentação)
9. Settings UI — exibe credenciais SIP para copiar no Zoiper + QR de config
10. Guia de setup Zoiper (iOS, Android, Windows, Mac) na docs do Operator

**Modo C — Browser / Twilio Voice SDK:**
11. `POST /api/twilio/token` — gera Access Token com identity do usuário
12. Hook `useTwilioDevice()` — registra o Device no browser, gerencia estado (ready/on-call/offline)
13. Componente `<IncomingCallBanner>` — aparece no topo do dashboard quando chega chamada
14. Componente `<Dialer>` — input de número + botão ligar para outbound
15. Notificação em tempo real (Supabase Realtime ou WebSocket) para o banner de chamada entrando

**Outbound (ligar para cliente) — os 3 modos:**
16. Modo A: `POST /api/twilio/outbound` → Twilio REST API inicia chamada → conecta os dois números
17. Modo B: admin disca direto no Zoiper (número do contato)
18. Modo C: `<DialerButton phone={contact.phone}>` no painel → Twilio SDK inicia chamada WebRTC

**Histórico e UI:**
19. `/dashboard/calls` — lista unificada (inbound + outbound), filtros, status, duração
20. Player de áudio inline com waveform simples
21. `/dashboard/contacts/[id]` — aba "Chamadas" com histórico + player + notas
22. Anotação pós-chamada — modal após encerrar com campo de notas

**Settings:**
23. `/settings/calls` — escolha de modo por usuário, configuração de cada modo, toggle de gravação

**Testes:**
24. TwiML correto para cada modo
25. Recording webhook → Hetzner Object Storage → call_logs
26. Token endpoint retorna identity correto
27. RLS: org A não vê chamadas da org B

---

## Decisões travadas
- **Os 3 modos são obrigatórios** — admin escolhe por usuário nas settings
- **Gravação ativa por padrão** — toggle por org nas settings
- **Hetzner Object Storage** — download imediato do Twilio (evita custo de storage Twilio)
- **TwiML dinâmico** — um único webhook, comportamento determinado pelo `call_settings` do usuário
- **Sem Chatwoot** — call logs ficam no Operator

## Scope
**Medium-Large — 4-5 fases, ~14 plans**

## Referências de código existente
- [`src/lib/twilio/`](src/lib/twilio/) — cliente Twilio (`send_sms`)
- [`src/lib/crypto.ts`](src/lib/crypto.ts) — AES-256-GCM para senha SIP
- Supabase Realtime — já usado em conversations para notificações em tempo real
- Hetzner Object Storage — storage definido (SEED-004)
