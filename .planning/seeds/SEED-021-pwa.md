---
id: SEED-021
status: idea
planted: 2026-05-20
trigger_when: next milestone
scope: Small-Medium
priority: medium
---

# SEED-021: PWA — Progressive Web App

Transforma o Xphere em um PWA instalável: manifest, service worker com cache offline, ícones nativos e suporte a "Add to Home Screen" em iOS e Android.

**Princípio central:** o favicon já existe — qualquer PNG/ICO/SVG/WebP enviado para o bucket `branding` via upload nas configurações vira automaticamente todos os ícones PWA (192, 512, maskable, apple-touch). Não há asset estático commitado. Um upload → tudo atualizado.

## O que ganha o usuário

- **Instalável** — Chrome/Safari mostram banner "Adicionar à tela inicial"; ícone nativo no launcher
- **Offline shell** — página de offline amigável quando sem rede
- **Experiência app** — sem barra de URL, fullscreen, splash screen nativa
- **Cache de assets estáticos** — JS/CSS/fontes cacheados → carregamento instantâneo nas visitas seguintes
- **Zero manutenção de ícones** — muda o favicon nas configurações → todos os tamanhos PWA atualizam automaticamente

## Arquitetura: Favicon → PWA Icons (fonte única)

```
Upload favicon no settings
        │
        ▼
  seo_config.favicon_url   (Supabase DB)
        │
        ▼
  GET /api/pwa/icons/[size]   (route handler)
   • busca favicon_url via getFaviconUrl()
   • fetch dos bytes da imagem (Supabase Storage)
   • sharp.resize(size, size).png()
   • Cache-Control: public, max-age=86400
   • fallback: SVG embutido se favicon_url === null
        │
        ├── manifest.ts  →  icons: [/api/pwa/icons/192, /api/pwa/icons/512, ...]
        ├── layout.tsx   →  apple-touch-icon: /api/pwa/icons/180
        └── <link rel="icon"> já existente (getFaviconUrl direto)
```

### Por que rota dinâmica em vez de build script?

| Abordagem | Prós | Contras |
|-----------|------|---------|
| Build script (`scripts/generate-icons.ts`) | Simples | Exige rebuild após upload; ícones ficam stale |
| `app/icon.tsx` (Next.js nativo) | Zero config | `ImageResponse` é canvas/OG — não lida bem com formatos arbitrários (ICO, SVG animado, WebP) |
| **Rota dinâmica `/api/pwa/icons/[size]`** (escolhida) | Sharp processa qualquer formato de entrada; cache HTTP; invalida junto com `seo-favicon`; funciona em Vercel Edge Cache | +1 arquivo de rota |

## Stack

| Peça | Escolha | Motivo |
|------|---------|--------|
| Service Worker | [`serwist`](https://serwist.pages.dev/) + `@serwist/next` | Fork ativo do workbox, suporte ao App Router, TypeScript first. `@ducanh2912/next-pwa` quebra com Turbopack + Next 16 |
| Manifest | `src/app/manifest.ts` (Next.js nativo, async) | Geração server-side, tipagem, zero config |
| Redimensionamento | `sharp` (já pode ser devDep; já é dep indireta do Next) | Processa qualquer formato de entrada (ICO, PNG, SVG, WebP, JPEG) |
| Ícone fallback | SVG inline gerado por código (sem asset commitado) | Nenhum binário no repo; fallback funciona mesmo sem favicon configurado |

## Fases

### Phase A — Manifest + Ícones Dinâmicos + Meta tags

**Goal:** App aparece como instalável no Chrome (Lighthouse "Installable" verde). Upload de favicon → ícones PWA atualizam sem rebuild.

**Entregáveis:**

#### `src/app/api/pwa/icons/[size]/route.ts`
```
GET /api/pwa/icons/192         → PNG 192×192
GET /api/pwa/icons/512         → PNG 512×512
GET /api/pwa/icons/180         → PNG 180×180 (apple-touch)
GET /api/pwa/icons/192?maskable=1  → PNG com padding 10% safe zone
```
Lógica:
1. `getFaviconUrl()` → `favicon_url`
2. Se `favicon_url` → fetch bytes → `sharp(bytes).resize(size).png().toBuffer()`
3. Se null → gerar SVG fallback com as iniciais "X" + cor brand
4. Header: `Cache-Control: public, max-age=86400, stale-while-revalidate=3600`
5. Header: `Content-Type: image/png`

Invalidação: quando o usuário salva um novo favicon nas configurações, chamar
`revalidateTag('seo-favicon')` (já é a cache tag usada pelo `getFaviconUrl()`).

#### `src/app/manifest.ts`
```ts
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  // aponta ícones para a rota dinâmica
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'AI Operations Platform',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#09090b',   // zinc-950 (dark bg)
    theme_color: '#18181b',        // zinc-900 (dark surface)
    icons: [
      { src: '/api/pwa/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/api/pwa/icons/512', sizes: '512x512', type: 'image/png' },
      { src: '/api/pwa/icons/192?maskable=1', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/api/pwa/icons/512?maskable=1', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    categories: ['business', 'productivity'],
    shortcuts: [
      { name: 'Dashboard', url: '/dashboard', description: 'Abrir dashboard' },
      { name: 'Contatos',  url: '/contacts',  description: 'Ver contatos' },
    ],
  }
}
```

#### `src/app/layout.tsx` — meta tags adicionais
```tsx
// dentro de generateMetadata():
other: {
  'mobile-web-app-capable': 'yes',
  'apple-mobile-web-app-capable': 'yes',
  'apple-mobile-web-app-status-bar-style': 'black-translucent',
  'apple-mobile-web-app-title': APP_NAME,
},
// adicionar no <head> via icons:
icons: {
  ...(faviconUrl && { icon: [{ url: faviconUrl }], shortcut: faviconUrl }),
  apple: '/api/pwa/icons/180',   // sempre aponta para a rota dinâmica
},
// theme-color via array (dark + light):
themeColor: [
  { media: '(prefers-color-scheme: dark)',  color: '#18181b' },
  { media: '(prefers-color-scheme: light)', color: '#ffffff' },
],
```

### Phase B — Service Worker + Offline

**Goal:** Lighthouse PWA score ≥ 90. App funciona sem rede (shell carrega offline).

**Entregáveis:**

#### Dependências
```bash
npm install @serwist/next serwist
```

#### `next.config.ts`
```ts
import withSerwist from '@serwist/next'

const withPWA = withSerwist({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',  // não gera SW em dev/Turbopack
})

export default withPWA(nextConfig)
```

#### `src/sw.ts` — Service Worker entry
```ts
import { defaultCache } from '@serwist/next/worker'
import { installSerwist } from 'serwist'

installSerwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  offlineAnalyticsConfig: false,
  fallbacks: {
    document: '/offline',
  },
  runtimeCaching: [
    // API routes: sempre network, nunca cache
    {
      matcher: /^\/api\//,
      handler: 'NetworkOnly',
    },
    // Ícones PWA dinâmicos: cache-first (mudam só quando favicon muda)
    {
      matcher: /^\/api\/pwa\/icons\//,
      handler: 'CacheFirst',
      options: { cacheName: 'pwa-icons', expiration: { maxAgeSeconds: 86400 } },
    },
    // Assets estáticos: cache-first
    ...defaultCache,
  ],
})
```

#### `src/app/offline/page.tsx`
UI mínima, sem dependências de rede:
- Logo (inline SVG, não depende de fetch)
- Heading: "Você está offline"
- Subtext: "Verifique sua conexão e tente novamente"
- Botão "Tentar novamente" (`window.location.reload()`)
- Estilo: Tailwind classes inline (não depende de CSS externo se precacheado)

#### `.gitignore`
```
public/sw.js
public/workbox-*.js
```

## Arquivos

```
src/
  app/
    manifest.ts                        NEW  — Web App Manifest (async, aponta para /api/pwa/icons/)
    offline/
      page.tsx                         NEW  — Offline fallback (standalone, sem fetch)
    api/
      pwa/
        icons/
          [size]/
            route.ts                   NEW  — Rota dinâmica: favicon → sharp → PNG
    layout.tsx                         EDIT — themeColor, apple-*, mobile-web-app-capable
  sw.ts                                NEW  — Service Worker (serwist)

next.config.ts                         EDIT — @serwist/next plugin (disabled em dev)
package.json                           EDIT — @serwist/next, serwist
.gitignore                             EDIT — public/sw.js, public/workbox-*.js
```

**Nenhum asset binário é commitado.** Tudo derivado do favicon do branding bucket.

## Invalidação de cache automática

Quando o usuário faz upload de um novo favicon nas configurações:
1. `seo_config.favicon_url` atualiza no banco
2. Server action chama `revalidateTag('seo-favicon')`
3. `getFaviconUrl()` invalida seu cache de 1h imediatamente
4. Próxima requisição a `/api/pwa/icons/*` busca a imagem nova
5. HTTP cache do browser expira em 24h (ou o SW invalida via `skipWaiting`)

> **Nota:** A rota `/api/pwa/icons/[size]` deve chamar internamente `unstable_noStore()` (ou `{ cache: 'no-store' }`) para ser revalidável por tag, não por rota estática.

## Decisões abertas

- **`start_url`:** `/dashboard` ou `/`? Dashboard exige auth → redirect para login se não autenticado (comportamento correto). Landing `/` também funciona. Decidir no planejamento.
- **`theme_color` dinâmico:** o manifest.ts atual usa cores hardcoded (zinc). Se o white-label evoluir para cores customizáveis por org, o manifest precisará ser org-aware (fora do escopo agora).
- **Push Notifications:** fora do escopo — o SW instalado serve de fundação para SEED futura.

## Critérios de sucesso

1. ✅ Lighthouse PWA score ≥ 90 (Installable + PWA Optimized)
2. ✅ Chrome mostra botão "Instalar" na barra de endereço
3. ✅ iOS Safari mostra "Adicionar à tela inicial" com ícone correto
4. ✅ App abre em modo standalone (sem barra de URL)
5. ✅ Página `/offline` é servida quando sem rede (SW ativo)
6. ✅ API routes (`/api/*`) **nunca** são servidas do cache (exceto `/api/pwa/icons/`)
7. ✅ Upload de novo favicon nas configurações → ícones PWA atualizam sem rebuild
8. ✅ Fallback funciona sem favicon configurado (SVG inline gerado por código)
9. ✅ `npm run build` passa sem erros
