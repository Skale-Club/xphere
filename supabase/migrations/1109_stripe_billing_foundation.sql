-- 1109_stripe_billing_foundation.sql
-- Reusable Stripe foundation for org-level subscription billing (BILL-02).
--
-- Billing owner = organization. One Stripe Customer per org. This migration is
-- the platform foundation only: it stores the Stripe<->org mapping, the current
-- subscription state, and a processed-event log for webhook idempotency. The
-- actual plans/prices and post-payment access rules are product decisions that
-- live in app code/config, NOT hardcoded here, so plans can change later without
-- a schema rewrite.
--
-- Writes to all three tables happen exclusively from the server (checkout server
-- action + Stripe webhook) via the service role, which bypasses RLS. Authenticated
-- org members get read-only visibility into their own org's billing rows.

-- ---------------------------------------------------------------------------
-- billing_customers — org <-> Stripe Customer mapping (one per org)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_customers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_customers_stripe_customer_id
  ON public.billing_customers (stripe_customer_id);

COMMENT ON TABLE public.billing_customers IS
  'Maps each organization to its Stripe Customer. Source of truth for webhook org resolution by stripe_customer_id.';

ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_customers_org_read" ON public.billing_customers;
CREATE POLICY "billing_customers_org_read"
  ON public.billing_customers
  FOR SELECT
  TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- billing_subscriptions — current subscription state per org
-- ---------------------------------------------------------------------------
-- status mirrors Stripe subscription statuses. The internal app reads `status`
-- to decide access; it must only be updated from webhook-confirmed data, never
-- from a checkout success redirect.
CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id     text NOT NULL,
  stripe_price_id        text,
  status                 text NOT NULL DEFAULT 'incomplete'
    CHECK (status IN (
      'trialing', 'active', 'past_due', 'canceled', 'unpaid',
      'incomplete', 'incomplete_expired', 'paused'
    )),
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_org_id
  ON public.billing_subscriptions (org_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_customer_id
  ON public.billing_subscriptions (stripe_customer_id);

COMMENT ON TABLE public.billing_subscriptions IS
  'Current Stripe subscription state per org. Only updated from verified webhook events.';

ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_subscriptions_org_read" ON public.billing_subscriptions;
CREATE POLICY "billing_subscriptions_org_read"
  ON public.billing_subscriptions
  FOR SELECT
  TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- billing_events — processed Stripe event log (webhook idempotency)
-- ---------------------------------------------------------------------------
-- The unique stripe_event_id is the idempotency key: the webhook inserts the
-- event id BEFORE processing; a duplicate delivery hits the unique constraint
-- and is skipped. RLS is enabled with NO policies, so this table is reachable
-- only via the service role (internal billing infrastructure, never client-read).
CREATE TABLE IF NOT EXISTS public.billing_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  type            text NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

COMMENT ON TABLE public.billing_events IS
  'Processed Stripe webhook event ids for idempotency. Service-role only (RLS enabled, no policies).';

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- updated_at maintenance trigger (reuses the platform convention)
CREATE OR REPLACE FUNCTION public.set_billing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_customers_updated_at ON public.billing_customers;
CREATE TRIGGER trg_billing_customers_updated_at
  BEFORE UPDATE ON public.billing_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_billing_updated_at();

DROP TRIGGER IF EXISTS trg_billing_subscriptions_updated_at ON public.billing_subscriptions;
CREATE TRIGGER trg_billing_subscriptions_updated_at
  BEFORE UPDATE ON public.billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_billing_updated_at();
