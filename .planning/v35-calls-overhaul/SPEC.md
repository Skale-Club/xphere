# v3.5 — Calls Overhaul: reestruturação, toque confiável e destinos

**Status:** aprovado (2026-07-03) · execução direta por fases, sem ciclo GSD
**Contexto:** diagnóstico completo na sessão de 2026-07-03 (análise de IA/UX do módulo Calls + investigação de produção do push PWA).

## Diagnóstico (resumo)

1. Módulo Calls tem 6 rotas navegáveis para 1 tela de uso diário + configuração ocasional; sub-sidebar mistura escopo pessoal (My Phone) com org (Routing); hub `/calls/settings` está órfão (não linkado); `/calls/phone-numbers/[id]` duplica o `PhoneNumberEditor` que já existe como dialog.
2. Telefone de membro vive em 4 lugares desconectados: `user_metadata.phone` (Profile), `call_settings.phone_forward` (My Phone), targets `cell`/`forward` crus na routing chain, `twilio_phone_numbers.forward_to_number`.
3. **Produção:** `push_subscriptions` tem 0 linhas na org inteira → PWA nunca toca. Chain ativa tem só `[{type:'team'}]` (25s) que resolve apenas `<Client>` (browsers) e sobrepõe o `phone_forward` do usuário → celular não toca por nenhum caminho.
4. Mesmo com push OK, o "Answer" atual só abre `/calls` — a perna `<Client>` já falhou quando o app carrega. Precisa de redirecionamento server-side da chamada em andamento.
5. Anomalia: última notificação `incoming_call` é de 2026-06-12, mas houve inbound completadas até 2026-07-02 — investigar por que o disparo parou.

## Critério página vs popup

| Conteúdo | Forma |
|---|---|
| Uso diário, precisa de URL | Página |
| Detalhe de item de lista | Sheet lateral (`?param` na URL) |
| Config ocasional de org | Modal com abas, aberto do módulo |
| Preferência pessoal | Modal/popover no header |
| Credencial de provedor | Integrations |

Precedentes internos: settings de Analytics (modal no módulo), contact/opportunity detail sheets, dial pad popover global.

## Estrutura alvo

```
/calls  — página única: Registro (timeline)
├─ clique em ligação      → SHEET lateral (player, transcript, notas) · URL /calls?call={id}
├─ ⚙ Voice Settings       → MODAL (admin only) abas: Numbers · Routing · Assistants · Geral
├─ 📱 My Phone            → MODAL pessoal (modo de atendimento, SIP, status push do aparelho)
└─ Voice Campaigns        → link p/ /campaigns?channel=calls
```

Remover: sub-sidebar de Calls, `/calls/phone-numbers/[id]` (página), `/calls/settings` (hub órfão). Rotas antigas viram redirect. Renomear "Connected Assistants" → "Voice Assistants" + cross-link no módulo Agents. Limpar `revalidatePath` mortos em `integrations/twilio/actions.ts:259,311` e `numbers-actions.ts:128-129`.

Nada de voz vai para o menu Settings; credenciais ficam em Integrations.

## Fases

### Fase 1 — Reestruturação do módulo Calls ✅ BUILT 2026-07-03 (aguarda QA no browser)
Pendências de polish: cross-link no lado do módulo Agents apontando para Voice Assistants.
- Timeline vira a página única do módulo (sem sub-sidebar).
- Detalhe de ligação em sheet lateral com `?call={id}` (manter render atual AI vs Human).
- Modal "Voice Settings" com abas Numbers / Routing / Assistants / Geral; gate por permissão admin (`calls.manage` ou equivalente); aba Routing em largura máxima.
- Modal "My Phone" pessoal.
- Redirects de todas as rotas antigas; deletar página `[id]` e hub órfão; faxina de revalidatePath.
- Renomeações + cross-links (Agents ↔ Voice Assistants, Phone Numbers ↔ Integrations/Twilio).

### Fase 2 — Toque confiável (celular/PWA)
- Onboarding de push: prompt no primeiro launch do PWA + status por aparelho no modal My Phone; lista de aparelhos registrados.
- Aviso em Voice Settings quando há alvos team/pwa e 0 `push_subscriptions` na org.
- Answer funcional: notificação → deep-link `?answer={callSid}` → registra Device → endpoint server-side redireciona a chamada em andamento (Twilio call update) para o client.
- Cancelar notificação de toque quando a chamada termina/é atendida (hoje `requireInteraction` deixa presa).
- Alvo PSTN paralelo na chain (toque nativo garantido).
- Investigar anomalia das notificações parardas em 12/jun.

### Fase 3 — Modelo `call_destinations`
- Tabela `call_destinations`: destino **pessoal** (ref. membro, telefone resolvido do perfil na hora da chamada) ou **compartilhado** (número nomeado org-level, ex. "Recepção", atendido por N pessoas).
- Chain targets e `forward_to_number` passam a referenciar destinos; fim de número cru em config de roteamento.
- Migração dos dados existentes (número presente em `call_settings.phone_forward` de um usuário → pessoal; demais → compartilhado p/ admin batizar).
- Alvo `team`/pessoal passa a significar "toque o membro por onde ele atende" (browser **e** forward), corrigindo o defeito de team só tocar browsers.
- Correção de config da org atual: chain ganha destino de celular do Vanildo (+1 508 801 8190) — aplicar na Fase 3 via modelo novo (sem hotfix antes, decisão do usuário: estrutura > pressa).

## Regras de execução
- Commits atômicos por etapa; `npm run build` antes de cada commit.
- Nunca editar migrations antigas; `npx supabase db push` + atualizar `src/types/database.ts`.
- Parada de validação com o usuário ao fim de cada fase.
