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
| Assistente Vapi — Recepção | `80dd9b79-fd39-457c-834a-7b0dd217fee4` (o que atende `+1 312 878-0637`) |
| Agente (prompt) — Recepção | slug `voz-recepcao`, bilíngue, com `save_caller_message` |
| Agente (prompt) — Agendamento | slug `voz-agendamento`, delegado pela recepção, com `check_meeting_times` e `book_meeting` |
| Tipo de evento | `conversa-inicial` — 30 min, vídeo, seg–sex 09:00–17:00 (Nova York) |
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

## Quem atende o telefone

`+1 312 878-0637` é atendido pela recepção bilíngue: responde no idioma de quem
ligou, conhece o catálogo, pode dizer os preços **publicados** dos produtos e
nada além disso, trata qualquer número de chaveiro como estimativa, e registra
a ligação com `save_caller_message` — o que abre tarefa, e-mail e Telegram pela
automação que já existia.

**Ela agenda.** Quando a pessoa quer falar com o time, a recepção passa a
ligação para o **especialista de agendamento** (agente `voz-agendamento`, ligado
por delegação — o chamador continua na mesma linha e com a mesma voz). Ele
consulta a agenda de verdade, oferece dois horários, pega o e-mail, lê tudo de
volta e só então marca.

O único compromisso que ele marca é a **Conversa inicial**: 30 minutos, por
vídeo, seg–sex 09:00–17:00 no fuso de Nova York. Página pública da mesma agenda:
<https://xphere.app/book/vanildo/conversa-inicial>.

Numa ligação ele **não consegue** marcar sem ler os detalhes de volta e ouvir um
sim — a checagem lê a transcrição da chamada, então o robô não tem como se
autoconvencer. Sem e-mail também não marca: é para onde vai o convite e o link
do vídeo.

**Antes de mudar o roteiro dela, ensaie:**

```bash
VOICE_REHEARSAL_ORG_ID=b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5 VOICE_REHEARSAL_ASSISTANT_ID=80dd9b79-fd39-457c-834a-7b0dd217fee4 npx vitest run --config vitest.manual.config.ts tests/manual/reception-rehearsal.test.ts
```

Seis chamadores passam pelo prompt vivo nos dois idiomas, sem discar nada. Na
primeira rodada ele pegou quatro problemas reais, incluindo um robocall de
garantia de carro virando contato no CRM.

## O que ainda não está pronto

- **O GoHighLevel da org está morto** — responde *"Location is not active"*.
  Nada depende dele hoje (a agenda é a nativa do Xphere), mas a integração
  continua marcada como ativa e vai enganar quem olhar.
- **O site ainda não oferece agendamento** (`booking_enabled: false` no
  `xphere_settings`), então quem entra pelo formulário não vê a mesma agenda
  que o robô usa.
- **A base de conhecimento da org está vazia** (só `dummy` e `test`). Hoje tudo
  que a recepção sabe está no próprio prompt, o que é aceitável para um
  catálogo pequeno e pára de escalar quando ele crescer.
- **A linha de data do prompt usa o fuso da organização** (`America/New_York`)
  mesmo no robô PT, porque é a org que define o fuso. Não afeta a confirmação
  de pedido, que não agenda nada.
- **O formulário não pede consentimento explícito de ligação.** A promessa está
  na página e o campo se chama "Qual é o seu WhatsApp?"; vale uma linha no
  último passo dizendo que vamos ligar para confirmar.
