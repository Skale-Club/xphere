# Public read-only demo — setup

The `/demo` route signs visitors into a single shared demo account (read-only)
scoped to a dedicated demo organization. Code is in `src/lib/demo/`,
`src/app/demo/`, migrations `1113`/`1114`, and `scripts/seed-demo-org.ts`.

## One-time setup

1. **Apply migrations** (creates the demo org + the DB write-block):

   ```bash
   npx supabase db push   # applies 1113_demo_org.sql and 1114_demo_readonly.sql
   ```

   The demo org id is fixed: `0000de00-0000-4000-8000-000000000001`.

2. **Create the shared demo auth user** (Supabase dashboard → Authentication, or
   admin API). Use a dedicated email/password, e.g. `demo@xphere.app`. Note the
   created **user UUID**.

3. **Link the user to the demo org and register it as the demo user** (SQL):

   ```sql
   insert into public.org_members (user_id, organization_id, role)
   values ('<DEMO_AUTH_USER_UUID>', '0000de00-0000-4000-8000-000000000001', 'member');

   insert into public.demo_config (demo_user_id)
   values ('<DEMO_AUTH_USER_UUID>')
   on conflict (singleton) do update set demo_user_id = excluded.demo_user_id;
   ```

   Registering the user in `demo_config` activates the database-level write block
   for that user (defense-in-depth; the app guard is already active).

4. **Set env vars** (server-only):

   ```bash
   DEMO_ORG_ID=0000de00-0000-4000-8000-000000000001
   DEMO_USER_EMAIL=demo@xphere.app
   DEMO_USER_PASSWORD=<the password from step 2>
   ```

5. **Seed demo data**:

   ```bash
   npm run seed:demo                                   # contacts, companies, pipeline, etc.
   tsx scripts/load-workflow-seeds.ts --org=0000de00-0000-4000-8000-000000000001
   ```

   `npm run seed:demo:dry` previews; `tsx scripts/seed-demo-org.ts --reset` clears
   and reseeds. The seeder uses the service-role key (bypasses RLS, including the
   demo write-block).

## How it works

- **Access:** `/demo` → programmatic `signInWithPassword` with the server-held
  demo credentials + `vo_active_org` cookie pinned to the demo org → `/dashboard`.
- **Read-only (app):** `assertWritable()` / `assertWritableOrThrow()` in core
  mutations; sensitive routes call `redirectIfDemo()`.
- **Read-only (DB):** restrictive RLS policies block all writes when
  `is_demo_session()` is true. Real users and superadmins are unaffected.
- **No side effects:** the action engine and campaign engine refuse any execution
  for the demo org (they run under service-role and bypass RLS).
- **Banner + signup:** `DemoBanner` shows for the demo session only; its CTA hits
  `/demo/exit`, which signs out and opens the signup flow.
- **Superadmins** maintain the demo org via their own login (not the demo user),
  so they keep full edit access.
