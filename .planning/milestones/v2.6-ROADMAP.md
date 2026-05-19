# Roadmap: v2.6 Admin Panel + Landing Page + SEO

**Workstream:** v26-admin-landing-seo
**Phases:** 3 (82–84) | **Requirements:** 18 (ADM-01..06, LND-01..06, SEO-01..06)

---

## Phase 82: SUPER-ADMIN-PANEL

**Goal:** Painel de super admin restrito ao email skale.club@gmail.com para visualizar todos os clientes (orgs) do sistema, suas configurações, membros, status de uso, e ajustar preferências globais
**Depends on:** Nothing (first phase of v2.6)
**Requirements:** ADM-01, ADM-02, ADM-03, ADM-04, ADM-05, ADM-06
**Success Criteria:**
1. Rota `/admin` existe e é acessível SOMENTE para o usuário com email `skale.club@gmail.com` — qualquer outro email é redirecionado para `/dashboard`
2. Middleware ou layout verifica o email do usuário autenticado e bloqueia acesso não autorizado
3. Página `/admin/orgs` lista todas as organizações do sistema com: nome, slug, criado_em, número de membros, status
4. Página `/admin/orgs/[orgId]` mostra detalhes da org: membros, configurações, plano, métricas de uso (chamadas, contatos, etc.)
5. Funcionalidade de ajuste de preferências globais: toggle features por org, ajuste de limites
6. Interface construída com shadcn/ui, Tailwind 4 — visual distinto do dashboard normal para indicar contexto admin
7. `npm run build` exits 0

**Plans:** 4
- [ ] 82-01-PLAN.md — Middleware/guard: restrição por email + rota /admin layout
- [ ] 82-02-PLAN.md — Página /admin/orgs: listagem de todas as organizações com métricas
- [ ] 82-03-PLAN.md — Página /admin/orgs/[orgId]: detalhes, membros e configurações da org
- [ ] 82-04-PLAN.md — Preferências globais: toggles de features e ajustes por org

---

## Phase 83: LANDING-AUTH-PAGE

**Goal:** Landing page moderna e sofisticada para o produto Xphere com hero, features, CTA e pricing; página de auth (login/signup) com design polido que combina com a landing
**Depends on:** Nothing (can run parallel to 82)
**Requirements:** LND-01, LND-02, LND-03, LND-04, LND-05, LND-06
**Success Criteria:**
1. Rota `/` (ou `/landing`) exibe a landing page com: hero section com headline + subheadline + CTA, seção de features/benefits, seção de pricing ou CTA final
2. Design moderno, sofisticado, responsivo — qualidade Vercel/Linear — dark mode by default
3. Animações sutis (Framer Motion ou CSS) para scroll reveal e interações
4. Página de login (`/login`) completamente redesenhada: layout split ou centered card com design premium
5. Página de signup (`/signup` ou integrada com login) com mesmo visual
6. Auth pages combinam visualmente com a landing page — mesma paleta de cores, tipografia
7. Performance: fontes otimizadas, imagens com next/image, LCP < 2.5s
8. `npm run build` exits 0

**Plans:** 3
- [ ] 83-01-PLAN.md — Landing page: hero, features, pricing/CTA sections com design system
- [ ] 83-02-PLAN.md — Auth pages redesign: login + signup com visual premium
- [ ] 83-03-PLAN.md — Animações, responsividade e polish final da landing + auth

---

## Phase 84: SEO-STRUCTURE

**Goal:** Estrutura de SEO completa no sistema: metadata dinâmica, Open Graph, sitemap.xml, robots.txt, JSON-LD, e painel no super admin para gerenciar configurações de SEO
**Depends on:** Phase 82 (super admin panel must exist for SEO management panel)
**Requirements:** SEO-01, SEO-02, SEO-03, SEO-04, SEO-05, SEO-06
**Success Criteria:**
1. `metadata` export com title, description, Open Graph, Twitter Card em todas as páginas públicas (landing, auth)
2. `src/app/sitemap.ts` gera sitemap.xml dinâmico com todas as rotas públicas
3. `src/app/robots.ts` gera robots.txt adequado (bloqueia /dashboard/*, /admin/*, /api/*)
4. JSON-LD structured data (Organization, WebSite, SoftwareApplication) na landing page
5. Painel `/admin/seo` no super admin para visualizar e editar: title template, description padrão, OG image URL, keywords globais
6. Configurações de SEO persistidas em tabela Supabase `seo_config` com RLS (somente super admin)
7. `npm run build` exits 0 e `next build` exibe 0 type errors

**Plans:** 3
- [ ] 84-01-PLAN.md — Metadata dinâmica, OG tags, sitemap.xml e robots.txt
- [ ] 84-02-PLAN.md — JSON-LD structured data na landing page
- [ ] 84-03-PLAN.md — Tabela seo_config + painel /admin/seo para gerenciar configurações
