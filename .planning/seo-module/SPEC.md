# Módulo SEO: auditoria técnica, Search Console e rank tracking

**Status:** rascunho (2026-10-05). Aguarda as decisões da Fase 0 · execução direta por fases, sem ciclo GSD
**Objetivo:** dar a cada org um "Ahrefs/Semrush básico" dentro do Xphere. O módulo responde três perguntas:
(1) o que está quebrado no site, (2) como o Google está vendo e mandando tráfego, e (3) onde o site
está posicionado nas palavras-chave que importam. Tudo multi-tenant, multi-site por org, e acionável
por workflow, MCP e Copilot.

## Estado atual (diagnóstico)

Hoje não existe nada de SEO de verdade no app. O que encosta no tema:

| Peça | Onde | Serve para SEO? |
|---|---|---|
| SEO & Branding (admin) | `src/app/(admin)/admin/seo`, `src/lib/seo.ts` | Não. É só a metadata do próprio xphere.app |
| Website Analyzer | `src/services/website-analyzer/` | Parcial. Abre **uma** página no Chromium, dá uma "nota de lead" para prospect e está preso a `accounts` (`website_analyses.account_id NOT NULL`) |
| SerpAPI | `src/lib/serpapi/client.ts` | Só raspa reviews. Chave BYO por org em `google_business_profiles` |
| Analytics | `/analytics`, tabelas `analytics_*` | Tráfego próprio. Tem `analytics_setups.primary_website_url`, mas é **1 site por org** (UNIQUE) |
| Guard de SSRF | `src/lib/flows/url-guard.ts` (`assertPublicHttpUrl`), `src/lib/ads/safe-fetch.ts` | Sim. Reusar no crawler, revalidando a cada hop de redirect |
| Search Console | nenhum | Não existe |

## Decisões de arquitetura (já tomadas neste plano)

1. **O crawler NÃO usa Chromium.** O crawler é `fetch` + `cheerio` (cheerio já é dependência). O pool de Chromium
   tem 2 slots, compartilhados com o analyzer de prospects, e o incidente de 2026-08-30 (74 Chromium
   derrubaram o box) mostra que não cabe mais carga ali. Core Web Vitals vêm da **API do PageSpeed Insights**
   (grátis, 25k req/dia), não de Lighthouse local. Renderização JS fica como modo opcional e posterior,
   só para a home, via `withBrowserSlot`.
2. **O crawl é retomável e roda em fatias de cron**, não fire-and-forget. Cada push em `main` faz rolling
   deploy e mata promises em voo. A fronteira do crawl vive no banco (`seo_audit_pages.status =
   queued|fetched|failed`). Um tick de cron processa N páginas dentro de um orçamento de **≤60s**
   (o teto da Cloudflare é 100s) e o próximo tick continua de onde parou.
3. **Há tabelas próprias de SEO** (`seo_*`); o módulo não generaliza `website_analyses` nem `analytics_setups`.
   O site do Analytics só serve como sugestão no "Adicionar site".
4. **O orçamento de banco é o do Supabase Free (500 MB).** Toda tabela de série temporal tem agregação e
   retenção definidas desde a migration (ver "Volume de dados").
5. **Search Console usa o padrão de `integrations`.** Provider novo no enum, tokens cifrados com
   `src/lib/crypto.ts`, `prompt=consent` e marcação de saúde em `invalid_grant` (copiar
   `src/lib/ads/connection-health.ts`). Isso faz os nós de workflow sumirem do spec quando a integração cai.
6. **Rank tracking e keyword research passam por um adapter** (`SeoDataProvider`), não por um fornecedor
   amarrado ao código. Assim dá para trocar DataForSEO ↔ SerpAPI ↔ Ahrefs sem mexer em UI e jobs.
7. **Migrations só via `npx supabase db push`.** A próxima livre é **1312**. Antes de numerar, confira contra
   `origin/main`, não contra o working tree.

## Fase 0: Decisões e pré-requisitos (sem código)

- [ ] **D1. Fornecedor de dados pagos (Fase 3) e quem paga.** Recomendação: **DataForSEO com chave da
      plataforma** (SERP a ~US$0,0006/consulta na fila standard; volume e ideias via Labs) com limite por
      plano e um ledger de uso. A alternativa é BYO key por org (padrão SerpAPI), que tem atrito de
      onboarding. Ahrefs API é cara demais para revender.
- [x] **D2. Projeto Google Cloud do OAuth do Search Console.** **Decidido (2026-10-05): reutilizar o client
      OAuth genérico que já existe (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, o mesmo do Google Contacts).** Sem client
      nem env novos. O Search Console é um grant separado (rotas próprias `/api/google/search-console/{connect,callback}`,
      linha própria em `integrations` com provider `google_search_console`), pedindo só `openid email
      webmasters.readonly`, então conectar o GSC não mexe no token do Contacts e vice-versa. O login do usuário
      (Supabase Auth com Google) não serve para isso: o Supabase não guarda o refresh token do Google e o login só
      pede `email profile`. O que se reaproveita é o client/projeto, não a sessão.
      Ainda é preciso, no console desse projeto: (1) ativar a **Google Search Console API**; (2) adicionar o escopo
      `webmasters.readonly` à tela de consentimento; (3) cadastrar o redirect
      `https://xphere.app/api/google/search-console/callback`; (4) conferir o status de publicação. `webmasters.readonly`
      é escopo **sensível**: se o app estiver em "Testing", o refresh token expira em 7 dias; se estiver em produção,
      o escopo novo entra na fila de verificação do Google. Isso não bloqueia o código da Fase 2, só o uso por
      clientes externos.
- [ ] **D3. Público.** O módulo é ferramenta interna da agência (Skale Club operando sites de clientes) ou
      self-serve para a org cliente? Isso muda a prioridade do relatório white-label (Fase 4) e dos limites.
- [ ] **D4. Gating.** Quais planos recebem `seo` em `src/lib/billing/catalog.ts`, e os limites
      (sites/org, páginas/auditoria, keywords rastreadas).
- [ ] Criar `GOOGLE_PSI_API_KEY` (PageSpeed Insights) e subir via `coolify-set-envs.yml`. **Não rodar isso
      durante um deploy do build-deploy**, porque a var é gravada mas o container não reinicia.

## Fase 1: Fundação + auditoria técnica (o "Site Audit") ✅ BUILT 2026-10-05 (aguarda `db push` + QA em prod)

**Entregue:** migration 1312, motor em `src/lib/seo/` (crawler, ~40 checks, PSI, score), `/api/cron/seo-tick`,
telas `/seo` e `/seo/[siteId]` (Visão geral · Issues com sheet `?issue=` · Páginas com sheet `?page=`), modal de
configurações, permissões `seo.view`/`seo.manage`, feature `seo`. Testes: `tests/seo-*.test.ts` (47), incluindo
um teste ponta a ponta do motor contra banco em memória (setup → crawl → finalize, retomada entre ticks sem
duplicar issues, limite de páginas, bloqueio por WAF). SQL validado em PGlite (idempotência, claim/lease,
enqueue, retenção, grants).

**Desvios do plano abaixo:**
- Sem RPC `reclaim_stale_seo_audits`: `claim_seo_audits` usa lease (`lease_expires_at`, 150s). Lease vencido é o
  reclaim. Falha num tick → `attempts++` com backoff 1/5/15/60 min; na 5ª vira `failed`.
- Proteção de SSRF em duas camadas: `assertPublicHttpUrl` por hop **e** `lookup` validado no próprio socket
  (undici `Agent`), o que fecha DNS rebinding. `undici` virou dependência direta (já vinha via cheerio).
- `user_agent_mode` (`googlebot_like`) **não** foi implementado: fingir ser o Googlebot contradiz "não há tentativa
  de contornar". `gsc_property` fica para a migration da Fase 2.
- `stage` (`setup|crawl|finalize|done`) em `seo_audits`; `source` (`page|final`) em `seo_audit_issues` para
  re-finalização idempotente; `links text[]` em `seo_audit_pages` guarda o grafo de links.
- Limite de páginas por auditoria: opções 50/100/200/500 na UI (o banco aceita até 5000) até a D4.
- `'seo'` entrou no plano **Pro** (e Enterprise via `ALL_FEATURES`) como default provisório até a D4.
- `custom-role-dialog.tsx` não existe; o ícone foi adicionado só em `role-matrix.tsx`.

**Pendências operacionais (fora do repo):**
1. `npx supabase db push` (aplica a 1312; este ambiente não tem credenciais).
2. Adicionar `/api/cron/seo-tick` ao crontab do **skale-cron** a cada 1 min (com heartbeat, como os outros).
   `.github/workflows/seo-tick.yml` é só o disparo manual.
3. `GOOGLE_PSI_API_KEY` via `coolify-set-envs.yml` (sem ela o PSI usa a cota anônima, que é pequena).
4. QA: auditar o site da Skale Club ponta a ponta e fazer um deploy no meio do crawl.


### 1a. Schema (`1312_seo_module.sql`)

- `seo_sites`: `id`, `org_id`, `name`, `root_url`, `host`, `crawl_max_pages` (default por plano, ex. 200),
  `audit_schedule` (`off|weekly|monthly`), `next_audit_at`, `user_agent_mode` (`xphere|googlebot_like`),
  `gsc_property` (Fase 2), `created_by`, timestamps. `UNIQUE (org_id, host)`.
- `seo_audits`: `id`, `org_id`, `site_id`, `status` (`pending|running|completed|failed|dead`), `trigger`
  (`manual|schedule|workflow|mcp`), `pages_discovered`, `pages_crawled`, `health_score` 0–100,
  `summary` jsonb (contagem por severidade/código), `site_checks` jsonb (robots, sitemap, https, www),
  `attempts`, `next_attempt_at`, `started_at`, `finished_at`, `error_message`. Índice único parcial com
  **1 auditoria ativa por site** e RPC `reclaim_stale_seo_audits`, os dois copiados do padrão 1273/1298.
- `seo_audit_pages`: `audit_id`, `url`, `depth`, `status` (`queued|fetched|failed|skipped`),
  `http_status`, `redirect_to`, `ttfb_ms`, `content_type`, `bytes`, `title`, `meta_description`,
  `h1_count`, `word_count`, `canonical`, `indexable`, `in_sitemap`, `inlinks`, `outlinks`, `content_hash`.
  `UNIQUE (audit_id, url)`, que é a própria fronteira do crawl.
- `seo_audit_issues`: `audit_id`, `page_id` (null = issue de site), `code`, `severity`
  (`error|warning|notice`), `details` jsonb. Índice `(audit_id, code)` para a visão "issue X afeta N páginas".
- RLS `org_isolation` em todas (padrão `1111_ads_journey.sql`), com escrita via service role nos jobs.
- **Retenção:** manter páginas e issues só das **últimas 3 auditorias completas por site**. As anteriores
  ficam apenas com `seo_audits.summary` e `health_score`, que alimentam o gráfico de histórico. A limpeza
  roda no próprio tick.

### 1b. Crawler (`src/lib/seo/crawler/`)

- `fetch-page.ts` faz GET com timeout de 15s, teto de 2 MB de HTML, no máximo 5 redirects e
  `assertPublicHttpUrl` **em cada hop**. A chamada a esse guard fica num único helper; as duas cópias de
  `isPrivateAddress` não são estendidas.
- `robots.ts` e `sitemap.ts` leem robots.txt (respeitam `Disallow` para o UA do Xphere) e sitemap.xml,
  incluindo índices de sitemap e gzip. As URLs do sitemap entram na fronteira com `in_sitemap=true`.
- `frontier.ts` faz BFS só no mesmo host, normaliza URLs (remove fragmento e parâmetros de tracking
  `utm_*`/`gclid`/`fbclid`), respeita o limite `crawl_max_pages` e faz no máximo 4 fetches concorrentes
  por auditoria, com um delay educado por host.
- UA `XphereBot/1.0 (+https://xphere.app/bot)`. Sites atrás de Cloudflare/WAF que bloquearem (403/503 com
  challenge) viram issue `crawl_blocked` com instrução de liberar o UA. Não há tentativa de contornar.

### 1c. Checks (`src/lib/seo/checks/`): funções puras, testadas com fixtures HTML

Catálogo em `catalog.ts`: `code`, severidade, peso no score, título e "como corrigir".

- **Página:** 4xx/5xx; cadeia de redirect >1; redirect 302 onde deveria ser 301; title ausente, duplicado
  ou fora de 30–60 caracteres; meta description ausente, duplicada ou fora de 70–160; H1 ausente ou
  múltiplo; canonical ausente, apontando para outra URL ou para não-200; `noindex` em página do sitemap;
  imagem sem `alt`; conteúdo fino (<300 palavras); mixed content; `lang` ausente; viewport ausente;
  OG/Twitter ausentes; sem JSON-LD; TTFB >800 ms; página órfã (no sitemap, 0 inlinks).
- **Cross-page:** links internos quebrados (com a página de origem), conteúdo duplicado via `content_hash`,
  canibalização de title.
- **Site:** robots.txt ausente ou bloqueando tudo; sitemap ausente ou inválido; http→https; consistência
  www/apex; sitemap com URLs não-200 ou noindex.
- **Core Web Vitals:** PSI (mobile) na home e em até 4 páginas com mais inlinks. Guardar LCP, INP, CLS e o
  score de performance em `site_checks`.
- **Health score:** 100 menos as penalidades ponderadas, normalizadas pelo nº de páginas. Errors pesam
  muito mais que notices. Documentar a fórmula no catálogo.

### 1d. Execução

- `src/app/api/cron/seo-tick/route.ts` usa Bearer `CRON_SECRET` fail-closed (padrão `ads-tick`),
  `maxDuration` 90 e orçamento de 60s. Em cada tick:
  1. Reclama auditorias travadas.
  2. Enfileira auditorias agendadas (`next_audit_at <= now()`).
  3. Avança a fronteira das auditorias `running` (round-robin entre orgs).
  4. Quando a fronteira esvazia, roda os checks cross-page e de site, o PSI e o score, e marca `completed`.
  5. Faz a limpeza de retenção.
- Agendar no **skale-cron** (crontab fora do repo, a cada 1 min) e mandar heartbeat em `/api/cron/heartbeat`.
  Opcionalmente, um `workflow_dispatch` para disparo manual.
- O botão "Rodar auditoria" só insere `pending`; o primeiro tick começa a auditoria em ≤1 min.

### 1e. UI, permissões e gating

- Nav: `/seo` em `nav-items.ts` (grupo `manage`, ao lado de Analytics), com `permission: 'seo.view'` e
  `feature: 'seo'`.
- RBAC: grupo `seo` com `seo.view` e `seo.manage` em `src/lib/rbac/permissions.ts`. Adicionar o ícone **nos
  dois mapas**, `role-matrix.tsx` e `custom-role-dialog.tsx`. Usar `can()`/`requirePermission()` no
  `layout.tsx` de `/seo` e em toda server action, porque esconder o item da nav não protege a página.
- Billing: incluir `'seo'` em `ALL_FEATURES` e nos planos da D4; `requireFeature('seo')` nas actions.
- Telas (critério página vs popup do spec de Calls):
  - `/seo`: cards dos sites com health score, tendência e (Fase 2) cliques em 28 dias. "Adicionar site"
    abre um **modal** pré-preenchido com `analytics_setups.primary_website_url`.
  - `/seo/[siteId]`: abas **Visão geral** (score, histórico, top issues, CWV), **Issues** (agrupadas por
    código; clicar abre um **sheet** `?issue=<code>` com as páginas afetadas e o "como corrigir") e
    **Páginas** (tabela filtrável).
  - As configurações do site (agenda, limite, UA, propriedade GSC) ficam num **modal**.

### 1f. Testes

- `tests/seo-checks-*.test.ts` com fixtures HTML por check.
- `tests/seo-crawler-frontier.test.ts` cobre normalização, mesmo host e robots.
- `tests/seo-url-guard.test.ts` cobre SSRF: IP privado, redirect para 169.254.169.254 e DNS rebinding
  no hop.
- `tests/seo-score.test.ts`.

**Pronto quando:** um site real (ex. o site da Skale Club) é auditado de ponta a ponta sobrevivendo a um
deploy no meio do crawl, a UI lista as issues com as páginas afetadas e `npm run build` passa.

## Fase 2: Google Search Console ✅ BUILT 2026-10-05 (aguarda `db push` da 1313 + config no Google Cloud)

**Entregue:** migration 1313 (enum `google_search_console`, colunas `gsc_*` em `seo_sites`, `seo_gsc_daily`,
`seo_gsc_top`, RPCs `claim_gsc_syncs` e `prune_seo_gsc_top`); OAuth em `/api/google/search-console/{connect,callback}`
reaproveitando `GOOGLE_CLIENT_ID` (D2); card "Google Search Console" em Integrations (categoria nova "SEO"); sync
diário dentro do `seo-tick` (até 3 sites por tick, backfill de 16 meses na primeira vez, re-sync dos últimos 5 dias,
snapshot semanal do top 500 de queries e páginas); aba **Performance** em `/seo/[siteId]` (conectar → escolher
propriedade → KPIs com comparação de período, gráfico, top queries/páginas e três listas de oportunidades: "quase
na página 1", "CTR baixo para a posição" e "corrigir primeiro: páginas com tráfego e issues"); cliques de 30 dias
nos cards de `/seo`; banner de reconexão quando o grant morre (`invalid_grant` → `health_status='disconnected'`).
Testes: `tests/seo-gsc.test.ts` e `tests/seo-gsc-sync.test.ts` (backfill → incremental, snapshot semanal, grant
desconectado). SQL validado em PGlite.

**Desvios / decisões de implementação:**
- **Uma conexão GSC por org** (`integrations` é único por org+provider). Para a agência, conectar uma conta Google
  com acesso a todas as propriedades dos clientes; cada site escolhe a sua.
- O callback do Google volta sem o org da aba: a org é capturada no `/connect` e guardada junto ao state CSRF;
  o callback usa `createClientForOrg()` (novo, em `src/lib/supabase/server.ts`) e confere que o usuário é membro.
- O seletor de propriedade fica na própria aba Performance (não no modal de configurações).
- **Adiado:** drill-down ao vivo com cache no Redis, URL Inspection API e o comparativo de período nas tabelas de
  top (as tabelas mostram o snapshot de 28 dias). Nós GSC de workflow ficam para a Fase 4.

**Pendências operacionais:** `npx supabase db push` (1313) e os 4 passos da D2 no Google Cloud Console (ativar a
Search Console API, adicionar o escopo `webmasters.readonly`, cadastrar o redirect
`https://xphere.app/api/google/search-console/callback`, conferir o status de publicação/verificação).


- **Migration:** `ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'google_search_console'` (a
  1253 mostra o callback falhando calado sem isso). Atualizar a union em `src/types/database.ts` e em
  `integrations/actions.ts`.
- **OAuth:** `src/app/api/google/search-console/{connect,callback}/route.ts` usa state em cookie,
  `access_type=offline` + `prompt=consent` e grava em `integrations` (`health_status: 'connected'`,
  `key_hint` = email). Refresh proativo, como `getCalendarTokens`, e `invalid_grant` marca
  `health_status='disconnected'`, que faz aparecer um banner "Reconectar" no módulo SEO.
- **Registry:** card em `src/lib/integrations/registry.ts` (`panelType: 'custom'`, padrão Google Calendar).
- **Propriedade por site:** picker no modal do site usando `sites.list`, que aceita `sc-domain:` e
  prefixo de URL.
- **Sync diário** (`seo-tick` ou `seo-gsc-tick`, no máx. 1×/dia por site):
  - `seo_gsc_daily`: `site_id`, `date`, `device`, `clicks`, `impressions`, `ctr`, `position`. Backfill de
    16 meses ao conectar.
  - `seo_gsc_top`: `site_id`, `window_end`, `dimension` (`query|page`), `key`, métricas. Top 500 por
    dimensão em **janelas semanais de 28 dias**, com retenção de 26 semanas.
  - Drill-down livre (query×página, país, filtros) vai **ao vivo** na API, com cache no Redis (Upstash) de
    6h. Nada disso é persistido.
- **UI:** aba **Performance** com gráficos de cliques, impressões, CTR e posição, comparação de períodos,
  e top queries e páginas.
  - **Oportunidades:** queries na posição 4–20 com impressões altas (ganhos rápidos); CTR muito abaixo do
    esperado para a posição (reescrever title/meta).
  - **Cruzamento com a auditoria:** páginas com tráfego e issues sobem na lista de prioridade.
- **Opcional:** URL Inspection API (status de indexação das páginas-chave; cota de 2.000/dia/propriedade).

**Pronto quando:** a org conecta o GSC, escolhe a propriedade, vê 16 meses de histórico, e um token
revogado mostra o banner e tira os nós GSC do spec de workflows.

## Fase 3: Palavras-chave e rank tracking (dados pagos)

- `src/lib/seo/providers/` define a interface `SeoDataProvider { serp(), keywordIdeas(), keywordMetrics() }`,
  com a implementação DataForSEO (D1) e a SerpAPI como adapter alternativo, reaproveitando `client.ts`.
- **Schema:**
  - `seo_keywords`: `site_id`, `keyword`, `location_code`, `language`, `device`, `tags[]`.
  - `seo_rank_checks`: `keyword_id`, `checked_at`, `position`, `url`, `serp_features` jsonb,
    `competitors` jsonb (top 10).
  - `seo_usage`: ledger por org e mês, contando consultas e custo, que serve de base para o limite do plano.
- **Rank tracking:** checagem semanal (diária nos planos maiores) via tick. Aba **Keywords** com posição
  atual, variação, URL ranqueada, gráfico por keyword, distribuição (top 3/10/100) e concorrentes
  detectados na SERP. Suporte a local (cidade) é importante para clientes de serviço local.
- **Keyword research:** a partir de uma seed, gerar ideias com volume, KD, CPC e intenção, e oferecer
  "Rastrear". Sugestões também vêm das queries do GSC que ainda não estão rastreadas.
- **Observação:** com GSC conectado, a posição média das queries que **já** ranqueiam é grátis. A Fase 3
  se justifica para keywords que ainda não ranqueiam, para concorrentes e para local pack. Dá para lançar
  a Fase 2 e medir a demanda antes de pagar dados.

## Fase 4: Automação, IA e relatório 🟡 PARCIAL 2026-10-05 (feito antes da Fase 3, que aguarda a D1)

**Entregue:**
- **Workflows:** ação `seo_run_audit` (site por id, host ou URL; devolve a auditoria em andamento em vez de falhar)
  e eventos `event:seo.audit_completed` / `event:seo.critical_issue_new` (erro novo em relação à auditoria anterior;
  nunca na primeira). Emitidos só pela chamada que fez a transição para `completed`. Variáveis `seo.*` no spec e no
  seletor do canvas, entradas na paleta, `SPEC_VERSION` 2026.10.05, exemplos validados em
  `.planning/workflows/examples/seo-*.yaml`.
- **MCP:** `seo_list_sites`, `seo_get_audit`, `seo_list_issue_pages`, `seo_get_search_performance`, `seo_run_audit`
  (exige `seo.manage` via `userCanInOrg`, que reaproveita a decisão de `can()` extraída para
  `src/lib/rbac/decide.ts`). Sem checagem de plano: os entitlements dependem de sessão e nenhuma tool MCP faz isso hoje.
- **Copilot:** as mesmas 5 tools (leitura exige `seo.view`; `seo_run_audit` exige `seo.manage` + plano) e uma seção
  SEO no system prompt. Tudo em cima de `src/lib/seo/service.ts`.
- **Plano de ação por IA:** botão na Visão geral, sob demanda (migration 1314: `seo_audits.action_plan`). Cinco ações
  priorizadas com os dados do GSC e reescritas de title/meta, no idioma do navegador, via OpenRouter (chave da org,
  depois a da plataforma; modelo `SEO_ACTION_PLAN_MODEL` ou o padrão do Copilot), debitado como créditos
  (`seo_action_plan`).

**Pendente:** `seo_track_keyword`, `event:seo.rank_changed` e nós GSC de workflow (dependem da Fase 3 / de demanda);
relatório mensal white-label (depende da D3).


- **Workflows** (`src/lib/workflows/spec.ts` + executor em `src/lib/action-engine/executors/`, bump do
  `SPEC_VERSION`):
  - Triggers: `event:seo.audit_completed`, `event:seo.critical_issue_new` (issue de severidade error que
    não existia na auditoria anterior) e `event:seo.rank_changed` (queda ≥ N posições). O emissor segue o
    padrão `src/lib/contacts/events.ts`.
  - Ação: `seo_run_audit`.
  - Nós GSC com `integration_required: ['google_search_console']`.
  - Teste no molde de `tests/ads-workflow-action.test.ts`.
- **MCP:** `src/lib/mcp/tools/seo.ts` (`seo_list_sites`, `seo_get_audit`, `seo_list_issues`,
  `seo_gsc_performance`, `seo_keyword_positions`, `seo_run_audit`, `seo_track_keyword`). O MCP hoje **não
  checa RBAC**, só a org; as tools de escrita precisam checar `seo.manage` no handler.
- **Copilot:** `src/lib/copilot/tools/seo.ts` (registry separado do MCP), mais uma seção em
  `system-prompt.ts`.
- **IA (OpenRouter, já em prod):** "Plano de ação" por auditoria com as 5 correções de maior impacto,
  priorizadas pelo cruzamento com o GSC, e sugestões de title/meta reescritos usando as queries reais
  da página.
- **Relatório mensal por site** (link compartilhável e/ou PDF): score, tráfego orgânico e keywords.
  Prioridade depende da D3.

## Fora de escopo (por ora)

- Índice próprio de backlinks. Não é viável construir. Se for necessário, usar a DataForSEO Backlinks API
  (mínimo de ~US$100/mês), mediante decisão separada.
- Editor de conteúdo/"content score", crawl renderizado em JS de todas as páginas, monitoramento de uptime
  (já existe o workflow `uptime`) e escrita no site do cliente.

## Volume de dados (Supabase Free, 500 MB)

| Tabela | Estimativa | Contenção |
|---|---|---|
| `seo_audit_pages` + `issues` | ~200 páginas × ~1,5 KB × 3 auditorias ≈ 1 MB/site | retenção de 3 auditorias |
| `seo_gsc_daily` | 16 meses × 3 devices ≈ 1.500 linhas/site | trivial |
| `seo_gsc_top` | 1.000 linhas × 26 semanas ≈ 26k linhas ≈ 3–4 MB/site | top 500 + 26 semanas; drill-down ao vivo |
| `seo_rank_checks` | 100 kw × 52 semanas ≈ 5k linhas/site/ano | `competitors` só da última checagem |

Com 50 sites isso fica abaixo de ~250 MB, o que ainda cabe, mas exige monitorar. Revisar se o número de
sites crescer.

## Riscos

- **SSRF:** o crawler busca URLs controladas pelo usuário dentro do box que hospeda outros containers. O
  guard roda em cada hop de redirect e tem teste dedicado.
- **Deploy durante o crawl:** coberto pela fronteira persistida e pelo reclaim.
- **Teto de 100s da Cloudflare:** o tick tem orçamento de 60s. Se apertar, usar `origin.xphere.app`.
- **OAuth não verificado:** tokens expiram em 7 dias e quebram silenciosamente. Mitigado pela D2 e pelo
  banner de saúde.
- **Sites que bloqueiam bots:** viram a issue `crawl_blocked` em vez de falha opaca.
- **Custo de dados pagos sem teto:** o ledger `seo_usage` e o limite por plano entram antes de abrir a
  Fase 3 para orgs clientes.

## Ordem sugerida

Fase 0 (D2 já iniciada) → **Fase 1** → Fase 2 → medir demanda → Fase 3 → Fase 4. As partes de workflow e
MCP da Fase 4 podem entrar incrementalmente ao fim de cada fase (ex. `seo_run_audit` e
`seo.audit_completed` logo após a Fase 1).
