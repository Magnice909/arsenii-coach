import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return Response.json({ error: "Не настроены переменные Supabase Edge Function" }, { status: 500, headers: corsHeaders });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      return Response.json({ error: "Нужно войти в аккаунт тренера" }, { status: 401, headers: corsHeaders });
    }

    const { data: profile, error: profileError } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .single();

    if (profileError || profile?.role !== "coach") {
      return Response.json({ error: "Создавать клиентов может только тренер" }, { status: 403, headers: corsHeaders });
    }

    const { email, password, name, telegram } = await req.json();
    if (!email || !password || password.length < 8) {
      return Response.json({ error: "Укажите email и пароль минимум 8 символов" }, { status: 400, headers: corsHeaders });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, telegram, role: "client" },
    });

    if (createError || !created.user) {
      return Response.json({ error: createError?.message || "Не удалось создать пользователя" }, { status: 400, headers: corsHeaders });
    }

    const { error: upsertError } = await adminClient.from("profiles").upsert({
      id: created.user.id,
      role: "client",
      name: name || email,
      telegram: telegram || "",
    });

    if (upsertError) {
      return Response.json({ error: upsertError.message }, { status: 400, headers: corsHeaders });
    }

    return Response.json({ userId: created.user.id, email: created.user.email }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Неизвестная ошибка" }, { status: 500, headers: corsHeaders });
  }
});
