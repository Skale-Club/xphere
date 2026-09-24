# Skale Club — voz

O que existe hoje na org `b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5`, como operar e o
que ainda não está pronto.

## O caminho de um pedido de chaveiro

1. A pessoa preenche `/nfc-order` (ou `/br/nfc-order`) em skale.club.
2. O site congela a cotação no lead, dispara o alerta no Telegram e enfileira o
   lead para o Xphere (`POST /api/v1/leads`, outbox durável no repo `skaleclub`).
   Desde `feat(nfc): hand Xphere the whole order…` o envelope carrega também o
   snapshot de preço, o `countryCode`, o nome do arquivo do logo e um campo
   `lang` derivado (`/br` → `pt-BR`; senão país do telefone → DDI → `en`).
3. O Xphere emite `lead.captured`, o que aciona o workflow
   **Chaveiros NFC — callback do pedido** (`nfc-order-callback.yaml`).
4. O workflow checa que o formulário é o `nfc-keychain-order`, escolhe a fila
   pelo `lang` e chama `campaign_enroll_call` — que **só enfileira**.
5. O motor de campanhas (`/api/cron/campaign-tick`, rodando no skale-cron) liga
   dentro do horário da campanha, com os dados do pedido no prompt.
6. O relatório de fim de chamada volta por `/api/vapi/calls`, fecha a linha em
   `campaign_contacts` e grava transcrição, gravação e a avaliação da ligação
   em `calls`.

## As peças

| Peça | Id |
|---|---|
| Assistente Vapi — PT | `d8b13b3b-980d-4269-a64f-393343a01ad1` |
| Assistente Vapi — EN | `efcd8778-7497-49c8-9082-fe2e59ca0081` |
| Agente (prompt) — PT | slug `voz-callback-nfc-pt` |
| Agente (prompt) — EN | slug `voz-callback-nfc-en` |
| Campanha — PT | `NFC callback — PT`, fuso `America/Sao_Paulo` |
| Campanha — EN | `NFC callback — EN`, fuso `America/New_York` |
| Caller id | `+1 312 878-0637` (o mesmo número que atende) |
| Workflow | `Skale Club — Chaveiros NFC — callback do pedido` |

Ambas as campanhas são **perenes**: ficam abertas esperando pedidos em vez de
se encerrarem quando a fila esvazia. Horário: 09:00–18:00, segunda a sexta, no
fuso de cada uma. Retry: duas tentativas, meia hora e depois quatro horas; caixa
postal nunca é rediscada.

## Operação

**Mudar o que o robô fala:** edite `scripts/skaleclub-voice/callback-{pt,en}.md`,
rode `npx tsx --env-file=.env.local scripts/setup-skaleclub-voice.ts --apply`
(publica uma nova versão do prompt) e depois empurre para a Vapi em
`Calls → Voice settings → Assistants → Push Config to Vapi`.

**Antes de empurrar qualquer coisa**, rode o diff:

```bash
STRICT=1 VAPI_PUSH_TEST_ORG_ID=b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5 VAPI_PUSH_TEST_ASSISTANT_ID=<assistente> npx vitest run --config vitest.manual.config.ts tests/manual/vapi-push-diff.test.ts
```

**Mudar horário, ritmo ou retry:** são colunas da campanha (`dial_window`,
`calls_per_minute`, `retry_policy`). Uma `dial_window` inválida não trava nada —
o sistema volta a "ligar a qualquer hora", de propósito, para que um erro de
configuração não pare a discagem da plataforma inteira.

**Parar tudo agora:** ponha as campanhas em `paused`. O workflow continua
enfileirando, e as linhas ficam esperando até alguém retomar.

**Não ligar para alguém específico:** ligue o do-not-disturb no contato
(canal *calls*). O enfileiramento respeita.

## O que ainda não está pronto

- **O número que atende continua sendo o legado.** Quem ligar de volta para o
  `+1 312 878-0637` cai no assistente antigo `Skale Club | Receptionist | EN`
  (gpt-4o-mini, sem ferramentas, não sabe o que é um chaveiro). A recepção
  bilíngue da agência — que é o inbound de verdade, com chaveiro como um assunto
  entre outros — ainda não foi feita.
- **A base de conhecimento da org está vazia** (só `dummy` e `test`). Sem ela a
  recepção não tem o que responder sobre a agência.
- **A linha de data do prompt usa o fuso da organização** (`America/New_York`)
  mesmo no robô PT, porque é a org que define o fuso. Não afeta a confirmação
  de pedido, que não agenda nada.
- **O formulário não pede consentimento explícito de ligação.** A promessa está
  na página e o campo se chama "Qual é o seu WhatsApp?"; vale uma linha no
  último passo dizendo que vamos ligar para confirmar.
