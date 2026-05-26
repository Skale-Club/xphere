-- Probe B — Guard: self-merge
DO $$ BEGIN
  PERFORM public.merge_contacts(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  );
  RAISE EXCEPTION 'merge_contacts did NOT reject self-merge';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM ILIKE '%survivor and archived must differ%' THEN
    RAISE NOTICE 'GUARD OK: self-merge rejected (%)', SQLERRM;
  ELSE
    RAISE EXCEPTION 'Wrong error: %', SQLERRM;
  END IF;
END $$;
