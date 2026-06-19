import { isSupabaseConfigured, supabase } from "./supabase";

const publicVapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
};

export const isPushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const enablePushNotifications = async (userId?: string) => {
  if (!isPushSupported()) throw new Error("Этот браузер не поддерживает push-уведомления");
  if (!publicVapidKey) throw new Error("Не задан VITE_VAPID_PUBLIC_KEY");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Разрешение на уведомления не выдано");
  const registration = await navigator.serviceWorker.register("/sw.js");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicVapidKey) });
  const subscriptionJson = subscription.toJSON();
  localStorage.setItem("arseniiCoachPushSubscription", JSON.stringify(subscriptionJson));
  if (isSupabaseConfigured && userId) {
    const { error } = await supabase.from("push_subscriptions").upsert({ user_id: userId, subscription: subscriptionJson, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
  }
  return subscriptionJson;
};

export const sendCoachPush = async (title: string, body: string) => {
  if (!isSupabaseConfigured) return;
  await supabase.functions.invoke("send-push", { body: { title, body, url: "/#/coach" } });
};
