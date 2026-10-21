-- Menu image storage: public-read bucket, uploads happen through the backend
-- (service role) from the admin panel.
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

drop policy if exists "menu images are public" on storage.objects;
create policy "menu images are public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'menu-images');
drop policy if exists "admins manage menu images" on storage.objects;
create policy "admins manage menu images" on storage.objects
  for all to authenticated using (
    bucket_id = 'menu-images'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    bucket_id = 'menu-images'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
