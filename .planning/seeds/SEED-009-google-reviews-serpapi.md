---
id: SEED-009
status: shipped
shipped_in: v2.1
planted: 2026-05-17
planted_during: post-v2.0 Multi-Bot Platform
trigger_when: milestone de CRM ou reputação online; OU pedido explícito de reviews sem Google API
scope: Medium
---

# SEED-009: Google Reviews via SerpAPI — Widget Embeddável por Cliente

Sistema de reviews do Google Business sem depender da Google Places API. Cada cliente (org) cadastra sua própria chave SerpAPI gratuita (100 buscas/mês) no painel do Operator. O sistema faz scraping periódico, armazena os reviews no banco com IDs estáveis, detecta novos e removidos, e serve um widget embeddável via `<iframe>` no site do cliente.

**Substitui e expande o sistema de reviews do v1.3** (que usava Google Places API com limite de 5 reviews por requisição).

## Por que SerpAPI free por cliente

- Plano gratuito: **100 buscas/mês por conta**
- 1 busca/dia por business = 30 buscas/mês — dentro do free tier com folga
- Cada cliente cria sua conta gratuita em `serpapi.com` e cola a API key no painel
- Zero custo para o Operator e para o cliente
- Sem compartilhamento de quota entre orgs

## Arquitetura

```
Admin cadastra: SerpAPI key + Google Place ID no painel
        ↓
Job diário (GitHub Action ou cron)
        ↓
SerpAPI: GET /search?engine=google_maps_reviews&place_id={id}&api_key={key}
        ↓
Upsert reviews no banco por review_id nativo do Google
        ↓
Widget serve do banco → iframe no site do cliente
```

## Decisao de produto - 2026-06-02

O painel de Reviews deve tratar o widget embeddavel como o produto primario da area, nao apenas como um monitor de reputacao. A experiencia principal em `/reviews` deve permitir que o operador escolha o layout do widget, visualize os cards com dados reais no formato aproximado do site do cliente, e copie snippets prontos de iframe ou JavaScript. A pagina dedicada da integracao Google Reviews pode continuar mostrando status operacional, chave SerpAPI, scraping e reviews recentes, mas deve reutilizar o mesmo builder de widget para evitar um configurador antigo ou simplificado.

## Como o cliente acha o Place ID

O Place ID do Google Maps é público e gratuito de obter:
- Via URL do Google Maps (está na URL da página do business)
- Via `https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder` (ferramenta gratuita)
- O Operator pode ter um helper: campo de busca por nome → chama SerpAPI `engine=google_maps` → retorna lista de businesses → admin seleciona o correto → Place ID salvo automaticamente

---

## Schema

```sql
-- Perfil do business por org
google_business_profiles (
  id uuid PK,
  org_id uuid FK (RLS),
  place_id text NOT NULL,             -- Google Place ID (ChIJ...)
  business_name text,
  address text,
  serpapi_key_encrypted text NOT NULL, -- AES-256-GCM (lib/crypto.ts)
  scrape_interval_hours int DEFAULT 24,
  last_scraped_at timestamptz,
  last_scrape_status text,            -- 'success' | 'error' | 'quota_exceeded'
  last_scrape_error text,
  total_reviews_count int,            -- total reportado pelo Google
  average_rating numeric(2,1),
  is_active boolean DEFAULT true,
  widget_token text UNIQUE,           -- token público para o iframe (reutiliza padrão existente)
  created_at, updated_at
)

-- Reviews individuais
google_reviews (
  id uuid PK,
  org_id uuid FK (RLS),
  profile_id uuid FK → google_business_profiles,
  review_id text NOT NULL,            -- ID nativo do Google via SerpAPI
  reviewer_name text,
  reviewer_photo_url text,            -- URL no Hetzner Object Storage (baixado do Google CDN)
  reviewer_profile_url text,
  rating int CHECK (rating BETWEEN 1 AND 5),
  text text,
  date_text text,                     -- "há 2 semanas" (como o Google exibe)
  date_iso timestamptz,               -- parseado quando possível
  is_local_guide boolean DEFAULT false,
  local_guide_reviews_count int,
  helpful_count int DEFAULT 0,
  owner_response text,                -- resposta do proprietário
  owner_response_date text,
  is_removed boolean DEFAULT false,   -- sumiu numa scrape posterior
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  UNIQUE (profile_id, review_id)
)

-- Fotos anexadas ao review pelo cliente
google_review_photos (
  id uuid PK,
  org_id uuid FK (RLS),
  review_id uuid FK → google_reviews,
  position int,                       -- ordem das fotos no review
  original_url text,                  -- URL original do Google CDN (lh5.googleusercontent.com)
  hetzner_url text,                        -- URL permanente no Hetzner Object Storage (baixada no momento do scraping)
  width int,
  height int,
  created_at timestamptz DEFAULT now()
)
```

---

## O que precisa ser construído

**Schema e tipos:**
1. Migration: `google_business_profiles` + `google_reviews` + RLS + índices
2. Atualizar `src/types/database.ts`

**Integração UI (painel do cliente):**
3. `/integrations/google-reviews` — redesign da página existente:
   - Campo "API Key SerpAPI" com link para `serpapi.com/manage-api-key`
   - Helper de busca de Place ID: input de nome do business → lista de resultados → seleciona
   - Status do perfil: última atualização, total de reviews, nota média, status da última scrape
   - Botão "Atualizar agora" (força scrape imediato, consome 1 busca da cota)
   - Preview dos últimos reviews direto na página

**Scraping engine:**
4. `src/lib/serpapi/scrape-reviews.ts`:
   - Chama `https://serpapi.com/search.json?engine=google_maps_reviews&place_id={id}&api_key={key}&hl=pt&gl=br`
   - Pagina resultados (SerpAPI retorna até 10 por página, tem `next_page_token`)
   - Mapeia payload → schema `google_reviews`
   - Detecta review_id nativo do SerpAPI response

5. `src/lib/serpapi/download-photos.ts`:
   - Para cada review novo: baixa `user.thumbnail` (foto do reviewer) → salva no Hetzner Object Storage → atualiza `reviewer_photo_url`
   - Para cada imagem em `review.images[]`: baixa → salva no Hetzner Object Storage → insere em `google_review_photos`
   - Nomeia os arquivos: `reviews/{org_id}/{review_id}/reviewer.jpg` e `reviews/{org_id}/{review_id}/photo-{n}.jpg`
   - Skip se já existe no Hetzner Object Storage (idempotente)

6. `src/lib/serpapi/upsert-reviews.ts`:
   - Para cada review retornado: `INSERT ... ON CONFLICT (profile_id, review_id) DO UPDATE`
   - Marca `last_seen_at = now()` nos encontrados
   - Após scrape: `UPDATE SET is_removed = true WHERE last_seen_at < scrape_start AND is_removed = false`
   - Atualiza `average_rating` e `total_reviews_count` no perfil

**Job periódico:**
6. GitHub Action (`.github/workflows/scrape-reviews.yml`):
   - Cron: `0 6 * * *` (todo dia 6h UTC)
   - Chama `POST /api/reviews/scrape` com bearer secret
   - `workflow_dispatch` para rodar manualmente

7. `POST /api/reviews/scrape` — endpoint interno:
   - Autentica com bearer secret (padrão do projeto)
   - Busca todos os `google_business_profiles` ativos
   - Para cada um: chama scraping engine com key descriptografada
   - Respeita `scrape_interval_hours` (não scrapa se ainda não chegou a hora)
   - Retorna `{ scraped, skipped, errors[] }`

**Widget embeddável:**
8. `src/reviews-widget/` — upgrade do widget existente:
   - Busca reviews do banco via `/api/reviews/[token]` (sem Google API)
   - Filtro por nota mínima (ex: mostrar só 4★ e 5★)
   - Ordenação: mais recentes | melhor nota | mais úteis
   - 3 layouts: **Grid** (cards em colunas), **Lista** (vertical), **Carrossel** (slider)
   - Mostra: foto do reviewer, nome, nota (estrelas), data, texto (com "ver mais"), resposta do dono
- **Galeria de fotos do review** — miniaturas clicáveis das fotos anexadas pelo cliente
- Lightbox para visualizar fotos em tamanho maior
   - Tema claro/escuro configurável

9. `/api/reviews/[token]` — endpoint público:
   - Sem autenticação (token público por org)
   - Query params: `?min_rating=4&sort=recent&limit=10&offset=0`
   - Retorna reviews não removidos do perfil vinculado ao token
   - Cache de 1h (não precisa bater no banco a cada carregamento do widget)

10. Embed code no painel:
    ```html
    <iframe 
      src="https://operator.skale.club/widget/reviews/[token]?layout=grid&min_rating=4"
      width="100%" height="600" frameborder="0">
    </iframe>
    ```

**Testes:**
11. Mock SerpAPI → upsert correto → reviews no banco
12. Review novo detectado → INSERT
13. Review removido detectado → `is_removed = true`
14. Quota excedida → `last_scrape_status = 'quota_exceeded'`, sem crash
15. Widget `/api/reviews/[token]` com cache e filtros
16. RLS: org A não vê reviews da org B

---

## Payload SerpAPI (referência)

```json
{
  "reviews": [
    {
      "review_id": "ChZDSUhNMG9nS0VJQ0FnSUQ...",
      "user": {
        "name": "João Silva",
        "link": "https://www.google.com/maps/contrib/...",
        "thumbnail": "https://lh3.googleusercontent.com/...",
        "local_guide": true,
        "reviews": 47
      },
      "rating": 5,
      "date": "há 3 semanas",
      "snippet": "Excelente atendimento! Recomendo muito...",
      "likes": 2,
      "owner_answer": {
        "date": "há 2 semanas",
        "snippet": "Obrigado pelo feedback!"
      }
    }
  ],
  "serpapi_pagination": {
    "next_page_token": "abc123..."
  }
}
```

---

## Limitações conhecidas e mitigações

| Limitação | Mitigação |
|---|---|
| 100 buscas/mês no free | 1 scrape/dia = 30 buscas — dentro do limite com folga |
| SerpAPI retorna 10 reviews por página | Paginar até buscar todos (cada página = 1 busca da quota) |
| Data relativa ("há 2 semanas") | Salvar texto original + tentar parsear data absoluta |
| Google pode mudar estrutura | SerpAPI gerencia isso — não depende do DOM |
| Business com 1000+ reviews | Paginar só os primeiros 100 (10 páginas) na primeira carga; incrementais diários pegam só novos |

---

## Decisões travadas
- **SerpAPI gratuito por cliente** — cada org tem sua própria conta e quota; zero custo compartilhado
- **Place ID obrigatório** — identificador estável do Google; helper de busca no painel
- **review_id nativo do SerpAPI** — mais estável que hash derivado
- **Fotos baixadas para R2** — URLs do Google CDN expiram; R2 é permanente e serve do edge
- **Foto do reviewer + fotos do review** — ambos baixados e armazenados no Hetzner Object Storage
- **Remoção suave** — `is_removed = true`, nunca DELETE (histórico preservado)
- **Cache de 1h no widget** — protege o banco de carregamentos frequentes
- **GitHub Action** — padrão do projeto (como o reengagement SMS do v1.9)

## Scope
**Medium — 3 fases, ~10 plans**

## Referências de código existente
- [`src/reviews-widget/`](src/reviews-widget/) — widget existente do v1.3 para upgrade
- [`src/app/api/reviews/`](src/app/api/reviews/) — endpoint existente
- [`src/app/(dashboard)/reviews/`](src/app/(dashboard)/reviews/) — dashboard existente
- [`src/lib/crypto.ts`](src/lib/crypto.ts) — AES-256-GCM para SerpAPI key
- [`.github/workflows/ghl-reengagement.yml`](.github/workflows/ghl-reengagement.yml) — padrão de GitHub Action cron
- [`src/app/api/automations/ghl-reengagement/run/route.ts`](src/app/api/automations/ghl-reengagement/run/route.ts) — padrão de endpoint protegido por bearer

## Próximo passo
`/gsd:new-milestone` ou inserir como fase num milestone de CRM/reputação
