import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";

export type CreatedClientAccount = {
  userId: string;
  email: string;
};

export const createClientAccount = async (payload: {
  email: string;
  password: string;
  name: string;
  telegram: string;
  userId?: string;
}): Promise<CreatedClientAccount> => {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  if (!token) {
    throw new Error("Сессия Supabase не найдена. Выйдите из кабинета и войдите заново.");
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase не настроен в переменных Vercel");
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/create-client-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || `Edge Function вернула ошибку ${response.status}`);
  }
  if (!data?.userId) {
    throw new Error(data?.error || "Edge Function не вернула userId клиента");
  }

  return data as CreatedClientAccount;
};
