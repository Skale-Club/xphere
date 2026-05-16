'use server'

// Server actions for Phase 36 Agent CRUD Dashboard.
// - Plan 03 adds: getAgents, getChannelDefaults, toggleAgentActive, softDeleteAgent, setChannelDefault, getActiveAgents
// - Plan 04 adds: getAgentById, createAgent, updateAgent, setAgentTools, getToolPickerData
//
// All actions use cached `getUser()` + `createClient()` from `@/lib/supabase/server`
// and rely on RLS via `(SELECT public.get_current_org_id())` for tenant scoping.

export {} // placeholder so 'use server' module compiles with no exports yet
