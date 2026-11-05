# Estudo: banco do Xphere fora do Supabase (Postgres no mesmo servidor)

Data: 2026-11-05. Status: estudo, nada foi alterado em produção nem em código.
Base: o repositório `xpot` (a referência que já fez essa saída), o plano
`xmail/docs/supabase-exit-plan.md` (fase 5 cobre o Xphere) e um levantamento do código
atual do Xphere. Números marcados "medido" vêm de contagem no repositório; o que não
dá para saber lendo código está na seção "Desconhecidos".

## 1. O que o export (Xpot) ensina

O Xpot saiu do Supabase em produção em 2026-11-03. O registro está em
`xpot/docs/supabase-production-exit.md`. O que dá para reaproveitar:

| Peça | Como o Xpot fez |
|---|---|
| Postgres de produção | Banco do Coolify (PG 17) no mesmo projeto do app, sem porta pública, URL interna em `POSTGRES_URL` |
| Dados | `pg_dump -Fc --schema=public --no-owner --no-privileges` do Supabase (conexão direta ou session pooler, `pg_dump` de versão >= servidor) e `pg_restore` no host. O dump leva a tabela de migrations e as sessões, então nada reroda e ninguém é deslogado |
| Migrations | Runner próprio com advisory lock, uma transação por arquivo, roda no boot do container; migration quebrada derruba o deploy e o Coolify mantém o container antigo |
| Backup | Diário do Coolify para R2, mínimo 14 dias, e um restore real num banco descartável (951 KB, 76 tabelas, SHA-256 registrado) |
| Rollback | Dump pré-corte, manifesto de referências e cópia imutável dos arquivos, tudo no bucket privado antes de mexer |
| Arquivos | R2, bucket público separado do privado, referências trocadas com compare-and-set numa transação |
| Dev | Supabase continua só como dev. `DEV_DATABASE_URL` + `DEV_SUPABASE_PROJECT_REF` obrigatórios; o seletor recusa a URL de produção; porta 6543 recusada porque o runner usa advisory lock de sessão |
| Release | Três releases separados: identidade, arquivos, depois remover o boot do Supabase em produção |

**Por que o Xpot foi fácil e o Xphere não:** o Xpot autoriza em código Express com Drizzle
e `pg`. Trocar o banco foi trocar uma connection string. O Xphere autoriza **no banco**
(RLS) e fala com ele por PostgREST. Um `pg_dump` sozinho não basta.

## 2. Quanto o Xphere depende do Supabase (medido)

| Dependência | Tamanho |
|---|---|
| Migrations | 334 arquivos |
| Chamadas `.from('...')` via supabase-js/PostgREST | 2.726 |
| Chamadas `.rpc(...)` | 283 |
| Arquivos que criam client Supabase | 480 (242 usam service role) |
| Policies RLS | 656 no banco real (329 `create policy` nos arquivos; o resto vem de loops). 237 usam `get_current_org_id`, 28 usam `auth.*` direto. Nenhuma tabela `public` sem RLS |
| Funções SQL | 141, das quais 128 ocorrências de `SECURITY DEFINER` |
| Migrations que citam `auth.*` (uid, jwt, users, role) | 78 |
| Componentes de browser com client Supabase | 11 (9 usam Realtime) |
| Código que usa Storage | 16 arquivos; 9 migrations tocam `storage.buckets/objects` |
| Edge Functions (Deno) | 4: `integration-health`, `process-embeddings`, `process-imports`, `push-sender` |
| Extensões instaladas | `vector` 0.8.0, `btree_gist`, `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, todas no schema `extensions`; `supabase_vault` no schema `vault` |
| pg_cron e pg_net | Extensões **não instaladas** neste banco (`cron.job` não existe). A migration `066` não deixou job ativo |
| Realtime | 8 migrations tocam a publication `supabase_realtime`, política `is_realtime_rls_check()` (1309) |

O que já está resolvido pela migração de autenticação (branch atual): o sign-in é Google
Identity Platform com sessão própria e `public.users`; as 83 FKs para `auth.users` já
apontam para `public.users` (migration 1336). Sobra a **ponte** `supabase-jwt.ts`, que
ainda gera um token Supabase por usuário via `admin.generateLink` + `verifyOtp` para o
PostgREST aceitar. O doc `docs/auth/identity-platform-migration.md` já diz que ela é
temporária e some com a saída do banco.

### Medição do banco real (2026-11-05, transação somente leitura)

| Item | Valor | O que significa |
|---|---|---|
| Versão | PostgreSQL 17.6, UTC | Mesma major do Xpot. Fuso igual ao do container |
| Tamanho | 150 MB (`public` 107 MB, 220 tabelas) | Pequeno. Dump e restore levam minutos, e a janela de corte pode ser curta |
| Maiores tabelas | `website_analyses` 22 MB, `accounts` 11 MB, `meta_audience_memberships` 8,6 MB, `contacts` 7,8 MB | Nada problemático |
| Compute atual | `shared_buffers` 224 MB, `max_connections` 60, 17 conexões abertas e 1 ativa na leitura | Instância pequena; um Postgres do Coolify com orçamento parecido atende |
| FKs de `public` para `auth`/`storage` | 0 | A migration 1336 já desacoplou. O dump de `public` fica autocontido |
| Usuários | 108 em `auth.users` e 108 em `public.users` | O doc de auth fala em "um punhado de contas"; conferir quantas são reais |
| Sessões novas | `app_sessions` 0, `auth_google_identities` 0 | O schema da nova autenticação está em produção, mas ninguém tinha entrado por ela na hora da leitura |
| Vault | 3 segredos VAPID, lidos por `get_push_vapid_config` (migration 1217) | **Não acompanha o dump.** Mover para env do app ao migrar o `push-sender` |
| Timeouts de role | `anon` 3 s, `authenticated` 8 s, `authenticator` 8 s, `lock_timeout` 8 s | Reproduzir no destino |
| `safeupdate` | Pré-carregado em `authenticator` | Bloqueia UPDATE/DELETE sem WHERE via PostgREST. **Não vem na imagem pgvector.** Ver seção 5 |
| Event triggers | `pgrst_ddl_watch`, `pgrst_drop_watch` | Recarregam o cache do PostgREST após DDL. Recriar ou dar `NOTIFY pgrst` ao fim de cada migration |
| Sequences em `public` | 3 | Quase tudo é UUID, risco baixo de divergência |
| Storage | ~1,1 GB em 11.466 objetos: `website-screenshots` 674 MB, `chat-media` 355 MB, `branding` 64 MB | Todo objeto está em bucket público, inclusive mídia de conversa de clientes. Vale decidir se `chat-media` fica privado no R2 |
| URLs persistidas | 11.420 referências em 13 colunas: `website_analyses` 10.336, `conversation_messages.metadata` 1.058 (JSON), o resto em logos, avatares e SEO | Reescrita com compare-and-set e manifesto de rollback, como no Xpot |
| Realtime | 9 tabelas publicadas | Bate com os 9 componentes |
| `DATABASE_URL` local | Porta 6543 (transaction pooler) | `pg_dump` e o runner de migrations precisam da conexão direta ou session pooler |

## 3. A decisão central: o que substitui o PostgREST

| Opção | O que é | Prós | Contras |
|---|---|---|---|
| **A. PostgREST próprio ao lado do Postgres** | Mesmo PostgREST que o Supabase usa, no Coolify, só na rede interna, com um proxy mapeando `/rest/v1` para a raiz | O código quase não muda: 2.726 `.from`, 283 `.rpc` e as 329 policies continuam valendo. `get_current_org_id()` lê `request.headers` e `request.jwt.claims`, que o PostgREST expõe igual, então o header `x-xphere-org` funciona sem mexer. Dev (Supabase) e prod falam o mesmo dialeto, que é o que o plano pede | Não cobre Auth, Storage nem Realtime (viram trabalho separado, ver 4). Mantém RLS por JWT assinado por nós, então a chave de assinatura vira segredo crítico. Mais uma peça para operar |
| B. Reescrever para SQL direto (Drizzle/`pg`) | Repositórios no servidor, `set_config` transação-local com o usuário e a org | É o destino "limpo" e o que o plano descreve | 2.726 pontos de chamada. Meses de trabalho e risco de regressão de autorização. Não dá para fazer como corte único |
| C. Supabase completo self-hosted | Docker compose do Supabase no servidor | Zero mudança de código | O plano rejeita (preserva a dependência) e o servidor tem 7,7 GB com 1,4 GB livres. Dezenas de contêineres |

**Recomendação: A agora, B por fatias depois, só se valer a pena.** A é o único caminho que
cabe como "migrar o banco" sem reescrever o produto. Atenção: o plano diz "não tente uma
troca global do client" e prefere repositórios de servidor; A é compatível porque o client
continua o mesmo e nada é trocado "globalmente", mas é **uma decisão sua**, ver seção 8.

Condição de segurança de A: o PostgREST fica **sem porta pública**. Hoje 11 componentes de
browser falam com o Supabase direto (9 por Realtime). Esses precisam sair do browser antes
do corte, senão o browser não tem mais para onde apontar.

## 3.1 pgvector: é motivo para ficar no Supabase?

**Não.** O pgvector é uma extensão open source do Postgres, e o Supabase só a instala. Ela
é a mesma fora de lá, e nenhuma função vetorial do Xphere depende de serviço do Supabase.
Isto é análise: nada foi instalado nem testado ainda (ver o portão abaixo).

| O que o Xphere usa | Medido |
|---|---|
| Colunas | `documents.embedding` e `ads_memories.embedding`, ambas `vector(1536)` (`text-embedding-3-small`) |
| Volume | Da ordem de 200 vetores (`ads_memories` 91 com embedding; `documents` ~104 pela estimativa do Postgres, que pode estar defasada) |
| Índices | HNSW com cosseno: 1,7 MB e 752 kB. Contador `idx_scan` = 0 nos dois desde o último reset de estatísticas |
| Busca | 3 funções SQL comuns: `match_documents`, `match_ads_memories`, `match_global_knowledge`, chamadas por `.rpc` |
| Geração de embeddings | Chamada à OpenAI, no app. `lib/knowledge/embed.ts`, `global-knowledge.ts` e `notion-sync.ts` já geram e gravam em Node |

Na opção A, as chamadas `.rpc('match_*')` continuam iguais, passando pelo PostgREST próprio.

Os cuidados reais, nenhum deles bloqueante:

1. **Imagem do banco.** Precisa de pgvector >= 0.8.0. Nenhum outro projeto nosso (Xpot,
   Xkedule, Xmail, Stuscle, Xcraper, Xpend, Xpeed) referencia pgvector nos arquivos que
   busquei, então o Xphere seria o primeiro a rodá-lo no Coolify. Confirmar no painel como
   escolher a imagem e que o backup agendado funciona com ela.
2. **Schema `extensions`.** A coluna é do tipo `extensions.vector` e 27 funções têm
   `search_path` com `extensions`. No destino: `CREATE EXTENSION vector SCHEMA extensions`
   antes do restore, senão as tabelas e funções não restauram.
3. **`process-embeddings` (Deno + LangChain `SupabaseVectorStore`).** É o único acoplamento
   de verdade na área, e é de runtime, não de banco. Ele tem 2 chamadores (`actions/knowledge.ts`
   e a versão admin) e pode ir para Node reaproveitando `embed.ts`.
4. **Memória se crescer.** O índice HNSW funciona melhor em RAM. Pelo tamanho atual (8 a 16 kB
   por vetor), 100 mil vetores dariam 1 a 1,5 GB de índice. Hoje não é problema, mas no host
   compartilhado vale acompanhar. É estimativa por extrapolação, não medição.

**Portão de decisão, no ensaio da fase 1:** restaurar num banco descartável, rodar as 3 funções
`match_*` com os mesmos vetores de consulta nos dois bancos e comparar os resultados. Como
HNSW é aproximado, comparar também com a busca exata. Se isso falhar, a decisão de sair é
revista antes de qualquer corte.

Se algo justificar ficar no Supabase, não é o pgvector. O que pesa é operação: backup, um
único servidor como ponto de falha e o custo de substituir PostgREST, Realtime e Storage.
Colocar banco e app no mesmo host melhora a latência, mas concentra a falha; isso só fica
mais confiável com backup externo testado e monitoramento.

## 4. Peças fora do Postgres

| Peça | Substituto | Observações |
|---|---|---|
| Ponte JWT | Assinatura local (HS256) no próprio `mintSupabaseJwt`, controlada por env (`DB_JWT_SECRET`) | Dá para entregar **antes** do corte: com a env ausente, mantém a ponte. Remove a dependência de `auth.users` sombra e uma chamada de rede por usuário |
| Realtime (9 componentes) | SSE autenticado alimentado por `LISTEN/NOTIFY`, ou polling limitado | Decidir por componente: `notification-bell`, `use-unread-count`, `chat-layout`, `credits-indicator`, `activity-feed-client`, `contact-status-board`, `use-outbound-call-status`, `import-detail-client`, `knowledge-manager`. O chat é o único que realmente quer baixa latência |
| Storage (16 arquivos) | R2 (bucket público separado do privado), como no Xpot | Plano próprio: [`docs/storage/r2-migration-plan.md`](../storage/r2-migration-plan.md). O código do Xphere não tem nenhuma referência a R2: tudo isso está no Supabase Storage hoje. Existe `lib/import/storage-supabase.ts` e `lib/contacts/store-avatar.ts` |
| Gravações de chamada | R2, junto com o resto | O código aponta para o Hetzner Object Storage (`HETZNER_S3_*`), mas essas variáveis **não existem em produção** (conferido no Coolify em 2026-11-05). As 18 gravações em `call_logs` são links da `api.twilio.com`, e `api/recording/upload` responde `ok` e descarta o áudio gravado no browser. O cliente S3 já existente serve de base para o R2 |
| Edge Functions (4) | Rotas Node ou workers no Coolify | `process-embeddings` é o mais delicado (pgvector, timeouts, idempotência). Cron: o repositório já usa GitHub Actions para tick |
| Vault (3 segredos VAPID) | Env do app | Sai junto com o `push-sender`. `get_push_vapid_config` deixa de existir no destino |
| Chamadas às Edge Functions | Rotas ou workers | `process-embeddings` (2 chamadores), `push-sender` (`lib/notifications/insert.ts`), `process-imports` (2 chamadores). `integration-health` não tem chamador no repositório; descobrir quem dispara |

Realtime, Storage e Edge Functions **independem de onde o banco mora**. Dá para migrá-los
enquanto o banco ainda está no Supabase, em releases separados e reversíveis, o que
diminui muito o risco do corte final. O plano também manda não juntar identidade, banco e
arquivos num release só.

## 5. Preparar o Postgres próprio

0. **Decidido (2026-11-05): o banco é um PostgreSQL do Coolify**, como o do Xpot: no mesmo projeto do app, sem porta pública, URL interna em `POSTGRES_URL`, backup agendado do Coolify para R2 (mínimo 14 dias). O PostgREST entra como um segundo recurso do Coolify na mesma rede interna.
1. Banco do Coolify com pgvector. O Postgres padrão do Coolify não traz a extensão `vector`: usar a imagem personalizada `pgvector/pgvector:pg17` (mesma major do Supabase, o Xpot confirmou 17.6) ao criar o banco, e conferir na fase 1 que `CREATE EXTENSION vector` e `btree_gist` funcionam e que o backup agendado do Coolify restaura com a imagem escolhida. Incluir `btree_gist`.
2. **Bootstrap de roles e funções que o Supabase dá de graça**: roles `anon`, `authenticated`, `service_role`, `authenticator` com os grants certos, e um schema `auth` mínimo com `auth.uid()`, `auth.jwt()` e `auth.role()` lendo `request.jwt.claims`. Sem isso, as 28 policies e 11 funções que usam `auth.*` e as migrations futuras não aplicam. Criar também o schema `extensions` e instalar nele `vector`, `btree_gist`, `pgcrypto` e `uuid-ossp`.
   **`safeupdate`:** o Supabase pré-carrega essa proteção no `authenticator`, e ela não existe na imagem `pgvector/pgvector`. Sem ela, um `.delete()` ou `.update()` sem filtro apaga a tabela inteira (limitado só pela RLS da org). Opções: imagem própria com `pg-safeupdate`, ou uma auditoria das chamadas. Prefiro a imagem própria.
3. Stubs para o que migrations antigas e novas ainda tocam: publication `supabase_realtime` (vazia), `storage.buckets/objects` (ou migrations novas condicionadas). Assim o mesmo arquivo de migration aplica no dev (Supabase) e na produção.
4. PostgREST na mesma major que o Supabase usa hoje, com `db-schemas`, `db-anon-role`, limite de linhas (`max-rows`) e `search_path` iguais aos do projeto atual. Diferença de configuração é a causa mais provável de regressão silenciosa.
5. Esquema `supabase_migrations` (histórico) deve ir no dump, senão `supabase db push --db-url` reaplica tudo. Alternativa: runner próprio como o do Xpot. Em qualquer caso a regra do CLAUDE.md continua: migration só por arquivo numerado, nunca DDL manual.
6. Backup diário para R2 com restore ensaiado, mais pré-corte (padrão Xpot). Se a perda de um dia for inaceitável para chamadas e conversas, avaliar WAL archiving/PITR.

## 6. Dev no Supabase: o cuidado que muda tudo

Hoje o banco de **produção** do Xphere é o projeto Supabase. O plano proíbe reaproveitar o
projeto de produção como dev enquanto ele for fonte de rollback, e esse banco guarda dados
reais (contatos, chamadas, conversas, prospects).

Recomendo:

- **Projeto Supabase novo e vazio para dev**, montado reaplicando as migrations e com seed sintético. O projeto atual vira arquivo de rollback e é aposentado só depois da observação (14 dias para o Xphere, segundo o plano).
- Copiar a trava do Xpot: `DEV_DATABASE_URL` + `DEV_SUPABASE_PROJECT_REF` obrigatórios, nunca cair em `POSTGRES_URL`, porta 6543 recusada se houver advisory lock.
- Qualquer cópia de produção para dev é explícita, com sanitização e com efeitos externos desligados (SMS, Vapi, Meta, ManyChat, e-mail). O padrão está em `xmail/docs/dev-database-pull.md`.

## 7. Capacidade do servidor

Medição do plano em 2026-11-03: 7,7 GiB de RAM, 1,4 GiB livres, 1,2 GiB de swap em uso,
20 GiB de disco livres (73% usado). Esse host já roda Xpot, Xkedule e outros. O build do
Xphere já saiu do servidor porque o `next build` estourava a memória.

O banco medido é pequeno (150 MB, índices vetoriais somando 2,5 MB, instância atual com
224 MB de `shared_buffers`), e os 1,1 GB de arquivos vão para o R2, não para o disco. Disco
não é o problema. RAM é o ponto a confirmar: 1,4 GiB livres com swap em uso é apertado
para mais um Postgres e um PostgREST. Antes de criar o banco: medir a memória de hoje no
host e o pico de conexões do Xphere. Se não couber, a saída é subir a máquina do Hetzner (o banco continua sendo do Coolify).
O plano do portfólio pede cautela em empilhar todos os bancos no host compartilhado, então
registrar a medição antes de criar o banco.

Ganho a registrar: o app roda na UE e o Supabase em us-west-2, cerca de 200 ms por `await`
sequencial. Banco no mesmo servidor derruba isso para uma fração de milissegundo, o que
melhora toda página do dashboard e o caminho dos webhooks de voz.

## 8. Plano de execução proposto

Cada fase é um release separado com rollback próprio.

| Fase | Entrega | Reversível? |
|---|---|---|
| 0. Medir | Tamanho do banco, extensões e schemas, jobs do pg_cron, objetos do Storage e URLs persistidas, uso de Vault/segredos no banco, ciclo de vida de conexões, capacidade do host | n/a |
| 1. Ensaio | Dump do Supabase restaurado num banco descartável no Hetzner, bootstrap de roles/auth, PostgREST, `xphere-stage.skale.club` apontando para ele. Rodar testes e smoke (login, org por aba, API keys `xph_`, busca vetorial, webhooks) | Sim, descartável |
| 2. Ponte JWT local | Assinatura local do token, por env, ainda sobre o Supabase | Sim, desliga a env |
| 3. Realtime para SSE/polling | Um componente por vez | Sim |
| 4. Storage para R2 | Copiar, conferir SHA-256, trocar referências com compare-and-set, manter origem | Sim, enquanto a origem existir |
| 5. Edge Functions e cron para workers/rotas | `process-embeddings` por último | Sim |
| 6. Corte do banco | Congelar escritores, dump final, restore, conferir contagens, sequences e totais, trocar a URL, smoke, retomar | Antes de novas escritas, sim. Depois, só reparo para frente |
| 7. Observação | 14 dias com backup e cron reais. Só então revogar credenciais e aposentar o projeto | n/a |

Ponto de atenção do corte (fase 6): webhooks de Vapi, Meta e ManyChat respondem sempre
200. Durante a janela de manutenção, um webhook confirmado e não gravado é dado perdido.
Precisa de fila durável ou janela curta em horário de baixo tráfego. O plano trata
webhook confirmado como dado que tem que ser preservado.

Também respeitar o `CLAUDE.md`: se o corte mexer em comportamento da prospecção
(verificação, import para o Xmail, audiências Meta), atualizar
`docs/prospecting/README.md` no repositório `xmail` no mesmo ciclo. O fluxo Xcraper para
Xphere para Xmail não pode parar sem alerta.

Ordem no plano do portfólio: Xphere é a fase 5, depois de Xmail, Xpend e Xcraper. As fases
2 a 5 acima não dependem disso e podem começar antes. O corte da fase 6 deve esperar o
roteiro do Xmail estar validado, já que os dois conversam.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Policy RLS que dependia de algo do Supabase e falha silenciosa (dado visível entre orgs) | Suite de teste cross-org no staging antes do corte; nenhuma policy desligada como atalho |
| PostgREST com config diferente (`max-rows`, schemas, search_path) | Copiar a config do projeto atual e comparar respostas de um conjunto de queries entre os dois |
| Chave de assinatura do JWT vazada ou rotacionada sem aviso | Segredo só no Coolify, rotação ensaiada, TTL curto como hoje (1 h) |
| Extensão `vector` em schema diferente do esperado por funções | Verificar `search_path` e o schema da extensão na fase 0 |
| Host sem memória | Medir na fase 0; separar o banco se preciso |
| Perda de webhook na janela | Fila durável ou janela curta; reconciliar após |
| Dev ficar com dados reais | Projeto novo e vazio, snapshot só explícito e sanitizado |
| Sequences e contagens divergentes após restore | Checklist de conferência por tabela e por totais de negócio, como no Xpot |

## 10. Desconhecidos (precisam de medição, não dá para ver no código)

Já respondidos pela medição: tamanho do banco, pg_cron/pg_net (não instalados), Vault (3
segredos VAPID), schema das extensões, volume do Storage e colunas com URLs.

Continuam abertos:

- Memória e pico de conexões do host hoje; o último snapshot é de 2026-11-03.
- Versão e configuração exatas do PostgREST do projeto (`db-schemas`, `max-rows`), que ficam no painel do Supabase e não no banco.
- Quem dispara a Edge Function `integration-health`.
- Como escolher a imagem no Coolify e se o backup agendado restaura com ela.
- Se os 108 usuários são contas reais (ver seção 2).

## 10.1 Coordenação com a migração de autenticação

A migração de autenticação corre em paralelo em outra conversa. Este estudo não toca nela, e o
plano depende dela nestes pontos:

- **A fase 2 (assinatura local do JWT) só começa depois que a autenticação estiver no ar.** Ela altera `src/lib/auth/supabase-jwt.ts`, arquivo daquela migração.
- `src/app/api/auth/token/route.ts` entrega o token ao browser. Ele só pode sair depois que os 9 componentes de Realtime saírem do browser (fase 3).
- Numeração de migrations: a última é a 1336. Combinar antes de criar arquivo novo para os dois trabalhos não pegarem o mesmo número.
- Em 2026-11-05, durante este estudo, o checkout passou de `feat/identity-platform-auth` para `main`, por trabalho da outra conversa. Duas conversas no mesmo checkout podem trocar o branch uma da outra, então a execução deste plano deve usar um worktree próprio.

## 11. Decisões que dependem de você

1. **Aceitar a opção A** (PostgREST próprio) como destino de curto e médio prazo, com reescrita para SQL direto só por fatias e sem prazo.
2. ~~Onde o Postgres mora~~ **Decidido: banco do Coolify, como os outros projetos.** Resta só confirmar na fase 0 que o host aguenta (seção 7); se não aguentar, a saída é subir a máquina, não mudar de modelo.
3. **Dev em projeto Supabase novo e vazio**, deixando o projeto atual como arquivo de rollback.
4. **Janela de manutenção** para o corte final e como tratar os webhooks nela.
