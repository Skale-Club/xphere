# Plano de execução: banco do Xphere fora do Supabase

Data: 2026-11-05. Base: [estudo](self-hosted-postgres-study.md). Arquivos: [plano do R2](../storage/r2-migration-plan.md).

## Decisões (2026-11-05)

| Decisão | Escolha |
|---|---|
| Onde fica o banco | PostgreSQL do Coolify, no mesmo projeto do app, sem porta pública, igual ao Xpot |
| Acesso aos dados | PostgREST próprio na rede interna. As 2.726 chamadas `.from`, 283 `.rpc` e 656 policies continuam valendo |
| Banco de dev | O Supabase atual vira dev **no próprio dia do corte**, como último passo do roteiro |
| Caminho de volta | Dump final verificado no R2 privado e backup do banco novo com restore testado, não o banco antigo |
| Webhooks na janela | Janela curta em horário de pouco uso, com conferência dos webhooks recebidos depois |

## Medição (2026-11-05)

| Item | Valor |
|---|---|
| Servidor | Hetzner CX32 `skaleclub-apps`: 4 CPUs, 7,7 GB de RAM com 4,4 GB disponíveis, swap 700 MB em uso, 27 GB de disco livres |
| Bancos no Coolify hoje | `xpot-db` e `xpeed-db`, ambos `postgres:17-alpine`, sem porta pública |
| Banco do Xphere | 150 MB, PG 17.6, 17 conexões abertas e 1 ativa |
| pgvector | 0.8.0, cerca de 200 vetores, 2 índices HNSW de 2,5 MB no total |
| Config do PostgREST no Supabase | Não lida: fica no painel, não no banco. Ler antes do ensaio |

## Fase A — tirar dependências, ainda no Supabase

Cada item é um release separado e reversível. Nada disso exige janela.

| Item | O que muda | Situação |
|---|---|---|
| A1. Realtime | 9 componentes passam para polling com pausa quando a aba está oculta. Chat aberto em intervalo curto, o resto em intervalo longo | Em andamento |
| A2. Edge Functions | `process-imports`, `process-embeddings` e `push-sender` viram código Node no app. `integration-health` não tem chamador no repositório, no `skale-cron` nem nos workflows: confirmar se é código morto | Em andamento |
| A3. Vault | As 3 chaves VAPID passam do Vault para uma tabela criptografada com `src/lib/crypto.ts`, copiadas por script, sem a chave passar por pessoas | Em andamento |
| A4. Ponte de JWT | O app assina o token do PostgREST com um segredo próprio. Exige um segredo novo no Coolify, criado pelo dono da conta | Pendente |

## Fase B — ensaio

1. Imagem própria: `pgvector/pgvector:pg17` mais `pg-safeupdate`.
2. Banco descartável no Coolify, sem porta pública.
3. Bootstrap: roles `anon`, `authenticated`, `service_role`, `authenticator`; schema `extensions` com `vector`, `btree_gist`, `pgcrypto`, `uuid-ossp`; schema `auth` mínimo (`uid()`, `jwt()`, `role()`); timeouts por role iguais aos do Supabase; stubs da publication `supabase_realtime` e de `storage`.
4. `pg_dump -Fc` de `public` e `supabase_migrations` pela conexão direta, `pg_restore` no host.
5. PostgREST com a mesma configuração do Supabase, atrás de um proxy que mapeia `/rest/v1`.
6. Staging (`xphere-stage.skale.club`) apontado para o ensaio.
7. Portões:
   - pgvector: as 3 funções `match_*` com os mesmos vetores nos dois bancos;
   - isolamento entre orgs;
   - login;
   - API keys `xph_`;
   - webhooks;
   - contagens e sequences.

## Fase C — corte

1. Dump final para o R2 privado, com SHA-256 e um restore conferido.
2. Congelar os escritores e o `skale-cron`, e anotar a hora de início.
3. Dump, restore e conferência de contagens, sequences e totais.
4. Trocar a URL do app, deploy e smoke em produção.
5. Retomar os crons e conferir os webhooks recebidos na janela.
6. Backup do banco novo com restore testado.
7. O Supabase atual vira dev:
   - `ENCRYPTION_SECRET` própria no dev, para as integrações reais não abrirem;
   - Edge Functions e gatilhos de produção desligados;
   - fora do keepalive;
   - trava local no estilo do Xpot (`DEV_DATABASE_URL` e o ref do projeto).

## Pendências que dependem do dono da conta

- Trocar o token do Coolify e a senha do banco, que vazaram em 2026-11-05.
- Criar o segredo do JWT (A4) no Coolify.
- Chave do R2, em andamento pelo Codex.
