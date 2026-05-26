-- Migration 1078: Inbound email routes table
-- Maps inbound email addresses to orgs for webhook routing

CREATE TABLE IF NOT EXISTS inbound_email_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_address text NOT NULL,   -- e.g. "support@tenant.com"
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inbound_email_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage inbound email routes"
  ON inbound_email_routes
  USING (org_id = get_current_org_id())
  WITH CHECK (org_id = get_current_org_id());

-- Index for fast lookup by route_address in inbound webhook
CREATE INDEX IF NOT EXISTS inbound_email_routes_route_address_idx
  ON inbound_email_routes (route_address)
  WHERE is_active = true;
