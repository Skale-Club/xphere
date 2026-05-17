---
plan: 42-02
status: deferred
completed: 2026-05-16
deferred_reason: Requires manual Google Cloud Console + Supabase Dashboard configuration
---

# Plan 42-02 Summary: OAuth Provider Pre-flight (DEFERRED)

## Status: DEFERRED — Manual Configuration Required

This plan requires manual steps in external dashboards that Claude cannot perform autonomously:

1. **Google Cloud Console** — Create OAuth 2.0 Client ID + Secret
2. **Supabase Dashboard** — Enable Google provider, paste credentials, set redirect URI
3. **Vercel Dashboard** — Add NEXT_PUBLIC_SITE_URL env var

## What the User Must Do

### Step 1: Google Cloud Console (https://console.cloud.google.com/)
- Create/Select project "Operator"
- Enable OAuth consent screen (External, scopes: email + profile)
- Create OAuth 2.0 Client: Web application
  - Authorized JavaScript origins: `https://operator.skale.club`, `http://localhost:4267`
  - Authorized redirect URI: `https://<supabase-project-ref>.supabase.co/auth/v1/callback`
- Copy Client ID and Client Secret

### Step 2: Supabase Dashboard → Authentication → Providers → Google
- Toggle Enable
- Paste Client ID and Client Secret
- Set Site URL: `https://operator.skale.club`
- Add `http://localhost:4267` to Additional Redirect URLs

### Step 3: Vercel Dashboard → Settings → Environment Variables
- Add `NEXT_PUBLIC_SITE_URL` = `https://operator.skale.club` (all environments)

### Step 4: Local .env.local (DO NOT COMMIT)
```
NEXT_PUBLIC_SITE_URL=http://localhost:4267
```

## Code Impact

Code in plans 42-03/04/05 assumes `NEXT_PUBLIC_SITE_URL` is set at runtime.
The build does NOT fail if the variable is absent — it will just produce incorrect OAuth redirects.
