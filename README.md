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
