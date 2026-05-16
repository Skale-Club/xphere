-- Migration 043: Add agent_id FK to conversations table (Phase 35 — D-35-05)
-- Backfill: set Main Agent for all existing conversations (GATE-07 deferred from Phase 33)
-- IMPORTANT: conversations.org_id joins to agents.organization_id (different column names)

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) NULL;

UPDATE conversations c
SET agent_id = (
  SELECT a.id FROM agents a
  WHERE a.organization_id = c.org_id
    AND a.name = 'Main Agent'
  LIMIT 1
)
WHERE c.agent_id IS NULL;
