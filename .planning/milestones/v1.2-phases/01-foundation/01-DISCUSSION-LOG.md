# Phase 1: Foundation - Discussion Log

**Date:** 2026-04-04
**Phase:** 1 — Foundation
**Mode:** discuss

---

## Gray Areas Selected

User selected all 3 presented areas:
1. Brand tagline
2. Redis provider
3. Widget placeholder

---

## Area 1: Brand Tagline

**Q:** What should replace "Voice AI Operations Platform" as the login page subtitle and metadata description?

**Options presented:**
- AI Operations Platform *(Recommended — broad enough to cover chat + voice + tools)*
- Embedded AI Platform
- You decide

**User selected:** AI Operations Platform

---

## Area 2: Redis Provider

**Q:** Which Redis client/provider should we set up for chat session storage?

**Options presented:**
- redis npm + REDIS_URL *(Recommended — matches chatbot ref, works with any Redis)*
- Upstash REST (@upstash/redis)

**User selected:** Upstash REST (@upstash/redis)

---

**Q:** Where will the Upstash Redis instance be hosted?

**Options presented:**
- Upstash.com *(Recommended)*
- Already have credentials
- You decide

**User selected:** Upstash.com

---

**Q:** Should the Upstash Redis client be a singleton module or per-request?

**Options presented:**
- Singleton module *(Recommended — mirrors Supabase client pattern)*
- Per-request instantiation

**User selected:** Singleton module

---

**User interjection:** "da pra usar o redis local?" (Can I use local Redis?)

**Claude clarification:** `@upstash/redis` uses REST API and does not work with local Redis directly. The `redis` npm package works with local Redis and Upstash via URL — more flexible for dev.

**Q (follow-up):** Dado que você quer suporte a Redis local no dev, qual abordagem prefere?

**Options presented:**
- redis npm + REDIS_URL *(Recommended — works local + Upstash via URL)*
- Manter @upstash/redis

**User selected:** redis npm + REDIS_URL *(revised from initial Upstash selection)*

---

## Area 3: Widget Placeholder

**Q:** How should the widget JS placeholder be served in Phase 1?

**Options presented:**
- public/widget.js static file *(Recommended — zero code, Phase 4 replaces it)*
- /api/widget/route.ts route

**User selected:** public/widget.js static file

---

## Summary of Decisions

| Decision | Choice |
|----------|--------|
| Brand tagline | "AI Operations Platform" |
| Redis client | `redis` npm + `REDIS_URL` env var |
| Redis client pattern | Singleton module at `src/lib/redis.ts` |
| Widget placeholder | `public/widget.js` static file |

---

*Log generated: 2026-04-04*
