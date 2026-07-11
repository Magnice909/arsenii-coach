-- Тексты заставки при загрузке главной страницы (IntroScreen) раньше были
-- зашиты в код. Тренер попросил редактировать их так же, как остальные
-- тексты сайта — добавляем две колонки в существующую таблицу site_settings.
alter table public.site_settings add column if not exists intro_tagline text;
alter table public.site_settings add column if not exists intro_slogan text;
