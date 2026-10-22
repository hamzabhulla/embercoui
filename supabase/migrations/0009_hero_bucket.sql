-- Ember & Co. — migration 0009: hero media storage bucket.
-- The homepage hero (hero-video.mp4 + hero-mobile.jpg, referenced by
-- src/components/Hero.tsx) lives in the public `hero-portfolio-video`
-- bucket. Until now that bucket was created by hand in the dashboard;
-- this migration creates it the same way 0002 created `menu-images`, so a
-- fresh install is reproducible from SQL alone. The owner still uploads
-- the two media files afterwards (dashboard Storage upload, or any
-- service-role client — both bypass these policies).
-- Access model mirrors 0002 exactly: public read for everyone, and full
-- management reserved to authenticated users whose profile role is
-- 'admin'. Idempotent — safe to run more than once; on the live project
-- (where the bucket already exists) it is a no-op apart from ensuring the
-- policies are present.

insert into storage.buckets (id, name, public)
values ('hero-portfolio-video', 'hero-portfolio-video', true)
on conflict (id) do nothing;

drop policy if exists "hero media are public" on storage.objects;
create policy "hero media are public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'hero-portfolio-video');
drop policy if exists "admins manage hero media" on storage.objects;
create policy "admins manage hero media" on storage.objects
  for all to authenticated using (
    bucket_id = 'hero-portfolio-video'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    bucket_id = 'hero-portfolio-video'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
