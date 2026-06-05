-- =============================================================================
-- Migration 1145: Storage policies for org logo uploads.
-- The existing avatars_upload_own policy requires the first path segment to be
-- the uploading user's auth.uid(). Org logos are stored under {org_id}/logo/...
-- which broke uploads for all members (the first segment is the org ID, not the
-- user ID). These three policies allow any org member to upload, update, and
-- delete files in their org's logo folder.
-- =============================================================================

CREATE POLICY "avatars_upload_org_logo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[2] = 'logo'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "avatars_update_org_logo" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[2] = 'logo'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[2] = 'logo'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "avatars_delete_org_logo" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[2] = 'logo'
    AND (storage.foldername(name))[1] IN (
      SELECT organization_id::text FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
    )
  );
