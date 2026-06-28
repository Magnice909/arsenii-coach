import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Раньше эта функция не проверяла, кто её вызывает — любой человек, узнав
    // URL проекта, мог разослать push-спам всем подписанным пользователям.
    // Теперь требуем валидную сессию Supabase (тренер или клиент — оба легитимно
    // шлют уведомления друг другу через эту функцию).
    const authHeader = req.headers.get("Authorization") || "";
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Нужна авторизация Supabase" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@arseniicoach.ru", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
    const { title, body, url, recipientIds } = await req.json();
    let targetIds: string[] = Array.isArray(recipientIds) ? recipientIds.filter(Boolean) : [];
    if (!targetIds.length) {
      const { data: coachProfiles, error: profileError } = await supabase.from("profiles").select("id").eq("role", "coach");
      if (profileError) return new Response(JSON.stringify({ error: profileError.message }), { status: 500, headers: corsHeaders });
      targetIds = (coachProfiles || []).map((profile) => profile.id);
    }
    if (!targetIds.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: subscriptions, error } = await supabase.from("push_subscriptions").select("user_id, subscription").in("user_id", targetIds);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    const payload = JSON.stringify({ title: title || "ArseniiCoach", body: body || "Новое уведомление", url: url || "/" });

    const results = await Promise.allSettled(
      (subscriptions || []).map((item) => webpush.sendNotification(item.subscription, payload))
    );

    // Подписки, на которые push больше не доходит (410 Gone / 404 — пользователь
    // отписался или сбросил разрешение в браузере), удаляем, чтобы не копился мёртвый балласт.
    const staleUserIds = (subscriptions || [])
      .filter((_, index) => {
        const result = results[index];
        return result.status === "rejected" && [404, 410].includes((result.reason as { statusCode?: number })?.statusCode ?? 0);
      })
      .map((item) => item.user_id);
    if (staleUserIds.length) {
      await supabase.from("push_subscriptions").delete().in("user_id", staleUserIds);
    }

    return new Response(JSON.stringify({ sent: results.filter((item) => item.status === "fulfilled").length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Ошибка push" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
