-- Migration 1259: Medusa commerce integration
-- Adds 'medusa' to integration_provider and all nine medusa_* action types.
-- PostgreSQL enum ADD VALUE must run outside a transaction block.

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'medusa';

ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'medusa_search_products';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'medusa_get_product';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'medusa_get_cart';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'medusa_add_to_cart';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'medusa_update_cart_item';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'medusa_wishlist_add';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'medusa_wishlist_remove';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'medusa_wishlist_list';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'medusa_get_order_status';
