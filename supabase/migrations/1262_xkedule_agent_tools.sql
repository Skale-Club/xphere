-- Migration 1262: Xkedule agent tools (AGT-07)
-- Adds 4 new action_type values so cancel/reschedule/quote/customer-lookup
-- can be registered as agent tools the same way xkedule_get_services /
-- xkedule_check_availability / xkedule_create_booking already are
-- (migration 1200). PostgreSQL enum ADD VALUE must run outside a
-- transaction block.

ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'xkedule_cancel_booking';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'xkedule_reschedule_booking';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'xkedule_quote';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'xkedule_lookup_customer';
