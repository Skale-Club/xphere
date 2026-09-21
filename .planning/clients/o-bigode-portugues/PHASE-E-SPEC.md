# Fase E — Jornada Google Ads completa (plataforma Xphere + Xkedule)

Objetivo: clique no anúncio → visita → marcação → contacto no Xphere com origem → cliente atendido → conversão offline devolvida ao Google Ads. Capacidade de **plataforma** (todos os tenants Xkedule / todas as orgs Xphere), estreada no Bigode (Xkedule tenant 4 ↔ Xphere org `b5bd24d8-aed0-4983-9750-d02d88a6b161`).

## E1 — Xphere: captura de cliques do Google no script de analytics
- `src/app/api/analytics/script/route.ts`: além de `fbclid`, capturar `gclid`, `gbraid`, `wbraid` da URL de entrada; persistir no primeiro-party storage junto do visitante (mesma lógica/validade do fbclid; o gclid vale 90 dias).
- `src/lib/analytics/ingest.ts`: gravar `gclid/gbraid/wbraid` em `analytics_sessions` (espelhar `fbclid`).
- Migração nova (numeração seguinte a `ls supabase/migrations` contra origin/main): `ALTER TABLE analytics_sessions ADD COLUMN IF NOT EXISTS gclid text, gbraid text, wbraid text` (+ índice parcial em gclid). Aplicar com `npx supabase db push` (NUNCA MCP/SQL editor). Atualizar `src/types/database.ts`.
- Expor no script uma forma estável de ler o `visitor_id` do Xphere a partir do site hospedeiro (ex.: `window.xpVisitorId()` ou cookie `_xvid` já existente) para o Xkedule anexar à marcação.

## E2 — Xkedule: instalar o script do Xphere por tenant
- Nova config por tenant (company_settings): `xphere_analytics_token` (texto, default vazio), editável pelo **super admin** (mesmo padrão do `consent_banner_enabled`: tenant-admin PUT faz omit).
- Cliente público: se token presente, injetar `<script src="https://xphere.app/api/analytics/script?t=TOKEN" async>`. Se `consentBannerEnabled` estiver ligado, só injetar após `getConsent()==='granted'` (e ao aceitar).
- Migração Xkedule idempotente, aplicada à mão no DB ATIVO (`.env`, não `.env.production`) ANTES do push.

## E3 — Atribuição na marcação
- Xkedule, no fluxo de checkout/criação de marcação: ler `visitor_id` do Xphere (cookie `_xvid`), `gclid` (cookie `_gcl_aw` → parte final, ou parâmetro guardado), `gbraid/wbraid`, UTMs e landing page; enviar ao servidor e guardar na booking (coluna jsonb `attribution`).
- Incluir `attribution` no payload dos webhooks `booking.*` para o Xphere.
- Xphere `/api/xkedule/webhook`: ler `attribution`; ligar contacto ↔ visitante (`linkVisitorToContact`), gravar gclid/utm na booking espelhada (coluna nova se preciso) para relatórios de atribuição.

### Contrato de dados (fixo — os dois lados implementam exatamente isto)
- Cookie do visitante Xphere no site hospedeiro: `_xvid` (já existe, 365 dias, definido pelo script do Xphere).
- Cookie do clique Google (Conversion Linker do GTM): `_gcl_aw` = `GCL.<timestamp>.<gclid>` → o gclid é o 3.º segmento. Também aceitar `gclid`/`gbraid`/`wbraid` que o script do Xphere guarde em `localStorage` sob `_xp_gclid`, `_xp_gbraid`, `_xp_wbraid` (JSON `{v, t}`; válido 90 dias).
- Campo novo no payload de **todos** os webhooks `booking.*` do Xkedule → Xphere, e coluna jsonb `attribution` na booking do Xkedule:
```json
"attribution": {
  "xphere_visitor_id": "uuid | null",
  "gclid": "string | null", "gbraid": "string | null", "wbraid": "string | null",
  "fbclid": "string | null",
  "utm_source": "…", "utm_medium": "…", "utm_campaign": "…", "utm_term": "…", "utm_content": "…",
  "landing_page": "url | null", "referrer": "url | null",
  "captured_at": "ISO-8601"
}
```
  Ausente ou `null` quando não há dados (ex.: marcação feita no admin). O Xphere tem de tolerar a ausência.

## E4 — Conversão offline para o Google Ads
- Xphere: ao receber `booking.completed` com gclid/gbraid/wbraid e a org tiver `ads_connections` google ativa: `uploadClickConversions` (Google Ads API) para a conversion action de importação configurada na org, com `conversion_value = totalPrice`, `currency`, `conversion_date_time` = fim da marcação, `order_id` = booking id (idempotente). Guardar resultado/erro (tabela de log ou coluna) e nunca falhar o webhook (sempre 200).
- Config por org: qual conversion action usar (resource name) — guardar em ads_connections/metadata ou settings.
- Google Ads (Bigode): criar a ação de conversão "Cliente atendido" do tipo Importação (cliques), categoria Compra, valor por conversão.

## Verificação
- Testes Vitest para o parse de gclid, ingest, mapeamento do webhook e o builder do payload de upload (sem chamar a API real).
- `npm run build` nos dois repos.
