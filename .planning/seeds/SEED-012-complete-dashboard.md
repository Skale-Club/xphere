---
id: SEED-012
status: dormant
planted: 2026-05-17
planted_during: post-v2.1 + SEED-011 chat redesign + 1621801304 incident recovery
trigger_when: depois que o dashboard mínimo (commit cdcae7f) for confirmado estável; OU pedido explícito
scope: Medium-Large
priority: high
---

# SEED-012: Complete Dashboard — Coerente com o Sistema Atual

Reconstruir o home dashboard (`/`) com widgets reais conectados a TODAS as áreas que o Operator agora suporta — Chat, Calls, Contacts, Pipeline, Agents, Reviews, Integrações. Deve ser uma "vista executiva" do negócio do cliente, não um painel genérico.

**Contexto crítico:** O dashboard original quebrava com erro `1621801304` (recursão infinita no render). Esta reconstrução deve ser feita com **error boundaries por seção** desde o início, NÃO try/catch defensivo retroativo.

---

## Filosofia

**Princípio 1 — Visão executiva, não dashboard de admin server**
Métricas que importam para um agência operando: deals abertos, conversas pendentes, chamadas perdidas hoje, novos contatos. NÃO métricas técnicas (latency de LLM, cache hit rate, etc — isso fica em `/agents/[id]/invocations`).

**Princípio 2 — Coerente com cada área**
Cada widget é um "preview" da página dedicada (`/chat`, `/pipeline`, etc), com link direto. Como o Linear dashboard linka pras issues, ou o Stripe dashboard linka pros payments.

**Princípio 3 — Tempo presente**
Foco em "agora" e "hoje", não em históricos de meses. Para histórico tem os relatórios dedicados.

**Princípio 4 — Actionable**
Cada widget deve permitir uma ação ou levar para uma ação. "Você tem 5 conversas não atribuídas" → clique → vai pra inbox filtrada.

**Princípio 5 — Resiliente desde o nascimento**
Cada widget é um Server Component independente envolvido em seu próprio `<Suspense>` + `error.tsx` boundary. Se um widget quebra, o resto carrega. Sem `Promise.all` global, sem error boundaries de página inteira.

---

## Layout — Grade Responsiva

```
┌──────────────────────────────────────────────────────────────────┐
│  Hero: Greeting + Cost ticker do dia + status do workspace        │
├──────────────────────────────────────────────────────────────────┤
│  Row 1 — 4 MetricCards lado a lado                                │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                              │
│  │ Convs│ │ Calls│ │ Deals│ │ Avg★ │                              │
│  │ open │ │ today│ │ won  │ │ Revw │                              │
│  └──────┘ └──────┘ └──────┘ └──────┘                              │
├──────────────────────────────────────────────────────────────────┤
│  Row 2 — Painéis grandes (2 cols)                                 │
│  ┌─────────────────────────┐ ┌──────────────────────────┐         │
│  │  Recent Conversations   │ │  Pipeline Overview        │         │
│  │  (top 5 unread)         │ │  (kanban mini ou bars)    │         │
│  └─────────────────────────┘ └──────────────────────────┘         │
├──────────────────────────────────────────────────────────────────┤
│  Row 3 — Painéis médios (3 cols)                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                           │
│  │Recent    │ │Integrations│ │Today's   │                          │
│  │Calls     │ │  status    │ │activity  │                          │
│  └──────────┘ └──────────┘ └──────────┘                           │
├──────────────────────────────────────────────────────────────────┤
│  Row 4 — Activity feed (full width)                               │
│  Latest events across all channels and operations                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Widgets — Especificação detalhada

### Hero

- **Greeting**: "Good morning/afternoon/evening, {first name}"
- **Cost today**: indicador subtil "$X.XX spent today" com barra de progresso do daily cap se houver
- **Workspace status pill**: "All systems operational" (verde) OU "1 integration disconnected" (warning)
- Ação rápida: botão "New conversation" + "New contact" + "New deal" (3 quick-action chips)

### Row 1 — MetricCards (4 cards)

Cada card: title + big value + delta vs ontem + sparkline (mini chart 7 dias)

1. **Open Conversations**
   - Value: count of conversations with status='open'
   - Delta: vs same time yesterday
   - Sparkline: new conversations per day, 7 days
   - Click: → `/chat`

2. **Calls Today**
   - Value: total calls (inbound + outbound)
   - Delta: vs yesterday
   - Sparkline: 7 days
   - Sub-label: "X missed" if any missed today
   - Click: → `/voice`

3. **Deals Won (this month)**
   - Value: count + sum of value (R$ format)
   - Delta: vs last month, percentage
   - Sparkline: deals won per week, last 4 weeks
   - Click: → `/pipeline?status=won`

4. **Avg Rating**
   - Value: ★ 4.8 (or whatever the average is across all linked Google Business profiles)
   - Sub-label: "X reviews total"
   - Sparkline: rating distribution mini bar chart
   - Click: → `/reviews`

### Row 2 — Painéis grandes (2 cols)

**Painel A — Recent Conversations**
- Card with header "Recent activity in Inbox" + "View all" link
- List of 5 most recent conversations sorted by `updated_at DESC`
- Each row: avatar (from contacts if linked) + name/phone + channel badge + last message preview (1 line) + time relative + unread indicator
- Empty state: "Your inbox is empty. Connect a channel to start."
- Click row → opens that conversation in `/chat?conversation={id}`

**Painel B — Pipeline Overview**
- Card with header "Active Pipeline" + "View board" link
- Mini horizontal bar chart per stage:
  ```
  Lead          ████████  12 deals  R$ 24,500
  Qualified     ██████    7 deals   R$ 18,200
  Proposal      ████      4 deals   R$ 32,100
  Negotiation   ██        2 deals   R$ 15,800
  Won (month)   ███       5 deals   R$ 28,300
  ```
- Total at bottom: "30 deals · R$ 118,900 total active value"
- Empty state: "No pipeline configured. Create your first deal."
- Click stage → `/pipeline?stage={id}`

### Row 3 — Painéis médios (3 cols)

**Painel C — Recent Calls**
- Card: "Today's calls" + "View all"
- List of 5 most recent calls
- Each row: direction icon (in/out) + contact name or phone + duration + status pill + time
- Recording icon if available
- Click row → call detail with player
- Empty state: "No calls yet today"

**Painel D — Integrations Status**
- Card: "Connected services"
- 6 integration tiles in 2x3 grid:
  - WhatsApp (Evolution Go) ✓/✗ + phone number if connected
  - Twilio (SMS + Voice) ✓/✗ + from_number
  - Meta (Messenger + Instagram) ✓/✗
  - ManyChat ✓/✗
  - Google Reviews ✓/✗ + place name if connected
  - GoHighLevel ✓/✗
- Each tile: small logo + status pill + "Configure" button if not connected
- Click any → `/integrations/{provider}`

**Painel E — Today's Activity Snapshot**
- Card: "Today by the numbers"
- Vertical list of mini-stats:
  - 📥 X messages received
  - 📤 Y messages sent (by humans / by agents split)
  - 📞 Z calls (with M missed)
  - 👤 N new contacts
  - 💰 V new deals
  - ⭐ W new reviews
- Each stat is clickable, navigates to filtered view

### Row 4 — Activity Feed (full width)

- Card: "Recent activity across your workspace" + filter dropdown (All / Messages / Calls / Deals / Reviews)
- Unified timeline of last 15 events from these sources:
  - new conversation message (any channel)
  - call completed
  - opportunity stage change
  - new review scraped
  - integration connect/disconnect
  - new contact created
- Each row: icon + actor + action + target + relative time
- Live updates via Supabase Realtime broadcast (subscribe to `activity:{org_id}` channel)
- Pagination: "Load 15 more" button at bottom

---

## Architecture — Resilient by Design

### Server Component decomposition

Each widget is its OWN Server Component file, no shared state:

```
src/app/(dashboard)/page.tsx              ← orchestrator only
src/components/dashboard/widgets/
├── hero-greeting.tsx                     ← Server, gets user
├── hero-cost-ticker.tsx                  ← Server, queries agent_invocations sum today
├── hero-workspace-status.tsx             ← Server, checks integrations
├── metric-open-conversations.tsx         ← Server, count + sparkline
├── metric-calls-today.tsx                ← Server
├── metric-deals-won.tsx                  ← Server
├── metric-avg-rating.tsx                 ← Server
├── recent-conversations.tsx              ← Server
├── pipeline-overview.tsx                 ← Server
├── recent-calls.tsx                      ← Server
├── integrations-status.tsx               ← Server
├── activity-snapshot.tsx                 ← Server
└── activity-feed.tsx                     ← Server + Client (realtime)
```

### Error isolation pattern

```tsx
// page.tsx — orchestrator
export default function DashboardPage() {
  return (
    <PageContainer>
      <HeroSection />
      
      <div className="grid grid-cols-4 gap-4 mt-6">
        <ErrorBoundary fallback={<MetricCardError />}>
          <Suspense fallback={<MetricCardSkeleton />}>
            <MetricOpenConversations />
          </Suspense>
        </ErrorBoundary>
        {/* ... 3 more metric cards same pattern */}
      </div>
      
      <div className="grid grid-cols-2 gap-4 mt-4">
        <ErrorBoundary fallback={<PanelError title="Conversations" />}>
          <Suspense fallback={<PanelSkeleton />}>
            <RecentConversations />
          </Suspense>
        </ErrorBoundary>
        {/* ... etc */}
      </div>
    </PageContainer>
  )
}
```

**Critical rule:** EVERY async server component must have its own `<Suspense>` + `<ErrorBoundary>` wrapper. NEVER use `Promise.all` to combine multiple queries — each is independent. This guarantees that if any single widget breaks, the rest of the dashboard loads normally.

### Custom ErrorBoundary

`src/components/dashboard/widget-error-boundary.tsx`:
```tsx
'use client'
import { Component, type ReactNode } from 'react'

interface State {
  hasError: boolean
  error?: Error
}

export class WidgetErrorBoundary extends Component<{
  fallback: ReactNode | ((error: Error) => ReactNode)
  children: ReactNode
}, State> {
  state = { hasError: false }
  
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[dashboard-widget]', error, info.componentStack)
  }
  
  render() {
    if (this.state.hasError) {
      return typeof this.props.fallback === 'function' 
        ? this.props.fallback(this.state.error!) 
        : this.props.fallback
    }
    return this.props.children
  }
}
```

Each fallback shows a small "Widget unavailable" card with retry button, never propagates the error up.

### Realtime updates (Activity Feed only)

Only the activity feed subscribes to realtime. Other widgets are server-rendered fresh on navigation. This keeps the page lightweight.

Channel: `dashboard:{org_id}`  
Events: `activity` with payload `{ type, actor, target, timestamp }`

---

## Data Queries — Performance

Use Supabase RPC or materialized views where possible:

```sql
-- Single function for the dashboard summary
CREATE OR REPLACE FUNCTION dashboard_summary(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'open_conversations', (SELECT count(*) FROM conversations WHERE org_id = p_org_id AND status = 'open'),
    'calls_today', (SELECT count(*) FROM call_logs WHERE org_id = p_org_id AND started_at >= now()::date),
    'deals_won_month', (SELECT count(*) FROM opportunities WHERE org_id = p_org_id AND status = 'won' AND updated_at >= date_trunc('month', now())),
    'deals_won_value_month', (SELECT coalesce(sum(value), 0) FROM opportunities WHERE org_id = p_org_id AND status = 'won' AND updated_at >= date_trunc('month', now())),
    'avg_rating', (SELECT avg(average_rating) FROM google_business_profiles WHERE org_id = p_org_id AND is_active = true)
  ) INTO result;
  
  RETURN result;
END $$;
```

Then each metric card reads from this RPC instead of running its own query — single DB roundtrip for the metric row.

OR: keep each widget independent with its own query (simpler, harder to optimize). Trade-off discussion in research phase.

---

## Empty States

The dashboard should look great on day 1 of a fresh org (no data). Each widget has its own empty state with a CTA:

- Open Conversations = 0 → "Connect WhatsApp to start receiving messages" → /integrations
- Calls Today = 0 → "Connect Twilio for SMS and Voice" → /integrations
- Deals Won = 0 → "Create your first deal" → /pipeline
- Reviews avg = null → "Connect Google Reviews to track your reputation" → /integrations/google-reviews

The hero greeting checks ALL these and if all are empty, shows a setup wizard variant instead of the normal dashboard.

---

## Scope

**Medium-Large — 5-6 fases, ~18 plans**

### Decomposição sugerida

1. **Fase D1 — Architecture skeleton + ErrorBoundary** — page.tsx orchestrator, Suspense + boundary pattern, skeletons, error fallbacks. Just structure, no data.

2. **Fase D2 — Hero + 4 MetricCards** — greeting, cost ticker, workspace status, 4 metric widgets with sparklines (recharts)

3. **Fase D3 — Recent Conversations + Pipeline Overview** — the 2 big panels of row 2

4. **Fase D4 — Recent Calls + Integrations Status + Activity Snapshot** — the 3 medium panels of row 3

5. **Fase D5 — Activity Feed + Realtime** — full-width unified feed with Supabase Realtime broadcast subscription

6. **Fase D6 — Empty states + setup wizard** — fresh-org variant, polished empty states per widget, polished setup wizard for day-1 users

---

## Critérios de sucesso

1. ✅ Dashboard carrega em < 1s para org com dados normais
2. ✅ Cada widget é independente — quebra de um não derruba o resto
3. ✅ Cada widget tem skeleton, empty state, error fallback
4. ✅ Visual coerente com o resto do v2.1 (cards, spacing, typography)
5. ✅ Dark mode primeiro
6. ✅ Mobile responsive (4-col → 2-col → 1-col)
7. ✅ Realtime updates funcionando no activity feed
8. ✅ Click em qualquer widget leva pra área dedicada
9. ✅ Sem `Promise.all` global, sem error boundaries de página inteira
10. ✅ Org nova (zero dados) tem experiência guiada via empty states + setup wizard

---

## Anti-patterns (lições do incidente 1621801304)

**NÃO fazer:**

❌ `Promise.all([fetch1, fetch2, fetch3])` que rejeita tudo se um falhar  
❌ Try/catch retroativo wrapping cada query → o código fica feio e os erros viram silenciosos  
❌ Error boundary único na página inteira (`error.tsx` no segment) → quando algo quebra, o dashboard inteiro some  
❌ `error.tsx` que importa componentes complexos do design system → pode quebrar dentro do próprio boundary, criando loop  
❌ `<Suspense>` aninhados em padrão que cria fallback loop  
❌ Componentes que fazem `setState` durante render  
❌ Providers globais que re-renderizam quando dados mudam  

**Fazer:**

✅ ErrorBoundary + Suspense por widget  
✅ Cada query no seu Server Component, independente  
✅ Skeletons enquanto cada widget carrega individualmente  
✅ Console logs tagueados `[dashboard:widget-name]` no error boundary  
✅ Test de "kill switch" para cada widget (force-fail uma query e verificar que dashboard ainda carrega)

---

## Referências de código existente

- `src/app/(dashboard)/page.tsx` — versão mínima atual (commit cdcae7f) — substituir
- `src/components/design-system/metric-card.tsx` — já existe, reusar
- `src/components/design-system/activity-feed.tsx` — adaptar para realtime
- `src/components/design-system/activity-chart.tsx` — já existe
- `src/components/dashboard/pipeline-widget.tsx` — versão antiga, refazer no novo padrão
- `src/components/skeletons/` — usar
- `src/components/empty-states/` — usar e expandir
- `.planning/incidents/dashboard-1621801304.md` — LER ANTES de começar, contém as lições

---

## Próximo passo

Quando o dashboard mínimo estiver confirmado estável em produção:

```
/gsd:new-milestone "v2.2 Dashboard Restoration"
```

OU executar autonomamente em waves de 2-3 widgets por vez (não tudo de uma vez como Wave 1 do v2.1 fez — aquela foi a fonte do bug). Cada wave:
1. Implementa widget
2. Deploy isolado
3. Confirmação visual de produção
4. Próxima wave

Cadência: max 3 widgets por commit. Deploy + verificação entre commits.
