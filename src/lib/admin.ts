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
}): Promise<CreatedClientAccount> => {
  const { data, error } = await supabase.functions.invoke("create-client-account", {
    body: payload,
  });

  if (error) throw new Error(error.message || "Не удалось создать аккаунт клиента");
  if (!data?.userId) throw new Error(data?.error || "Не удалось создать аккаунт клиента");

  return data as CreatedClientAccount;
};
