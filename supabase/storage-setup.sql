-- Bucket для публичных изображений сайта (фото на главной странице).
-- ВАЖНО: сам bucket нужно создать один раз в Supabase Dashboard:
--   Storage → New bucket → имя "site-assets" → Public bucket: ВКЛЮЧЕНО.
-- После создания bucket выполните этот файл, чтобы настроить права доступа.

-- Разрешаем всем читать файлы из site-assets (это публичные изображения лендинга,
-- не персональные данные — чтение должно быть открытым, иначе фото не отрисуется
-- для анонимных посетителей сайта).
drop policy if exists "Публичное чтение site-assets" on storage.objects;
create policy "Публичное чтение site-assets"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'site-assets');

-- Загружать и заменять файлы может только тренер.
drop policy if exists "Тренер загружает в site-assets" on storage.objects;
create policy "Тренер загружает в site-assets"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'site-assets'
  and exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'coach')
);

drop policy if exists "Тренер удаляет из site-assets" on storage.objects;
create policy "Тренер удаляет из site-assets"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'site-assets'
  and exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'coach')
);
