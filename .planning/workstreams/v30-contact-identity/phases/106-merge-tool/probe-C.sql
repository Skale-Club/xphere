-- Probe C — Guard: nonexistent rows
DO $$ BEGIN
  PERFORM public.merge_contacts(gen_random_uuid(), gen_random_uuid());
  RAISE EXCEPTION 'merge_contacts did NOT reject nonexistent survivor';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM ILIKE '%not found%' THEN
    RAISE NOTICE 'GUARD OK: nonexistent survivor rejected';
  ELSE
    RAISE EXCEPTION 'Wrong error: %', SQLERRM;
  END IF;
END $$;
