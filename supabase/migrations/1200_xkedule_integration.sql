-- Migration 1200: Xkedule integration
-- Adds 'xkedule' to integration_provider enum and 3 booking action types.
-- PostgreSQL enum ADD VALUE must run outside a transaction block.

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'xkedule';

ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'xkedule_get_services';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'xkedule_check_availability';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'xkedule_create_booking';
