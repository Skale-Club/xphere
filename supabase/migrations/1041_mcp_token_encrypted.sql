-- Add encrypted token column to project_mcp_tokens
-- Needed to allow decryption for copy in UI (token_hash is one-way)
ALTER TABLE public.project_mcp_tokens
  ADD COLUMN IF NOT EXISTS token_encrypted text;
