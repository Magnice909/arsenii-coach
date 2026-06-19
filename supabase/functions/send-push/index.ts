import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") || "mailto:admin@arseniicoach.ru", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const { title, body, url } = await req.json();
  const { data: coachProfiles, error: profileError } = await supabase.from("profiles").select("id").eq("role", "coach");
  if (profileError) return new Response(JSON.stringify({ error: profileError.message }), { status: 500, headers: corsHeaders });
  const coachIds = (coachProfiles || []).map((profile) => profile.id);
  if (!coachIds.length) return new Response(JSON.stringify({ sent: 0 }), { headers: corsHeaders });
  const { data: subscriptions, error } = await supabase.from("push_subscriptions").select("subscription").in("user_id", coachIds);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  const payload = JSON.stringify({ title: title || "ArseniiCoach", body: body || "Новое уведомление", url: url || "/#/coach" });
  const results = await Promise.allSettled((subscriptions || []).map((item) => webpush.sendNotification(item.subscription, payload)));
  return new Response(JSON.stringify({ sent: results.filter((item) => item.status === "fulfilled").length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
