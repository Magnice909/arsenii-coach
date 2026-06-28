-- Уборка технического долга: на старте таблица applications была создана с
-- колонками startTimeline / lookingFor / readyToInvest (camelCase без кавычек,
-- Postgres свернул их в нижний регистр без подчёркиваний). Позже завели
-- параллельные start_timeline / looking_for / ready_to_invest (snake_case),
-- на которые фронтенд переключился полностью. Старые колонки с тех пор
-- не читаются и не пишутся никаким кодом — это мёртвый балласт схемы.
--
-- Перед выполнением можно проверить, что в старых колонках действительно
-- нет данных, которых нет в новых:
--   select count(*) from public.applications
--   where starttimeline is not null or lookingfor is not null or readytoinvest is not null;
-- Если результат 0 (или все эти заявки уже задублированы в новых колонках) — можно выполнять.

alter table public.applications drop column if exists starttimeline;
alter table public.applications drop column if exists lookingfor;
alter table public.applications drop column if exists readytoinvest;
