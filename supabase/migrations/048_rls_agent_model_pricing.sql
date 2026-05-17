-- Enable RLS on agent_model_pricing (global reference table — read-only via PostgREST)
ALTER TABLE public.agent_model_pricing ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read model pricing (needed by agent runtime cost calculations)
CREATE POLICY "agent_model_pricing_select"
  ON public.agent_model_pricing
  FOR SELECT
  TO authenticated
  USING (true);
