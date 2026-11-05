// DANGER: Service role key bypasses ALL RLS policies.
// ONLY import this in trusted server-only code such as /api/vapi/* route handlers.
// NEVER import in browser code, dashboard pages, or Server Components.
import { createDbClient as createSupabaseClient, getServiceRoleKey } from '@/lib/supabase/db-exit'
import type { Database } from '@/types/database'

export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    getServiceRoleKey()!,
    { auth: { persistSession: false } }
  )
}
