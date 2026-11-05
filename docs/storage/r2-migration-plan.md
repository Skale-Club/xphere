# Plano: retenção de arquivos e migração para o Cloudflare R2

Data: 2026-11-05. Status: execução parcial em produção; ver o
[registro do cutover](r2-cutover-2026-11-05.md) para os buckets ativados,
validações, resultados da cópia e pendências. Os números abaixo são o levantamento
original, medido no banco real (leitura) e no código.
Não depende de onde o banco está nem da autenticação, e pode vir antes das duas.
Contexto maior: [estudo do banco](../database/self-hosted-postgres-study.md).

## 1. Regras decididas

| Arquivo | Regra |
|---|---|
| Screenshots de análise de site | Apagados **1 dia** depois da análise. Os existentes hoje podem ser apagados |
| Mídia de conversa (inbox) | **30 dias** por padrão. Depois, um seletor por org com prazo maior, pago à parte |
| Texto das mensagens | Fica; só o arquivo expira |
| Linhas de `website_analyses` | **Ficam.** Ver seção 3 |

A ideia central: limpar **primeiro** e migrar depois. O que sobra para copiar fica pequeno.

## 2. O que existe hoje e o que sobra

| Bucket | Hoje | Depois | Observação |
|---|---|---|---|
| `website-screenshots` | 10.333 objetos, 674 MB | 0 a copiar | Em regime, só o último dia: cerca de 12 MB, estimado pelo ritmo de outubro |
| `chat-media` | 1.060 objetos, 355 MB | 67 MB | Skale Club 349 MB, Fluenverse 6 MB |
| `branding` | 49 objetos, 64 MB | 64 MB | 46 imagens da landing, cerca de 1,4 MB cada. Comprimir é opcional |
| `email-assets` | 2 objetos, 4,5 MB | 4,5 MB | Sem referência no banco, mas podem estar em e-mails enviados |
| `avatars` | 22 objetos, 302 kB | 302 kB | |
| `contact-imports`, `global-knowledge`, `ads-playbook` | 0 | 0 | Vazios, mas os dois primeiros têm código ativo |
| **Total** | **~1,1 GB** | **~136 MB** | Queda de cerca de 88% |

Fora do Supabase: as gravações de chamada. O código aponta para `HETZNER_S3_*`, que não existe em
produção. As 18 gravações são links da Twilio, e `api/recording/upload` responde `ok` e descarta o
áudio gravado no browser.

## 3. Screenshots sim, análises não

O screenshot não é usado para gerar a análise. Ele é gravado e só aparece em dois lugares:
`prospect-detail-sheet.tsx`, que já trata imagem ausente, e a API `/api/v1/accounts`, onde o campo já
pode ser nulo. Nenhum outro repositório lê esse campo.

Já as **linhas** da análise não são lixo: `lib/xmail/website-insights.ts` lê `services`, `raw_evidence`
e `outreach_insights` para personalizar o outreach no Xmail, e o cron usa o histórico para decidir
reanálises e novas tentativas. Apagá-las quebraria a prospecção. Por isso o job limpa só os arquivos e
as URLs.

Fica para outra frente: 3.722 linhas com falha e 7 contas com 3.399 análises (uma com 1.442), o que
parece um loop de novas tentativas. A causa não foi confirmada.

## 4. O job de retenção

Uma rota nova, `/api/cron/storage-retention`, no mesmo padrão das outras em `api/cron/`. Roda **de hora em hora até o acervo esvaziar** (cada execução tem teto de linhas e de tempo e devolve `truncated: true` quando para no meio); depois disso a execução é barata (uma página vazia por varredura) e pode ficar espaçada. O agendamento fica no skale-cron.

- **Screenshots:** análises com URL e `analyzed_at` com mais de 1 dia: remove os 2 objetos e, só depois do sucesso, zera as duas URLs. É idempotente. O caminho do objeto vem só do id da linha; o backend (Supabase ou R2) vem da URL guardada em cada linha (a base pública do R2, `R2_PUBLIC_BASE_URL`, ou qualquer outra coisa = Supabase). Um lote pode misturar os dois: remove por backend e zera só as linhas cujos objetos todos foram removidos.
- **Mídia de conversa:** o caminho já começa com o id da org (`<orgId>/...`). Reconhece as duas formas de endereço, a URL pública do Supabase e `/api/media/chat-media/<orgId>/...` (R2), exige que o primeiro segmento seja a org da mensagem e remove pelo backend para o qual a URL aponta. Só depois da remoção marca `media_expired_at`.
- **Por que job, e não só a regra de ciclo de vida do R2:** a regra vale por prefixo e por prazo fixo. O seletor pago por org exigiria refazer tudo. Com o job, o prazo vira só um valor por org: agora uma constante de 30 dias, depois a coluna `organizations.chat_media_retention_days`.
- **Trava de segurança:** modo simulação por padrão, relatando quantos objetos e bytes apagaria. Cada varredura tem a sua env, independentes: `STORAGE_RETENTION_SCREENSHOTS_ENABLED=true` liga os screenshots e `STORAGE_RETENTION_CHAT_ENABLED=true` liga a mídia de conversa. Só vale o texto exato `true`. Lotes limitados por execução (linhas, objetos e 60 s de relógio) e registro em log só com contagens e ids.
- **Remoção no R2:** só acontece se o bucket lógico estiver em `STORAGE_R2_BUCKETS`. Uma URL do R2 com o bucket fora da lista é erro (nada é zerado nem marcado), nunca remoção silenciosa no Supabase.
- **Backstop no R2 (depois da migração):** ciclo de vida de 2 dias só na pasta de screenshots, caso o job pare. Na mídia de conversa não há backstop, porque ele cortaria quem paga por mais tempo.

Na tela: mensagem de mídia mais antiga que o prazo da org mostra "Mídia expirada", sem player quebrado.
Isso vai ao ar **antes** de o job apagar qualquer coisa de conversa.

**O que a regra de 30 dias apaga agora:** 930 objetos (288 MB). 928 das 1.058 mensagens com mídia
perdem o anexo. É quase tudo da própria Skale Club, mas a **Fluenverse** também tem 8 objetos (6 MB).
Essa remoção não tem volta.

A verificar antes de ligar para conversas: se Copilot, workflows ou transcrição releem áudio antigo.

## 5. Destino no R2

| Bucket R2 | Conteúdo | Acesso |
|---|---|---|
| `xphere-assets` | `branding`, `avatars`, `email-assets`, `website-screenshots` | Público em `media.xphere.app` (a zona já está na Cloudflare) |
| `xphere-files` | `chat-media`, `contact-imports`, `global-knowledge`, gravações | Privado, só por URL assinada |
| `xphere-dev` | Tudo do ambiente de desenvolvimento | Separado; dev nunca escreve em produção |

**Proposta: mídia de conversa privada.** Hoje ela é pública: quem tem o link abre sem login. O caminho
passa a ser `/api/media/...`, que confere a org e redireciona para uma URL assinada, como no Xpot.
Provedores (Twilio, Meta) recebem uma URL assinada no envio, com validade suficiente para buscarem o arquivo.

Módulo único `src/lib/storage/` com `put`, `remove`, `publicUrl`, `signedUrl`, `signedUploadUrl`, `get`
e `list`. Usa o `@aws-sdk/client-s3` que já está no projeto, com os mesmos timeouts de
`lib/calls/upload-recording.ts`, mais `@aws-sdk/s3-request-presigner` (dependência nova).

Referências no banco: público segue como URL completa; privado vira `r2:<chave>`. Como cada linha diz
onde o arquivo está, URLs antigas e novas convivem durante a transição.

## 6. Código a alterar

| Área | Arquivos | Atenção |
|---|---|---|
| Avatares e ícones | `companies/actions`, `contacts/actions`, `space-icon`, `company-info/actions`, `workspace/actions`, `widget/actions`, `lib/contacts/store-avatar`, `zernio/process-event` | Simples |
| `profile-form.tsx` | Upload **direto do browser** | Vira server action. Tira uma dependência do token e da RLS de Storage |
| Branding | `favicon`, `landing-image`, `og-image`, `landing-config`, `landing-page.tsx:54` | A linha 54 tem a URL do Supabase fixa no código |
| Chat | `api/chat/upload`, `lib/chat/store-media`, `meta/media`, `telegram/storage`, `twilio/media`, `whatsapp/storage`, `chat-area/message-list` | Montam a URL à mão; rota privada e estado "expirada" |
| E-mail | `email-templates/upload`, `assets/cleanup`, `email/upload-quota` | Usa `list` para cota. Precisa ficar público |
| Screenshots | `services/website-analyzer/index.ts` | Só troca o destino do upload |
| Importação | `lib/import/storage*`, `import-actions`, `import-history-actions`, `functions/process-imports` | Upload direto do browser: CORS no R2 e `connect-src` no CSP. Já existe interface pronta para a troca |
| Conhecimento | `global-knowledge/upload`, `knowledge/upload`, `admin/knowledge/_actions`, `actions/knowledge`, `functions/process-embeddings` | A Edge Function recebe uma URL assinada em vez de ler o bucket |
| Gravações | `lib/calls/upload-recording`, `api/recording/upload` | `HETZNER_S3_*` vira R2; corrigir o descarte silencioso |

## 7. Fases

Cada fase é um release separado.

| Fase | Entrega | Como reverter |
|---|---|---|
| **1. Screenshots** | Job de retenção em simulação; conferir o relatório; ligar. A primeira execução limpa o acervo. Roda ainda no Supabase | Desligar a env. O que já foi apagado não volta |
| **2. Mídia de conversa** | "Mídia expirada" na tela; conferir quem relê mídia antiga; ligar 30 dias | Desligar a env. O que já foi apagado não volta |
| **3. Preparar o R2** | Buckets, domínio, credencial restrita a eles, CORS, env de produção no escopo certo (não Preview) e de dev | Sem impacto; nada usa ainda |
| **4. Novos uploads no R2** | Módulo de storage, chamadas trocadas, rota privada. Bucket a bucket, começando por `avatars`, por env. O job passa a limpar os dois lados | URLs públicas continuam acessíveis. Para privados, preservar a leitura/assinatura do R2 até copiar de volta os uploads novos e restaurar suas referências; desligar a env sozinho não basta |
| **5. Copiar o que restou** | Cerca de 136 MB. Script no servidor (não neste PC), manifesto com SHA-256, troca das URLs em transação com compare-and-set e manifesto de rollback no bucket privado | Aplicar o manifesto; a origem está intacta |
| **6. Observar e aposentar** | 14 dias. Depois, tirar o Supabase Storage do código e apagar o restante da origem, **só com sua autorização explícita** | Depois disso, não há volta |
| **Depois** | Seletor pago de retenção por org (coluna, tela, cobrança) | Fora deste plano |

Efeitos a aceitar na fase 6: links antigos do Supabase param de funcionar, inclusive imagens em e-mails
já enviados.

## 8. Como validar

- **Job:** em simulação, os números devem bater com a seção 4. Testar com falha na remoção: a URL não pode ser zerada.
- **Isolamento:** o job de uma org não toca outra. Na rota de mídia, usuário de outra org recebe 403/404; sem sessão, 401; bucket privado sem assinatura, rejeitado.
- Por bucket: enviar, abrir, substituir e remover, em staging (`xphere-stage.skale.club`).
- MMS e WhatsApp reais, com entrada e saída, conferindo que o provedor busca o arquivo.
- Importação de CSV completa e upload para a base de conhecimento (passam pelas Edge Functions).
- Depois da cópia: quantidade, SHA-256 e nenhuma URL do Supabase nas colunas conhecidas.
- Widget público: visitante sem sessão **pode precisar ver mídia**. Ainda não verifiquei esse caminho; se precisar, ele requer URL assinada própria.

## 9. Coordenação

- Migração de autenticação: `profile-form.tsx` e `lib/supabase` podem estar em uso naquela conversa. Executar em worktree próprio e combinar a ordem. As fases 1 e 2 quase não encostam nisso.
- `CLAUDE.md`: mudar o comportamento do analisador de sites exige atualizar `docs/prospecting/README.md` no repositório `xmail`, no mesmo ciclo.
- A API pública (`/api/v1/accounts`) passa a devolver screenshot nulo depois de 1 dia. Integrações que usam esse campo precisam saber.

## 10. Decisões em aberto

1. **Mídia de conversa privada:** proposta de sim.
2. **Fluenverse:** avisar antes de a regra de 30 dias apagar os arquivos dela.
3. **Gravações de chamada:** ir para `xphere-files`; definir se têm retenção própria. Não há proposta: é decisão de negócio e pode ter implicação legal.

## 11. Fase 4: como está implementada

Código inativo até a env existir. `src/lib/storage/index.ts` é a única porta (`put`, `remove`, `publicUrl`,
`signedUrl`, `signedUploadUrl`, `get`, `list`). Um bucket lógico só vai para o R2 se estiver em
`STORAGE_R2_BUCKETS` (ex.: `avatars,branding`); fora da lista, Supabase como antes. Bucket listado com
config incompleta **lança erro** (nunca cai em silêncio no Supabase). Variáveis em `.env.local.example`.

- Chave no R2: `<bucket-lógico>/<mesmo path de hoje>`. Públicos (`branding`, `avatars`, `email-assets`,
  `website-screenshots`) viram `R2_PUBLIC_BASE_URL/<chave>`. Privados (`chat-media`, `contact-imports`,
  `global-knowledge`, `knowledge-docs`, `recordings`) só por URL assinada.
- `/api/media/<bucket>/<org-id>/...`: exige sessão, confere que o usuário é membro da org do path e
  redireciona (302) para URL assinada de 5 min. 401 sem sessão, 404 para não-membro, path malformado ou
  traversal. `global-knowledge` não passa por ela (não tem org).
- Mídia de conversa com `chat-media` no R2 é gravada como `/api/media/chat-media/...`. Na saída, o
  `dispatch-outbound` assina (1 h) antes de entregar a Twilio/Zernio; o MCP `conversations_get_messages`
  devolve URLs assinadas. URLs antigas do Supabase seguem como estão.
- Leituras por path (`get`) caem para o Supabase se o objeto não está no R2; `remove` apaga dos dois lados.
  As linhas anteriores à virada guardam só o path.
- Importação CSV: o navegador faz PUT na URL assinada do R2 (o bucket precisa de CORS com PUT e o
  `connect-src` do CSP recebe `*.r2.cloudflarestorage.com` quando `STORAGE_R2_BUCKETS` existe no build).
  As Edge Functions `process-imports` e `process-embeddings` recebem `downloadUrl` no corpo e tentam
  essa URL antes do Supabase Storage.
- Gravações: com `recordings` no R2, `call_logs.recording_url` guarda `/api/media/recordings/...` e o player
  (`/api/calls/[id]/recording`) assina no servidor. Sem R2 e sem `HETZNER_S3_*`, `/api/recording/upload`
  agora responde 503 em vez de `ok` descartando o áudio.

Retenção nos dois lados: a mesma rota limpa Supabase e R2 durante a transição (ver seção 4). O banco fica
misturado até a fase 5 terminar; a fase 6 só começa depois que a retenção não encontra mais URL do Supabase.

Pontos que entregam URL a quem não tem sessão e por isso assinam na saída: `dispatch-outbound` (Twilio, Zernio),
`lib/twilio/send-sms.ts` (parâmetro `media_urls`, usado também por workflows), a ação `send_whatsapp_mention_all`,
o MCP `conversations_get_messages` e `calls_get`. Não passam pelo caminho de mídia: `routeWhatsAppReply` e
`sendWhatsAppMessage` (só texto nos dois chamadores) e `sendMetaMessage` (só texto). Quem lê `call.recording_url` nos
fluxos recebe a URL que a Vapi enviou, não a do R2.

Falha clara nas Edge Functions: `process-imports` e `process-embeddings` não ficam mais em `processing` quando o
arquivo só existe no R2 e não veio `downloadUrl`. A importação vai para `failed` com `status_message`, e a fonte de
conhecimento para `error` com `error_detail`; o download assinado tem timeout de 30 s.

## 12. Fase 5: como rodar o script de cópia

`scripts/r2-copy-remaining.ts`, **no servidor** (não neste PC). As partes puras (mapeamento de URL, escopo,
manifestos, planejamento do compare-and-set) estão em `src/lib/storage/copy-remaining.ts`, com testes em
`tests/r2-copy-remaining.test.ts`.

```bash
npx tsx scripts/r2-copy-remaining.ts                       # SIMULAÇÃO (padrão): só lê e imprime contagens
npx tsx scripts/r2-copy-remaining.ts --apply               # copia, confere SHA-256, grava manifestos, troca as referências
npx tsx scripts/r2-copy-remaining.ts --only branding,avatars --apply
npx tsx scripts/r2-copy-remaining.ts --rollback <manifesto>            # simulação do rollback
npx tsx scripts/r2-copy-remaining.ts --rollback <manifesto> --apply    # restaura os valores antigos
```

`<manifesto>` é um arquivo local ou uma chave no bucket privado, por exemplo
`migration-backups/2026-11-05/rollback-120000.json`.

Env: `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` sempre; para `--apply`, também as `R2_*`
(`R2_ACCOUNT_ID` ou `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`,
`R2_PRIVATE_BUCKET`, `R2_PUBLIC_BASE_URL`). Não depende de `STORAGE_R2_BUCKETS`.

O que faz, em ordem: lê as colunas de referência; copia cada objeto para o R2 (chave `<bucket>/<path>`) e **lê de
volta** o que subiu para comparar o SHA-256; grava no bucket privado, em `migration-backups/<data>/`, o manifesto de
rollback (tabela, id, coluna, valor antigo, valor novo) e o de objetos (chave, tamanho, sha256), lendo de volta; só
então troca as referências, cada uma com compare-and-set (só atualiza se a coluna ainda guarda o valor lido; perdeu a
corrida, lê de novo e tenta; depois de 3 tentativas registra conflito e deixa a linha em paz).

Escopo: `branding`, `avatars`, `email-assets` e `chat-media` só das mensagens dentro de 30 dias e sem
`media_expired_at` (as mais antigas são da retenção). `website-screenshots` é ignorado por inteiro. Objetos sem
referência são ignorados, exceto `email-assets`, copiado todo porque pode estar em e-mail já enviado (esse bucket não
tem referência a trocar no banco). Colunas: `accounts.avatar_url`, `contacts.avatar_url`,
`conversation_messages.metadata` (`media[].url` e `thumbnail_url`), `folders.icon`, `landing_config.cta_image_url`,
`landing_config.scroll_images`, `organizations.widget_avatar_url`, `organizations.logo_url`, `seo_config.og_image_url`,
`seo_config.favicon_url`, `website_analyses.logo_url`. Esta última costuma guardar logo do site do prospect (host
de terceiros): o script conta o que é externo, de website-screenshots ou de outro bucket, sem presumir nada.

Garantias: **nunca apaga do Supabase** (a interface de I/O nem tem essa operação); um objeto que já existe no R2 com
conteúdo diferente vira conflito e não é sobrescrito; uma cópia que não confere é removida do R2 e conta como falha;
reexecutar pula o que já está feito (objeto com o mesmo tamanho e sha256 gravado, referência já trocada). A saída tem só
contagens, sem URL, caminho ou conteúdo de cliente. Código de saída diferente de zero se houve falha, conflito ou erro.
Cada execução grava os próprios manifestos; para desfazer várias, rode `--rollback` em cada um.

