import 'server-only'

// Side effects of a finished scan (alerts, workflow events, annotations).
// Phase 1 only needs the hook; Phase 2 fills it in.

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

type ScanRow = Database['public']['Tables']['local_seo_scans']['Row']

export async function onScanFinalized(_admin: SupabaseClient<Database>, _scan: ScanRow): Promise<void> {}
