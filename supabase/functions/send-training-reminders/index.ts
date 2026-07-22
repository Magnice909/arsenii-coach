import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const weekDays = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

const getDayWorkoutTitle = (workout: any, day: string) => {
  const exercises = workout?.exercises;
  if (exercises?.type === "weekly_template" && exercises?.days?.[day]?.title) return exercises.days[day].title;
  return workout?.title || "Тренировка";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!supabaseUrl || !serviceRoleKey || !vapidPublic || !vapidPrivate) {
      return new Response(JSON.stringify({ error: "Не настроены SUPABASE_URL, SERVICE_ROLE_KEY или VAPID ключи" }), { status: 500, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Эта функция предназначена только для вызова по расписанию (Supabase Cron),
    // который аутентифицируется service role key. Раньше любой человек мог вызвать
    // её URL напрямую и разослать произвольные push-уведомления всем клиентам.
    const authHeader = req.headers.get("Authorization") || "";
    const incomingToken = authHeader.replace(/^Bearer\s+/i, "");
    if (incomingToken !== serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Эта функция вызывается только по расписанию" }), { status: 401, headers: corsHeaders });
    }

    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@arseniicoach.ru", vapidPublic, vapidPrivate);

    // Клиент выбирает удобный час напоминания (push_subscriptions.reminder_hour,
    // 0-23) в своём кабинете — это московское время, единственный часовой пояс,
    // под который сделано приложение. Чтобы разослать напоминание именно в
    // выбранный клиентом час, эта функция должна вызываться по расписанию
    // Supabase Cron КАЖДЫЙ ЧАС (а не раз в сутки, как раньше) — поменяй
    // расписание в Supabase Dashboard → Edge Functions → send-training-reminders
    // → Cron на "0 * * * *". У клиентов без выбранного часа (reminder_hour = null)
    // сохраняется прежнее поведение по умолчанию — 18:00 по Москве.
    const nowUtc = new Date();
    const moscowHour = (nowUtc.getUTCHours() + 3) % 24;
    const DEFAULT_REMINDER_HOUR = 18;

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowDay = weekDays[tomorrow.getDay()];

    const { data: plans, error: plansError } = await supabase
      .from("weekly_plans")
      .select("client_id, workout_id, day_of_week")
      .eq("day_of_week", tomorrowDay);

    if (plansError) throw plansError;
    if (!plans?.length) return new Response(JSON.stringify({ sent: 0, day: tomorrowDay }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const clientIds = [...new Set(plans.map((plan: any) => plan.client_id))];
    const workoutIds = [...new Set(plans.map((plan: any) => plan.workout_id))];

    const [{ data: clients, error: clientsError }, { data: workouts, error: workoutsError }] = await Promise.all([
      supabase.from("clients").select("id, user_id, name").in("id", clientIds),
      supabase.from("workouts").select("id, title, exercises").in("id", workoutIds),
    ]);

    if (clientsError) throw clientsError;
    if (workoutsError) throw workoutsError;

    const userIds = (clients || []).map((client: any) => client.user_id).filter(Boolean);
    if (!userIds.length) return new Response(JSON.stringify({ sent: 0, day: tomorrowDay }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: allSubscriptions, error: subscriptionsError } = await supabase
      .from("push_subscriptions")
      .select("user_id, subscription, reminder_hour, reminder_enabled")
      .in("user_id", userIds);

    if (subscriptionsError) throw subscriptionsError;

    const subscriptions = (allSubscriptions || []).filter((item: any) => {
      if (item.reminder_enabled === false) return false;
      const hour = item.reminder_hour ?? DEFAULT_REMINDER_HOUR;
      return hour === moscowHour;
    });

    const plansByClient = new Map(plans.map((plan: any) => [plan.client_id, plan]));
    const workoutsById = new Map((workouts || []).map((workout: any) => [workout.id, workout]));
    const clientsByUser = new Map((clients || []).map((client: any) => [client.user_id, client]));

    const results = await Promise.allSettled(subscriptions.map((item: any) => {
      const client = clientsByUser.get(item.user_id);
      const plan = plansByClient.get(client?.id);
      const workout = workoutsById.get(plan?.workout_id);
      const title = getDayWorkoutTitle(workout, tomorrowDay);
      const payload = JSON.stringify({
        title: "Завтра тренировка",
        body: `${tomorrowDay}: ${title}`,
        url: "/#/client",
      });
      return webpush.sendNotification(item.subscription, payload);
    }));

    const staleUserIds = (subscriptions || [])
      .filter((_: any, index: number) => {
        const result = results[index];
        return result.status === "rejected" && [404, 410].includes((result.reason as { statusCode?: number })?.statusCode ?? 0);
      })
      .map((item: any) => item.user_id);
    if (staleUserIds.length) {
      await supabase.from("push_subscriptions").delete().in("user_id", staleUserIds);
    }

    return new Response(JSON.stringify({ sent: results.filter((item) => item.status === "fulfilled").length, day: tomorrowDay }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Ошибка напоминаний" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
