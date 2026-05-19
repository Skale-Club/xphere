---
id: SEED-003
status: shipped
shipped_in: v2.0
planted: 2026-05-16
planted_during: post-v2.0 Phase 36 (Agent CRUD Dashboard completed)
partial_note: Fase 42 executada (org_invites, OAuth callback, /dashboard/members) — pendente apenas 42-02 (config manual Google Cloud Console + Supabase OAuth provider + NEXT_PUBLIC_SITE_URL no Vercel)
trigger_when: planejamento de milestone com tema "auth", "SSO", "onboarding de novos admins", "compliance", "convites", "team management"; OU pedido explícito de um cliente que exige Google Workspace SSO; OU primeiro suporte ticket sobre senha esquecida que vire fricção real; OU operator alcançar 5+ usuários admin ativos
scope: Medium
---

# SEED-003: Google SSO para Admin Dashboard (Allowlist por Org)

Adicionar **Google Sign-In como opção de autenticação para o dashboard admin do Operator**, ao lado do email/senha existente. Restrição via **allowlist por org** — cada org configura quais emails podem entrar; primeiro login do email convidado cria a conta + associa membership. Sem MFA próprio (confia no 2FA do Google).

Este seed encerra o tópico de "auth manual" como única opção e prepara o terreno pra crescimento de equipe — cada org pode adicionar/remover membros sem precisar provisionar senhas manualmente.

## Why This Matters

### 1. Fricção do email/senha vai cobrar caro quando equipes crescerem
Hoje a única forma de adicionar um novo admin é Supabase Auth com email/senha — alguém precisa criar a conta via signup, lembrar de senha, lidar com "esqueci minha senha". Pra **uma agência operando o Operator pra vários clientes**, isso vira atrito real assim que o primeiro cliente quer 3-4 pessoas no dashboard.

Google Sign-In:
- Zero senha pra gerenciar
- Aproveita 2FA que o usuário já tem configurado na Google
- "Sign in with Google" é UX padrão que ninguém precisa aprender
- Onboard de novo admin: admin atual digita o email da pessoa na lista de convites, pessoa clica no botão, tá dentro

### 2. Allowlist por org é o modelo certo pra Operator
Operator é multi-tenant. Não dá pra usar "qualquer dominio Workspace" porque um único Operator hospeda várias orgs (cada uma com seu próprio domínio ou misturando Gmail pessoal + corporativo). Não dá pra usar "qualquer Google" porque seria buraco de segurança.

**Allowlist** = cada org tem uma tabela `org_invites(org_id, email, role, invited_by, invited_at, accepted_at)`. Primeiro login do email convidado:
1. Supabase Auth cria o `auth.users` row (via OAuth callback)
2. Trigger ou edge function popula `memberships(user_id, org_id, role)` pegando da linha de `org_invites` que bate
3. Marca `org_invites.accepted_at`
4. Login conclui — usuário cai no dashboard da org

Email que NÃO está em nenhuma allowlist → bloqueado com mensagem "Você não foi convidado. Peça pro admin da sua organização te adicionar."

### 3. Multi-org friendly
Um único email pode estar em allowlists de várias orgs (consultor que atende vários clientes). Sign-In autentica uma vez, e o `OrgSwitcher` existente lida com a troca. O cookie `vo_active_org` + `user_active_org` já implementam essa lógica — Google Sign-In só precisa preencher `memberships` corretamente.

### 4. Coexistência com email/senha = zero risco de quebrar quem já tem conta
Botão "Sign in with Google" no `/login` ao lado do form de email/senha. Usuários antigos continuam logando do jeito que sempre logaram. Pra usuários novos, o admin escolhe qual fluxo recomendar (provavelmente Google daqui pra frente). Migração gradual sem cutover dramático.

### 5. Sem MFA próprio = escopo enxuto + segurança suficiente
2FA do próprio Google cobre o ataque mais comum (credential stuffing). Implementar MFA próprio (TOTP, WebAuthn) seria um milestone separado e bem maior. **Trust the OAuth provider** é o padrão da indústria pra apps SaaS pequenos/médios.

## When to Surface

**Trigger primário:** planejamento de qualquer milestone com tema:
- "Auth", "SSO", "single sign-on"
- "Onboarding" de novos admins / "team management"
- "Convites", "invites", "member management"
- "Compliance" (SOC2, ISO27001 — auditor vai perguntar sobre MFA)

**Trigger secundário:**
- Cliente específico pede Google Workspace SSO (provavelmente domínio educacional ou corporativo)
- Primeiro suporte ticket sobre senha esquecida que vire fricção real
- Operator alcança 5+ usuários admin ativos (sinal que vai escalar)

**Trigger negativo (NÃO surfacing):**
- Milestone focado em runtime/canais/observabilidade — auth não bloqueia entrega
- Cliente solo (usuário único) — overhead não compensa

Apresentar este seed durante `/gsd:new-milestone` quando o escopo bater com qualquer um dos triggers primários.

## Scope Estimate

**Medium** — 3-5 fases provavelmente.

### Componentes principais

1. **Supabase Auth Google provider config**
   - Habilitar Google OAuth no Supabase Dashboard
   - Configurar OAuth redirect URI: `https://operator.skale.club/auth/callback`
   - Google Cloud Console: criar OAuth client, configurar consent screen (Operator branding)
   - Env vars: `SUPABASE_AUTH_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_GOOGLE_SECRET`

2. **Schema (migration nova)**
   - `org_invites(id, org_id, email, role, invited_by, invited_at, accepted_at, expires_at)` com RLS
   - `memberships(user_id, org_id, role)` provavelmente já existe (verificar) — se não, criar
   - Trigger ou edge function `handle_oauth_login` que faz o match `email → org_invites → memberships`
   - Índice em `org_invites(email)` pra lookup rápido no callback

3. **OAuth callback route**
   - `src/app/auth/callback/route.ts` — handler do Supabase OAuth
   - Pós-callback: verifica se email tem `org_invites` row; se não, redireciona pra `/login?error=not_invited`
   - Se sim: cria membership, marca invite como accepted, set cookie `vo_active_org`

4. **`/login` UI**
   - Botão "Sign in with Google" acima do form email/senha (com divider "or")
   - Mensagem de erro `?error=not_invited` na URL
   - Reusa shadcn/ui Button + ícone Google de lucide-react

5. **`/settings/team` ou `/dashboard/members` — UI de gerenciamento de convites**
   - Admin lista membros atuais + convites pendentes
   - "Invite member" form: email + role (admin / member)
   - Insere row em `org_invites`
   - Opcional: enviar email de convite via Resend/SendGrid com link `/login?invited=true`
   - "Revoke invite" + "Remove member" actions

6. **RLS policies**
   - `org_invites`: SELECT/INSERT/DELETE só admin da org
   - `memberships`: usuário vê própria membership; admin vê todas da org

7. **Testes**
   - Convite + primeiro login → membership criada + invite marcado
   - Email não convidado tenta logar → bloqueado
   - Multi-org: mesmo email em duas orgs → OrgSwitcher mostra ambas
   - Coexistência: email/senha existente continua funcionando

### Fora de escopo (deferred to future seeds)

- **MFA próprio do Operator** — seed separado (trigger: compliance ou cliente enterprise)
- **Google Workspace domain restriction** — funcionalidade adicional dentro deste milestone, mas não é o default
- **Magic link / passwordless email** — outro provider; seed separado se vier demanda
- **GitHub / Microsoft / Apple OAuth** — adicionar outros providers; seed separado
- **Widget de chat SSO** — explicitamente fora deste seed (widget continua anônimo)
- **SCIM / SAML enterprise SSO** — caso surja cliente enterprise, é milestone próprio
- **Audit log de logins** — bom-ter; pode entrar como parte do milestone ou ficar pra observability

## Locked Decisions (capturadas com o operator em 2026-05-16)

| Decisão | Valor | Por quê |
|---|---|---|
| Coexistência | Google **adicional** ao email/senha | Migração gradual, zero risco de bloquear users existentes |
| Restrição | **Allowlist por org** (não domínio) | Operator é multi-tenant; emails de orgs diferentes coexistem |
| Escopo | **Só dashboard admin** | Widget continua anônimo (sem CORS/cross-domain headache) |
| MFA | **Não próprio** | Confia no 2FA do Google; mantém escopo enxuto |

## Open Questions (resolver no `/gsd:discuss-phase` quando promovido)

1. **Como o admin envia o convite?** Email automático via SendGrid/Resend, ou só insere no DB e o admin compartilha o link `/login` manualmente?
2. **Role granularity:** só `admin` e `member`, ou mais granular (admin / editor / viewer)?
3. **Invite expiration:** convites expiram em 7 dias? 30 dias? Nunca?
4. **Revogação após accept:** admin remove membership → próximo carregamento de página derruba a sessão, ou usuário fica logado até refresh manual?
5. **Primeiro org cria como?** Quem cria a primeira org de um Operator novo (auto-signup do primeiro Google login? Provisionamento manual via SQL? CLI?)
6. **Email tem que bater exatamente, ou normalizar (lowercase + trim)?**
7. **Caching da membership:** já temos `getUser()` cached. Adicionar `getMemberships()` cached?

## Codebase Hints (pra pesquisador futuro)

- Auth atual: `src/lib/supabase/server.ts` — `createClient()` + `getUser()` cached helpers (NÃO chamar `supabase.auth.getUser()` direto)
- `/login` page: `src/app/(auth)/login/` — atualizar pra adicionar botão Google
- Org switcher: `src/components/layout/OrgSwitcher.tsx` — já lida com multi-org via `user_active_org` + cookie `vo_active_org`
- RLS pattern: `(SELECT public.get_current_org_id())` — toda tabela nova segue
- Migration cadence: `npx supabase db push` + atualizar `src/types/database.ts` (manual; CLI gen types tem privilege error documentado)
- Memberships table: verificar se já existe (busca em `supabase/migrations/`) — se não, criar como parte deste milestone
- Padrão de pages do dashboard: `src/app/(dashboard)/` — `/settings/team` ou `/dashboard/members` vai aqui

## References

- Supabase Auth Google OAuth: https://supabase.com/docs/guides/auth/social-login/auth-google
- Google Cloud OAuth setup: https://developers.google.com/identity/protocols/oauth2/web-server
- Next.js + Supabase SSR cookies (já implementado no projeto): `src/lib/supabase/server.ts`

---

**Status:** Dormant até trigger surfar.

Quando o trigger bater, promover via `/gsd:new-milestone` → este seed vira a base do CONTEXT.md do milestone (decisões já travadas) e do REQUIREMENTS.md (escopo claro).
