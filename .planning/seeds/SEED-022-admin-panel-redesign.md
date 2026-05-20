---
id: SEED-022
status: idea
planted: 2026-05-20
trigger_when: next milestone
scope: Small
priority: medium
---

# SEED-022: Super Admin Panel — Redesign Visual

Realinha o painel super admin ao design system do dashboard padrão: mesmos tokens CSS, mesma tipografia, mesma estrutura de layout. Hoje o admin usa cores hex hardcoded, accent vermelho, e força `class="dark"` — completamente fora do design system.

## Diagnóstico (auditoria dos 7 arquivos)

### Problema 1 — `class="dark"` hardcoded no wrapper
```tsx
// layout.tsx — HOJE
<div className="dark flex min-h-screen bg-[#0A0A0B] text-[#FAFAFA]">
```
Isso sobrescreve o `ThemeProvider` e bloqueia light mode. O admin nunca herda o tema do usuário.

### Problema 2 — Hex hardcoded em vez de design tokens
Todos os 5 componentes usam hex direto em vez das variáveis CSS do `globals.css`:

| Hex atual | Token correto |
|-----------|--------------|
| `bg-[#0A0A0B]` | `bg-bg-primary` |
| `bg-[#111113]` | `bg-bg-secondary` / `bg-card` |
| `bg-[#1A1A1D]` | `bg-bg-tertiary` |
| `border-[#2A2A2F]` | `border-border-subtle` |
| `text-[#FAFAFA]` | `text-text-primary` |
| `text-[#A1A1AA]` | `text-text-secondary` |
| `text-[#71717A]` | `text-text-tertiary` |
| `text-[0.8125rem]` | `text-sm` (13px = design system padrão) |

### Problema 3 — Accent vermelho fora do sistema
O dashboard usa `--accent: #6366F1` (indigo). O admin usa vermelho (`bg-red-600`, `text-red-400`, `border-red-500`, `focus-visible:ring-red-500/40`) — uma cor que não existe no design system e contrasta com o resto da interface.

O `top-bar.tsx` já estabeleceu a identidade do admin como **amber** (shield icon: `text-amber-400/80`, `border-amber-500/20`). O seed segue esse padrão: amber como cor de identidade admin, indigo como accent funcional.

### Problema 4 — Header do layout sem `backdrop-blur`
O header do admin é `bg-[#0A0A0B]` sólido. O dashboard usa `bg-bg-primary/80 backdrop-blur-md` com `sticky top-0 z-30`.

### Problema 5 — Sidebar não usa shadcn Sidebar primitives
O dashboard usa o componente `Sidebar` do shadcn (com collapso, keyboard nav, etc.). O admin tem um `<aside>` manual simples. Não precisa ser idêntico — a sidebar admin é mais simples — mas deve usar os mesmos tokens de cor.

## O que mudar (por arquivo)

### `src/app/(admin)/layout.tsx`
- Remover `class="dark"` do wrapper div → herda ThemeProvider
- Trocar todos hex por tokens: `bg-bg-primary text-text-primary`
- Header: `sticky top-0 z-30 border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md`
- Badge "SUPER ADMIN": trocar gradient vermelho por `text-amber-500 dark:text-amber-400` (alinha com o shield do top-bar)
- Botão "Voltar ao painel": usar `border-border-subtle hover:bg-bg-tertiary text-text-secondary hover:text-text-primary`
- Email do usuário: `text-text-tertiary text-xs`

### `src/components/admin/admin-sidebar.tsx`
- Sidebar: `bg-bg-secondary border-r border-border-subtle`
- Logo header: `h-14 flex items-center gap-2 px-4 border-b border-border-subtle bg-amber-500/5`
- Ícone shield: `text-amber-500 dark:text-amber-400`
- Nav items inativos: `text-text-secondary hover:bg-bg-tertiary hover:text-text-primary`
- Nav item ativo: `bg-accent-muted text-accent` (indigo, igual ao dashboard) — sem `border-l` hardcoded

### `src/components/admin/orgs-table.tsx`
- Input search: `bg-bg-secondary border-border-subtle text-text-primary placeholder:text-text-tertiary focus-visible:ring-ring/40`
- Container da tabela: `rounded-lg border border-border-subtle overflow-hidden`
- TableHeader row: `border-border-subtle bg-bg-secondary`
- TableHead: `text-text-tertiary font-medium text-xs`
- Sort icon ativo: `text-accent` (indigo)
- TableRow: `border-border-subtle bg-bg-primary hover:bg-bg-tertiary`
- TableCell primary: `text-text-primary`
- TableCell secondary: `text-text-secondary`

### `src/components/admin/org-detail-view.tsx`
- Cards: `bg-card border-border-subtle` (shadcn `Card` já usa `bg-card` — basta limpar o override)
- `MetricCard`: ícone `text-text-tertiary`, valor `text-text-primary`, label `text-text-secondary`
- Badge ativo: `bg-success-muted text-success border-success/20`
- Badge inativo: `bg-muted text-muted-foreground border-border`
- Slug: `text-text-tertiary font-mono text-xs`
- Switch feature flags: `data-[state=checked]:bg-primary` (indigo)
- Botão salvar: `bg-primary hover:bg-primary/90 text-primary-foreground`
- Separator: `bg-border-subtle`
- TableRow hover: `hover:bg-bg-tertiary`
- Metadata card: sem override de bg — usa `bg-card` padrão

### `src/components/admin/platform-settings-view.tsx`
- `StatCard`: igual ao `MetricCard` acima
- Separator: `bg-border-subtle`
- Card bulk flags: `bg-card border-border-subtle`
- Botão "Disable all": `border-border-subtle bg-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary`
- Botão "Enable all": `bg-primary hover:bg-primary/90 text-primary-foreground`

### `src/components/admin/seo-config-form.tsx`
- Cards: remover overrides de bg/border → herda `bg-card border-border-subtle`
- Inputs: `bg-bg-primary border-border text-text-primary focus-visible:ring-ring/40`
- `FormLabel`: `text-text-secondary text-sm`
- `FormDescription`: `text-text-tertiary text-xs`
- `FormMessage`: `text-danger text-xs`
- Favicon preview box: `border-border-subtle bg-bg-primary`
- Botão upload: `border-border-subtle bg-bg-primary text-text-secondary hover:bg-bg-tertiary hover:text-text-primary`
- Botão delete: `hover:bg-danger-muted hover:border-danger/30 hover:text-danger`
- Botão salvar: `bg-primary hover:bg-primary/90 text-primary-foreground`

### Pages (orgs/page.tsx, seo/page.tsx, settings/page.tsx)
- `h1`: `text-text-primary text-xl font-semibold tracking-tight` (sem hardcoded `tracking-[-0.015em]`)
- `p` subtitles: `text-text-secondary text-sm mt-1`
- Error states: `text-text-secondary text-sm`

## Identidade visual do admin

O admin **não deve ser idêntico** ao dashboard — precisa de uma identidade reconhecível para o super admin saber que está em modo elevado. A estratégia:

| Elemento | Dashboard | Admin |
|----------|-----------|-------|
| Accent funcional (botões, focus ring, active nav) | Indigo `--accent` | Indigo `--accent` (igual) |
| Identidade de seção (badge, shield, sidebar header) | — | Amber `text-amber-500` |
| Fundo, bordas, tipografia | CSS tokens | CSS tokens (idêntico) |
| Fonte | Inter `--font-sans` | Inter `--font-sans` (herda do RootLayout) |
| Dark/light | ThemeProvider | ThemeProvider (removendo `class="dark"` hardcoded) |

## Arquivos

```
src/
  app/(admin)/
    layout.tsx                     EDIT — remove class="dark", tokens, header polish
    admin/
      orgs/page.tsx                EDIT — tokens nos estados de erro
      seo/page.tsx                 EDIT — tokens nos estados de erro
      settings/page.tsx            EDIT — tokens nos estados de erro
      orgs/[orgId]/page.tsx        EDIT — tokens no estado de erro

  components/admin/
    admin-sidebar.tsx              EDIT — tokens, amber identity, active state indigo
    orgs-table.tsx                 EDIT — tokens em toda a tabela e inputs
    org-detail-view.tsx            EDIT — tokens em cards, switches, badges, botões
    platform-settings-view.tsx     EDIT — tokens em cards e botões
    seo-config-form.tsx            EDIT — tokens em inputs, labels, botões
```

**Zero novas dependências. Zero alterações de schema. Zero alterações de lógica.** Mudanças 100% visuais/CSS.

## Critérios de sucesso

1. ✅ Admin abre em light mode quando o usuário preferir (sem `class="dark"` hardcoded)
2. ✅ Nenhum hex hardcoded em nenhum dos 7 arquivos — só tokens CSS e classes Tailwind do design system
3. ✅ Accent indigo nos botões de ação e nav ativo (igual ao dashboard)
4. ✅ Amber na badge "SUPER ADMIN" e ícone shield da sidebar (identidade admin preservada)
5. ✅ `backdrop-blur-md` no header do admin (igual ao top-bar do dashboard)
6. ✅ `npm run build` passa sem erros de tipo
7. ✅ Inspeção visual: fontes e tamanhos de texto idênticos ao dashboard padrão
