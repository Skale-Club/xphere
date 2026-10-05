# Local SEO: geogrid, Google Business Profile, auditoria e relatórios

**Status:** Fases 0 a 7 implementadas na branch `feat/local-seo` (2026-10-05), com as recomendações da seção 1 adotadas e a opção B na Fase 7. Migrations 1315–1321 escritas e ainda não aplicadas. Nada foi validado contra o banco nem contra as APIs reais; as Fases 3 e 4 dependem da aprovação do Google.
**Contexto:** hoje o Xphere só faz scraping de reviews do Google (SerpAPI, SEED-009) e tem o widget embeddável. A referência de mercado é a BrightLocal (Local Search Grid, Rank Tracker, Citation Tracker, Audit, Reputation, relatórios white-label). Este plano leva o essencial disso para dentro do Xphere, aproveitando os padrões que já existem: command ledger do Ads, fila com `SKIP LOCKED`, skale-cron, workflows, MCP, RBAC e billing.

---

## Execução (atualizado em 2026-10-05)

| Fase | Estado | Onde |
|---|---|---|
| 0 Fundação | Feita | migration 1315, `src/lib/local-seo/{credentials,quota}.ts`, `/local-seo`, correção do `/reviews` |
| 1 Geogrid | Feita | migration 1316, `grid/metrics/matching/providers/worker/scans.ts`, crons, postback, aba Rankings |
| 2 Tracking | Feita | migration 1317, `schedules/events/workflow-events.ts`, abas Trends/Competitors, Settings, MCP, ação `local_seo_run_scan` |
| 3 GBP + reviews | Feita | migration 1318, `src/lib/google/oauth.ts`, `src/lib/gbp/{client,commands,replies,sync}.ts`, OAuth, `gbp-sync-tick`, aba Reviews, widget |
| 4 Perfil, posts, performance | Feita | `src/lib/gbp/profile.ts`, abas Profile e Posts, performance na aba Trends |
| 5 Auditoria | Feita | migration 1319, `audit-checks.ts` (puro) + `audit.ts`, aba Audit, criação de Tasks |
| 6 Relatórios | Feita | migration 1320, `reports.ts`, `/r/local-seo/[token]`, PDF, envio mensal, página Reports |
| 7 Citações e IA | Feita (opção B) | migration 1321, `citations.ts`, `ai-visibility.ts`, aba Citations & AI |

Runbook com variáveis de ambiente, crons e troubleshooting: `docs/local-seo/README.md`.

**Desvios do plano, decididos na implementação:**
- Colunas `row_idx`/`col_idx` no lugar de `row`/`col`; estados do ponto são `queued → in_flight → done | failed` (o `submitted` virou `in_flight` com `provider_task_id`).
- Chave BYO de SerpAPI **não** é usada no geogrid: o plano grátis dela tem 100 buscas/mês e um scan 7×7 gastaria metade. Ela só serve para a busca do negócio ao cadastrar a location. BYO de geogrid fica para quando alguém pedir.
- Kill switch e teto diário são variáveis de ambiente (`LOCAL_SEO_DISABLED`, `LOCAL_SEO_DAILY_POINT_CAP`), não `platform_settings`, porque lá os valores são segredos mascarados.
- Org sem plano, com enforcement de billing desligado, recebe `LOCAL_SEO_UNPLANNED_POINTS_MONTH` (500) pontos; com enforcement ligado, zero.
- Alertas: o canal nativo é in-app + push. Email/Telegram/Slack ficam a cargo de workflows no evento `local_seo.rank_changed`, em vez de uma lista fixa de canais por regra.
- Postback da DataForSEO é opcional (`LOCAL_SEO_POSTBACK_SECRET`); sem ele o worker consulta `task_get` depois de 2 min.
- Chave do Maps é runtime (`GOOGLE_MAPS_BROWSER_KEY`), passada da página para o cliente, para não exigir rebuild da imagem.
- GBP: o ledger tem 5 comandos (`review.reply`, `review.delete_reply`, `profile.update`, `post.create`, `post.delete`). Edição de perfil cobre descrição, site, telefone e horários; categorias, atributos, serviços e horários especiais ficaram de fora porque exigem IDs de categoria/atributo do Google e uma UI própria.
- GBP: quem tem `local_seo.approve` aprova ao enviar; membros, workflows e IA sempre esperam aprovação. O Pub/Sub de notificações do Google não foi feito; o sync de reviews roda a cada 15 min.
- Auditoria: o site é buscado com `fetch` (via `safeFetchBytes`, só https e IPs públicos), não com Chromium. Sites que montam o conteúdo só via JavaScript podem dar falso "não encontrado" no NAP.
- Relatórios: o link público guarda só o hash do token (como `api_keys`). O PDF imprime a própria página pública dentro do gate de Chromium do website-analyzer.
- Citações (opção B): uma busca `site:` por diretório via SerpAPI, cobrando 1 ponto cada. Campo ausente no snippet conta como "desconhecido", não como divergência.
- Visibilidade em IA: até 3 keywords × modelos de `LOCAL_SEO_AI_MODELS` (padrão Perplexity Sonar e GPT-4o mini com busca). O custo de LLM não entra na cota de pontos.

---

## 0. Visão do produto

Módulo **Local SEO** (`/local-seo`). Cada org gerencia uma ou mais **locations** (negócios no Google Maps) e, para cada uma:

| Pilar | O que entrega | Fonte de dados |
|---|---|---|
| **Rankings (geogrid)** | Mapa com a posição do negócio em cada ponto de uma grade, por palavra-chave, com histórico, comparação antes/depois e concorrentes por ponto | Provider de SERP do Maps (DataForSEO / SerpAPI) |
| **Tendências e alertas** | ARP/ATRP/SoLV ao longo do tempo, anotações de mudanças, alertas de queda, eventos de workflow | Scans agendados |
| **Concorrentes** | Quem domina cada região, share of voice, evolução de reviews e nota dos concorrentes | Resultados dos próprios scans |
| **Google Business Profile** | Reviews oficiais com resposta (IA + aprovação), posts agendados, edição do perfil, métricas de performance, detecção de edições feitas pelo Google | Business Profile APIs (OAuth) |
| **Auditoria** | Score por pilar (Good/OK/Poor) e lista de tarefas acionáveis | GBP + scans + website-analyzer |
| **Relatórios** | Link público white-label, PDF e envio mensal por email | Tudo acima |
| **Citações / NAP** (fase final) | Presença e consistência em diretórios | Decidir: API BrightLocal ou checagem leve própria |

Princípio da plataforma (CLAUDE.md): **capacidade reutilizável e tenant-aware**, sem playbook de um cliente só. Toda escrita no Google passa por um ledger auditável, como acontece em Ads.

---

## 1. Decisões em aberto (preciso de resposta antes da Fase 1)

| # | Decisão | Recomendação | Por quê |
|---|---|---|---|
| D1 | Provider do geogrid | **DataForSEO como principal**, SerpAPI como fallback, atrás de uma interface `RankProvider` | Custo por ponto ~25× menor (tabela na seção 4.6). O SerpAPI já está integrado e serve de fallback e de "Scan agora" síncrono |
| D2 | Lib de mapa | **Google Maps JS** via `@vis.gl/react-google-maps` | Visual idêntico ao do print, `GOOGLE_MAPS_API_KEY` já existe (precisa de uma key de browser com restrição por referrer) e há cota grátis mensal. Alternativa: MapLibre + MapTiler |
| D3 | Modelo comercial | **Cota mensal de "pontos" por plano** (limite novo em `PLAN_CATALOG`), com custo real registrado em ledger | É fácil de explicar ao cliente ("500 pontos/mês") e o custo em USD fica rastreado para medir margem |
| D4 | Chave do provider | **Chave da plataforma** (`MANAGED_PLATFORM_KEYS`), com override opcional BYO por org | Mesmo padrão do OpenRouter. Hoje cada org cola a própria chave SerpAPI, o que não escala para geogrid |
| D5 | Citações | Decidir só na Fase 7, depois de cotar a API da BrightLocal | A API deles tem preço sob consulta, e o citation building é pay-as-you-go a ~US$2/citação |
| D6 | Nome do módulo na UI | "Local SEO" | — |

**Ações humanas no caminho crítico (começar já, em paralelo com a Fase 0):**
1. **Pedir acesso às Business Profile APIs** ao Google. Exige um perfil verificado e ativo há mais de 60 dias, com site, e um email que seja owner/manager do perfil. O pedido vai pelo formulário de acesso com o número do projeto do Google Cloud. Enquanto a cota aparecer como **0 QPM**, o acesso não foi aprovado; aprovado, ela vira 300 QPM. **A Fase 3 inteira depende disso.**
2. **Verificação do app OAuth** para o escopo sensível `business.manage`. Em modo Testing, o refresh token expira em 7 dias, o mesmo problema que o app OAuth do Google Ads ainda tem.
3. Conta na DataForSEO (se D1 for aceita) e uma key de browser do Maps JS restrita a `xphere.app`.

---

## 2. Estado atual (o que reaproveitar e o que corrigir)

**Reaproveitar:**
- `src/lib/serpapi/client.ts`: `searchBusinesses` já chama `engine=google_maps` e devolve `place_id` e `gps_coordinates`. Falta o parâmetro `ll`.
- `google_business_profiles` + `google_reviews` (migration 052): scraping de reviews e widget por `widget_token`.
- `tenant_locations` (088): endereço e lat/lng geocodificados (Geocoding API), mas sem `place_id`.
- Fila: `claim_global_knowledge_sync_job()` (1220) é o template de `FOR UPDATE SKIP LOCKED`, e o command ledger do Ads (`src/lib/ads/commands/`, `docs/ads/control-plane.md`) é o template de escrita auditada.
- Cron: rotas `src/app/api/cron/*` com `Bearer CRON_SECRET` (padrão estrito, que falha fechado com 503), heartbeat em `cron_heartbeats` e skale-cron batendo em `origin.xphere.app` por causa do limite de 100s da Cloudflare.
- Workflows: triggers em `src/lib/workflows/spec.ts`, emissores no molde de `src/lib/leads/events.ts` e executores em `src/lib/action-engine/executors/`.
- MCP: `src/lib/mcp/registry.ts` + `tool-types.ts`.
- LLM: `src/lib/llm/openrouter.ts`.
- Branding: `getOrgBranding`. Email: `sendTenantEmail`. Chromium: pool de `src/services/website-analyzer/concurrency.ts`.
- Billing: `catalog.ts` / `entitlements.ts` / `guards.ts`. RBAC: `src/lib/rbac/permissions.ts`. Nav: `src/components/layout/nav-items.ts`.
- Gráficos: `recharts` já instalado.

**Lacunas e correções necessárias:**
- `google_business_profiles` é na prática **um por org**: `reviews/page.tsx` usa `.maybeSingle()` sem filtro e quebra com mais de um perfil. Precisa ficar multi-location.
- Não existe helper OAuth Google compartilhado (Contacts, Calendar e Ads têm cada um o seu).
- Não há lib de mapa nem geração de PDF.
- Não há cota por feature, só o wallet de créditos do Copilot.
- Há dois segredos de cron (`OPERATOR_AUTOMATION_SECRET` no scrape de reviews e `CRON_SECRET` no resto). As rotas novas usam `CRON_SECRET`.
- **Supabase prod está no plano Free** (decisão de 2026-10-02, limite de 500 MB de banco). Resultados de SERP crescem rápido, então **política de retenção é obrigatória** (seção 4.5).

---

## 3. Arquitetura

```
                        ┌─────────────────────── UI /local-seo ───────────────────────┐
                        │ Overview · Location[Rankings|Trends|Competitors|Profile|     │
                        │ Reviews|Posts|Audit|Reports] · Settings modal               │
                        └──────────────┬───────────────────────────────┬──────────────┘
                                       │ server actions (RLS)          │
          ┌────────────────────────────▼───────┐        ┌──────────────▼──────────────┐
          │ src/lib/local-seo/                 │        │ src/lib/gbp/                │
          │  grid.ts      (geometria)          │        │  oauth.ts → lib/google/oauth│
          │  scans.ts     (criar/estimar/cota) │        │  client.ts  (APIs GBP)      │
          │  metrics.ts   (ARP/ATRP/SoLV)      │        │  sync.ts    (reviews/perf)  │
          │  matching.ts  (place_id/cid/nome)  │        │  commands/  (ledger escrita)│
          │  providers/   dataforseo|serpapi   │        │  replies.ts (IA + aprovação)│
          │  worker.ts    (claim → fetch → fin)│        └──────────────┬──────────────┘
          │  events.ts    (workflows/alertas)  │                       │
          └───────┬───────────────▲────────────┘                       │
                  │               │ postback (DataForSEO, sempre 200)  │
   skale-cron ──► /api/cron/local-seo-tick (1 min)    /api/cron/gbp-sync-tick (15 min)
                  │                                                    │
                  ▼                                                    ▼
          Postgres: local_seo_* (RLS)                      gbp_* (RLS), ledger + events
```

**Diretórios novos:**
- `src/lib/local-seo/`: núcleo do geogrid e do tracking.
- `src/lib/gbp/`: integração com o Business Profile.
- `src/lib/google/oauth.ts`: helper compartilhado (state cookie, troca do code, refresh, blob criptografado com `crypto.ts`). Contacts e Calendar migram depois, de forma opcional.
- `src/app/(dashboard)/local-seo/`: UI.
- `src/app/api/local-seo/*`: postbacks e endpoints internos.
- `src/app/r/local-seo/[token]/`: relatório público.
- `src/lib/mcp/tools/local-seo.ts` e `gbp.ts`.
- `docs/local-seo/*.md`: runbook, métricas e custos.

---

## 4. Motor do geogrid (núcleo das Fases 1 e 2)

### 4.1 Geometria da grade (`grid.ts`)
- Entradas: centro (lat/lng da location ou centro custom), `grid_size` ímpar (3, 5, 7, 9, 11 ou 13), `spacing_m` (padrão 1.000 m) e `shape` (`square` ou `circle`).
- Offsets: `Δlat = d / 111_320`, `Δlng = d / (111_320 · cos(lat))`. No formato `circle`, pontos com distância maior que o raio são descartados (é o recorte do print).
- Cada ponto recebe `row`, `col`, `lat` e `lng`. A função é pura e determinística, com teste de unidade.
- **Service-area business** (sem endereço público): o centro passa a ser o centroide da área atendida, e o matching continua pelo `place_id`.

### 4.2 Busca por ponto (`providers/`)
```ts
interface RankProvider {
  id: 'dataforseo' | 'serpapi'
  mode: 'sync' | 'async'
  costPerPointUsd(opts): number
  submit(points: PointRequest[]): Promise<SubmitResult[]>          // async: cria tasks
  fetch(point: PointRequest): Promise<SerpResult[]>                // sync
  parse(raw: unknown): SerpResult[]                                // normaliza
}
type SerpResult = { position: number; placeId?: string; cid?: string; title: string;
  rating?: number; reviews?: number; category?: string; address?: string; lat?: number; lng?: number }
```
- **SerpAPI:** `engine=google_maps&type=search&q=<kw>&ll=@lat,lng,<zoom>z&hl&gl`. Vêm 20 resultados por página, cada um com `place_id`, `data_id` e `data_cid`.
- **DataForSEO:** Google Maps SERP com `location_coordinate="lat,lng,zoom"`, `depth=20` e `language_code`. Há fila *standard* (`task_post` em lote de até 100 tasks, com `postback_url`) e modo *live* (síncrono). Na prática, um scan 7×7 é um único POST com 49 tasks, e os resultados chegam por postback em `/api/local-seo/providers/dataforseo/postback`. O handler é idempotente pelo `task_id`, sempre responde 200 e é validado por um token secreto na URL.
- O **zoom** (padrão 13z) e a **profundidade** (20) entram no snapshot do scan. Só são comparáveis scans com os mesmos parâmetros, controlados pela flag `comparable_key`.
- Validar antes de fechar o custo: os multiplicadores de preço da DataForSEO para parâmetros extras e para `depth` acima de 20.

### 4.3 Matching (`matching.ts`)
A busca segue esta ordem: `place_id`, depois `cid`, depois nome normalizado + telefone/endereço. O método usado fica gravado (`match_method`) para auditoria.

Fora dos 20 primeiros, o ponto fica com `rank = null` e aparece como "20+". Pontos onde o negócio não aparece também são valiosos: entram no heatmap de concorrentes.

### 4.4 Métricas (`metrics.ts`)
| Métrica | Definição |
|---|---|
| **ARP**: Average Rank Position | Média do rank **só onde o negócio apareceu** (1 a 20) |
| **ATRP**: Average Total Rank Position | Média em todos os pontos, contando os ausentes como 21 (penaliza ausência) |
| **SoLV**: Share of Local Voice | % dos pontos com rank ≤ 3 (o "local pack") |
| **Found %** | % dos pontos com rank ≤ 20 |
| **Competitor SoLV** | O mesmo SoLV calculado para cada concorrente a partir dos resultados |

O "1.36 Average Scan Ranking" do print corresponde ao ARP. Cores dos pins: 1–3 verde, 4–10 âmbar, 11–20 laranja, 20+ vermelho.

### 4.5 Execução robusta (`worker.ts`)
1. **Criar o scan** (server action, MCP ou cron de agendamento):
   1. Estima os pontos e o custo.
   2. Checa a cota (D3), o kill switch global e o limite diário da plataforma.
   3. Insere `local_seo_scans` com status `queued` e N linhas em `local_seo_scan_points`.
2. **Tick** (`/api/cron/local-seo-tick`, a cada 1 min, `budgetMs` ~60s):
   1. Chama o RPC `claim_local_seo_points(p_limit)`, que usa `FOR UPDATE SKIP LOCKED`, é SECURITY DEFINER e tem `REVOKE` de `PUBLIC, anon, authenticated` (o padrão da 1311).
   2. Provider *async*: agrupa as tasks por scan e faz o `submit`, gravando `provider_task_id`.
   3. Provider *sync*: chama `fetch` com concorrência limitada (p-limit 5) e respeitando o throughput (o SerpAPI limita a 20% da cota por hora).
3. **Retentativa:** `attempts` até 3, com backoff de 1, 4 e 15 min. Um erro permanente (`auth_error` ou `quota_exceeded`) falha o scan inteiro com mensagem clara. Um circuit breaker por provider pausa os envios depois de 5 falhas transitórias em 10 min, como no Ads.
4. **Finalização:** quando todos os pontos estão em estado terminal, calcula as métricas, grava o snapshot de concorrentes, compara com o scan comparável anterior, emite eventos e alertas e fecha o custo real no ledger. Se algum ponto falhou definitivamente, o status final é `partial`, nunca um "completed" mentiroso.
5. **Scans travados** (`running` há mais de 30 min): o obs-alerts reporta, e eles não são re-tentados automaticamente, igual ao Ads.
6. **Heartbeat** em `cron_heartbeats` e alertas no `obs-alerts`: tick parado, taxa de falha e gasto diário acima do esperado.
7. **Retenção** (job diário, obrigatório no Supabase Free):
   1. `local_seo_serp_results` (top 20 por ponto) fica 60 dias.
   2. Depois disso, sobram o rank do alvo e o top 3 por ponto (`top3 jsonb` no ponto) e o snapshot agregado de concorrentes, que é pequeno e permanente.
   3. Estimativa de volume: um scan 7×7 gera ~980 linhas de resultado.

### 4.6 Custos (referência de out/2026, conferir antes de lançar)
| Grade | Pontos | DataForSEO standard (US$0,0006) | DataForSEO live (US$0,002) | SerpAPI Developer (US$75/5k ≈ 0,015) |
|---|---|---|---|---|
| 5×5 | 25 | $0,015 | $0,05 | $0,38 |
| 7×7 | 49 | $0,03 | $0,10 | $0,74 |
| 9×9 | 81 | $0,05 | $0,16 | $1,22 |
| 13×13 | 169 | $0,10 | $0,34 | $2,54 |

Exemplo de cliente: 1 location, 5 palavras-chave, grade 7×7, scan semanal, dá ~1.050 pontos por mês. Isso custa **~US$0,63/mês na DataForSEO standard** contra ~US$16 no SerpAPI.

---

## 5. Modelo de dados (migrations a partir de **1315**)

Todas as tabelas seguem as mesmas regras:
- `org_id` + RLS `USING (org_id = (SELECT public.get_current_org_id()))` com `WITH CHECK`.
- Tabelas escritas só pelo servidor ficam SELECT-only para `authenticated`.
- Migrations idempotentes, aplicadas **só via `npx supabase db push`**.
- `src/types/database.ts` é atualizado na mesma PR.

### 5.1 Hub de locations (Fase 0)
```sql
local_seo_locations (
  id uuid pk, org_id uuid,
  name text, business_name text,
  place_id text, cid text,                         -- identidade no Google
  address text, lat double precision, lng double precision,
  is_service_area boolean default false, timezone text,
  primary_category text, website_url text, phone text,
  tenant_location_id uuid null references tenant_locations,
  google_business_profile_id uuid null references google_business_profiles, -- reviews/widget
  gbp_location_name text null,                     -- "locations/123" (Fase 3)
  gbp_connection_id uuid null,
  is_active boolean, created_at, updated_at,
  unique (org_id, place_id)
)
```
- O onboarding busca o negócio pelo nome (`searchBusinesses` já existe) e o operador seleciona o resultado. Com isso o `place_id`, as coordenadas e o endereço são preenchidos sozinhos.
- `google_business_profiles` passa a ser multi-location (corrigir `.maybeSingle()` em `reviews/page.tsx` e `reviews/actions.ts`) e se liga ao hub.

### 5.2 Geogrid (Fase 1)
```sql
local_seo_keywords (id, org_id, location_id, keyword text, language text, country text,
                    is_active, tags text[], unique(location_id, lower(keyword), language))

local_seo_scans (id, org_id, location_id, keyword_id, schedule_id null,
  provider text, provider_mode text,
  grid_size int, spacing_m int, shape text, zoom int, depth int,
  center_lat, center_lng, comparable_key text,     -- hash dos parâmetros
  status text check (queued|running|partial|completed|failed|cancelled),
  points_total int, points_done int, points_failed int,
  arp numeric, atrp numeric, solv numeric, found_pct numeric,
  est_cost_usd numeric, cost_usd numeric,
  triggered_by text check (manual|schedule|workflow|mcp), triggered_by_user uuid null,
  error text, started_at, finished_at, created_at)

local_seo_scan_points (id, org_id, scan_id, row int, col int, lat, lng,
  status text check (queued|submitted|done|failed),
  rank int null, match_method text null, top3 jsonb,
  provider_task_id text unique null, attempts int, next_attempt_at, last_error text,
  fetched_at, unique(scan_id, row, col))

local_seo_serp_results (point_id, org_id, scan_id, position int, place_id, cid, title,
  rating numeric, reviews int, category text, is_target boolean)   -- retenção 60 dias

local_seo_competitor_snapshots (scan_id, org_id, location_id, keyword_id,
  place_id, title, appearances int, avg_rank numeric, solv numeric,
  rating numeric, reviews int)                                     -- permanente, pequeno
```

### 5.3 Tracking contínuo (Fase 2)
```sql
local_seo_schedules (id, org_id, location_id, keyword_ids uuid[], grid params…,
  frequency text check (daily|weekly|biweekly|monthly), weekday int, hour int,
  next_run_at timestamptz, is_active)
local_seo_competitors (id, org_id, location_id, place_id, title, pinned boolean)  -- concorrentes fixados
local_seo_alert_rules (id, org_id, location_id null, metric text, threshold numeric,
  direction text, channels text[], is_active)
local_seo_annotations (id, org_id, location_id, occurred_at, kind text, title, ref_id)
  -- mudanças manuais ou automáticas (post publicado, categoria alterada) mostradas no gráfico
```

### 5.4 Uso e cota
```sql
local_seo_usage_ledger (id, org_id, scan_id, points int, cost_usd numeric,
  provider text, period date, created_at)          -- soma por mês = consumo da cota
```
- Novo limite `local_seo_points_month` em `PLAN_CATALOG` e nova feature `local_seo` em `ALL_FEATURES`.
- Kill switch e teto diário da plataforma ficam em `platform_settings`.

### 5.5 Google Business Profile (Fases 3 e 4)
```sql
gbp_connections (id, org_id, google_email, encrypted_tokens text, scopes text[],
  status, health, connection_error, token_expires_at, last_verified_at, connected_by)
gbp_reviews (id, org_id, location_id, review_name text unique,   -- "accounts/../reviews/.."
  reviewer_name, rating int, comment, create_time, update_time,
  reply_comment, reply_update_time, reply_state text, policy_violation jsonb,
  source text check (gbp|serpapi), raw jsonb)
gbp_reply_drafts (id, org_id, review_id, draft text, model text, status
  check (draft|approved|sent|rejected|failed), approved_by, sent_at)
gbp_posts (id, org_id, location_id, post_name text null, topic_type text, summary,
  media jsonb, cta jsonb, event jsonb, offer jsonb, recurrence jsonb,
  status check (draft|scheduled|publishing|live|failed|deleted), scheduled_for, published_at)
gbp_performance_daily (org_id, location_id, date, metric text, value bigint,
  primary key(location_id, date, metric))
gbp_search_keywords_monthly (org_id, location_id, month date, keyword text, impressions bigint)
gbp_profile_snapshots (id, org_id, location_id, taken_at, data jsonb, google_updated boolean)
gbp_change_requests / gbp_change_events      -- ledger de escrita; REMOVIDAS na 1322: a escrita virou comando do Ads Command Engine (ads_change_requests)
```
- A tabela antiga `google_reviews` (SerpAPI) continua valendo para locations **não conectadas** e para o widget. Quando a location está conectada, a fonte oficial do widget passa a ser `gbp_reviews`, com o mesmo contrato de saída.

### 5.6 Relatórios (Fase 6)
```sql
local_seo_reports (id, org_id, location_ids uuid[], period text, sections text[],
  schedule text null, recipients text[], last_sent_at)
local_seo_report_shares (id, org_id, report_id, token text unique, expires_at, revoked_at)
```

---

## 6. UI (critério página/sheet/modal igual ao do Calls overhaul)

```
/local-seo                         Overview: cards das locations (SoLV/ARP + sparkline,
                                   último scan, alertas abertos, cota usada do mês)
/local-seo/[locationId]            Abas:
  ├─ Rankings     Mapa geogrid (seletor de keyword + data); pin clicado → SHEET com o
  │               top 20 daquele ponto; modo "Comparar" (antes|depois lado a lado ou slider);
  │               overlay "ver como concorrente X"; botão "Scan agora" (mostra custo/cota)
  ├─ Trends       recharts: ARP/ATRP/SoLV por keyword, com anotações (posts, mudanças no perfil)
  ├─ Competitors  Ranking de concorrentes por SoLV, evolução de reviews/nota, fixar concorrente
  ├─ Profile      (Fase 4) dados do GBP, propor alterações (ledger), "Google alterou seu perfil"
  ├─ Reviews      (Fase 3) inbox: filtros, rascunho IA, aprovar/enviar, status/violação
  ├─ Posts        (Fase 4) calendário, compositor, recorrência
  ├─ Audit        (Fase 5) score por pilar + tarefas → cria Task no módulo de tarefas
  └─ Reports      (Fase 6) gerar link/PDF, agendar envio
⚙ Settings (MODAL)  Keywords · Grade padrão · Agendamentos · Alertas · Conexão GBP
```
- Nav: item **Local SEO** no grupo `manage`, com `permission: 'local_seo.view'` e `feature: 'local_seo'`.
- `/reviews` continua sendo o configurador do widget e ganha um link para a aba Reviews da location.
- Mapa: componente `GeoGridMap`, com pins numerados coloridos e legenda High/Mid/Low como no print. Ao lado, o card com ARP e o donut de SoLV. Precisa funcionar em mobile (o mapa ocupa a largura toda e a lista de pontos fica abaixo).
- Fallback sem mapa (relatório e PDF): uma grade SVG simples com os mesmos números, para nunca depender de uma key de mapa num link público.
- Rotas sempre org-aware: `usePathname` vem de `@/lib/org/navigation` e redirects usam `orgRedirect`.

---

## 7. Permissões, billing e segurança

- **RBAC** (`permissions.ts`), grupo `local_seo`:
  - `local_seo.view` e `local_seo.manage` (keywords, scans, agendamentos).
  - `local_seo.approve` (aprovar respostas, posts e alterações de perfil).
  - `local_seo.admin` (conexões e cota).
- **Checagem:** `requirePermission` em todas as server actions e `can()` nas tools MCP. As tools usam service role, então também filtram por `org_id` manualmente.
- **Billing:** `requireFeature('local_seo')` e checagem de cota antes de criar qualquer scan, por qualquer caminho (UI, cron, workflow ou MCP). Os guards são no-op enquanto `BILLING_ENFORCEMENT_ENABLED` estiver desligado, então **a cota de pontos é aplicada sempre** e não depende dessa flag, porque é custo real.
- **Segredos:** tokens OAuth e chaves BYO criptografados com `crypto.ts` (sem mudar o formato). A chave da plataforma fica em `platform_settings`.
- **Webhooks/postbacks:** sempre 200, idempotentes, com token secreto na URL e runtime Node.
- **Escrita no Google:** só pelo Ads Command Engine (`ads_change_requests`, plataforma `google_business`; desde a 1322). Nenhuma rota, tool ou workflow chama a API de escrita direto, a mesma regra do Ads.

---

## 8. Integrações com o resto da plataforma

| Tipo | Itens |
|---|---|
| **Eventos de workflow** (`spec.ts` + emissor) | `event:local_seo.scan_completed`, `event:local_seo.rank_changed` (com threshold), `event:gbp.review_received`, `event:gbp.review_negative` (≤ 3★), `event:gbp.google_update_detected` |
| **Ações de workflow** | `local_seo_run_scan` (respeita a cota), `gbp_draft_review_reply`, `gbp_propose_post` e `gbp_propose_profile_change` (só **propõem**; quem tem `local_seo.approve` aplica, como no `ads_propose_change`) |
| **Notificações** | Novo `NotificationType` `local_seo_alert` (in-app + push), email via `sendTenantEmail` e Telegram via `send_telegram_notification` |
| **MCP** (`tools/local-seo.ts`, `tools/gbp.ts`) | `localseo_list_locations`, `localseo_list_scans`, `localseo_get_scan`, `localseo_trigger_scan`, `localseo_get_competitors`, `gbp_list_reviews`, `gbp_create_reply_draft`, `gbp_propose_change` |
| **Journal** | Toda alteração aplicada no GBP vira uma `local_seo_annotations` e aparece nos gráficos, para correlacionar mudança com ranking |
| **Tarefas** | Os itens da auditoria viram Tasks no módulo existente |
| **Copilot** | As mesmas tools MCP ficam disponíveis no Copilot |
| **Observabilidade** | Heartbeats `local-seo-tick` e `gbp-sync-tick` no `obs-alerts`, mais os alertas de gasto e de token GBP expirado |

---

## 9. Fases

Cada fase entrega algo utilizável sozinho e termina com uma parada de validação com o usuário.

### Fase 0: Fundação (≈ 2–3 dias)
- Migration 1315: `local_seo_locations`, `local_seo_keywords`, `local_seo_usage_ledger`.
- Feature `local_seo`, limite `local_seo_points_month`, grupo RBAC e item de nav (oculto atrás de flag até a Fase 1).
- Chaves da plataforma `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` e `SERPAPI_API_KEY` em `MANAGED_PLATFORM_KEYS`, com override BYO.
- Onboarding da location: busca por nome, seleção, `place_id` e coordenadas. Vínculo opcional com `tenant_locations` e `google_business_profiles`.
- Correção: `google_business_profiles` multi-location (remover o `.maybeSingle()` cego).
- **Disparar as ações humanas da seção 1** (acesso à GBP API, verificação OAuth).
- **Aceite:** criar 2 locations numa org, cada uma com `place_id` correto, e `/reviews` continua funcionando.

### Fase 1: Geogrid MVP (≈ 1 semana)
- `grid.ts`, `matching.ts`, `metrics.ts` e os providers DataForSEO (async + postback) e SerpAPI (sync), com testes em Vitest usando fixtures reais anonimizadas.
- Migration: `scans`, `scan_points`, `serp_results`, `competitor_snapshots` e o RPC `claim_local_seo_points`.
- Worker + `/api/cron/local-seo-tick` + entrada no skale-cron (`origin.xphere.app`) + heartbeat.
- UI: aba Rankings com mapa, sheet de ponto e "Scan agora" mostrando custo e cota.
- Retenção (job diário).
- **Aceite:**
  - Scan 7×7 real do Bigode e de mais uma location termina em menos de 5 min.
  - O mapa bate com uma checagem manual no Google Maps em 3 pontos.
  - Uma falha de provider gera status `partial`, não `completed`.
  - O consumo aparece no ledger.

### Fase 2: Tracking contínuo e concorrentes (≈ 1 semana)
- Agendamentos (com escalonamento de horário para espalhar a carga) e o cron que cria scans a partir deles.
- Aba Trends com anotações, aba Competitors, modo "Comparar" e overlay de concorrente.
- Regras de alerta, eventos de workflow, notificações e tools MCP de leitura e disparo.
- Overview `/local-seo` com cards e consumo da cota.
- **Aceite:** um agendamento semanal roda sozinho por 2 semanas, e uma queda simulada dispara o alerta e o workflow.

### Fase 3: Conexão GBP e reviews oficiais (≈ 1–1,5 semana; **bloqueada pela aprovação do Google**)
- `src/lib/google/oauth.ts` (helper compartilhado) e a conexão GBP: connect/callback e descoberta de contas e locations, ligando cada uma a uma `local_seo_locations`.
- `gbp_connections` com health, refresh proativo e alerta de token morto (a mesma lição do Google Contacts).
- Sync de reviews (cron de 15 min; Pub/Sub de notificações do GBP numa etapa posterior), `gbp_reviews` com `reply_state` e `policy_violation`.
- Rascunho de resposta com IA (OpenRouter, tom configurável por org), aprovação e envio via ledger. Regra opcional de auto-resposta para 4–5★, **sempre humana para ≤ 3★**.
- O widget passa a usar `gbp_reviews` quando a location está conectada.
- **Aceite:** responder um review real pela UI, a resposta aparecer no Google, e o status voltar pelo sync.

### Fase 4: Perfil, posts e performance (≈ 1,5 semana)
- Escrita pelo Ads Command Engine (snapshot → plan → validate → execute → verify → rollback); o ledger próprio `gbp_change_requests`/`events` da 1318 foi removido na 1322.
- Edição de horários, horários especiais, descrição, categorias, atributos, serviços e links. Cada mudança gera anotação.
- Detecção de "Google alterou seu perfil": snapshot diário comparado com o anterior, mais o sinal de edição feita pelo Google que a API expõe. Gera alerta.
- Posts: compositor, agendamento, recorrência (`RecurrenceInfo`), mídia e calendário.
- Performance API: métricas diárias (impressões Maps/Search mobile/desktop, ligações, cliques no site, rotas) e palavras-chave mensais, com gráficos na aba Trends.
- **Aceite:** um post agendado publica no horário, uma alteração de horário passa pelo ledger com read-back, e as métricas dos últimos 90 dias são importadas.

### Fase 5: Auditoria (≈ 1 semana)
- Checagens agrupadas por pilar, cada uma Good/OK/Poor com explicação e ação sugerida:
  - **Perfil:** categorias principal e secundárias comparadas às do top 3, descrição, horários, fotos (quantidade e recência), posts nos últimos 7 dias, atributos, serviços, link com UTM, link de agendamento.
  - **Reviews:** volume, nota e velocidade contra a média dos concorrentes; taxa e tempo de resposta.
  - **Site e NAP:** nome, endereço e telefone do site batem com o GBP; schema `LocalBusiness`. Usa o extractor do website-analyzer no pool de Chromium existente.
  - **Visibilidade:** SoLV e found% por keyword, keywords sem presença.
  - **Spam de concorrentes:** nome com keyword stuffing, sinalizado para denúncia manual.
- Score total, histórico de auditorias e "criar tarefas" no módulo de Tasks.
- **Aceite:** a auditoria do Bigode gera uma lista que o operador concorda que faz sentido, com no máximo 10% de falsos positivos.

### Fase 6: Relatórios white-label (≈ 1 semana)
- Página pública `/r/local-seo/[token]` com expiração e revogação, branding da org (`getOrgBranding`) e CSS de impressão.
- PDF via Playwright `page.pdf()`, reaproveitando e generalizando o gate de concorrência do website-analyzer (sem abrir um segundo pool de Chromium; lição do incidente de 2026-08-30).
- Envio agendado mensal via `sendTenantEmail` com o PDF anexado.
- **Aceite:** o relatório mensal chega por email com o PDF, e o link público abre sem login e expira quando deve.

### Fase 7: Citações, NAP e visibilidade em IA (escopo a decidir em D5)
- Opção A: integrar a API da BrightLocal (Citation Tracker/Builder), se a cotação fizer sentido.
- Opção B: checagem leve própria com lista curada de diretórios por país (US: Yelp, Bing Places, Apple Business Connect, Facebook, BBB, Yellow Pages, Foursquare; BR: equivalentes). Faz busca `site:` via provider de SERP e compara NAP.
- Visibilidade em IA (opcional): perguntar a modelos com busca na web ("melhor <categoria> em <cidade>") via OpenRouter e medir menções ao longo do tempo.

**Total estimado das Fases 0 a 6: 6–8 semanas** de execução direta. A Fase 3 pode atrasar por depender do Google.

---

## 10. Testes e qualidade
- **Vitest:** geometria da grade (simetria, recorte circular, longitude perto dos polos/antimeridiano), métricas (casos com ausência total, empate, 1 ponto), matching (`place_id`/`cid`/nome), parsers dos providers com fixtures, cálculo de cota/custo, idempotência do postback e máquina de estados do scan e do ledger.
- **Teste de integração do worker** com provider fake: falha transitória, permanente e scan parcial.
- **QA no browser:** mapa em desktop e mobile, tema escuro e link público.
- `npm run build` e `npm run lint` antes de cada commit. Workflows seed validados com `npm run workflows:validate`.

## 11. Riscos
| Risco | Mitigação |
|---|---|
| Aprovação da GBP API demorar ou ser negada | Fases 1, 2 e 5 (parcial) não dependem dela; pedir já na Fase 0 |
| Refresh token de 7 dias (app OAuth não verificado) | Verificação OAuth em paralelo; alerta de token morto |
| Custo de provider fugir do controle | Cota por org, kill switch, teto diário global e alerta de gasto |
| Banco Free estourar | Retenção de 60 dias dos resultados completos e agregados compactos |
| Resultados simulados diferirem do que o cliente vê | Explicar na UI (simulação por coordenada, sem personalização); manter parâmetros fixos para comparar a evolução |
| Mudanças na resposta dos providers | Parsers isolados por provider com fixtures e alerta de falha de parse |
| Cloudflare 100s | Ticks curtos (`budgetMs` 60s) via `origin.xphere.app` |

## 12. Regras de execução
- Commits atômicos por etapa; `npm run build` antes de cada commit.
- Migrations novas a partir de **1315** (conferir contra `origin/main`, não contra o working tree), aplicadas só com `npx supabase db push`, sempre idempotentes.
- Hierarquia de agentes: Fable orquestra, Sonnet executa e Opus valida antes do merge.
- Parada de validação com o usuário ao fim de cada fase.
