-- Migration 1326: align match_documents with MCP knowledge_search.
--
-- The MCP tool sends query_embedding, filter, and match_count. The original
-- LangChain-compatible function only accepted the first two arguments, so
-- PostgREST could not resolve the three-argument RPC call. Keep the LangChain
-- call compatible by making match_count optional while bounding the result set.

DROP FUNCTION IF EXISTS public.match_documents(extensions.vector, jsonb);
DROP FUNCTION IF EXISTS public.match_documents(extensions.vector, jsonb, integer);

CREATE FUNCTION public.match_documents(
  query_embedding extensions.vector(1536),
  filter          JSONB DEFAULT '{}',
  match_count     INTEGER DEFAULT 5
)
RETURNS TABLE (
  id         BIGINT,
  content    TEXT,
  metadata   JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM public.documents d
  WHERE d.metadata @> COALESCE(filter, '{}'::jsonb)
    AND d.embedding IS NOT NULL
  ORDER BY d.embedding <=> query_embedding ASC
  LIMIT LEAST(GREATEST(COALESCE(match_count, 5), 1), 100);
END;
$$;

-- This SECURITY DEFINER RPC is server-only. It trusts the service-role caller
-- to provide the tenant org_id in filter; browser API roles must not invoke it.
REVOKE EXECUTE ON FUNCTION public.match_documents(extensions.vector, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_documents(extensions.vector, jsonb, integer)
  TO service_role;
