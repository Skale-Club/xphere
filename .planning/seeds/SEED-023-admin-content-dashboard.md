---
id: SEED-023
status: idea
planted: 2026-05-20
trigger_when: after SEED-022
scope: Medium
priority: medium
---

# SEED-023: Super Admin — Platform Command Center

Transforma o painel super admin de um conjunto de páginas utilitárias em um **command center real**: dashboard home com métricas cross-platform, feed de atividade recente, deep-dive por org, preview da landing page e adoção de features. O SEED-022 cuida do visual — este cuida do conteúdo e dos dados.

## Problema atual

Hoje o `/admin` só redireciona para `/admin/orgs`. O que existe:
- Lista de orgs com 4 contadores (sem ranking, sem tendência, sem atividade recente)
- "Platform Settings" com 6 números globais e botões de bulk-flag
- Página SEO com o formulário de edição

O que falta: **contexto**. Como a plataforma está crescendo? Quais orgs estão ativas? Quais integrações estão sendo usadas? O que aconteceu ontem? A página da LP está configurada corretamente?

## Nova estrutura de navegação

```
/admin                    → Overview (HOME — novo)
/admin/orgs               → Organizations (existente, enriquecido)
/admin/orgs/[id]          → Org Detail (existente, enriquecido)
/admin/activity           → Activity Feed (NOVO)
/admin/seo                → SEO & Branding (existente, enriquecido)
/admin/settings           → Platform Settings (existente)
```

Sidebar ganha "Overview" e "Activity" como novos itens.

---

## `/admin` — Platform Overview (nova home)

Substitui o redirect para `/admin/orgs`. Dashboard de comando com widgets independentes via `<Suspense>` (padrão do dashboard normal — cada widget faz seu próprio fetch).

### Widget 1 — KPI Row (6 métricas)

| Métrica | Fonte | Detalhe |
|---------|-------|---------|
| Total de orgs | `organizations` count | Com delta: "+N este mês" |
| Orgs ativas | `organizations WHERE is_active` | % do total |
| Total de usuários | `org_members` count | Únicos por `user_id` |
| Total de contatos | `contacts` count | Soma cross-org |
| Chamadas (últimos 30d) | `calls WHERE created_at >= now()-30d` | Com variação vs. 30d anteriores |
| Conversas (últimos 30d) | `conversations WHERE created_at >= now()-30d` | Com variação vs. 30d anteriores |

### Widget 2 — Orgs recentes (últimas 5)

Mini-tabela: nome, slug, membros, criada em, badge ativo/inativo. Link para `/admin/orgs/[id]`.

### Widget 3 — Top 5 orgs por atividade

Ranking: org name + soma de (calls + conversations + contacts) → ordena decrescente. Mostra quem está realmente usando a plataforma.

### Widget 4 — Adoção de feature flags

3 barras horizontais, uma por flag:
- `ai_calling_enabled`: N/total orgs (%)
- `bulk_import_enabled`: N/total orgs (%)
- `advanced_pipeline_enabled`: N/total orgs (%)

Dados de `organizations.settings` JSONB — conta os que têm a flag `true`.

### Widget 5 — LP & SEO Status (snapshot)

Card com o estado atual da landing page:
- **Favicon**: preview do ícone (via `favicon_url`) ou aviso "não configurado"
- **Title**: `site_title` atual
- **Description**: primeiros 80 chars de `description`
- **OG Image**: thumbnail se configurado, aviso se vazio
- **Última atualização**: `seo_config.updated_at` formatado
- Botão "Editar" → `/admin/seo`

### Widget 6 — Atividade de workflows (últimos 7d)

Mini-stat de `workflow_runs`:
- Total de execuções (7d)
- Sucesso: `status = 'completed'`
- Falha: `status = 'failed'`
- Taxa de sucesso em %

### Widget 7 — Campanhas ativas

Contagem de `campaigns WHERE status = 'active'` + total de contatos sendo chamados (`campaign_contacts WHERE status = 'pending' OR status = 'calling'`). Link para contexto.

---

## `/admin/activity` — Feed de atividade recente (nova página)

Feed cronológico reverso de eventos cross-platform das últimas 24–72 horas. Cada evento é um item com ícone, descrição e timestamp relativo.

### Fontes de eventos

| Evento | Tabela | Campo de tempo | Ícone |
|--------|--------|----------------|-------|
| Nova org criada | `organizations` | `created_at` | `Building2` |
| Novo membro | `org_members` | `created_at` | `UserPlus` |
| Chamada completada | `calls` | `created_at` WHERE status = completed | `Phone` |
| Nova conversa | `conversations` | `created_at` | `MessageSquare` |
| Novo contato | `contacts` | `created_at` | `Contact2` |
| Workflow executado | `workflow_runs` | `started_at` | `Zap` |
| Campanha iniciada | `campaigns` | `created_at` WHERE status = active | `Megaphone` |
| Novo booking | `bookings` | `created_at` | `Calendar` |

**Query:** para cada fonte, pega os 10 mais recentes das últimas 72h. Merge em memória → ordena por timestamp → exibe os 50 mais recentes. Monta uma lista tipada `PlatformEvent[]` no server action.

### Filtros (client-side, sem refetch)
- Por tipo de evento (toggle chips: Orgs | Usuários | Chamadas | Conversas | Workflows)
- Por período: 24h / 48h / 72h (dropdown)

---

## `/admin/orgs` — Organizations (enriquecido)

Mantém a tabela atual. Adiciona:

1. **Barra de busca** já existe — OK
2. **Coluna "Ativo"**: badge verde/cinza (atualmente sem coluna visual)
3. **Coluna "Último acesso"**: data da última call ou conversation por org — inferido pelo MAX(created_at) entre as duas tabelas
4. **Coluna "Flags"**: chips pequenos mostrando quais feature flags estão ativas (ícones, não texto)
5. **Stat header**: acima da tabela, 3 mini-chips: "N orgs" | "N ativas" | "N inativas"

---

## `/admin/orgs/[id]` — Org Detail (enriquecido)

Adiciona 3 seções ao layout existente:

### Seção 1 — Timeline da org (linha do tempo)
Eventos marcos: criação da org, primeiro contato adicionado, primeira chamada, primeira conversa, primeiro agente criado. Montado via queries individuais com `SELECT created_at ... ORDER BY created_at ASC LIMIT 1`.

### Seção 2 — Integrações ativas
Lista de `integrations WHERE org_id = X AND is_active = true` + `evolution_instances WHERE org_id = X AND is_active = true`. Chips com nome/tipo de cada integração.

### Seção 3 — Agentes
Lista de `agents WHERE org_id = X`: nome, modelo, quantas invocações (`agent_invocations` count).

### Seção 4 — Atividade recente (mini-feed)
Últimas 10 calls + últimas 5 conversations da org. Tabela compacta com tipo, canal, timestamp.

---

## `/admin/seo` — SEO & Branding (enriquecido)

Adiciona antes do formulário:

### Preview card da LP
Simula como a página aparece num resultado de busca Google:
```
┌─────────────────────────────────────┐
│ 🌐 xphere.app                       │
│ [site_title] — [description...]     │
│ [favicon] [og_image thumbnail]      │
└─────────────────────────────────────┘
```
- Favicon preview (img com `favicon_url`)
- OG Image preview (img com `og_image_url`)
- Indicadores de saúde: description ≤ 160 chars ✅, title ≤ 60 chars ✅, og_image presente ✅

### Keywords atuais
Chips com cada keyword cadastrada, antes do formulário.

---

## Dados novos necessários (server actions)

### `get-platform-dashboard.ts` (novo)
```ts
export type PlatformDashboard = {
  kpis: {
    total_orgs: number
    active_orgs: number
    new_orgs_30d: number
    total_members: number
    calls_30d: number
    calls_prev_30d: number
    conversations_30d: number
    conversations_prev_30d: number
    total_contacts: number
  }
  recent_orgs: RecentOrg[]          // últimas 5
  top_orgs: TopOrg[]                // top 5 por atividade
  flag_adoption: FlagAdoption[]     // 3 flags com N/total
  workflow_stats: WorkflowStats     // runs 7d
  active_campaigns: number
  pending_campaign_contacts: number
  seo_snapshot: SeoSnapshot | null  // do seo_config
}
```

### `get-platform-activity.ts` (novo)
```ts
export type PlatformEvent = {
  id: string
  type: 'org_created' | 'member_joined' | 'call_completed' | 'conversation_started'
        | 'contact_created' | 'workflow_run' | 'campaign_started' | 'booking_created'
  org_id: string | null
  org_name: string | null
  description: string
  timestamp: string
  meta?: Record<string, unknown>
}

export async function getPlatformActivity(hours: 24 | 48 | 72): Promise<PlatformEvent[]>
```

### Enriquecimento de `get-org-detail.ts`
Adicionar ao retorno existente:
```ts
timeline: OrgTimeline          // marcos: criação, primeiro contato, etc.
integrations: OrgIntegration[] // integrações ativas
agents: OrgAgent[]             // agentes com invocation count
recent_calls: RecentCall[]     // últimas 10 calls
recent_conversations: RecentConversation[] // últimas 5
```

---

## Estrutura de arquivos

```
src/
  app/(admin)/
    admin/
      page.tsx                              EDIT — novo overview (não mais redirect)
      activity/
        page.tsx                            NEW  — feed de atividade
      orgs/
        page.tsx                            EDIT — enriquecido (stat header, novas colunas)
        [orgId]/page.tsx                    EDIT — passa novos dados pro OrgDetailView
      seo/page.tsx                          EDIT — preview card da LP antes do form
      _actions/
        get-platform-dashboard.ts           NEW  — dados da home
        get-platform-activity.ts           NEW  — feed de eventos
        get-org-detail.ts                  EDIT — timeline, integrações, agentes, atividade

  components/admin/
    dashboard/
      platform-kpi-row.tsx                 NEW  — 6 métricas com delta
      recent-orgs-widget.tsx               NEW  — últimas 5 orgs
      top-orgs-widget.tsx                  NEW  — ranking por atividade
      flag-adoption-widget.tsx             NEW  — barras de adoção
      lp-status-widget.tsx                 NEW  — snapshot SEO/LP
      workflow-stats-widget.tsx            NEW  — runs 7d
      campaign-pulse-widget.tsx            NEW  — campanhas ativas
    activity/
      activity-feed.tsx                    NEW  — lista de eventos + filtros client-side
      activity-event-item.tsx              NEW  — item individual do feed
    admin-sidebar.tsx                      EDIT — novos nav items (Overview, Activity)
    org-detail-view.tsx                    EDIT — novas seções (timeline, integrações, agentes)
    orgs-table.tsx                         EDIT — novas colunas + stat header
    seo-config-form.tsx                    EDIT — preview card antes do formulário
```

## Critérios de sucesso

1. ✅ `/admin` mostra 7 widgets com dados reais — sem redirect para `/admin/orgs`
2. ✅ KPIs mostram delta (+N este mês) para orgs, chamadas, conversas
3. ✅ Top 5 orgs por atividade rankeadas corretamente
4. ✅ Adoção de feature flags mostra % de orgs com cada flag ativa
5. ✅ LP Status mostra favicon, título, description e og_image atual
6. ✅ `/admin/activity` lista eventos das últimas 72h filtráveis por tipo
7. ✅ Org detail mostra timeline de marcos, integrações ativas e agentes
8. ✅ SEO page mostra preview estilo Google antes do formulário
9. ✅ Todos os widgets são Server Components com `<Suspense>` independentes — falha de um não derruba a página
10. ✅ `npm run build` passa sem erros de tipo

## Decisões abertas

- **Gráficos de tendência:** usar `recharts` (já é dep) para um sparkline de orgs criadas por mês? Ou manter só números com delta por ora? → deixar para o planejamento
- **Atualização automática:** o feed de atividade é estático (server render). Supabase Realtime para auto-refresh? Fora do escopo desta seed — pode ser uma melhoria futura
- **"Último acesso" por org:** inferido por MAX(calls.created_at, conversations.created_at) — pode ser lento se as tabelas forem grandes. Alternativa: coluna `last_activity_at` materializada via trigger. Deixar para o planejamento decidir
