# syntax=docker/dockerfile:1
# Production image for Coolify/Hetzner. Mirrors the Vercel build
# (widgets via esbuild + favicon via tsx + next build) and ships the
# Next.js standalone output. Node 24 matches the Vercel runtime.
#
# Base image is intentionally `node:24-alpine` and MUST stay identical
# across every app on the shared host — Docker stores the base layer once
# and reuses it, which is what keeps the 80GB box from filling up.

FROM node:24-alpine AS base
# libc6-compat: glibc shim some native prebuilds (e.g. sharp) expect on musl.
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
# .npmrc carries legacy-peer-deps=true — required or npm ci hits an ERESOLVE
# peer conflict (@langchain/community wants openai 4.x via stagehand vs root 6.x).
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ---- Build ----
FROM base AS builder
# NEXT_PUBLIC_* are inlined at build time — Coolify must pass these as
# build args (Build Variables), not just runtime env.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
# NEXT_PUBLIC_APP_URL is intentionally NOT declared: Coolify doesn't set it, so
# `ENV X=$X` would bake an empty string into the image. `??`-based fallbacks
# (e.g. `process.env.NEXT_PUBLIC_APP_URL ?? '…'`) only trigger on undefined, so
# an empty string would slip through and break URL building. Leaving it unset
# keeps it undefined and lets those fallbacks resolve. Origins resolve from
# NEXT_PUBLIC_SITE_URL instead (see src/lib/site-url.ts).
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Runner ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Standalone output does not include public/ or static/ — copy them in.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
