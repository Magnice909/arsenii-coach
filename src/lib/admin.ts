import { supabase } from "./supabase";

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

  const { data, error } = await supabase.functions.invoke("create-client-account", {
    body: payload,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (error) throw new Error(error.message || "Не удалось создать аккаунт клиента");
  if (!data?.userId) throw new Error(data?.error || "Не удалось создать аккаунт клиента");

  return data as CreatedClientAccount;
};
