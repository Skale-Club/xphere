ALTER TABLE public.ads_connections
  ADD COLUMN ad_objective TEXT NOT NULL DEFAULT 'leads'
    CHECK (ad_objective IN ('leads', 'sales'));
