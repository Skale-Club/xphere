-- Add default currency preference per org. System default is USD.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL DEFAULT 'USD';
