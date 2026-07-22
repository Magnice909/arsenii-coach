import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, CalendarDays, Check, CheckCircle2, Copy, Download, Dumbbell, Inbox, LayoutDashboard, LogOut, MoreHorizontal, Plus, Scale, Search, Send, Settings, StickyNote, Tag, Trash2, TrendingUp, Users, X, type LucideIcon } from "lucide-react";
import { enablePushNotifications, sendPushToUsers } from "../lib/push";
import { createClientAccount, deleteClientAccount } from "../lib/admin";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { getErrorMessage } from "../lib/errors";
import { Client, getClients, getMessages, getSiteSettings, getUser, getWorkouts, logout, makeId, Message, resetSiteSettings, setClients, setMessages, setSiteSettings, setWorkouts, SiteSettings, Workout } from "../lib/storage";
import { StrengthRecord, createClientRecord, createWorkoutRecord, deleteClientRecord, createEmptyWeeklyTemplate, deleteWorkoutRecord, fetchCoachClientStrengthRecords, fetchCoachData, fetchCoachNotifications, fetchSiteSettingsDb, markNotificationRead, replaceWeeklyPlanRecord, saveSiteSettingsDb, updateClientRecord, updateWorkoutRecord, createClientRecordFromClient, uploadSitePhoto, PlanPeriod, fetchCurrentPlanPeriod, createPlanPeriod, extendClientPlan, addDaysToISO, createNotification, fetchWeeklyCompletionCounts, WeeklyActivityBucket, ClientNote, fetchClientNotes, createClientNote, deleteClientNote, CompletionHistoryItem, fetchCoachClientCompletionHistory, BodyWeightRecord, fetchCoachClientBodyWeightRecords, ExerciseLibraryItem, fetchExerciseLibrary, createExerciseLibraryItem, deleteExerciseLibraryItem } from "../lib/db";
import CalendarView from "../components/CalendarView";
import HoloCard from "../components/HoloCard";
import ProgressRing from "../components/ProgressRing";
import { AlertBanner, AlertLine, alertColors } from "../components/AlertBanner";
import { buildCalendarEntries, CalendarWorkoutEntry, toISODate } from "../lib/calendar";

type Application = {
  id: string;
  name: string;
  goal: string;
  duration: string;
  obstacle: string;
  commitment: string;
  start_timeline?: string;
  looking_for?: string;
  ready_to_invest?: string;
  telegram: string;
  email: string;
  instagram?: string;
  status?: string;
  created_at?: string;
};

const emptyClient = (workoutId: string): Client => ({
  id: makeId(), name: "Новый клиент", telegram: "@username", email: "", goal: "", plan: "", status: "Новый", progress: 0, nextWorkout: "", comment: "", nutrition: "", assignedWorkoutId: workoutId, weeklyPlan: { "Понедельник": workoutId },
});

const emptyWorkout = (): Workout => ({ id: makeId(), title: "Новый недельный план", day: "Понедельник", focus: "", notes: "", exercises: [], weeklyTemplate: createEmptyWeeklyTemplate() });

type NavItem = { id: string; label: string; icon: LucideIcon };
// Планы не продлеваются сами: когда 7-дневный период заканчивается, а тренер
// не назначил следующий вручную, клиент молча остаётся без плана. Помогаем
// не забыть — считаем, у кого план уже закончился или заканчивается со дня
// на день, чтобы показать предупреждение на «Обзоре» и в карточке клиента.
const daysUntilIso = (iso: string) => Math.round((new Date(iso + "T00:00:00").getTime() - new Date(toISODate(new Date()) + "T00:00:00").getTime()) / 86400000);
const needsPlanAttention = (client: Client) => client.status === "Активен" && (!client.planEndDate || daysUntilIso(client.planEndDate) <= 1);
// Клиент, который давно не отмечал тренировки, легко теряется среди тех, у
// кого просто заканчивается план — это разные проблемы и разные действия
// тренера, поэтому считаем отдельно.
const INACTIVITY_DAYS_THRESHOLD = 7;
const daysSinceIso = (iso: string) => Math.round((new Date(toISODate(new Date()) + "T00:00:00").getTime() - new Date(iso + "T00:00:00").getTime()) / 86400000);
const needsActivityAttention = (client: Client) => client.status === "Активен" && (!client.lastActivityDate || daysSinceIso(client.lastActivityDate) >= INACTIVITY_DAYS_THRESHOLD);
// Оплата — отдельная причина для внимания тренера, не смешиваем с планом/активностью.
const needsPaymentAttention = (client: Client) => Boolean(client.nextPaymentDate) && daysUntilIso(client.nextPaymentDate!) <= 2;
const needsAnyAttention = (client: Client) => needsPlanAttention(client) || needsActivityAttention(client) || needsPaymentAttention(client);

type NavGroup = { label: string; items: NavItem[] };
// Группировка меню по разделам вместо одного длинного плоского списка —
// проще ориентироваться, где искать нужное действие.
const coachNavGroups: NavGroup[] = [
  { label: "Обзор", items: [
    { id: "overview", label: "Обзор", icon: LayoutDashboard },
    { id: "calendar", label: "Календарь", icon: CalendarDays },
  ] },
  { label: "Клиенты", items: [
    { id: "clients", label: "Клиенты", icon: Users },
    { id: "applications", label: "Заявки", icon: Inbox },
  ] },
  { label: "Контент", items: [
    { id: "workouts", label: "Планы тренировок", icon: Dumbbell },
  ] },
  { label: "Сервис", items: [
    { id: "messages", label: "Сообщения", icon: Bell },
    { id: "settings", label: "Настройки", icon: Settings },
  ] },
];
const coachNavItems: NavItem[] = coachNavGroups.flatMap((group) => group.items);
// Вкладки в нижней панели на мобильном — самые частые действия тренера.
// Остальные (и выход) остаются в полном меню за кнопкой «Ещё».
const coachMobilePrimaryIds = ["overview", "calendar", "clients", "messages"];

const isApplicationPending = (application: Application, clients: Client[]) => !clients.some((client) =>
  Boolean(application.email && client.email && application.email.trim().toLowerCase() === client.email.trim().toLowerCase()) ||
  Boolean(application.telegram && client.telegram && application.telegram.trim().toLowerCase() === client.telegram.trim().toLowerCase())
);

const CoachDashboard = () => {
  const user = getUser();
  const [tab, setTab] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [clients, updateClients] = useState<Client[]>(getClients().map((client) => ({ ...client, weeklyPlan: client.weeklyPlan || { "Понедельник": client.assignedWorkoutId } })));
  const [workouts, updateWorkouts] = useState<Workout[]>(getWorkouts());
  const [messages, updateMessages] = useState<Message[]>(getMessages());
  const [siteSettingsState, updateSiteSettingsState] = useState<SiteSettings>(getSiteSettings());
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationsStatus, setApplicationsStatus] = useState("");
  const [pushStatus, setPushStatus] = useState("");
  const [selectedClientStrength, setSelectedClientStrength] = useState<StrengthRecord[]>([]);
  const [syncStatus, setSyncStatus] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || "");
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(workouts[0]?.id || "");
  const [calendarEntries, setCalendarEntries] = useState<Map<string, CalendarWorkoutEntry[]>>(new Map());
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [clientSearch, setClientSearch] = useState("");
  const [clientTagFilter, setClientTagFilter] = useState("");
  const [workoutSearch, setWorkoutSearch] = useState("");
  const [workoutTemplateFilter, setWorkoutTemplateFilter] = useState(false);
  const [weeklyActivity, setWeeklyActivity] = useState<WeeklyActivityBucket[]>([]);
  const [broadcastText, setBroadcastText] = useState("");
  const [broadcastClientIds, setBroadcastClientIds] = useState<string[]>([]);
  const [broadcastStatus, setBroadcastStatus] = useState("");
  const [isSendingBroadcast, setIsSendingBroadcast] = useState(false);
  const selectedClient = clients.find((c) => c.id === selectedClientId) || clients[0];
  const selectedWorkout = workouts.find((w) => w.id === selectedWorkoutId) || workouts[0];
  const average = useMemo(() => clients.length ? Math.round(clients.reduce((sum, c) => sum + c.progress, 0) / clients.length) : 0, [clients]);
  const clientTags = useMemo(() => Array.from(new Set(clients.map((c) => c.tag).filter(Boolean))) as string[], [clients]);
  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    return clients
      .filter((c) => !query || c.name.toLowerCase().includes(query) || c.telegram.toLowerCase().includes(query))
      .filter((c) => !clientTagFilter || c.tag === clientTagFilter);
  }, [clients, clientSearch, clientTagFilter]);
  const filteredWorkouts = useMemo(() => {
    const query = workoutSearch.trim().toLowerCase();
    return workouts
      .filter((w) => !query || w.title.toLowerCase().includes(query))
      .filter((w) => !workoutTemplateFilter || w.isTemplate)
      .slice()
      .sort((a, b) => Number(Boolean(b.isTemplate)) - Number(Boolean(a.isTemplate)));
  }, [workouts, workoutSearch, workoutTemplateFilter]);
  const pendingApplicationsCount = useMemo(() => applications.filter((application) => isApplicationPending(application, clients)).length, [applications, clients]);
  const attentionClientsCount = useMemo(() => clients.filter(needsAnyAttention).length, [clients]);
  const navBadges: Record<string, number> = { messages: messages.length, applications: pendingApplicationsCount, clients: attentionClientsCount };

  const loadAllData = async () => {
    if (!isSupabaseConfigured || !user?.id) return;
    setSyncStatus("Синхронизируем данные...");
    try {
      const [{ clients: syncedClients, workouts: syncedWorkouts }, syncedSettings, syncedMessages] = await Promise.all([
        fetchCoachData(user.id),
        fetchSiteSettingsDb(),
        fetchCoachNotifications(),
      ]);
      updateClients(syncedClients);
      setClients(syncedClients);
      updateWorkouts(syncedWorkouts);
      setWorkouts(syncedWorkouts);
      updateMessages(syncedMessages);
      setMessages(syncedMessages);
      if (syncedSettings) { updateSiteSettingsState(syncedSettings); setSiteSettings(syncedSettings); }
      setSelectedClientId((current) => syncedClients.some((c) => c.id === current) ? current : (syncedClients[0]?.id || ""));
      setSelectedWorkoutId((current) => syncedWorkouts.some((w) => w.id === current) ? current : (syncedWorkouts[0]?.id || ""));
      setSyncStatus("");
    } catch (error) {
      setSyncStatus(getErrorMessage(error, "Не удалось синхронизировать данные"));
    }
  };

  const loadApplications = async () => {
    if (!isSupabaseConfigured) {
      try {
        setApplications(JSON.parse(localStorage.getItem("arseniiCoachApplications") || "[]"));
      } catch {
        setApplications([]);
      }
      return;
    }

    setApplicationsStatus("Загружаем заявки...");
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setApplicationsStatus("Не удалось загрузить заявки. Проверьте таблицу applications и права доступа.");
      return;
    }

    setApplications((data || []) as Application[]);
    setApplicationsStatus("");
  };

  useEffect(() => { loadAllData(); }, [user?.id, refreshKey]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") setRefreshKey((key) => key + 1); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, []);
  // Заявки нужны не только на своей вкладке — от них зависит счётчик в
  // навигации, который должен быть верным сразу, а не только после того,
  // как тренер откроет вкладку «Заявки» хотя бы раз.
  useEffect(() => { loadApplications(); }, [user?.id, refreshKey]);
  useEffect(() => { if (tab === "applications") loadApplications(); }, [tab]);
  useEffect(() => {
    const loadStrength = async () => {
      if (!isSupabaseConfigured || !selectedClientId) { setSelectedClientStrength([]); return; }
      try {
        setSelectedClientStrength(await fetchCoachClientStrengthRecords(selectedClientId));
      } catch {
        setSelectedClientStrength([]);
      }
    };
    if (tab === "clients") loadStrength();
  }, [tab, selectedClientId]);

  useEffect(() => {
    const loadWeeklyActivity = async () => {
      if (!isSupabaseConfigured || !clients.length) { setWeeklyActivity([]); return; }
      try {
        setWeeklyActivity(await fetchWeeklyCompletionCounts(clients.map((c) => c.id)));
      } catch {
        setWeeklyActivity([]);
      }
    };
    if (tab === "overview") loadWeeklyActivity();
  }, [tab, clients]);

  const loadCalendarMonth = async (anchor: Date) => {
    if (!isSupabaseConfigured || !clients.length) { setCalendarEntries(new Map()); return; }
    setCalendarLoading(true);
    try {
      const rangeStart = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 21);
      const rangeEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 10);
      const entries = await buildCalendarEntries(clients, workouts, toISODate(rangeStart), toISODate(rangeEnd));
      setCalendarEntries(entries);
    } catch (error) {
      setSyncStatus(getErrorMessage(error, "Не удалось загрузить календарь"));
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => { if (tab === "calendar") loadCalendarMonth(new Date()); }, [tab, clients.length, workouts.length]);
  useEffect(() => { if (tab === "messages" && isSupabaseConfigured) fetchCoachNotifications().then((next) => { updateMessages(next); setMessages(next); }).catch(() => {}); }, [tab]);

  const saveClients = (next: Client[]) => { updateClients(next); setClients(next); };
  const saveWorkouts = (next: Workout[]) => { updateWorkouts(next); setWorkouts(next); };


  const updateClient = (patch: Partial<Client>) => {
    if (!selectedClient) return;
    const updated = { ...selectedClient, ...patch };
    const next = clients.map((client) => client.id === selectedClient.id ? updated : client);
    saveClients(next);

    if (isSupabaseConfigured && user?.id) {
      const planChanged = Boolean(patch.weeklyPlan || patch.assignedWorkoutId || patch.nextPlanId || patch.nextPlanWeekStart);
      updateClientRecord(user.id, updated)
        .then(async () => {
          if (patch.weeklyPlan || patch.assignedWorkoutId) await replaceWeeklyPlanRecord(user.id!, updated.id, updated.weeklyPlan || {});
          if (planChanged && updated.userId) await sendPushToUsers([updated.userId], "Новый план тренировок", "Арсений обновил ваш тренировочный план", "/#/client");
        })
        .catch((error) => setSyncStatus(getErrorMessage(error, "Не удалось сохранить клиента")));
    }
  };

  const exportClientsCsv = () => {
    const header = ["Имя", "Telegram", "Email", "Статус", "Метка", "Прогресс %", "Дата след. оплаты", "Цель"];
    const rows = clients.map((c) => [c.name, c.telegram, c.email, c.status, c.tag || "", String(c.progress), c.nextPaymentDate || "", (c.goal || "").replace(/\n/g, " ")]);
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    // BOM в начале файла — иначе Excel открывает кириллицу в CSV как кракозябры.
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clients-${toISODate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const addClient = async () => {
    try {
      const client = isSupabaseConfigured && user?.id ? await createClientRecord(user.id) : emptyClient(workouts[0]?.id || "");
      const next = [client, ...clients];
      saveClients(next);
      setSelectedClientId(client.id);
      setTab("clients");
    } catch (error) {
      setSyncStatus(getErrorMessage(error, "Не удалось добавить клиента"));
    }
  };

  const deleteClient = async () => {
    if (!selectedClient || !confirm(`Удалить клиента ${selectedClient.name}?`)) return;
    const removedClient = selectedClient;
    try {
      if (isSupabaseConfigured && user?.id) {
        if (removedClient.userId) await deleteClientAccount(removedClient.userId);
        await deleteClientRecord(user.id, removedClient.id);
      }
      const next = clients.filter((client) => client.id !== removedClient.id);
      saveClients(next);
      setSelectedClientId(next[0]?.id || "");
      if (isSupabaseConfigured) {
        if (removedClient.email) await supabase.from("applications").update({ status: "Новая" }).eq("email", removedClient.email);
        if (removedClient.telegram) await supabase.from("applications").update({ status: "Новая" }).eq("telegram", removedClient.telegram);
      }
      setApplications((current) => current.map((application) =>
        (application.email && application.email === removedClient.email) || (application.telegram && application.telegram === removedClient.telegram)
          ? { ...application, status: "Новая" }
          : application
      ));
    } catch (error) {
      const details = error instanceof Error ? error.message : typeof error === "object" && error ? JSON.stringify(error) : String(error);
      setSyncStatus(`Не удалось удалить клиента: ${details}`);
    }
  };

  const updateWorkout = (patch: Partial<Workout>) => {
    if (!selectedWorkout) return Promise.resolve();
    const updated = { ...selectedWorkout, ...patch };
    const next = workouts.map((workout) => workout.id === selectedWorkout.id ? updated : workout);
    saveWorkouts(next);
    if (isSupabaseConfigured && user?.id) return updateWorkoutRecord(user.id, updated).catch((error) => setSyncStatus(getErrorMessage(error, "Не удалось сохранить тренировку")));
    return Promise.resolve();
  };

  const addWorkout = async () => {
    try {
      const workout = isSupabaseConfigured && user?.id ? await createWorkoutRecord(user.id) : emptyWorkout();
      const next = [workout, ...workouts];
      saveWorkouts(next);
      setSelectedWorkoutId(workout.id);
      setTab("workouts");
    } catch (error) {
      setSyncStatus(getErrorMessage(error, "Не удалось создать план"));
    }
  };

  const deleteWorkout = async () => {
    if (!selectedWorkout || workouts.length <= 1) return alert("Нельзя удалить последнюю тренировку");
    if (!confirm(`Удалить тренировку ${selectedWorkout.title}?`)) return;
    try {
      if (isSupabaseConfigured && user?.id) await deleteWorkoutRecord(user.id, selectedWorkout.id);
      const next = workouts.filter((workout) => workout.id !== selectedWorkout.id);
      saveWorkouts(next);
      setSelectedWorkoutId(next[0]?.id || "");
    } catch (error) {
      setSyncStatus(getErrorMessage(error, "Не удалось удалить план"));
    }
  };

  const duplicateWorkout = async () => {
    if (!selectedWorkout) return;
    try {
      const base = isSupabaseConfigured && user?.id ? await createWorkoutRecord(user.id) : { ...selectedWorkout, id: makeId() };
      const copy: Workout = {
        ...selectedWorkout,
        id: base.id,
        title: `${selectedWorkout.title} — копия`,
        weeklyTemplate: selectedWorkout.weeklyTemplate ? JSON.parse(JSON.stringify(selectedWorkout.weeklyTemplate)) : undefined,
      };
      if (isSupabaseConfigured && user?.id) await updateWorkoutRecord(user.id, copy);
      const next = [copy, ...workouts];
      saveWorkouts(next);
      setSelectedWorkoutId(copy.id);
    } catch (error) {
      setSyncStatus(getErrorMessage(error, "Не удалось дублировать план"));
    }
  };

  const assignWorkoutToClients = async (workout: Workout, clientIds: string[], startDate: string) => {
    if (!clientIds.length || !isSupabaseConfigured || !user?.id) return;
    try {
      await Promise.all(clientIds.map((clientId) => createPlanPeriod(clientId, workout.id, startDate)));
      const assignedClients = clients.filter((item) => clientIds.includes(item.id));
      await sendPushToUsers(assignedClients.map((client) => client.userId || "").filter(Boolean), "Новый план тренировок", `Арсений назначил план ${workout.title}`, "/#/client");
      setSyncStatus("План назначен выбранным клиентам");
      await loadAllData();
    } catch (error) {
      setSyncStatus(getErrorMessage(error, "Не удалось назначить план"));
    }
  };

  const deleteApplication = async (application: Application) => {
    if (!confirm(`Удалить заявку ${application.name || application.email || "без имени"}?`)) return;
    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase.from("applications").delete().eq("id", application.id);
        if (error) throw error;
      }
      setApplications((current) => current.filter((item) => item.id !== application.id));
    } catch (error) {
      const details = error instanceof Error ? error.message : typeof error === "object" && error ? JSON.stringify(error) : String(error);
      setApplicationsStatus(`Не удалось удалить заявку: ${details}`);
    }
  };

  const createClientFromApplication = async (application: Application) => {
    const client: Client = {
      id: makeId(),
      name: application.name || "Новый клиент",
      telegram: application.telegram || "@username",
      email: application.email || "",
      goal: application.goal || "",
      plan: "",
      status: "Новая заявка",
      progress: 0,
      nextWorkout: "",
      comment: `Опыт: ${application.duration || "—"}\nМешает: ${application.obstacle || "—"}\nГотовность: ${application.commitment || "—"}\nСтарт: ${application.start_timeline || "—"}\nИщет: ${application.looking_for || "—"}\nИнвестиции: ${application.ready_to_invest || "—"}`,
      nutrition: "",
      assignedWorkoutId: workouts[0]?.id || "",
      weeklyPlan: {},
    };

    try {
      const finalClient = isSupabaseConfigured && user?.id ? await createClientRecordFromClient(user.id, client) : client;
      saveClients([finalClient, ...clients]);
      setSelectedClientId(finalClient.id);
      setTab("clients");
      if (isSupabaseConfigured && user?.id) {
        if (finalClient.weeklyPlan && Object.keys(finalClient.weeklyPlan).length) await replaceWeeklyPlanRecord(user.id, finalClient.id, finalClient.weeklyPlan);
        await supabase.from("applications").update({ status: "Добавлена в клиенты" }).eq("id", application.id);
        setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status: "Добавлена в клиенты" } : item));
        loadApplications();
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : typeof error === "object" && error ? JSON.stringify(error) : String(error);
      setSyncStatus(`Не удалось добавить заявку в клиенты: ${details}`);
    }
  };

  const enablePush = async () => {
    try {
      await enablePushNotifications(user?.id);
      setPushStatus("Push-уведомления включены для этого устройства");
    } catch (error) {
      setPushStatus(getErrorMessage(error, "Не удалось включить push-уведомления"));
    }
  };

  const markMessageRead = async (messageId: string) => {
    const next = messages.filter((message) => message.id !== messageId);
    updateMessages(next);
    setMessages(next);
    try {
      if (isSupabaseConfigured) {
        await markNotificationRead(messageId);
        const fresh = await fetchCoachNotifications();
        updateMessages(fresh);
        setMessages(fresh);
      }
    } catch (error) {
      setSyncStatus(getErrorMessage(error, "Не удалось отметить событие"));
    }
  };

  const toggleBroadcastClient = (clientId: string) => setBroadcastClientIds((current) => current.includes(clientId) ? current.filter((id) => id !== clientId) : [...current, clientId]);

  const sendBroadcastMessage = async () => {
    if (!broadcastText.trim() || !broadcastClientIds.length || !isSupabaseConfigured) return;
    setIsSendingBroadcast(true);
    setBroadcastStatus("");
    try {
      const recipients = clients.filter((c) => broadcastClientIds.includes(c.id) && c.userId);
      await Promise.all(recipients.map((client) => createNotification(client.userId!, "Сообщение от тренера", broadcastText.trim(), "/#/client")));
      await sendPushToUsers(recipients.map((client) => client.userId || "").filter(Boolean), "Сообщение от тренера", broadcastText.trim(), "/#/client");
      setBroadcastStatus(`Отправлено ${recipients.length} из ${broadcastClientIds.length} выбранных (без аккаунта в приложении сообщение не дойдёт).`);
      setBroadcastText("");
      setBroadcastClientIds([]);
    } catch (error) {
      setBroadcastStatus(getErrorMessage(error, "Не удалось отправить сообщение"));
    } finally {
      setIsSendingBroadcast(false);
    }
  };

  const exit = async () => { await logout(); window.location.hash = "/"; };

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-[270px_1fr]" style={{ background: "var(--bg)" }}>
      {mobileMenuOpen && <div className="fixed inset-0 z-[80] lg:hidden">
        <button className="absolute inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} aria-label="Закрыть меню" />
        <aside className="absolute left-0 top-0 h-full w-[82vw] max-w-[340px] p-5 overflow-y-auto" style={{ background: "#080c12", borderRight: "1px solid var(--line)" }}>
          <div className="flex items-center justify-between mb-8">
            <button onClick={() => { window.location.hash = "/"; setMobileMenuOpen(false); }} className="flex items-center gap-3 font-bold"><span className="logo-mark" /> ARSENIICOACH</button>
            <button onClick={() => setMobileMenuOpen(false)} className="rounded-full p-2 glass" aria-label="Закрыть меню"><X size={18} /></button>
          </div>
          <NavList groups={coachNavGroups} activeTab={tab} badges={navBadges} onSelect={(id) => { setTab(id); setMobileMenuOpen(false); }} />
          <button onClick={exit} className="w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}><LogOut size={18} /> Выйти</button>
        </aside>
      </div>}

      <aside className="hidden lg:flex lg:flex-col border-r p-5 lg:min-h-screen" style={{ borderColor: "var(--line)", background: "rgba(0,0,0,.18)" }}>
        <button onClick={() => window.location.hash = "/"} className="flex items-center gap-3 font-bold mb-8"><span className="logo-mark" /> ARSENIICOACH</button>
        <NavList groups={coachNavGroups} activeTab={tab} badges={navBadges} onSelect={setTab} />
        <button onClick={exit} className="w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}><LogOut size={18} /> Выйти</button>
      </aside>

      <nav className="tabbar-glass lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch pb-[env(safe-area-inset-bottom)]">
        {coachNavItems.filter((item) => coachMobilePrimaryIds.includes(item.id)).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] relative">
            {tab === id && <span className="tabbar-glass-pill" />}
            <span className="relative">
              <Icon size={20} strokeWidth={tab === id ? 2.4 : 1.8} color={tab === id ? "var(--accent)" : "var(--ink-3)"} />
              {id === "messages" && messages.length > 0 && <span className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full" style={{ background: "#ff8a98" }} />}
            </span>
            <span className="relative" style={{ color: tab === id ? "var(--accent)" : "var(--ink-3)" }}>{label}</span>
          </button>
        ))}
        <button onClick={() => setMobileMenuOpen(true)} className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px]">
          <MoreHorizontal size={20} strokeWidth={1.8} color="var(--ink-3)" />
          <span style={{ color: "var(--ink-3)" }}>Ещё</span>
        </button>
      </nav>

      <section className="p-4 pt-6 pb-28 md:p-8 lg:pt-8 lg:pb-8 relative overflow-hidden">
        <div className="grid-overlay fixed inset-0 opacity-30 pointer-events-none" />
        <header className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div><div className="eyebrow">Кабинет тренера</div><h1 className="mt-2 text-3xl md:text-4xl font-extrabold tracking-[-.02em]">Привет, {user?.name || "Арсений"}</h1><p className="mt-1" style={{ color: "var(--ink-2)" }}>Telegram: {user?.telegram || "@president_h"}</p></div>
          <div className="flex gap-3 flex-wrap"><button onClick={addClient} className="btn btn-primary btn-lg"><Users size={17} /> Добавить клиента</button><button onClick={addWorkout} className="btn btn-secondary btn-lg glass"><Dumbbell size={17} /> Создать план</button><button onClick={() => setTab("messages")} className="btn btn-secondary btn-lg glass"><Send size={17} /> Написать клиентам</button></div>
        </header>

        {syncStatus && <div className="relative z-10 mb-4 app-card rounded-2xl p-4 text-sm" style={{ color: syncStatus.endsWith("...") || syncStatus === "План назначен выбранным клиентам" ? "var(--ink-2)" : "#ff8a98" }}>{syncStatus}</div>}

        {tab === "overview" && <div className="relative z-10 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><Metric title="Клиентов" value={clients.length} /><Metric title="Планов" value={workouts.length} /><Metric title="Средний прогресс" ring={average} /><Metric title="Нужно ответить" value={messages.length} onClick={() => setTab("messages")} hint="Открыть" /></div>
          {clients.some(needsPlanAttention) && <AlertBanner level="warning" title="План не продлевается сам" action={<button onClick={() => setTab("clients")} className="btn btn-secondary btn-sm glass mt-3">Открыть клиентов</button>}>У этих клиентов план уже закончился или заканчивается со дня на день: {clients.filter(needsPlanAttention).map((c) => c.name).join(", ")}.</AlertBanner>}
          {clients.some(needsActivityAttention) && <AlertBanner level="danger" title="Давно не отмечались" action={<button onClick={() => setTab("clients")} className="btn btn-secondary btn-sm glass mt-3">Открыть клиентов</button>}>{`${INACTIVITY_DAYS_THRESHOLD}+ дней без отметки тренировки: `}{clients.filter(needsActivityAttention).map((c) => c.name).join(", ")}.</AlertBanner>}
          {clients.some(needsPaymentAttention) && <AlertBanner level="warning" title="Пора напомнить об оплате" action={<button onClick={() => setTab("clients")} className="btn btn-secondary btn-sm glass mt-3">Открыть клиентов</button>}>Оплата уже просрочена или подходит в ближайшие 2 дня: {clients.filter(needsPaymentAttention).map((c) => c.name).join(", ")}.</AlertBanner>}
          <Panel title="Активность клиентов" subtitle="отметки тренировок по неделям, все клиенты вместе"><WeeklyActivityChart buckets={weeklyActivity} /></Panel>
          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_.85fr] gap-5"><Panel title="Клиенты" subtitle="статусы и назначенные планы"><ClientList clients={clients} workouts={workouts} onSelect={(id) => { setSelectedClientId(id); setTab("clients"); }} /></Panel><Panel title="Уведомления" subtitle="из кабинета клиентов"><MessageList messages={messages} onOpenClients={() => setTab("clients")} onMarkRead={markMessageRead} /></Panel></div>
        </div>}

        {tab === "calendar" && <Panel title="Календарь тренировок" subtitle="недельный план каждого клиента, спроецированный на даты"><CalendarView entriesByDate={calendarEntries} loading={calendarLoading} onMonthChange={loadCalendarMonth} renderDay={(date, entries) => <CoachCalendarDay date={date} entries={entries} onOpenClient={(clientId) => { setSelectedClientId(clientId); setTab("clients"); }} />} /></Panel>}

        {tab === "applications" && <Panel title="Заявки с главной страницы" subtitle="анкеты, которые заполнили посетители сайта"><div className="flex justify-end mb-4"><button onClick={loadApplications} className="btn btn-secondary btn-md glass">Обновить заявки</button></div>{applicationsStatus && <p className="mb-4" style={{ color: "var(--ink-2)" }}>{applicationsStatus}</p>}<ApplicationsList applications={applications} clients={clients} onCreateClient={createClientFromApplication} onDeleteApplication={deleteApplication} /></Panel>}

        {tab === "clients" && !selectedClient && <Panel title="Клиенты" subtitle="список пока пуст"><p style={{ color: "var(--ink-2)" }}>Клиентов пока нет. Нажмите «Добавить клиента», чтобы создать первого.</p></Panel>}
        {tab === "clients" && selectedClient && <Panel title="Редактирование клиента" subtitle="можно менять всё: контакты, цель, питание, тренировку, прогресс"><div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-5"><div id="client-list"><SearchInput value={clientSearch} onChange={setClientSearch} placeholder="Поиск по имени или Telegram" /><button type="button" onClick={exportClientsCsv} className="btn btn-secondary btn-sm glass mt-3"><Download size={14} /> Экспорт в CSV</button>{Boolean(clientTags.length) && <div className="flex flex-wrap gap-2 mt-3"><button type="button" onClick={() => setClientTagFilter("")} className={clientTagFilter === "" ? "badge badge-accent" : "btn btn-secondary btn-sm glass"}>Все</button>{clientTags.map((tag) => <button key={tag} type="button" onClick={() => setClientTagFilter(tag)} className={clientTagFilter === tag ? "badge badge-accent" : "btn btn-secondary btn-sm glass"}>{tag}</button>)}</div>}<div className="space-y-3 mt-3">{filteredClients.map(c => <button key={c.id} onClick={() => { setSelectedClientId(c.id); document.getElementById("client-editor")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} className="w-full text-left app-card rounded-2xl p-4 transition hover:bg-white/[.04]" style={{ borderColor: selectedClient.id === c.id ? "rgba(52,231,166,.45)" : needsPaymentAttention(c) ? alertColors.warning.border : "var(--line)", background: needsPaymentAttention(c) ? alertColors.warning.bg : undefined }}><div className="flex flex-wrap items-center gap-2"><b>{c.name}</b>{c.tag && <span className="badge badge-accent"><Tag size={11} /> {c.tag}</span>}{needsPaymentAttention(c) && <span className="badge" style={{ background: alertColors.warning.bg, color: alertColors.warning.text, border: `1px solid ${alertColors.warning.border}` }}>Оплата</span>}</div><p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{c.telegram} • {c.progress}%</p></button>)}{!filteredClients.length && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Ничего не найдено.</p>}</div></div><div id="client-editor"><ClientEditor key={selectedClient.id} client={selectedClient} allClients={clients} onSwitchClient={setSelectedClientId} workouts={workouts} strengthRecords={selectedClientStrength} coachId={user?.id || ""} onChange={updateClient} onDelete={deleteClient} /></div></div></Panel>}

        {tab === "workouts" && !selectedWorkout && <Panel title="Планы тренировок" subtitle="список пока пуст"><p style={{ color: "var(--ink-2)" }}>Планов пока нет. Нажмите «Создать план», чтобы добавить первый план тренировок.</p></Panel>}
        {tab === "workouts" && selectedWorkout && <Panel title="Конструктор планов тренировок" subtitle="создавай и редактируй программы, потом назначай клиентам"><div className="grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-5"><div id="workout-list"><SearchInput value={workoutSearch} onChange={setWorkoutSearch} placeholder="Поиск по названию плана" /><div className="flex flex-wrap gap-2 mt-3"><button type="button" onClick={() => setWorkoutTemplateFilter(false)} className={!workoutTemplateFilter ? "badge badge-accent" : "btn btn-secondary btn-sm glass"}>Все</button><button type="button" onClick={() => setWorkoutTemplateFilter(true)} className={workoutTemplateFilter ? "badge badge-accent" : "btn btn-secondary btn-sm glass"}>Только шаблоны</button></div><div className="space-y-3 mt-3">{filteredWorkouts.map(w => <button key={w.id} onClick={() => { setSelectedWorkoutId(w.id); document.getElementById("workout-editor")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} className="w-full text-left app-card rounded-2xl p-4 transition hover:bg-white/[.04]" style={{ borderColor: selectedWorkout.id === w.id ? "rgba(52,231,166,.45)" : "var(--line)" }}><div className="flex flex-wrap items-center gap-2"><b>{w.title}</b>{w.isTemplate && <span className="badge badge-accent">Шаблон</span>}</div><p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{w.weeklyTemplate ? `${Object.keys(w.weeklyTemplate).length} трен. дней` : `${w.day} • ${w.exercises.length} упражнений`}</p></button>)}{!filteredWorkouts.length && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Ничего не найдено.</p>}</div></div><div id="workout-editor"><WorkoutEditor key={selectedWorkout.id} workout={selectedWorkout} allWorkouts={workouts} onSwitchWorkout={setSelectedWorkoutId} clients={clients} coachId={user?.id || ""} onChange={updateWorkout} onDelete={deleteWorkout} onDuplicate={duplicateWorkout} onBulkAssign={assignWorkoutToClients} /></div></div></Panel>}

        {tab === "messages" && <Panel title="Сообщения и Telegram" subtitle="уведомления и контакты клиентов"><MessageList messages={messages} onOpenClients={() => setTab("clients")} onMarkRead={markMessageRead} /><BroadcastComposer clients={clients} text={broadcastText} onTextChange={setBroadcastText} selectedIds={broadcastClientIds} onToggleClient={toggleBroadcastClient} onSend={sendBroadcastMessage} status={broadcastStatus} isSending={isSendingBroadcast} /><div className="mt-5 app-card rounded-2xl p-5"><h3 className="text-xl font-bold">Telegram интеграция</h3><p className="mt-2" style={{ color: "var(--ink-2)" }}>В продакшене сюда можно подключить Telegram Bot API, чтобы заявки и уведомления приходили в Telegram @president_h.</p></div></Panel>}
        {tab === "settings" && <Panel title="Редактирование главной страницы" subtitle="текст, кнопка и фото на лендинге"><div className="app-card rounded-2xl p-5 mb-5"><h3 className="text-xl font-bold">Push-уведомления тренера</h3><p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>Включи на этом устройстве, чтобы получать уведомления о действиях клиентов. На iPhone сайт должен быть открыт как веб-приложение с экрана «Домой».</p><button onClick={enablePush} className="btn btn-primary btn-md mt-4">Включить уведомления тренеру</button>{pushStatus && <p className="mt-3 text-sm" style={{ color: pushStatus.includes("включ") ? "var(--accent)" : "#ff8a98" }}>{pushStatus}</p>}</div><SiteEditor settings={siteSettingsState} onChange={(next) => { updateSiteSettingsState(next); setSiteSettings(next); if (isSupabaseConfigured) saveSiteSettingsDb(next).catch((error) => setSyncStatus(getErrorMessage(error, "Не удалось сохранить главную"))); }} /></Panel>}
      </section>
    </main>
  );
};

const CoachCalendarDay = ({ date, entries, onOpenClient }: { date: string; entries: CalendarWorkoutEntry[]; onOpenClient: (clientId: string) => void }) => {
  if (!entries.length) return <p style={{ color: "var(--ink-2)" }}>На {new Date(date).toLocaleDateString("ru-RU")} ни у кого тренировка не запланирована.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm mb-1" style={{ color: "var(--ink-3)" }}>{new Date(date).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" })}</p>
      {entries.map((entry) => (
        <button key={`${entry.clientId}-${entry.workoutId}`} onClick={() => onOpenClient(entry.clientId)} className="w-full text-left app-card rounded-2xl p-3 flex items-center justify-between gap-3 transition hover:bg-white/[.04]">
          <div>
            <b>{entry.clientName}</b>
            <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>{entry.title} • {entry.exerciseCount} упражнений</p>
          </div>
          <span className={`badge shrink-0 ${entry.completed ? "badge-accent" : "badge-neutral"}`}>
            {entry.completed ? "Выполнено" : "Запланировано"}
          </span>
        </button>
      ))}
    </div>
  );
};

const NavList = ({ groups, activeTab, badges, onSelect }: { groups: NavGroup[]; activeTab: string; badges: Record<string, number>; onSelect: (id: string) => void }) => (
  <div>
    {groups.map((group) => (
      <div key={group.label} className="mb-4 last:mb-0">
        <p className="px-4 mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>{group.label}</p>
        {group.items.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => onSelect(id)} aria-current={activeTab === id ? "page" : undefined} className="w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 mb-2 transition-colors" style={{ background: activeTab === id ? "rgba(52,231,166,.14)" : "transparent", color: activeTab === id ? "var(--ink)" : "var(--ink-3)", border: activeTab === id ? "1px solid rgba(52,231,166,.28)" : "1px solid transparent" }}>
            <Icon size={18} strokeWidth={activeTab === id ? 2.4 : 1.8} />
            <span className="flex-1">{label}</span>
            {Boolean(badges[id]) && <span className="rounded-full px-2 py-0.5 text-xs font-semibold shrink-0" style={{ background: "rgba(255,138,152,.18)", color: "#ff8a98" }}>{badges[id]}</span>}
          </button>
        ))}
      </div>
    ))}
  </div>
);

const Metric = ({ title, value, ring, onClick, hint }: { title: string; value?: string | number; ring?: number; onClick?: () => void; hint?: string }) => {
  const content = <>
    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>{title}</p>
    {ring !== undefined ? <div className="mt-3 flex items-center"><ProgressRing percent={ring} size={56} strokeWidth={5} /></div> : <b className="text-[2.1rem] leading-none mt-3 block tracking-tight">{value}</b>}
    {hint && <span className="text-xs mt-3 inline-flex items-center gap-1 font-semibold" style={{ color: "var(--accent)" }}>{hint} →</span>}
  </>;
  if (onClick) return <HoloCard className="stat-tile glass rounded-3xl"><button onClick={onClick} className="w-full h-full text-left p-5">{content}</button></HoloCard>;
  return <HoloCard className="stat-tile glass rounded-3xl p-5">{content}</HoloCard>;
};
const Panel = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => <section className="relative z-10 glass rounded-[1.75rem] p-5 md:p-7"><div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-6"><h2 className="text-2xl md:text-[1.75rem] font-bold tracking-[-.02em]">{title}</h2><span className="text-sm" style={{ color: "var(--ink-3)" }}>{subtitle}</span></div>{children}</section>;
const ClientList = ({ clients, workouts, onSelect }: { clients: Client[]; workouts: Workout[]; onSelect: (id: string) => void }) => <div className="space-y-3">{clients.map(c => <button key={c.id} onClick={() => onSelect(c.id)} className="w-full text-left app-card rounded-2xl p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 transition hover:border-[rgba(52,231,166,.3)] hover:bg-white/[.04]" style={needsPaymentAttention(c) ? { borderColor: alertColors.warning.border, background: alertColors.warning.bg } : undefined}><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-lg">{c.name}</h3>{c.tag && <span className="badge badge-accent"><Tag size={11} /> {c.tag}</span>}{needsPaymentAttention(c) && <span className="badge" style={{ background: alertColors.warning.bg, color: alertColors.warning.text, border: `1px solid ${alertColors.warning.border}` }}>Оплата</span>}</div><p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>{workouts.find(w => w.id === c.assignedWorkoutId)?.title || c.plan} • {c.telegram}</p>{needsPlanAttention(c) && <AlertLine level="warning">План закончился или заканчивается — нужно продлить</AlertLine>}{needsActivityAttention(c) && <AlertLine level="danger">{c.lastActivityDate ? `Не отмечался с ${c.lastActivityDate}` : "Ни разу не отмечался"}</AlertLine>}{needsPaymentAttention(c) && <AlertLine level="warning">Оплата {daysUntilIso(c.nextPaymentDate!) < 0 ? "просрочена" : daysUntilIso(c.nextPaymentDate!) === 0 ? "сегодня" : `через ${daysUntilIso(c.nextPaymentDate!)} дн.`}</AlertLine>}</div><div className="text-left md:text-right"><span className={`badge ${c.status === "Пропуск" ? "badge-danger" : "badge-accent"}`}>{c.status}</span><p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>Прогресс {c.progress}%</p></div></button>)}</div>;
const SearchInput = ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) => (
  <label className="relative block">
    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-3)" }} />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="field-input mt-0 pl-10" style={{ fontSize: "16px" }} />
  </label>
);
const WeeklyActivityChart = ({ buckets }: { buckets: WeeklyActivityBucket[] }) => {
  if (!buckets.length) return <p style={{ color: "var(--ink-2)" }}>Пока нет данных — появятся, как только клиенты начнут отмечать тренировки.</p>;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const thisWeek = buckets[buckets.length - 1]?.count ?? 0;
  const lastWeek = buckets[buckets.length - 2]?.count;
  const trend = lastWeek === undefined ? null : thisWeek - lastWeek;
  return (
    <div>
      {trend !== null && (
        <p className="text-sm mb-4 font-semibold" style={{ color: trend > 0 ? "var(--accent)" : trend < 0 ? "#ff8a98" : "var(--ink-3)" }}>
          {trend === 0 ? "Как на прошлой неделе" : `${trend > 0 ? "↑" : "↓"} ${Math.abs(trend)} к прошлой неделе`}
        </p>
      )}
      {/* Раньше это была grid-cols-4 sm:grid-cols-8: на узких экранах 8 колонок
          переносились в 2 ряда с общей высотой 160px на оба — грид делил её
          неровно (не 50/50), и бары последних, самых важных недель заметно
          сжимались относительно первых. Один ряд с горизонтальным скроллом
          держит одинаковый масштаб для всех недель на любой ширине экрана. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex gap-3 items-end" style={{ height: 160, minWidth: 8 * 64 }}>
          {buckets.map((bucket) => (
            <div key={bucket.weekStart} className="flex flex-col items-center gap-2 h-full justify-end flex-1" style={{ minWidth: 56 }}>
              <span className="text-sm font-semibold">{bucket.count}</span>
              <div className="w-full rounded-t-lg" style={{ height: `${Math.max(4, (bucket.count / max) * 100)}px`, background: "linear-gradient(180deg,var(--accent),var(--secondary-accent))" }} />
              <span className="text-[11px] whitespace-nowrap" style={{ color: "var(--ink-3)" }}>{bucket.weekStart.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
const BroadcastComposer = ({ clients, text, onTextChange, selectedIds, onToggleClient, onSend, status, isSending }: { clients: Client[]; text: string; onTextChange: (value: string) => void; selectedIds: string[]; onToggleClient: (id: string) => void; onSend: () => void; status: string; isSending: boolean }) => (
  <div className="mt-5 app-card rounded-2xl p-5">
    <h3 className="text-xl font-bold">Написать клиентам</h3>
    <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-2)" }}>Сообщение придёт клиенту в кабинет (вкладка «Связь») и как push-уведомление, если он его включил.</p>
    {!clients.length && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Клиентов пока нет.</p>}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
      {clients.map((client) => (
        <label key={client.id} className="app-card rounded-2xl p-3 flex items-center gap-3 cursor-pointer transition hover:bg-white/[.04]">
          <input type="checkbox" checked={selectedIds.includes(client.id)} onChange={() => onToggleClient(client.id)} />
          <span>{client.name}</span>
        </label>
      ))}
    </div>
    <TextArea label="Текст сообщения" value={text} onChange={onTextChange} rows={3} />
    <button type="button" disabled={!text.trim() || !selectedIds.length || isSending} onClick={onSend} className="btn btn-primary btn-md mt-4"><Send size={16} /> {isSending ? "Отправляем..." : `Отправить ${selectedIds.length ? `(${selectedIds.length})` : ""}`}</button>
    {status && <p className="mt-3 text-sm" style={{ color: "var(--accent)" }}>{status}</p>}
  </div>
);
const ApplicationsList = ({ applications, clients, onCreateClient, onDeleteApplication }: { applications: Application[]; clients: Client[]; onCreateClient: (application: Application) => void; onDeleteApplication: (application: Application) => void }) => {
  if (!applications.length) return <p style={{ color: "var(--ink-2)" }}>Заявок пока нет.</p>;

  return (
    <div className="space-y-4">
      {applications.map((application) => {
        const isAdded = !isApplicationPending(application, clients);
        return (
        <div key={application.id} className="app-card rounded-2xl p-5">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-bold">{application.name || "Без имени"}</h3>
                <span className="badge badge-accent">{isAdded ? "Добавлена в клиенты" : "Новая"}</span>
              </div>
              <p className="mt-1" style={{ color: "var(--ink-2)" }}>{application.telegram} • {application.email}</p>
              {application.created_at && <p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>{new Date(application.created_at).toLocaleString("ru-RU")}</p>}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              {isAdded ? <span className="badge badge-accent">Уже в клиентах</span> : <button onClick={() => onCreateClient(application)} className="btn btn-primary btn-md">Добавить в клиенты</button>}
              <button onClick={() => onDeleteApplication(application)} className="btn btn-danger btn-md">Удалить заявку</button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5 text-sm" style={{ color: "var(--ink-2)" }}>
            <p><b style={{ color: "var(--ink)" }}>Цель:</b> {application.goal || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Опыт:</b> {application.duration || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Мешает:</b> {application.obstacle || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Готовность:</b> {application.commitment || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Когда старт:</b> {application.start_timeline || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Что ищет:</b> {application.looking_for || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Инвестиции:</b> {application.ready_to_invest || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Instagram:</b> {application.instagram || "—"}</p>
          </div>
        </div>
        );
      })}
    </div>
  );
};

const MessageList = ({ messages, onOpenClients, onMarkRead }: { messages: Message[]; onOpenClients?: () => void; onMarkRead?: (id: string) => void }) => (
  <div className="space-y-3">
    <div className="app-card rounded-2xl p-4">
      <b>Как с этим работать</b>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>Это не чат, а список событий: заявка, выполненная тренировка или действие клиента. Чтобы ответить, открой клиента и напиши ему в Telegram, либо поменяй план/комментарий в карточке клиента.</p>
      {onOpenClients && <button onClick={onOpenClients} className="btn btn-primary btn-sm mt-3">Открыть клиентов</button>}
    </div>
    {!messages.length && <p style={{ color: "var(--ink-2)" }}>Новых событий пока нет.</p>}
    {messages.map(m => <div key={m.id} className="app-card rounded-2xl p-4">
      <b>{m.from}</b>
      <p className="mt-1" style={{ color: "var(--ink-2)" }}>{m.text}</p>
      <span className="text-xs" style={{ color: "var(--ink-3)" }}>{m.time}</span>
      <div className="mt-3 flex gap-2 flex-wrap">
        {onOpenClients && <button onClick={onOpenClients} className="btn btn-secondary btn-sm glass">Открыть клиента</button>}
        {onMarkRead && <button onClick={() => onMarkRead(m.id)} className="btn btn-secondary btn-sm glass">Прочитано</button>}
      </div>
    </div>)}
  </div>
);

const Field = ({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) => <label className="field-label">{label}<input value={value} type={type} onChange={(e) => onChange(e.target.value)} className="field-input" style={{ fontSize: "16px" }} /></label>;
const TextArea = ({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) => <label className="field-label">{label}<textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className="field-input resize-none" /></label>;

const ClientEditor = ({ client, allClients, onSwitchClient, workouts, strengthRecords, coachId, onChange, onDelete }: { client: Client; allClients: Client[]; onSwitchClient: (id: string) => void; workouts: Workout[]; strengthRecords: StrengthRecord[]; coachId: string; onChange: (patch: Partial<Client>) => void; onDelete: () => void }) => {
  const [clientPassword, setClientPassword] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [showClientPassword, setShowClientPassword] = useState(false);
  const [currentPeriod, setCurrentPeriod] = useState<PlanPeriod | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [newPlanWorkoutId, setNewPlanWorkoutId] = useState(workouts[0]?.id || "");
  const [newPlanStartDate, setNewPlanStartDate] = useState(toISODate(new Date()));
  const [week2Mode, setWeek2Mode] = useState<"none" | "same" | "different">("none");
  const [week2WorkoutId, setWeek2WorkoutId] = useState(workouts[0]?.id || "");
  const [planActionStatus, setPlanActionStatus] = useState("");
  const [isSavingPeriod, setIsSavingPeriod] = useState(false);
  const [editorTab, setEditorTab] = useState<"profile" | "plan" | "timeline" | "progress">("profile");

  const buildPassword = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  };

  const passwordStorageKey = (clientId: string) => `arseniiCoachTempPassword:${clientId}`;

  useEffect(() => {
    let cancelled = false;
    setPeriodLoading(true);
    fetchCurrentPlanPeriod(client.id)
      .then((period) => { if (!cancelled) setCurrentPeriod(period); })
      .catch(() => { if (!cancelled) setCurrentPeriod(null); })
      .finally(() => { if (!cancelled) setPeriodLoading(false); });
    return () => { cancelled = true; };
  }, [client.id]);

  useEffect(() => {
    const savedPassword = sessionStorage.getItem(passwordStorageKey(client.id)) || "";
    if (savedPassword) {
      setClientPassword(savedPassword);
      setShowClientPassword(false);
      setAccountStatus("Пароль сохранён временно в этой вкладке. Нажми «Показать», скопируй его и отправь клиенту.");
      return;
    }

    if (!client.userId) {
      const password = buildPassword();
      sessionStorage.setItem(passwordStorageKey(client.id), password);
      setClientPassword(password);
      setShowClientPassword(false);
      setAccountStatus("Пароль сгенерирован автоматически. Нажми «Показать», затем создай аккаунт и отправь пароль клиенту.");
    } else {
      setClientPassword("");
      setShowClientPassword(false);
      setAccountStatus("Клиентский аккаунт уже привязан. Если пароль не сохранился на экране, сгенерируй новый и нажми «Обновить пароль».");
    }
  }, [client.id]);

  const handleCreatePeriod = async () => {
    setPlanActionStatus("");
    if (!newPlanWorkoutId) { setPlanActionStatus("Выбери тренировку для плана"); return; }
    if (week2Mode === "different" && !week2WorkoutId) { setPlanActionStatus("Выбери тренировку для второй недели"); return; }
    setIsSavingPeriod(true);
    try {
      const period = await createPlanPeriod(client.id, newPlanWorkoutId, newPlanStartDate);
      let status = `Неделя 1 (${period.startDate} – ${period.endDate}): ${workouts.find((w) => w.id === newPlanWorkoutId)?.title || ""}`;
      if (week2Mode !== "none") {
        const week2WorkoutIdToUse = week2Mode === "same" ? newPlanWorkoutId : week2WorkoutId;
        const nextPeriod = await createPlanPeriod(client.id, week2WorkoutIdToUse, addDaysToISO(period.endDate, 1));
        status += `. Неделя 2 (${nextPeriod.startDate} – ${nextPeriod.endDate}): ${workouts.find((w) => w.id === week2WorkoutIdToUse)?.title || ""}`;
      }
      setPlanActionStatus(status);
      setCurrentPeriod(await fetchCurrentPlanPeriod(client.id));
    } catch (error) {
      setPlanActionStatus(getErrorMessage(error, "Не удалось создать план"));
    } finally {
      setIsSavingPeriod(false);
    }
  };

  const handleExtendPeriod = async () => {
    if (!currentPeriod) return;
    setPlanActionStatus("");
    setIsSavingPeriod(true);
    try {
      const period = await extendClientPlan(client.id, currentPeriod.workoutId);
      setPlanActionStatus(`План продлён: следующий период ${period.startDate} – ${period.endDate}`);
      setCurrentPeriod(await fetchCurrentPlanPeriod(client.id));
    } catch (error) {
      setPlanActionStatus(getErrorMessage(error, "Не удалось продлить план"));
    } finally {
      setIsSavingPeriod(false);
    }
  };

  const generatePassword = () => {
    const password = buildPassword();
    sessionStorage.setItem(passwordStorageKey(client.id), password);
    setClientPassword(password);
    setShowClientPassword(false);
    setAccountStatus("Новый пароль сгенерирован. Нажми «Показать», скопируй его и отправь клиенту.");
  };

  const createAccount = async () => {
    setAccountStatus("");
    if (!client.email) {
      setAccountStatus("Сначала укажи email клиента");
      return;
    }
    if (clientPassword.length < 8) {
      setAccountStatus("Пароль должен быть минимум 8 символов");
      return;
    }

    setIsCreatingAccount(true);
    try {
      const created = await createClientAccount({
        email: client.email,
        password: clientPassword,
        name: client.name,
        telegram: client.telegram,
        userId: client.userId,
      });
      sessionStorage.setItem(passwordStorageKey(client.id), clientPassword);
      onChange({ userId: created.userId });
      setShowClientPassword(false);
      setAccountStatus(client.userId ? "Пароль клиента обновлён. Нажми «Показать», скопируй новый пароль и отправь клиенту." : "Аккаунт клиента создан. Пароль сохранён в этой вкладке. Нажми «Показать», скопируй его и отправь клиенту.");
    } catch (error) {
      setAccountStatus(getErrorMessage(error, "Не удалось создать аккаунт клиента"));
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const editorTabs = [
    { id: "profile" as const, label: "Профиль" },
    { id: "plan" as const, label: "План" },
    { id: "timeline" as const, label: "Лента" },
    { id: "progress" as const, label: "Прогресс" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button type="button" onClick={() => document.getElementById("client-list")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="btn btn-secondary btn-sm glass lg:hidden self-start"><ArrowLeft size={14} /> К списку клиентов</button>
        <label className="flex items-center gap-2 text-sm sm:ml-auto" style={{ color: "var(--ink-3)" }}>
          Клиент
          <select value={client.id} onChange={(event) => onSwitchClient(event.target.value)} className="field-input mt-0 w-auto">
            {allClients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2 pb-3 border-b" style={{ borderColor: "var(--line)" }}>
        {editorTabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setEditorTab(t.id)} className={editorTab === t.id ? "badge badge-accent" : "btn btn-secondary btn-sm glass"}>{t.label}</button>
        ))}
      </div>

      {editorTab === "profile" && <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Имя" value={client.name} onChange={(name) => onChange({ name })} />
          <Field label="Telegram" value={client.telegram} onChange={(telegram) => onChange({ telegram })} />
          <Field label="Email" value={client.email} onChange={(email) => onChange({ email })} />
          <Field label="Статус" value={client.status} onChange={(status) => onChange({ status })} />
          <Field label="Прогресс, %" type="number" value={client.progress} onChange={(progress) => onChange({ progress: Math.max(0, Math.min(100, Number(progress) || 0)) })} />
          <Field label="Следующая тренировка" value={client.nextWorkout} onChange={(nextWorkout) => onChange({ nextWorkout })} />
          <Field label="Метка (VIP, Новый, На паузе...)" value={client.tag || ""} onChange={(tag) => onChange({ tag: tag || undefined })} />
          <Field label="Дата следующей оплаты" type="date" value={client.nextPaymentDate || ""} onChange={(nextPaymentDate) => onChange({ nextPaymentDate: nextPaymentDate || undefined })} />
        </div>

        <div className="app-card rounded-2xl p-4">
          <h3 className="text-xl font-bold">Аккаунт клиента</h3>
          <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>
            Пароль не сохраняется в коде сайта и не записывается в базу clients. Он передаётся в Supabase Auth через защищённую серверную функцию.
          </p>
          <div className="grid grid-cols-1 gap-3">
            <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
              Временный пароль клиента
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                <input value={clientPassword} type={showClientPassword ? "text" : "password"} readOnly className="field-input mt-0 cursor-default" />
                <div className="grid grid-cols-2 sm:contents gap-2">
                  <button type="button" onClick={() => setShowClientPassword((value) => !value)} className="btn btn-secondary btn-md glass">{showClientPassword ? "Скрыть" : "Показать"}</button>
                  <button type="button" onClick={generatePassword} className="btn btn-secondary btn-md glass">Сгенерировать</button>
                </div>
              </div>
            </label>
            <button disabled={isCreatingAccount || !clientPassword} onClick={createAccount} className="btn btn-primary btn-md">
              {client.userId ? (isCreatingAccount ? "Обновляю..." : "Обновить пароль") : (isCreatingAccount ? "Создаю..." : "Создать аккаунт")}
            </button>
          </div>
          {client.userId && <p className="text-sm mt-3" style={{ color: "var(--accent)" }}>Клиентский аккаунт привязан. Пароль можно в любой момент сгенерировать заново и обновить.</p>}
          {accountStatus && <p className="text-sm mt-3" style={{ color: ["создан", "сгенерирован", "обновлён", "привязан", "Скопируй"].some((word) => accountStatus.includes(word)) ? "var(--accent)" : "#ff8a98" }}>{accountStatus}</p>}
        </div>

        <TextArea label="Цель клиента" value={client.goal} onChange={(goal) => onChange({ goal })} />
        <TextArea label="Питание / рекомендации" value={client.nutrition} onChange={(nutrition) => onChange({ nutrition })} />
        <TextArea label="Комментарий тренера" value={client.comment} onChange={(comment) => onChange({ comment })} />
        <button onClick={onDelete} className="btn btn-danger btn-md"><Trash2 size={16} /> Удалить клиента</button>
      </>}

      {editorTab === "plan" && <div className="app-card rounded-2xl p-4">
        <h3 className="text-xl font-bold">Активный план</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>Каждый период действует ровно 7 дней. По окончании недели календарь и вкладка «Сегодня» у клиента автоматически перестают его показывать.</p>

        {periodLoading ? (
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>Загружаем текущий план...</p>
        ) : currentPeriod ? (
          <div className="rounded-2xl p-4 mb-4" style={{ background: "rgba(52,231,166,.08)", border: "1px solid rgba(52,231,166,.22)" }}>
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>Сейчас активен план</p>
            <b className="text-lg block mt-1">{workouts.find((w) => w.id === currentPeriod.workoutId)?.title || "Тренировка"}</b>
            <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{currentPeriod.startDate} – {currentPeriod.endDate}</p>
            {(() => {
              const daysLeft = Math.round((new Date(currentPeriod.endDate + "T00:00:00").getTime() - new Date(toISODate(new Date()) + "T00:00:00").getTime()) / 86400000);
              if (daysLeft > 1) return null;
              return <div className="mt-2"><AlertLine level="warning">{daysLeft <= 0 ? "План заканчивается сегодня — план на следующую неделю сам не назначится." : "План заканчивается завтра — не забудь продлить или назначить новый."}</AlertLine></div>;
            })()}
            <button type="button" onClick={handleExtendPeriod} disabled={isSavingPeriod} className="btn btn-primary btn-sm mt-3">
              {isSavingPeriod ? "Продлеваем..." : "Продлить ещё на 7 дней"}
            </button>
          </div>
        ) : (
          <div className="mb-4"><AlertLine level="danger">{client.status === "Активен" ? "У активного клиента сейчас нет плана на эту неделю — назначь новый ниже." : "На сегодня у клиента нет активного плана."}</AlertLine></div>
        )}

        <p className="text-sm font-semibold mb-2" style={{ color: "var(--ink-2)" }}>Назначить новый план</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
            Тренировка, неделя 1
            <select value={newPlanWorkoutId} onChange={(e) => setNewPlanWorkoutId(e.target.value)} className="field-input">
              {workouts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
          </label>
          <Field label="Дата начала недели 1" type="date" value={newPlanStartDate} onChange={setNewPlanStartDate} />
        </div>
        <label className="block text-sm mt-4" style={{ color: "var(--ink-3)" }}>
          Неделя 2
          <select value={week2Mode} onChange={(e) => setWeek2Mode(e.target.value as typeof week2Mode)} className="field-input">
            <option value="none">Не назначать</option>
            <option value="same">Тот же план, что на неделе 1</option>
            <option value="different">Другой план</option>
          </select>
        </label>
        {week2Mode === "different" && (
          <label className="block text-sm mt-3" style={{ color: "var(--ink-3)" }}>
            Тренировка, неделя 2
            <select value={week2WorkoutId} onChange={(e) => setWeek2WorkoutId(e.target.value)} className="field-input">
              {workouts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={handleCreatePeriod} disabled={isSavingPeriod} className="btn btn-primary btn-md mt-4">
          {isSavingPeriod ? "Создаём..." : week2Mode === "none" ? "Назначить план" : "Назначить план на 2 недели"}
        </button>
        {planActionStatus && <p className="text-sm mt-3" style={{ color: "var(--accent)" }}>{planActionStatus}</p>}
      </div>}

      {editorTab === "timeline" && <ClientTimeline clientId={client.id} coachId={coachId} strengthRecords={strengthRecords} />}

      {editorTab === "progress" && <>
        <CoachStrengthProgress records={strengthRecords} />
        <CoachBodyWeightView clientId={client.id} />
      </>}
    </div>
  );
};


type TimelineEvent = { id: string; date: string; kind: "note" | "completion" | "weight" | "strength"; label: string; detail?: string; onRemove?: () => void };

const timelineIcon = (kind: TimelineEvent["kind"]) => {
  if (kind === "note") return <StickyNote size={15} />;
  if (kind === "completion") return <CheckCircle2 size={15} />;
  if (kind === "weight") return <Scale size={15} />;
  return <TrendingUp size={15} />;
};

// Единая лента: заметки тренера, отметки тренировок, вес тела и силовые
// рекорды клиента на одной хронологической шкале, вместо разбросанных по
// вкладкам блоков. Заметки тут же и добавляются/удаляются — своей истории
// у ленты нет, поэтому отдельного экрана «Заметки» больше не нужно.
const ClientTimeline = ({ clientId, coachId, strengthRecords }: { clientId: string; coachId: string; strengthRecords: StrengthRecord[] }) => {
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [completions, setCompletions] = useState<CompletionHistoryItem[]>([]);
  const [weights, setWeights] = useState<BodyWeightRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!isSupabaseConfigured) { setLoading(false); return; }
    Promise.all([
      fetchClientNotes(clientId),
      fetchCoachClientCompletionHistory(clientId),
      fetchCoachClientBodyWeightRecords(clientId),
    ]).then(([nextNotes, nextCompletions, nextWeights]) => {
      if (cancelled) return;
      setNotes(nextNotes);
      setCompletions(nextCompletions);
      setWeights(nextWeights);
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  const addNote = async () => {
    if (!noteText.trim() || !isSupabaseConfigured || !coachId) return;
    try {
      const note = await createClientNote(coachId, clientId, noteText.trim());
      setNotes((current) => [note, ...current]);
      setNoteText("");
      setStatus("");
    } catch (error) {
      setStatus(getErrorMessage(error, "Не удалось сохранить заметку"));
    }
  };

  const removeNote = async (noteId: string) => {
    try {
      await deleteClientNote(noteId);
      setNotes((current) => current.filter((note) => note.id !== noteId));
    } catch (error) {
      setStatus(getErrorMessage(error, "Не удалось удалить заметку"));
    }
  };

  const events: TimelineEvent[] = [
    ...notes.map((note): TimelineEvent => ({ id: `note-${note.id}`, date: note.createdAt.slice(0, 10), kind: "note", label: "Заметка тренера", detail: note.text, onRemove: () => removeNote(note.id) })),
    ...completions.map((item): TimelineEvent => ({ id: `wc-${item.id}`, date: item.completedDate, kind: "completion", label: `Тренировка: ${item.dayWorkoutTitle}`, detail: `${item.workoutTitle} • ${item.exerciseCount} упражнений` })),
    ...weights.map((record): TimelineEvent => ({ id: `bw-${record.id}`, date: record.recordedDate, kind: "weight", label: `Вес тела: ${record.weightKg} кг` })),
    ...strengthRecords.map((record): TimelineEvent => ({ id: `sr-${record.id}`, date: record.recordedDate, kind: "strength", label: `${record.exerciseName}: ${record.maxWeight} кг`, detail: record.muscleGroup })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="app-card rounded-2xl p-4">
      <h3 className="text-xl font-bold">Лента активности</h3>
      <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>Заметки, тренировки, вес и силовые рекорды клиента на одной шкале. Заметки видны только тебе.</p>
      <TextArea label="Новая заметка" value={noteText} onChange={setNoteText} rows={2} />
      <button type="button" disabled={!noteText.trim()} onClick={addNote} className="btn btn-secondary btn-md glass mt-2">Добавить заметку</button>
      {status && <p className="text-sm mt-3" style={{ color: "#ff8a98" }}>{status}</p>}
      <div className="space-y-3 mt-5">
        {loading && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Загружаем...</p>}
        {!loading && !events.length && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Пока пусто — как только появятся заметки, тренировки или замеры, они окажутся здесь.</p>}
        {events.map((event) => (
          <div key={event.id} className="rounded-2xl p-3 flex gap-3" style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: "rgba(52,231,166,.14)", color: "var(--accent)" }}>{timelineIcon(event.kind)}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <b className="text-sm">{event.label}</b>
                <span className="text-xs shrink-0" style={{ color: "var(--ink-3)" }}>{new Date(event.date + "T00:00:00").toLocaleDateString("ru-RU")}</span>
              </div>
              {event.detail && <p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>{event.detail}</p>}
              {event.onRemove && <button type="button" onClick={event.onRemove} className="text-xs font-semibold mt-2" style={{ color: "#ff8a98" }}>Удалить</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const CoachBodyWeightView = ({ clientId }: { clientId: string }) => {
  const [records, setRecords] = useState<BodyWeightRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!isSupabaseConfigured) { setLoading(false); return; }
    fetchCoachClientBodyWeightRecords(clientId)
      .then((next) => { if (!cancelled) setRecords(next); })
      .catch(() => { if (!cancelled) setRecords([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  return (
    <div className="app-card rounded-3xl p-4">
      <h3 className="text-xl font-bold flex items-center gap-2"><Scale size={18} /> Вес тела клиента</h3>
      {loading ? <p className="text-sm mt-3" style={{ color: "var(--ink-3)" }}>Загружаем...</p> : !records.length ? <p className="text-sm mt-3" style={{ color: "var(--ink-3)" }}>Клиент пока не добавлял записи веса.</p> : (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          {records.slice().reverse().map((record) => <div key={record.id} className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,.04)" }}><b>{record.weightKg} кг</b><p className="text-sm" style={{ color: "var(--ink-2)" }}>{new Date(record.recordedDate).toLocaleDateString("ru-RU")}</p></div>)}
        </div>
      )}
    </div>
  );
};

const CoachStrengthProgress = ({ records }: { records: StrengthRecord[] }) => {
  const [groupFilter, setGroupFilter] = useState("all");
  const [exerciseFilter, setExerciseFilter] = useState("all");
  const groups = Array.from(new Set(records.map((record) => record.muscleGroup))).filter(Boolean);
  const exercises = Array.from(new Set(records.map((record) => record.exerciseName))).filter(Boolean);
  const filtered = records
    .filter((record) => groupFilter === "all" || record.muscleGroup === groupFilter)
    .filter((record) => exerciseFilter === "all" || record.exerciseName === exerciseFilter)
    .sort((a, b) => a.recordedDate.localeCompare(b.recordedDate));

  return (
    <div className="app-card rounded-3xl p-4">
      <h3 className="text-xl font-bold">Силовой прогресс клиента</h3>
      <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>Данные, которые клиент сам добавляет в своём кабинете.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Группа мышц<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="field-input"><option value="all">Все группы</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
        <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Упражнение<select value={exerciseFilter} onChange={(event) => setExerciseFilter(event.target.value)} className="field-input"><option value="all">Все упражнения</option>{exercises.map((exercise) => <option key={exercise} value={exercise}>{exercise}</option>)}</select></label>
      </div>
      <CoachStrengthChart records={filtered} />
    </div>
  );
};

const CoachStrengthChart = ({ records }: { records: StrengthRecord[] }) => {
  if (!records.length) return <p className="mt-4" style={{ color: "var(--ink-2)" }}>Клиент пока не добавлял силовые показатели.</p>;
  const width = 640;
  const height = 240;
  const padding = 34;
  const weights = records.map((record) => record.maxWeight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const range = Math.max(1, max - min);
  const points = records.map((record, index) => {
    const x = records.length === 1 ? width / 2 : padding + (index * (width - padding * 2)) / (records.length - 1);
    const y = height - padding - ((record.maxWeight - min) / range) * (height - padding * 2);
    return { x, y, record };
  });
  const diff = records[records.length - 1].maxWeight - records[0].maxWeight;
  return (
    <div className="mt-4">
      <p className="text-sm mb-3" style={{ color: diff >= 0 ? "var(--accent)" : "#ff8a98" }}>{records.length > 1 ? `Изменение: ${diff > 0 ? "+" : ""}${diff} кг` : "Нужна ещё одна запись для динамики"}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-3xl" style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }}>
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,.18)" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="rgba(255,255,255,.18)" />
        <polyline fill="none" stroke="var(--accent)" strokeWidth="4" points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
        {points.map((point) => <g key={point.record.id}><circle cx={point.x} cy={point.y} r="6" fill="var(--accent)" /><text x={point.x} y={point.y - 12} textAnchor="middle" fontSize="13" fill="white">{point.record.maxWeight} кг</text></g>)}
      </svg>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">{records.slice().reverse().map((record) => <div key={record.id} className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,.04)" }}><b>{record.exerciseName}</b><p className="text-sm" style={{ color: "var(--ink-2)" }}>{record.muscleGroup} • {record.maxWeight} кг • {new Date(record.recordedDate).toLocaleDateString("ru-RU")}</p></div>)}</div>
    </div>
  );
};

const weekDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

const exerciseMuscleGroups = ["Грудь", "Спина", "Ноги", "Плечи", "Руки", "Кор", "Другое"];

// Шаблон в библиотеке хранит только название и группу мышц — подходы и
// повторы у одного и того же упражнения отличаются от клиента к клиенту,
// поэтому их тренер вписывает вручную при каждой вставке, а не хранит
// заранее зафиксированными в шаблоне.
const ExerciseLibraryPicker = ({ library, onInsert, onAdd, onRemove }: { library: ExerciseLibraryItem[]; onInsert: (text: string) => void; onAdd: (label: string, muscleGroup: string) => void; onRemove: (id: string) => void }) => {
  const [selectedId, setSelectedId] = useState("");
  const [setsReps, setSetsReps] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newMuscleGroup, setNewMuscleGroup] = useState("");
  const [manageOpen, setManageOpen] = useState(false);

  const insert = () => {
    const item = library.find((candidate) => candidate.id === selectedId);
    if (!item) return;
    onInsert(setsReps.trim() ? `${item.label} — ${setsReps.trim()}` : item.label);
    setSelectedId("");
    setSetsReps("");
  };

  return (
    <div className="rounded-2xl p-3 mt-3 mb-1" style={{ background: "rgba(255,255,255,.03)", border: "1px solid var(--line)" }}>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs flex-1 min-w-[180px]" style={{ color: "var(--ink-3)" }}>
          Упражнение из библиотеки
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="field-input mt-1">
            <option value="">Выбрать...</option>
            {library.map((item) => <option key={item.id} value={item.id}>{item.label}{item.muscleGroup ? ` (${item.muscleGroup})` : ""}</option>)}
          </select>
        </label>
        <label className="text-xs" style={{ color: "var(--ink-3)" }}>
          Подходы×повторы
          <input value={setsReps} onChange={(event) => setSetsReps(event.target.value)} placeholder="4×8" className="field-input mt-1 w-28" />
        </label>
        <button type="button" disabled={!selectedId} onClick={insert} className="btn btn-secondary btn-sm glass">Вставить</button>
        <button type="button" onClick={() => setManageOpen((value) => !value)} className="btn btn-ghost btn-sm">{manageOpen ? "Скрыть библиотеку" : "Управлять библиотекой"}</button>
      </div>
      {manageOpen && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-2">
            <input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="Название упражнения, например: Жим лёжа" className="field-input mt-0" />
            <select value={newMuscleGroup} onChange={(event) => setNewMuscleGroup(event.target.value)} className="field-input mt-0">
              <option value="">Группа мышц</option>
              {exerciseMuscleGroups.map((group) => <option key={group} value={group}>{group}</option>)}
            </select>
            <button type="button" disabled={!newLabel.trim()} onClick={() => { onAdd(newLabel.trim(), newMuscleGroup); setNewLabel(""); setNewMuscleGroup(""); }} className="btn btn-secondary btn-sm glass">Сохранить</button>
          </div>
          {Boolean(library.length) && <div className="flex flex-wrap gap-2">
            {library.map((item) => <span key={item.id} className="badge badge-neutral flex items-center gap-2">{item.label}{item.muscleGroup ? ` · ${item.muscleGroup}` : ""}<button type="button" onClick={() => onRemove(item.id)} aria-label={`Удалить ${item.label} из библиотеки`} style={{ color: "#ff8a98" }}>×</button></span>)}
          </div>}
        </div>
      )}
    </div>
  );
};

const ExerciseList = ({ exercises, onChange }: { exercises: string[]; onChange: (exercises: string[]) => void }) => {
  const updateExercise = (index: number, value: string) => onChange(exercises.map((exercise, i) => i === index ? value : exercise));
  const addExercise = () => onChange([...exercises, ""]);
  const removeExercise = (index: number) => onChange(exercises.filter((_, i) => i !== index));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mt-4 mb-2">
        <label className="text-sm" style={{ color: "var(--ink-3)" }}>Упражнения</label>
        <button type="button" onClick={addExercise} className="btn btn-secondary btn-sm glass"><Plus size={14} /> Добавить упражнение</button>
      </div>
      <div className="space-y-2">
        {exercises.length === 0 && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Упражнений пока нет. Нажмите «Добавить упражнение».</p>}
        {exercises.map((exercise, index) => (
          <div key={index} className="grid grid-cols-[1fr_auto] gap-2">
            <input value={exercise} onChange={(event) => updateExercise(index, event.target.value)} placeholder="Например: Жим лёжа — 4×8" className="field-input mt-0" />
            <button type="button" aria-label="Удалить упражнение" onClick={() => removeExercise(index)} className="btn btn-danger px-3.5">×</button>
          </div>
        ))}
      </div>
    </div>
  );
};

const WorkoutEditor = ({ workout, allWorkouts, onSwitchWorkout, clients, coachId, onChange, onDelete, onDuplicate, onBulkAssign }: { workout: Workout; allWorkouts: Workout[]; onSwitchWorkout: (id: string) => void; clients: Client[]; coachId: string; onChange: (patch: Partial<Workout>) => Promise<void> | void; onDelete: () => void; onDuplicate: () => void; onBulkAssign: (workout: Workout, clientIds: string[], startDate: string) => Promise<void> | void }) => {
  const [draft, setDraft] = useState<Workout>({ ...workout, weeklyTemplate: workout.weeklyTemplate || createEmptyWeeklyTemplate() });
  const [status, setStatus] = useState("");
  const [bulkClientIds, setBulkClientIds] = useState<string[]>([]);
  const [bulkStartDate, setBulkStartDate] = useState(toISODate(new Date()));
  const [isBulkAssigning, setIsBulkAssigning] = useState(false);
  const [library, setLibrary] = useState<ExerciseLibraryItem[]>([]);

  useEffect(() => setDraft({ ...workout, weeklyTemplate: workout.weeklyTemplate || createEmptyWeeklyTemplate() }), [workout.id]);

  useEffect(() => {
    if (!isSupabaseConfigured || !coachId) return;
    fetchExerciseLibrary(coachId).then(setLibrary).catch(() => {});
  }, [coachId]);

  const addLibraryItem = async (label: string, muscleGroup: string) => {
    if (!isSupabaseConfigured || !coachId) return;
    try {
      const item = await createExerciseLibraryItem(coachId, label, muscleGroup || undefined);
      setLibrary((current) => [...current, item]);
    } catch {
      // Библиотека — вспомогательный ускоритель ввода, а не критичные данные:
      // если сохранить не удалось, план всё равно можно собрать вручную.
    }
  };

  const removeLibraryItem = async (id: string) => {
    try {
      await deleteExerciseLibraryItem(id);
      setLibrary((current) => current.filter((item) => item.id !== id));
    } catch {
      // См. комментарий в addLibraryItem.
    }
  };

  const usedDays = Object.keys(draft.weeklyTemplate || {});
  const availableDays = weekDays.filter((day) => !usedDays.includes(day));

  const updateDay = (day: string, patch: Partial<{ title: string; focus: string; notes: string; exercises: string[] }>) => {
    const currentTemplate = draft.weeklyTemplate || createEmptyWeeklyTemplate();
    setDraft({
      ...draft,
      weeklyTemplate: {
        ...currentTemplate,
        [day]: { ...currentTemplate[day], ...patch },
      },
    });
    setStatus("");
  };

  const addTrainingDay = (day: string) => {
    if (!day || usedDays.includes(day)) return;
    setDraft({
      ...draft,
      weeklyTemplate: {
        ...(draft.weeklyTemplate || {}),
        [day]: { title: "Новая тренировка", focus: "", notes: "", exercises: [] },
      },
    });
    setStatus("");
  };

  const removeTrainingDay = (day: string) => {
    const next = { ...(draft.weeklyTemplate || {}) };
    delete next[day];
    setDraft({ ...draft, weeklyTemplate: next });
    setStatus("");
  };

  const renameTrainingDay = (oldDay: string, newDay: string) => {
    if (oldDay === newDay || (draft.weeklyTemplate || {})[newDay]) return;
    const currentTemplate = draft.weeklyTemplate || {};
    const next = { ...currentTemplate };
    next[newDay] = currentTemplate[oldDay];
    delete next[oldDay];
    setDraft({ ...draft, weeklyTemplate: next });
    setStatus("");
  };

  const toggleBulkClient = (clientId: string) => setBulkClientIds((current) => current.includes(clientId) ? current.filter((id) => id !== clientId) : [...current, clientId]);

  const save = () => {
    onChange(draft);
    setStatus("План сохранён. Теперь его можно назначать клиенту.");
  };

  const handleBulkAssign = async () => {
    if (!bulkClientIds.length) {
      alert("Выбери хотя бы одного клиента");
      return;
    }
    setIsBulkAssigning(true);
    try {
      await onChange(draft);
      await onBulkAssign(draft, bulkClientIds, bulkStartDate);
      setBulkClientIds([]);
      setStatus(`План назначен ${bulkClientIds.length > 1 ? `${bulkClientIds.length} клиентам` : "клиенту"} с ${bulkStartDate}.`);
    } finally {
      setIsBulkAssigning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button type="button" onClick={() => document.getElementById("workout-list")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="btn btn-secondary btn-sm glass lg:hidden self-start"><ArrowLeft size={14} /> К списку планов</button>
        <label className="flex items-center gap-2 text-sm sm:ml-auto" style={{ color: "var(--ink-3)" }}>
          План
          <select value={workout.id} onChange={(event) => onSwitchWorkout(event.target.value)} className="field-input mt-0 w-auto">
            {allWorkouts.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Название недельного плана" value={draft.title} onChange={(title) => { setDraft({ ...draft, title }); setStatus(""); }} />
        <label className="flex items-center gap-2 text-sm mt-4 md:mt-0 md:self-end md:mb-2.5" style={{ color: "var(--ink-2)" }}>
          <input type="checkbox" checked={Boolean(draft.isTemplate)} onChange={(event) => { setDraft({ ...draft, isTemplate: event.target.checked }); setStatus(""); }} />
          Это шаблон — легко находить и копировать для новых клиентов
        </label>
      </div>
      <TextArea label="Общие заметки к плану" value={draft.notes} onChange={(notes) => { setDraft({ ...draft, notes }); setStatus(""); }} />

      <div className="app-card rounded-2xl p-4">
        <h3 className="text-xl font-bold">Тренировочные дни</h3>
        <p className="text-sm mt-1 mb-3" style={{ color: "var(--ink-3)" }}>Нажми на нужный день, чтобы добавить в него тренировку. Дни отдыха не создаются.</p>
        <div className="flex flex-wrap gap-2 mb-1">
          {weekDays.map((day) => {
            const used = usedDays.includes(day);
            return (
              <button key={day} type="button" disabled={used} onClick={() => addTrainingDay(day)} className={used ? "badge badge-accent cursor-default" : "btn btn-secondary btn-sm glass"}>
                {used && <Check size={13} />} {day}
              </button>
            );
          })}
        </div>
        {!usedDays.length && <p className="text-sm mt-3" style={{ color: "var(--ink-3)" }}>В плане пока нет тренировочных дней. Нажми на день недели выше.</p>}
        <div className="space-y-5">
          {usedDays.sort((a, b) => weekDays.indexOf(a) - weekDays.indexOf(b)).map((day) => {
            const dayWorkout = draft.weeklyTemplate?.[day] || { title: "Новая тренировка", focus: "", notes: "", exercises: [] };
            return (
              <div key={day} className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                  <select value={day} onChange={(event) => renameTrainingDay(day, event.target.value)} className="field-input mt-0 w-auto">
                    {[day, ...availableDays].sort((a, b) => weekDays.indexOf(a) - weekDays.indexOf(b)).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <button type="button" onClick={() => removeTrainingDay(day)} className="btn btn-danger btn-sm">Удалить день</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Название тренировки" value={dayWorkout.title} onChange={(title) => updateDay(day, { title })} />
                  <Field label="Фокус" value={dayWorkout.focus} onChange={(focus) => updateDay(day, { focus })} />
                </div>
                <ExerciseLibraryPicker library={library} onInsert={(label) => updateDay(day, { exercises: [...(dayWorkout.exercises || []), label] })} onAdd={addLibraryItem} onRemove={removeLibraryItem} />
                <ExerciseList exercises={dayWorkout.exercises || []} onChange={(exercises) => updateDay(day, { exercises })} />
                <TextArea label="Заметки к этому дню" value={dayWorkout.notes} onChange={(notes) => updateDay(day, { notes })} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="app-card rounded-2xl p-4">
        <h3 className="text-xl font-bold">Массовое назначение</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>Выбери клиентов и дату начала — каждому создастся 7-дневный активный план с этой тренировкой.</p>
        {!clients.length && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Клиентов пока нет.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {clients.map((client) => (
            <label key={client.id} className="app-card rounded-2xl p-3 flex items-center gap-3 cursor-pointer transition hover:bg-white/[.04]">
              <input type="checkbox" checked={bulkClientIds.includes(client.id)} onChange={() => toggleBulkClient(client.id)} />
              <span>{client.name}</span>
            </label>
          ))}
        </div>
        <Field label="Дата начала" type="date" value={bulkStartDate} onChange={setBulkStartDate} />
        <button type="button" disabled={!bulkClientIds.length || isBulkAssigning} onClick={handleBulkAssign} className="btn btn-primary btn-md mt-4">{isBulkAssigning ? "Назначаем..." : "Назначить выбранным"}</button>
      </div>

      <div className="sticky bottom-4 z-20 glass rounded-3xl p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div>
          <h3 className="font-bold">Сохранение плана</h3>
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>Изменения применятся только после нажатия кнопки.</p>
          {status && <p className="text-sm mt-1" style={{ color: "var(--accent)" }}>{status}</p>}
        </div>
        <div className="flex gap-3 flex-wrap">
          <button onClick={save} className="btn btn-primary btn-lg">Сохранить план</button>
          <button onClick={onDuplicate} className="btn btn-secondary btn-md glass"><Copy size={16} /> Дублировать план</button>
          <button onClick={onDelete} className="btn btn-danger btn-md"><Trash2 size={16} /> Удалить план</button>
        </div>
      </div>
    </div>
  );
};

const SiteEditor = ({ settings, onChange }: { settings: SiteSettings; onChange: (settings: SiteSettings) => void }) => {
  const [draft, setDraft] = useState<SiteSettings>(settings);
  const [status, setStatus] = useState("");
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => { setPhotoFailed(false); }, [draft.photoDataUrl]);

  const update = (patch: Partial<SiteSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus("");
  };

  const uploadPhoto = async (file: File | null) => {
    if (!file) return;
    if (!isSupabaseConfigured) {
      setStatus("Supabase не настроен — загрузка фото недоступна без подключённого проекта.");
      return;
    }
    setIsUploadingPhoto(true);
    setStatus("Загружаем фото...");
    try {
      const url = await uploadSitePhoto(file);
      update({ photoDataUrl: url });
      setStatus("Фото загружено. Не забудь нажать «Сохранить изменения».");
    } catch (error) {
      setStatus(getErrorMessage(error, "Не удалось загрузить фото"));
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const save = () => {
    onChange(draft);
    setStatus("Изменения сохранены. Открой главную, чтобы проверить результат.");
  };

  const reset = () => {
    resetSiteSettings();
    const defaults = getSiteSettings();
    setDraft(defaults);
    onChange(defaults);
    setStatus("Тексты сброшены к стандартным.");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
      <div className="space-y-4 min-w-0">
        <Field label="Название бренда" value={draft.brand} onChange={(brand) => update({ brand })} />
        <Field label="Текст бейджа над заголовком" value={draft.heroBadge} onChange={(heroBadge) => update({ heroBadge })} />
        <TextArea label="Главный заголовок" value={draft.heroTitle} onChange={(heroTitle) => update({ heroTitle })} rows={3} />
        <TextArea label="Описание под заголовком" value={draft.heroSubtitle} onChange={(heroSubtitle) => update({ heroSubtitle })} rows={4} />
        <Field label="Текст главной кнопки" value={draft.ctaText} onChange={(ctaText) => update({ ctaText })} />
        <Field label="Цитата" value={draft.quote} onChange={(quote) => update({ quote })} />
        <Field label="Заголовок блока о подходе" value={draft.approachTitle} onChange={(approachTitle) => update({ approachTitle })} />
        <TextArea label="Текст блока о подходе — часть 1" value={draft.approachText1} onChange={(approachText1) => update({ approachText1 })} rows={4} />
        <TextArea label="Текст блока о подходе — часть 2" value={draft.approachText2} onChange={(approachText2) => update({ approachText2 })} rows={4} />
        <div className="sticky bottom-4 z-20 glass rounded-3xl p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div>
            <h3 className="font-bold">Сохранение главной страницы</h3>
            <p className="text-sm" style={{ color: "var(--ink-3)" }}>Изменения применятся после нажатия кнопки.</p>
            {status && <p className="text-sm mt-1" style={{ color: status.includes("сохран") ? "var(--accent)" : "var(--ink-2)" }}>{status}</p>}
          </div>
          <button onClick={save} className="btn btn-primary btn-lg">Сохранить изменения</button>
        </div>
      </div>
      <div className="space-y-4">
        <div className="app-card rounded-2xl p-4">
          <h3 className="text-xl font-bold">Фото на главной</h3>
          <p className="text-sm mt-2" style={{ color: "var(--ink-3)" }}>Лучше загружать уже обрезанный вертикальный портрет 4:5 или 3:4.</p>
          <div className="mt-4 aspect-[4/5] rounded-2xl overflow-hidden grid place-items-center" style={{ background: "rgba(255,255,255,.06)", border: "1px solid var(--line)" }}>
            {draft.photoDataUrl && !photoFailed ? <img src={draft.photoDataUrl} alt="Фото на главной" onError={() => setPhotoFailed(true)} className="h-full w-full object-cover object-center" /> : <span style={{ color: "var(--ink-3)" }} className="px-4 text-center text-sm">{draft.photoDataUrl ? "Не удалось загрузить фото — ссылка недоступна. Попробуй загрузить заново." : "Фото не загружено"}</span>}
          </div>
          <input type="file" accept="image/*" disabled={isUploadingPhoto} onChange={(event) => uploadPhoto(event.target.files?.[0] || null)} className="field-input mt-4 disabled:opacity-50" />
          {isUploadingPhoto && <p className="mt-2 text-sm" style={{ color: "var(--accent)" }}>Загружаем...</p>}
          <button onClick={() => update({ photoDataUrl: "" })} className="btn btn-secondary btn-md mt-3">Убрать фото</button>
        </div>
        <div className="app-card rounded-2xl p-4">
          <h3 className="text-xl font-bold">Заставка при загрузке</h3>
          <p className="text-sm mt-2 mb-4" style={{ color: "var(--ink-3)" }}>Экран, который на пару секунд показывается перед главной страницей.</p>
          <div className="space-y-3">
            <Field label="Подпись под названием бренда" value={draft.introTagline} onChange={(introTagline) => update({ introTagline })} />
            <Field label="Слоган на втором экране" value={draft.introSlogan} onChange={(introSlogan) => update({ introSlogan })} />
          </div>
        </div>
        <div className="app-card rounded-2xl p-4">
          <h3 className="text-xl font-bold">Предпросмотр</h3>
          <p className="text-sm mt-2" style={{ color: "var(--ink-3)" }}>Сначала нажми «Сохранить изменения», затем открой главную.</p>
          <div className="flex flex-wrap gap-3 mt-4">
            <button onClick={() => window.location.hash = "/"} className="btn btn-primary btn-md">Открыть главную</button>
            <button onClick={reset} className="btn btn-danger btn-md">Сбросить тексты</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoachDashboard;
