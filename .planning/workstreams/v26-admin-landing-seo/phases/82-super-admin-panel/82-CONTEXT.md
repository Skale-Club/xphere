# Phase 82: SUPER-ADMIN-PANEL - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Painel de super admin restrito ao email `skale.club@gmail.com`. Inclui:
- Route group `(admin)/` com layout que verifica o email do usuário autenticado
- Listagem de todas as organizações do sistema com métricas
- Detalhes por org: membros, configurações, status
- Ajuste de feature flags e notas de admin por org (persistido em `settings jsonb` da tabela `organizations`)

</domain>

<decisions>
## Implementation Decisions

### Access Control & Route Structure
- Verificação de email implementada no layout do route group `(admin)/`
- Rotas em `src/app/(admin)/admin/` — route group isolado com layout próprio
- Acesso não autorizado → redirect para `/dashboard`
- Usar `createClient()` normal com verificação de email no layout (sem service role no frontend)

### Layout & Visual Design
- Sidebar dedicada simples para o admin — sem org-switcher, sem componentes do dashboard
- Paleta: slate/zinc dark com accent vermelho/laranja — visualmente marca o contexto privilegiado
- Navegação: sidebar esquerda (consistente com dashboard)
- Header sempre mostra "Super Admin" + email do usuário logado

### Dados e Acesso às Orgs
- Server actions usam Supabase service role (via `SUPABASE_SERVICE_ROLE_KEY` env var) para bypass de RLS e visão global
- Métricas por org: contagem de contatos, chamadas, conversas, membros + data de criação
- Sem impersonação de org nesta fase
- Dados estáticos com refresh manual (sem Realtime)

### Preferências e Feature Flags
- Persistir em coluna `settings jsonb` na tabela `organizations` — sem nova migração
- Feature flags: toggles booleanos com descrição + campo de notas do admin
- Sem log de auditoria nesta fase
- Interface: lista de `Switch` shadcn com label e descrição

### Claude's Discretion
- Nomenclatura dos feature flags (ex: `feature_X_enabled`)
- Organização interna dos server actions de admin
- Detalhes de styling da sidebar admin dentro da paleta vermelho/slate

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createClient()`, `getUser()` from `@/lib/supabase/server` — use for auth check in admin layout
- shadcn/ui: `Switch`, `Card`, `Badge`, `Table`, `Button`, `Separator` — já instalados
- Sonner toasts para feedback de ações
- `APP_NAME` de `@/lib/config`

### Established Patterns
- Auth gate em layouts: `const user = await getUser(); if (!user) redirect('/login')`
- Email check adicional: `if (user.email !== 'skale.club@gmail.com') redirect('/dashboard')`
- Server actions com `createClient()` para dados da org atual
- Para acesso cross-org: usar `createServiceClient()` com `SUPABASE_SERVICE_ROLE_KEY`

### Integration Points
- Tabela `organizations`: tem `id`, `name`, `slug`, `created_at`, `settings jsonb`
- Tabelas de métricas existentes: `contacts`, `calls`, `conversations`, `organization_members`
- Não há rota `/admin` existente — criar do zero
- Não modificar sidebar do dashboard — criar sidebar admin separada

</code_context>

<specifics>
## Specific Ideas

- Accent vermelho/laranja para diferenciar claramente do contexto normal
- Header fixo com badge "SUPER ADMIN" sempre visível
- Tabela de orgs com busca e ordenação
- Feature flags predefinidos (ex: `ai_calling_enabled`, `bulk_import_enabled`, `advanced_pipeline_enabled`)

</specifics>

<deferred>
## Deferred Ideas

- Impersonação de org (entrar no contexto de uma org como admin)
- Log de auditoria de alterações
- Limites numéricos por org (max contacts, max calls)
- Real-time updates

</deferred>
