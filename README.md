# ArseniiCoach — Supabase Auth + Push Notifications

Добавлена база для push-уведомлений:

- `public/sw.js` — service worker для получения push
- `src/lib/push.ts` — подписка браузера на push
- кнопка **Включить push** в кабинете тренера → Сообщения
- `supabase/schema.sql` — таблица `push_subscriptions`
- `supabase/functions/send-push/index.ts` — Supabase Edge Function для отправки push тренеру

## Что нужно для push

1. Сайт должен быть на HTTPS. Vercel подходит.
2. Нужно создать VAPID public/private keys.
3. `VITE_VAPID_PUBLIC_KEY` добавить в Vercel Environment Variables.
4. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` добавить в Supabase Edge Function Secrets.
5. Выполнить SQL из `supabase/schema.sql`.
6. Задеплоить Edge Function `send-push`.
7. Войти в кабинет тренера и нажать **Сообщения → Включить push**.

## Vercel env

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_VAPID_PUBLIC_KEY=...
```

## Supabase secrets

```text
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:your-email@example.com
```

Push не будет работать просто от загрузки frontend-кода. Нужен backend-отправитель: в этой версии подготовлена Supabase Edge Function.


## Защищенное создание клиентских аккаунтов

Кнопка «Создать аккаунт» в кабинете тренера вызывает Supabase Edge Function `create-client-account`.
Пароль клиента не хранится во frontend-коде и не сохраняется в таблице `clients`.

### Что нужно сделать в Supabase

1. Установить Supabase CLI.
2. Войти в Supabase CLI:

```bash
supabase login
```

3. Привязать проект:

```bash
supabase link --project-ref ijowzzxavpjheapdrnmz
```

4. Добавить секреты для Edge Functions:

```bash
supabase secrets set SERVICE_ROLE_KEY="ВАШ_SERVICE_ROLE_KEY"
```

`SUPABASE_URL` и `SUPABASE_ANON_KEY` Supabase обычно предоставляет Edge Function автоматически.

5. Задеплоить функцию:

```bash
supabase functions deploy create-client-account
```

После этого тренер сможет создавать клиентские аккаунты из кабинета.


## Обновление главной страницы

В разделе «Настройки» изменения теперь не применяются сразу. После редактирования текста или фото нажмите «Сохранить изменения», затем «Открыть главную».

Фото выводится через `object-contain`, чтобы оно не обрезалось и не растягивалось. Для красивого вида лучше загружать вертикальное портретное фото 4:5 или 3:4, а не скан паспорта/анкеты/лист с несколькими лицами.


## Заявки с главной страницы

Заявки теперь отправляются в таблицу Supabase `applications` и отображаются в кабинете тренера в разделе «Заявки».

Перед публикацией обновления выполните SQL из файла:

```text
supabase/applications.sql
```

После этого в кабинете тренера появится раздел «Заявки», где можно открыть анкету и нажать «Добавить в клиенты».


Важно: в Supabase Dashboard название custom secret не должно начинаться с `SUPABASE_`. Для service role используйте имя `SERVICE_ROLE_KEY`.

## Полная синхронизация Supabase

В этой версии клиенты, планы тренировок, недельные назначения, заявки, уведомления и настройки главной страницы читаются/сохраняются через Supabase.

Перед деплоем выполните SQL:

```text
supabase/full-sync.sql
```

После этого:
1. Войдите как тренер.
2. Создайте/выберите клиента.
3. Создайте клиентский аккаунт.
4. Назначьте тренировки на неделю.
5. Клиент войдёт со своей почтой и увидит назначенный план.

## Недельные планы внутри одного плана

Теперь «План тренировок» — это недельный шаблон. Внутри одного плана есть дни недели: понедельник, вторник, среда и т.д. В каждом дне можно указать название тренировки, фокус, упражнения и заметки.

В карточке клиента теперь выбирается один «Назначенный недельный план», а не отдельный основной план и отдельный план по дням.

После редактирования плана нужно нажимать «Сохранить план».

## Последние правки интерфейса

- Кнопка «Войти» теперь видна на телефоне.
- Фото на главной обрезается по рамке через `object-cover`, чтобы не выходить за карточку.
- В кабинете клиента убрано поле сообщения тренеру.
- Отметка тренировки сохраняется в Supabase в таблицу `workout_completions`; после обновления страницы повторно отметить ту же тренировку за тот же день нельзя.

После обновления выполните `supabase/full-sync.sql` ещё раз, чтобы добавить таблицу `workout_completions`.
