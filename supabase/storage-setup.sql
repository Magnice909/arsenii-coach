-- Bucket для публичных изображений сайта (фото на главной странице).
-- ВАЖНО: сам bucket нужно создать один раз в Supabase Dashboard:
--   Storage → New bucket → имя "site-assets" → Public bucket: ВКЛЮЧЕНО.
-- После создания bucket выполните этот файл, чтобы настроить права доступа.

-- Флаг "Public bucket" в Storage — это отдельная настройка bucket'а, а не RLS-
-- политика на storage.objects: даже с политикой чтения ниже, публичная ссылка
-- (getPublicUrl) не откроется анонимному посетителю, если сам bucket не помечен
-- публичным. Ставим это явно через SQL — на случай, если bucket создали без
-- галочки "Public" или она потом слетела, фото на лендинге просто не грузилось
-- у анонимных посетителей, хотя в кабинете тренера (с активной сессией) могло
-- казаться, что всё в порядке из-за кэша браузера.
update storage.buckets set public = true where id = 'site-assets';

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
