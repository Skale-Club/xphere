---
id: SEED-010
status: dormant
planted: 2026-05-17
planted_during: post-v2.0 Multi-Bot Platform
trigger_when: antes do milestone v2.1 (CRM + Omnichannel) para que tudo já saia com design final
scope: Large
priority: high
---

# SEED-010: Complete Redesign — Design Premium e Moderno

Redesign completo do Operator com qualidade visual comparável a **Linear, Vercel, Stripe e Notion**. Sair da estética genérica de "shadcn padrão" para um produto com identidade própria, motion design, dark mode primeiro, e atenção a cada microinteração.

**Objetivo:** Operator precisa parecer um produto premium de R$5000/mês quando o cliente abre o dashboard — não mais um "admin panel" que parece template.

---

## Filosofia de design

### Princípios
1. **Dark mode first** — visual primário em dark, com light mode disponível
2. **Densidade certa** — informação acessível sem poluição; espaço para respirar
3. **Motion subtil** — transições e microinterações em tudo (200-300ms ease-out)
4. **Hierarquia clara** — tipografia define importância, não tamanho de border
5. **Sem cinza puro** — cinzas com pequeno tint (azulado, esverdeado) dão sofisticação
6. **Componentes únicos** — cada tela deve ter um detalhe memorável (não tudo genérico)
7. **Performance visível** — skeletons, optimistic updates, transições suaves entre estados

### Referências visuais (mood board)
- **Linear** — densidade, atalhos, command palette, motion
- **Vercel Dashboard** — tipografia, espaços, charts limpos
- **Stripe Dashboard** — dados financeiros, tabelas
- **Notion** — empty states, ilustrações, onboarding
- **Raycast** — command palette, atalhos, microinterações
- **Cal.com** — dark mode bem feito, settings UX

---

## Design System Foundation

### Cores

**Dark mode (padrão):**
```css
--bg-primary:    #0A0A0B    /* fundo principal */
--bg-secondary:  #111113    /* cards, sidebars */
--bg-tertiary:   #1A1A1D    /* hover states */
--bg-elevated:   #222226    /* modais, popovers */

--border-subtle: #1E1E22    /* divisórias */
--border:        #2A2A2F    /* bordas padrão */
--border-strong: #3A3A40    /* bordas com ênfase */

--text-primary:   #FAFAFA   /* títulos, dados */
--text-secondary: #A1A1AA   /* descrições */
--text-tertiary:  #71717A   /* placeholders, hints */

--accent:         #6366F1   /* primary brand — indigo */
--accent-hover:   #4F46E5
--accent-muted:   rgba(99, 102, 241, 0.1)

--success: #22C55E
--warning: #F59E0B
--danger:  #EF4444
--info:    #3B82F6
```

**Light mode (paralelo):**
- Inversão calculada, não apenas troca de variáveis
- Sombras mais marcadas para compensar falta de glow

### Tipografia
- **Display:** Inter Display (títulos > 24px) ou Geist
- **Body:** Inter (texto, UI)
- **Mono:** JetBrains Mono ou Geist Mono (IDs, código, dados)
- **Tracking:** -0.02em em títulos grandes, 0 em body, +0.05em em labels uppercase

### Spacing
- Sistema de 4px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96
- Padding consistente: cards = 24px, sections = 32-48px

### Border radius
- Inputs/buttons: 8px
- Cards: 12px
- Modais: 16px
- Tags/badges: 6px (mais fechado, menos infantil)

### Shadows / elevation
```css
--shadow-sm:  0 1px 2px rgba(0,0,0,0.4)
--shadow-md:  0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)
--shadow-lg:  0 16px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)
--shadow-glow: 0 0 24px rgba(99,102,241,0.15) /* para CTAs */
```

### Motion
- Padrão: `200ms cubic-bezier(0.16, 1, 0.3, 1)` (ease-out forte)
- Hover: `100ms ease-out`
- Modais/sheets: `300ms cubic-bezier(0.32, 0.72, 0, 1)`
- Page transitions: View Transitions API quando disponível

---

## O que precisa ser construído

### Fase 1 — Fundação do design system

1. **CSS variables** — todas as cores, sombras, motion em `app/globals.css`
2. **Tema dark/light** — toggle no header com persistência em cookie
3. **Tipografia** — instalar Inter + Geist Mono via `next/font/google`
4. **Tailwind config** — extender tema com tokens do design system
5. **Componentes base re-skinned**:
   - Button (4 variantes: primary/secondary/ghost/destructive + 3 sizes)
   - Input/Textarea (com label flutuante opcional)
   - Select/Combobox (com search)
   - Card (com elevation + hover state)
   - Dialog/Sheet (com motion suave)
   - Toast (sonner re-skinned, posições configuráveis)
   - Badge (6 variantes semânticas)
   - Avatar (com stack/group)
   - Tooltip (delay 300ms, com keyboard hint quando aplicável)

### Fase 2 — Layout e navegação

6. **Sidebar nova**:
   - Collapsible (Cmd+B), persiste estado
   - Logo no topo + org switcher embaixo
   - Grupos de navegação com separadores sutis
   - Item ativo com glow do accent + indicador lateral
   - Badge de contagem em items (ex: "12 unread" no inbox)
   - Tooltip com nome quando colapsada

7. **Top bar**:
   - Breadcrumb dinâmico baseado na rota
   - Search global (Cmd+K abre command palette)
   - Notificações com badge animado
   - User menu com avatar + atalho de logout
   - Indicador de status do workspace (online/offline)

8. **Command palette (Cmd+K)**:
   - Componente novo usando `cmdk`
   - Categorias: Navigation, Actions, Settings, Help
   - Fuzzy search
   - Atalhos de teclado visíveis em cada item
   - Histórico recente

9. **Layout responsivo**:
   - Mobile: sidebar vira drawer, top bar compacta
   - Tablet: sidebar colapsada por padrão
   - Desktop: sidebar expandida por padrão

### Fase 3 — Páginas redesenhadas

10. **Home dashboard** (`/dashboard`):
    - Hero com saudação personalizada + métricas-chave (4 cards animados com sparklines)
    - Seção "Atividade recente" com feed unificado (mensagens, chamadas, oportunidades)
    - Quick actions: "Nova conversa", "Adicionar contato", "Criar oportunidade"
    - Gráfico de atividade nos últimos 7 dias (área chart)

11. **Conversas/Inbox** (`/chat`, `/conversations`):
    - Layout 3 colunas: lista | conversa | painel de contato
    - Filtros como pills no topo (todos, não lidas, atribuídas a mim)
    - Preview de mensagem com formatação rica
    - Channel icons coloridos por canal
    - Status badges (bot ativo/pausado, atribuída)
    - Indicador de "digitando..." em tempo real
    - Drag-to-reply quote system

12. **Agentes** (`/agents`):
    - Grid de cards com preview do prompt (truncado)
    - Métricas inline em cada card (invocações 24h, custo, latência)
    - Ações rápidas no hover: editar, playground, duplicar
    - Empty state com CTA grande "Criar primeiro agente"

13. **Contatos** (`/contacts`):
    - Tabela densa com avatares + tags coloridas
    - Filtros laterais (source, tag, última atividade)
    - Bulk actions (export, delete, tag, merge)
    - Detail panel slide-in ao clicar (não navega, abre lateral)
    - Histórico unificado no detail (mensagens, chamadas, oportunidades)

14. **Calls** (`/calls`):
    - Timeline visual de chamadas por dia
    - Player de áudio com waveform (lib `wavesurfer.js`)
    - Filtros: inbound/outbound, status, duração, contato
    - Card de chamada com transcrição expandível

15. **Pipeline** (`/pipeline`):
    - Kanban com drag-and-drop suave (lib `@dnd-kit`)
    - Cards com avatar do contato, valor formatado, dias no stage
    - Toggle entre Kanban e List view
    - Filtros: responsável, valor, tag, próxima ação
    - Indicador visual de aging (cor muda se está há muito tempo no stage)

16. **Reviews** (`/reviews`):
    - Hero com nota média grande + total de reviews + gráfico de distribuição (estrelas)
    - Lista de reviews em cards com foto, nota, texto, fotos anexadas
    - Filtros: nota mínima, com foto, com resposta do dono
    - Preview do widget embeddable

17. **Settings** (`/settings/*`):
    - Layout 2 colunas: nav de settings | conteúdo
    - Seções: Workspace, Integrações, Equipe, Calls, Billing
    - Form auto-save com indicador "Salvo" subtil
    - Toggle switches grandes e bonitos

### Fase 4 — Componentes únicos

18. **Metric Card** com sparkline + trend indicator (↑/↓ com cor)
19. **Activity Feed** unificado (timeline com ícones por tipo de evento)
20. **Channel Badge** colorido (verde WhatsApp, rosa Instagram, etc.)
21. **Status Pill** animado (pulse para "live", spinner para "loading")
22. **Empty States** com ilustrações SVG customizadas + CTA
23. **Skeleton Loaders** para cada tipo de conteúdo (cards, tabelas, listas)
24. **Error Boundary** com ilustração + botão de retry
25. **Onboarding Tour** (lib `react-joyride` ou custom) para primeira sessão

### Fase 5 — Microinterações

26. **Botões com loading state** (texto vira spinner sem mudar de tamanho)
27. **Optimistic updates** em todas as ações (toggle, drag, delete)
28. **Toast animations** (slide-in suave da direita, auto-dismiss com progress bar)
29. **Hover effects** em cards (lift sutil + glow no accent)
30. **Page transitions** entre rotas (fade + slide pequeno)
31. **Number counters** animados (CountUp em métricas)
32. **Confetti** ao fechar deal (lib `react-confetti`) — pequenos detalhes que viciam

### Fase 6 — Branding por org

33. **Logo upload** por org nas settings
34. **Primary color override** por org (admin escolhe accent color)
35. **Favicon dinâmico** baseado no logo da org
36. **White label** opcional: esconder "Powered by Operator"

---

## Componentes técnicos

### Bibliotecas a adicionar
```json
{
  "@dnd-kit/core": "Kanban drag-and-drop",
  "@dnd-kit/sortable": "Lista ordenável",
  "cmdk": "Command palette",
  "framer-motion": "Animações complexas",
  "wavesurfer.js": "Audio waveform",
  "recharts": "Já presente, usar mais",
  "sonner": "Já presente, re-skin",
  "react-confetti": "Micro celebrations"
}
```

### Fontes
```ts
// app/layout.tsx
import { Inter, JetBrains_Mono } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' })
const mono = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-mono' })
```

### Estrutura de arquivos
```
src/
├── styles/
│   ├── globals.css            (CSS variables, base styles)
│   ├── tokens.css             (design tokens exportados)
│   └── motion.css             (keyframes, transitions)
├── components/
│   ├── ui/                    (shadcn components re-skinned)
│   ├── design-system/         (novos componentes: MetricCard, ActivityFeed, etc.)
│   ├── empty-states/          (ilustrações + CTAs)
│   ├── skeletons/             (loaders por tipo)
│   └── layout/                (Sidebar, TopBar, CommandPalette)
```

---

## Critérios de sucesso

Antes de fechar este SEED, deve ser verdade:

1. ✅ Dark mode é o tema padrão e é genuinamente bonito (não só "fundo preto com mesmas cores")
2. ✅ Tipografia tem hierarquia clara — alguém que olha sabe imediatamente o que é importante
3. ✅ Todas as 7 páginas principais (home, conversas, agentes, contatos, calls, pipeline, reviews) seguem o mesmo design language
4. ✅ Command palette funciona (Cmd+K) e contém navegação + ações comuns
5. ✅ Sidebar colapsa/expande com animação suave + persiste estado
6. ✅ Cada CRUD tem skeleton loader, empty state com CTA, e error state
7. ✅ Pelo menos 5 microinterações memoráveis (confetti em deal won, sparkline em métrica, hover em card, etc.)
8. ✅ Responsivo: mobile, tablet, desktop testados
9. ✅ Performance: Lighthouse 90+ em performance + accessibility
10. ✅ Brand por org: org pode trocar accent color + logo

---

## Scope

**Large — 6-8 fases, ~25-30 plans**

Decomposição sugerida em fases:
- Fase R1: Design System Foundation (tokens, cores, tipografia, componentes base) — 4 plans
- Fase R2: Layout + Sidebar + TopBar + Command Palette — 4 plans
- Fase R3: Home Dashboard + Empty States — 3 plans
- Fase R4: Inbox/Conversas redesign — 4 plans
- Fase R5: Agentes + Contatos + Calls redesign — 5 plans
- Fase R6: Pipeline + Reviews redesign — 4 plans
- Fase R7: Settings + Onboarding + Branding por org — 4 plans
- Fase R8: Microinterações + Polimento final + Lighthouse audit — 3 plans

---

## Ordem de execução

Este SEED deve ser executado **ANTES** das fases funcionais do v2.1 — assim cada nova funcionalidade (Contacts, Calls, Pipeline, Reviews) já nasce com o design system pronto, sem retrabalho de UI.

**Sequência recomendada:**
```
SEED-010 R1-R3 (design system + layout + home)
  ↓
SEED-005, SEED-006, SEED-009 (funcionalidades novas usando o design já pronto)
  ↓
SEED-010 R4-R6 (redesign das telas existentes + novas)
  ↓
SEED-007, SEED-004, SEED-008 (funcionalidades restantes)
  ↓
SEED-010 R7-R8 (polimento final)
```

---

## Referências de código existente

- [`src/app/globals.css`](src/app/globals.css) — CSS atual a refatorar
- [`src/components/ui/`](src/components/ui/) — shadcn primitives a re-skinnar
- [`src/components/layout/`](src/components/layout/) — Sidebar, OrgSwitcher atuais
- [`tailwind.config.ts`](tailwind.config.ts) — config Tailwind a expandir
- Skill `frontend-design` — referência de qualidade para guiar agentes de execução
- Skill `ui-ux-pro-max` — biblioteca de patterns para consultar

---

## Próximo passo

Este SEED é a **base visual de todo o resto**. Deve abrir o milestone v2.1.

Quando autônomo: agentes devem invocar a skill `frontend-design` ou `ui-ux-pro-max` em cada plano para garantir qualidade visual premium.
