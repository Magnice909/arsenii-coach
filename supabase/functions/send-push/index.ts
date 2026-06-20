import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey!);
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@arseniicoach.ru", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
    const { title, body, url, recipientIds } = await req.json();
    let targetIds: string[] = Array.isArray(recipientIds) ? recipientIds.filter(Boolean) : [];
    if (!targetIds.length) {
      const { data: coachProfiles, error: profileError } = await supabase.from("profiles").select("id").eq("role", "coach");
      if (profileError) return new Response(JSON.stringify({ error: profileError.message }), { status: 500, headers: corsHeaders });
      targetIds = (coachProfiles || []).map((profile) => profile.id);
    }
    if (!targetIds.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: subscriptions, error } = await supabase.from("push_subscriptions").select("subscription").in("user_id", targetIds);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    const payload = JSON.stringify({ title: title || "ArseniiCoach", body: body || "Новое уведомление", url: url || "/" });
    const results = await Promise.allSettled((subscriptions || []).map((item) => webpush.sendNotification(item.subscription, payload)));
    return new Response(JSON.stringify({ sent: results.filter((item) => item.status === "fulfilled").length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Ошибка push" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
