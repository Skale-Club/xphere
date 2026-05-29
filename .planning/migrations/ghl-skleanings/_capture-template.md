# Captura GHL — `<workflow-slug>`

> Fase 0. Preencher a partir da UI do GHL (a API não expõe internals).
> Um arquivo por workflow. Depois disto vira YAML do Xphere e é validado.

## Identificação
- **Nome no GHL:**
- **GHL ID / versão:**
- **Status:** published / draft
- **Categoria (triagem):** Agendamento / Leads / Pipeline / Reputação / Subsistema

## Gatilho (trigger)
- **O que dispara:** (ex: agendamento confirmado, contato criado, mudou de estágio, sem resposta por N dias…)
- **Filtros/condições de entrada:**
- **Reentrada permitida?** sim/não
- **→ trigger Xphere proposto:** `event:…` / `schedule` / `manual` / `tool_call`

## Passos (em ordem)
| # | Tipo (GHL) | Detalhe (mensagem, delay, condição, tag, ação) | → node Xphere |
|---|-----------|-----------------------------------------------|---------------|
| 1 | | | |
| 2 | | | |

## Mensagens (conteúdo exato)
```
(colar texto dos SMS/email/templates, com variáveis {{...}})
```

## Condições / ramificações
- (descrever if/else, goals, exits)

## Variáveis usadas
- (campos do contato/oportunidade/agendamento referenciados)

## Ações que dependem de gap de plataforma
- [ ] tag de contato (`add_tag`/`remove_tag`)
- [ ] envio de email (`send_email`)
- [ ] outro: __________

## Observações / dificuldades de mapeamento
- (anotar aqui qualquer coisa que não mapeia 1:1 → alimenta o GAPS.md)

## YAML Xphere (rascunho)
```yaml
name: <slug>
description: |
  Migrado de GHL "<nome>". Platform-default? não.
trigger:
  type: event
  event: …
nodes:
  - id: …
    kind: …
edges:
  - from: trigger
    to: …
```
