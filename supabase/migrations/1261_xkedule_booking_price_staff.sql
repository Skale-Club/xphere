-- Migration 1261: Xkedule mirror price/currency/staff (MIR-06 Xphere half)
-- Xkedule's booking.* webhook payload now carries totalPrice/currency and an
-- optional staff{id,name} identity (Xkedule Phase 103), but the mirror had
-- nowhere to persist them -- the payload was silently dropped by the old,
-- narrower webhook Zod schema (2026-07 audit: "Preco, moeda, staff e
-- endereco nao chegam/nao persistem"). All four columns are nullable and
-- general-purpose (not Xkedule-exclusive) so a native Xphere booking is
-- unaffected; the staff columns follow the existing external_* naming
-- convention already used for external_source/external_id/external_updated_at.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS price numeric(12, 2),
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS external_staff_id integer,
  ADD COLUMN IF NOT EXISTS external_staff_name text;

COMMENT ON COLUMN public.bookings.price IS
  'Mirrored booking price (e.g. from Xkedule totalPrice). Null for native/unpriced bookings.';
COMMENT ON COLUMN public.bookings.currency IS
  'Lowercase ISO 4217 code (e.g. usd, brl) mirrored alongside price.';
COMMENT ON COLUMN public.bookings.external_staff_id IS
  'Assigned staff id from the external source (e.g. Xkedule staffMemberId) -- not a local FK.';
COMMENT ON COLUMN public.bookings.external_staff_name IS
  'Assigned staff display name from the external source, resolved at send time.';
