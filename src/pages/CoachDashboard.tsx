import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarDays, Copy, Dumbbell, Inbox, LayoutDashboard, LogOut, MoreHorizontal, Plus, Settings, Trash2, Users, X, type LucideIcon } from "lucide-react";
import { enablePushNotifications, sendPushToUsers } from "../lib/push";
import { createClientAccount, deleteClientAccount } from "../lib/admin";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { Client, getClients, getMessages, getSiteSettings, getUser, getWorkouts, logout, makeId, Message, resetSiteSettings, setClients, setMessages, setSiteSettings, setWorkouts, SiteSettings, Workout } from "../lib/storage";
import { StrengthRecord, createClientRecord, createWorkoutRecord, deleteClientRecord, createEmptyWeeklyTemplate, deleteWorkoutRecord, fetchCoachClientStrengthRecords, fetchCoachData, fetchCoachNotifications, fetchSiteSettingsDb, markNotificationRead, replaceWeeklyPlanRecord, saveSiteSettingsDb, updateClientRecord, updateWorkoutRecord, createClientRecordFromClient, uploadSitePhoto, PlanPeriod, fetchCurrentPlanPeriod, createPlanPeriod, extendClientPlan } from "../lib/db";
import CalendarView from "../components/CalendarView";
import { buildCalendarEntries, CalendarWorkoutEntry } from "../lib/calendar";

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
const coachNavItems: NavItem[] = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "calendar", label: "Календарь", icon: CalendarDays },
  { id: "applications", label: "Заявки", icon: Inbox },
  { id: "clients", label: "Клиенты", icon: Users },
  { id: "workouts", label: "Планы тренировок", icon: Dumbbell },
  { id: "messages", label: "Сообщения", icon: Bell },
  { id: "settings", label: "Настройки", icon: Settings },
];
// Вкладки в нижней панели на мобильном — самые частые действия тренера.
// Остальные (и выход) остаются в полном меню за кнопкой «Ещё».
const coachMobilePrimaryIds = ["overview", "calendar", "clients", "messages"];

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
  const selectedClient = clients.find((c) => c.id === selectedClientId) || clients[0];
  const selectedWorkout = workouts.find((w) => w.id === selectedWorkoutId) || workouts[0];
  const average = useMemo(() => clients.length ? Math.round(clients.reduce((sum, c) => sum + c.progress, 0) / clients.length) : 0, [clients]);

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
      setSelectedClientId(syncedClients[0]?.id || "");
      setSelectedWorkoutId(syncedWorkouts[0]?.id || "");
      setSyncStatus("");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Не удалось синхронизировать данные");
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

  useEffect(() => { loadAllData(); }, [user?.id]);
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

  const loadCalendarMonth = async (anchor: Date) => {
    if (!isSupabaseConfigured || !clients.length) { setCalendarEntries(new Map()); return; }
    setCalendarLoading(true);
    try {
      const rangeStart = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 21);
      const rangeEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 10);
      const toIso = (d: Date) => d.toISOString().slice(0, 10);
      const entries = await buildCalendarEntries(clients, workouts, toIso(rangeStart), toIso(rangeEnd));
      setCalendarEntries(entries);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Не удалось загрузить календарь");
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
        .catch((error) => setSyncStatus(error instanceof Error ? error.message : "Не удалось сохранить клиента"));
    }
  };

  const addClient = async () => {
    try {
      const client = isSupabaseConfigured && user?.id ? await createClientRecord(user.id) : emptyClient(workouts[0]?.id || "");
      const next = [client, ...clients];
      saveClients(next);
      setSelectedClientId(client.id);
      setTab("clients");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Не удалось добавить клиента");
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
    if (!selectedWorkout) return;
    const updated = { ...selectedWorkout, ...patch };
    const next = workouts.map((workout) => workout.id === selectedWorkout.id ? updated : workout);
    saveWorkouts(next);
    if (isSupabaseConfigured && user?.id) updateWorkoutRecord(user.id, updated).catch((error) => setSyncStatus(error instanceof Error ? error.message : "Не удалось сохранить тренировку"));
  };

  const addWorkout = async () => {
    try {
      const workout = isSupabaseConfigured && user?.id ? await createWorkoutRecord(user.id) : emptyWorkout();
      const next = [workout, ...workouts];
      saveWorkouts(next);
      setSelectedWorkoutId(workout.id);
      setTab("workouts");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Не удалось создать план");
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
      setSyncStatus(error instanceof Error ? error.message : "Не удалось удалить план");
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
      setSyncStatus(error instanceof Error ? error.message : "Не удалось дублировать план");
    }
  };

  const assignWorkoutToClients = async (workout: Workout, clientIds: string[]) => {
    if (!clientIds.length) return;
    const weeklyPlan = workout.weeklyTemplate ? Object.fromEntries(Object.keys(workout.weeklyTemplate).map((day) => [day, workout.id])) : {};
    const nextClients = clients.map((client) => clientIds.includes(client.id) ? { ...client, assignedWorkoutId: workout.id, weeklyPlan, plan: workout.title } : client);
    saveClients(nextClients);
    if (isSupabaseConfigured && user?.id) {
      try {
        const assignedClients = nextClients.filter((item) => clientIds.includes(item.id));
        for (const client of assignedClients) {
          await updateClientRecord(user.id, client);
          await replaceWeeklyPlanRecord(user.id, client.id, client.weeklyPlan || {});
        }
        await sendPushToUsers(assignedClients.map((client) => client.userId || "").filter(Boolean), "Новый план тренировок", `Арсений назначил план ${workout.title}`, "/#/client");
        setSyncStatus("План назначен выбранным клиентам");
      } catch (error) {
        setSyncStatus(error instanceof Error ? error.message : "Не удалось назначить план");
      }
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
      setPushStatus(error instanceof Error ? error.message : "Не удалось включить push-уведомления");
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
      setSyncStatus(error instanceof Error ? error.message : "Не удалось отметить событие");
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
          <NavList items={coachNavItems} activeTab={tab} messageCount={messages.length} onSelect={(id) => { setTab(id); setMobileMenuOpen(false); }} />
          <button onClick={exit} className="w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}><LogOut size={18} /> Выйти</button>
        </aside>
      </div>}

      <aside className="hidden lg:flex lg:flex-col border-r p-5 lg:min-h-screen" style={{ borderColor: "var(--line)", background: "rgba(0,0,0,.18)" }}>
        <button onClick={() => window.location.hash = "/"} className="flex items-center gap-3 font-bold mb-8"><span className="logo-mark" /> ARSENIICOACH</button>
        <NavList items={coachNavItems} activeTab={tab} messageCount={messages.length} onSelect={setTab} />
        <button onClick={exit} className="w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}><LogOut size={18} /> Выйти</button>
      </aside>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch pb-[env(safe-area-inset-bottom)]" style={{ background: "rgba(8,12,18,.92)", backdropFilter: "blur(14px)", borderTop: "1px solid var(--line)" }}>
        {coachNavItems.filter((item) => coachMobilePrimaryIds.includes(item.id)).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] relative">
            <span className="relative">
              <Icon size={20} strokeWidth={tab === id ? 2.4 : 1.8} color={tab === id ? "var(--accent)" : "var(--ink-3)"} />
              {id === "messages" && messages.length > 0 && <span className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full" style={{ background: "#ff8a98" }} />}
            </span>
            <span style={{ color: tab === id ? "var(--accent)" : "var(--ink-3)" }}>{label}</span>
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
          <div className="flex gap-3 flex-wrap"><button onClick={addClient} className="btn btn-primary btn-lg"><Users size={17} /> Добавить клиента</button><button onClick={addWorkout} className="btn btn-secondary btn-lg glass"><Dumbbell size={17} /> Создать план</button></div>
        </header>

        {syncStatus && <div className="relative z-10 mb-4 app-card rounded-2xl p-4 text-sm" style={{ color: syncStatus.endsWith("...") || syncStatus === "План назначен выбранным клиентам" ? "var(--ink-2)" : "#ff8a98" }}>{syncStatus}</div>}

        {tab === "overview" && <div className="relative z-10 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><Metric title="Клиентов" value={clients.length} /><Metric title="Планов" value={workouts.length} /><Metric title="Средний прогресс" value={`${average}%`} /><Metric title="Нужно ответить" value={messages.length} onClick={() => setTab("messages")} hint="Открыть" /></div>
          <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_.85fr] gap-5"><Panel title="Клиенты" subtitle="статусы и назначенные планы"><ClientList clients={clients} workouts={workouts} onSelect={(id) => { setSelectedClientId(id); setTab("clients"); }} /></Panel><Panel title="Уведомления" subtitle="из кабинета клиентов"><MessageList messages={messages} onOpenClients={() => setTab("clients")} onMarkRead={markMessageRead} /></Panel></div>
        </div>}

        {tab === "calendar" && <Panel title="Календарь тренировок" subtitle="недельный план каждого клиента, спроецированный на даты"><CalendarView entriesByDate={calendarEntries} loading={calendarLoading} onMonthChange={loadCalendarMonth} renderDay={(date, entries) => <CoachCalendarDay date={date} entries={entries} onOpenClient={(clientId) => { setSelectedClientId(clientId); setTab("clients"); }} />} /></Panel>}

        {tab === "applications" && <Panel title="Заявки с главной страницы" subtitle="анкеты, которые заполнили посетители сайта"><div className="flex justify-end mb-4"><button onClick={loadApplications} className="btn btn-secondary btn-md glass">Обновить заявки</button></div>{applicationsStatus && <p className="mb-4" style={{ color: "var(--ink-2)" }}>{applicationsStatus}</p>}<ApplicationsList applications={applications} clients={clients} onCreateClient={createClientFromApplication} onDeleteApplication={deleteApplication} /></Panel>}

        {tab === "clients" && !selectedClient && <Panel title="Клиенты" subtitle="список пока пуст"><p style={{ color: "var(--ink-2)" }}>Клиентов пока нет. Нажмите «Добавить клиента», чтобы создать первого.</p></Panel>}
        {tab === "clients" && selectedClient && <Panel title="Редактирование клиента" subtitle="можно менять всё: контакты, цель, питание, тренировку, прогресс"><div className="grid grid-cols-1 xl:grid-cols-[330px_1fr] gap-5"><div className="space-y-3">{clients.map(c => <button key={c.id} onClick={() => setSelectedClientId(c.id)} className="w-full text-left app-card rounded-2xl p-4 transition hover:bg-white/[.04]" style={{ borderColor: selectedClient.id === c.id ? "rgba(104,225,253,.45)" : "var(--line)" }}><b>{c.name}</b><p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{c.telegram} • {c.progress}%</p></button>)}</div><ClientEditor client={selectedClient} workouts={workouts} strengthRecords={selectedClientStrength} onChange={updateClient} onDelete={deleteClient} /></div></Panel>}

        {tab === "workouts" && !selectedWorkout && <Panel title="Планы тренировок" subtitle="список пока пуст"><p style={{ color: "var(--ink-2)" }}>Планов пока нет. Нажмите «Создать план», чтобы добавить первый план тренировок.</p></Panel>}
        {tab === "workouts" && selectedWorkout && <Panel title="Конструктор планов тренировок" subtitle="создавай и редактируй программы, потом назначай клиентам"><div className="grid grid-cols-1 xl:grid-cols-[330px_1fr] gap-5"><div className="space-y-3">{workouts.map(w => <button key={w.id} onClick={() => setSelectedWorkoutId(w.id)} className="w-full text-left app-card rounded-2xl p-4 transition hover:bg-white/[.04]" style={{ borderColor: selectedWorkout.id === w.id ? "rgba(104,225,253,.45)" : "var(--line)" }}><b>{w.title}</b><p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{w.day} • {w.exercises.length} упражнений</p></button>)}</div><WorkoutEditor workout={selectedWorkout} clients={clients} onChange={updateWorkout} onDelete={deleteWorkout} onDuplicate={duplicateWorkout} onBulkAssign={assignWorkoutToClients} /></div></Panel>}

        {tab === "messages" && <Panel title="Сообщения и Telegram" subtitle="уведомления и контакты клиентов"><MessageList messages={messages} onOpenClients={() => setTab("clients")} onMarkRead={markMessageRead} /><div className="mt-5 app-card rounded-2xl p-5"><h3 className="text-xl font-bold">Telegram интеграция</h3><p className="mt-2" style={{ color: "var(--ink-2)" }}>В продакшене сюда можно подключить Telegram Bot API, чтобы заявки и уведомления приходили в Telegram @president_h.</p></div></Panel>}
        {tab === "settings" && <Panel title="Редактирование главной страницы" subtitle="текст, кнопка и фото на лендинге"><div className="app-card rounded-2xl p-5 mb-5"><h3 className="text-xl font-bold">Push-уведомления тренера</h3><p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>Включи на этом устройстве, чтобы получать уведомления о действиях клиентов. На iPhone сайт должен быть открыт как веб-приложение с экрана «Домой».</p><button onClick={enablePush} className="btn btn-primary btn-md mt-4">Включить уведомления тренеру</button>{pushStatus && <p className="mt-3 text-sm" style={{ color: pushStatus.includes("включ") ? "var(--accent)" : "#ff8a98" }}>{pushStatus}</p>}</div><SiteEditor settings={siteSettingsState} onChange={(next) => { updateSiteSettingsState(next); setSiteSettings(next); if (isSupabaseConfigured) saveSiteSettingsDb(next).catch((error) => setSyncStatus(error instanceof Error ? error.message : "Не удалось сохранить главную")); }} /></Panel>}
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

const NavList = ({ items, activeTab, messageCount, onSelect }: { items: NavItem[]; activeTab: string; messageCount: number; onSelect: (id: string) => void }) => (
  <div>
    {items.map(({ id, label, icon: Icon }) => (
      <button key={id} onClick={() => onSelect(id)} aria-current={activeTab === id ? "page" : undefined} className="w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 mb-2 transition-colors" style={{ background: activeTab === id ? "rgba(104,225,253,.14)" : "transparent", color: activeTab === id ? "var(--ink)" : "var(--ink-3)", border: activeTab === id ? "1px solid rgba(104,225,253,.28)" : "1px solid transparent" }}>
        <Icon size={18} strokeWidth={activeTab === id ? 2.4 : 1.8} />
        <span className="flex-1">{label}</span>
        {id === "messages" && messageCount > 0 && <span className="rounded-full px-2 py-0.5 text-xs font-semibold shrink-0" style={{ background: "rgba(255,138,152,.18)", color: "#ff8a98" }}>{messageCount}</span>}
      </button>
    ))}
  </div>
);

const Metric = ({ title, value, onClick, hint }: { title: string; value: string | number; onClick?: () => void; hint?: string }) => {
  const content = <><p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>{title}</p><b className="text-[2.1rem] leading-none mt-3 block tracking-tight">{value}</b>{hint && <span className="text-xs mt-3 inline-flex items-center gap-1 font-semibold" style={{ color: "var(--accent)" }}>{hint} →</span>}</>;
  if (onClick) return <button onClick={onClick} className="stat-tile glass rounded-3xl p-5 text-left transition hover:-translate-y-0.5 hover:border-[rgba(104,225,253,.32)]">{content}</button>;
  return <div className="stat-tile glass rounded-3xl p-5">{content}</div>;
};
const Panel = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => <section className="relative z-10 glass rounded-[1.75rem] p-5 md:p-7"><div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-6"><h2 className="text-2xl md:text-[1.75rem] font-bold tracking-[-.02em]">{title}</h2><span className="text-sm" style={{ color: "var(--ink-3)" }}>{subtitle}</span></div>{children}</section>;
const ClientList = ({ clients, workouts, onSelect }: { clients: Client[]; workouts: Workout[]; onSelect: (id: string) => void }) => <div className="space-y-3">{clients.map(c => <button key={c.id} onClick={() => onSelect(c.id)} className="w-full text-left app-card rounded-2xl p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 transition hover:border-[rgba(104,225,253,.3)] hover:bg-white/[.04]"><div><h3 className="font-bold text-lg">{c.name}</h3><p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>{workouts.find(w => w.id === c.assignedWorkoutId)?.title || c.plan} • {c.telegram}</p></div><div className="text-left md:text-right"><span className={`badge ${c.status === "Пропуск" ? "badge-danger" : "badge-accent"}`}>{c.status}</span><p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>Прогресс {c.progress}%</p></div></button>)}</div>;
const ApplicationsList = ({ applications, clients, onCreateClient, onDeleteApplication }: { applications: Application[]; clients: Client[]; onCreateClient: (application: Application) => void; onDeleteApplication: (application: Application) => void }) => {
  if (!applications.length) return <p style={{ color: "var(--ink-2)" }}>Заявок пока нет.</p>;

  return (
    <div className="space-y-4">
      {applications.map((application) => {
        const hasMatchingClient = clients.some((client) =>
          Boolean(application.email && client.email && application.email.trim().toLowerCase() === client.email.trim().toLowerCase()) ||
          Boolean(application.telegram && client.telegram && application.telegram.trim().toLowerCase() === client.telegram.trim().toLowerCase())
        );
        const isAdded = hasMatchingClient;
        return (
        <div key={application.id} className="app-card rounded-2xl p-5">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
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

const ClientEditor = ({ client, workouts, strengthRecords, onChange, onDelete }: { client: Client; workouts: Workout[]; strengthRecords: StrengthRecord[]; onChange: (patch: Partial<Client>) => void; onDelete: () => void }) => {
  const [clientPassword, setClientPassword] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [showClientPassword, setShowClientPassword] = useState(false);
  const [assignedPlanDraft, setAssignedPlanDraft] = useState(client.assignedWorkoutId || "");
  const [currentPeriod, setCurrentPeriod] = useState<PlanPeriod | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);
  const [newPlanWorkoutId, setNewPlanWorkoutId] = useState(workouts[0]?.id || "");
  const [newPlanStartDate, setNewPlanStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [planActionStatus, setPlanActionStatus] = useState("");
  const [isSavingPeriod, setIsSavingPeriod] = useState(false);

  const buildPassword = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  };

  const passwordStorageKey = (clientId: string) => `arseniiCoachTempPassword:${clientId}`;

  useEffect(() => {
    setAssignedPlanDraft(client.assignedWorkoutId || "");
  }, [client.id, client.assignedWorkoutId]);

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

  const saveWeeklyTemplate = () => {
    const workout = workouts.find((item) => item.id === assignedPlanDraft);
    const weeklyPlan = workout?.weeklyTemplate ? Object.fromEntries(Object.keys(workout.weeklyTemplate).map((day) => [day, assignedPlanDraft])) : {};
    onChange({ assignedWorkoutId: assignedPlanDraft, weeklyPlan, plan: workout?.title || "" });
  };

  const handleCreatePeriod = async () => {
    setPlanActionStatus("");
    if (!newPlanWorkoutId) { setPlanActionStatus("Выбери тренировку для плана"); return; }
    setIsSavingPeriod(true);
    try {
      const period = await createPlanPeriod(client.id, newPlanWorkoutId, newPlanStartDate);
      setPlanActionStatus(`План создан на ${period.startDate} – ${period.endDate}`);
      setCurrentPeriod(await fetchCurrentPlanPeriod(client.id));
    } catch (error) {
      setPlanActionStatus(error instanceof Error ? error.message : "Не удалось создать план");
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
      setPlanActionStatus(error instanceof Error ? error.message : "Не удалось продлить план");
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
      setAccountStatus(error instanceof Error ? error.message : "Не удалось создать аккаунт клиента");
    } finally {
      setIsCreatingAccount(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Имя" value={client.name} onChange={(name) => onChange({ name })} />
        <Field label="Telegram" value={client.telegram} onChange={(telegram) => onChange({ telegram })} />
        <Field label="Email" value={client.email} onChange={(email) => onChange({ email })} />
        <Field label="Статус" value={client.status} onChange={(status) => onChange({ status })} />
        <Field label="Прогресс, %" type="number" value={client.progress} onChange={(progress) => onChange({ progress: Math.max(0, Math.min(100, Number(progress) || 0)) })} />
        <Field label="Следующая тренировка" value={client.nextWorkout} onChange={(nextWorkout) => onChange({ nextWorkout })} />
      </div>

      <div className="app-card rounded-2xl p-4">
        <h3 className="text-xl font-bold">Аккаунт клиента</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>
          Пароль не сохраняется в коде сайта и не записывается в базу clients. Он передаётся в Supabase Auth через защищённую серверную функцию.
        </p>
        <div className="grid grid-cols-1 gap-3">
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
            Временный пароль клиента
            <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2">
              <input value={clientPassword} type={showClientPassword ? "text" : "password"} readOnly className="field-input mt-0 cursor-default" />
              <button type="button" onClick={() => setShowClientPassword((value) => !value)} className="btn btn-secondary btn-md glass">{showClientPassword ? "Скрыть" : "Показать"}</button>
              <button type="button" onClick={generatePassword} className="btn btn-secondary btn-md glass">Сгенерировать</button>
            </div>
          </label>
          <button disabled={isCreatingAccount || !clientPassword} onClick={createAccount} className="btn btn-primary btn-md">
            {client.userId ? (isCreatingAccount ? "Обновляю..." : "Обновить пароль") : (isCreatingAccount ? "Создаю..." : "Создать аккаунт")}
          </button>
        </div>
        {client.userId && <p className="text-sm mt-3" style={{ color: "var(--accent)" }}>Клиентский аккаунт привязан. Пароль можно в любой момент сгенерировать заново и обновить.</p>}
        {accountStatus && <p className="text-sm mt-3" style={{ color: ["создан", "сгенерирован", "обновлён", "привязан", "Скопируй"].some((word) => accountStatus.includes(word)) ? "var(--accent)" : "#ff8a98" }}>{accountStatus}</p>}
      </div>

      <div className="app-card rounded-2xl p-4">
        <h3 className="text-xl font-bold">Шаблон тренировок по дням недели</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>Это «рецепт» плана — какая тренировка идёт в какой день недели. Сам план становится активным только когда ты назначишь ему конкретную дату начала ниже.</p>
        <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
          Шаблон тренировок
          <select value={assignedPlanDraft} onChange={(e) => setAssignedPlanDraft(e.target.value)} className="field-input">
            <option value="">План не выбран</option>
            {workouts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
          </select>
        </label>
        <button type="button" onClick={saveWeeklyTemplate} className="btn btn-primary btn-md mt-4">Сохранить шаблон</button>
      </div>

      <div className="app-card rounded-2xl p-4">
        <h3 className="text-xl font-bold">Активный план (7 дней)</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>План действует ровно 7 дней с выбранной даты. По окончании недели календарь автоматически перестаёт его показывать — никаких ручных переключений не нужно.</p>

        {periodLoading ? (
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>Загружаем текущий план...</p>
        ) : currentPeriod ? (
          <div className="rounded-2xl p-4 mb-4" style={{ background: "rgba(104,225,253,.08)", border: "1px solid rgba(104,225,253,.22)" }}>
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>Сейчас активен план</p>
            <b className="text-lg block mt-1">{workouts.find((w) => w.id === currentPeriod.workoutId)?.title || "Тренировка"}</b>
            <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{currentPeriod.startDate} – {currentPeriod.endDate}</p>
            <button type="button" onClick={handleExtendPeriod} disabled={isSavingPeriod} className="btn btn-primary btn-sm mt-3">
              {isSavingPeriod ? "Продлеваем..." : "Продлить ещё на 7 дней"}
            </button>
          </div>
        ) : (
          <p className="text-sm mb-4" style={{ color: "var(--ink-3)" }}>На сегодня у клиента нет активного плана.</p>
        )}

        <p className="text-sm font-semibold mb-2" style={{ color: "var(--ink-2)" }}>Назначить новый план</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
            Тренировка
            <select value={newPlanWorkoutId} onChange={(e) => setNewPlanWorkoutId(e.target.value)} className="field-input">
              {workouts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
          </label>
          <Field label="Дата начала (план будет на 7 дней от неё)" type="date" value={newPlanStartDate} onChange={setNewPlanStartDate} />
        </div>
        <button type="button" onClick={handleCreatePeriod} disabled={isSavingPeriod} className="btn btn-primary btn-md mt-4">
          {isSavingPeriod ? "Создаём..." : "Назначить план на 7 дней"}
        </button>
        {planActionStatus && <p className="text-sm mt-3" style={{ color: "var(--accent)" }}>{planActionStatus}</p>}
      </div>
      <TextArea label="Цель клиента" value={client.goal} onChange={(goal) => onChange({ goal })} />
      <TextArea label="Питание / рекомендации" value={client.nutrition} onChange={(nutrition) => onChange({ nutrition })} />
      <TextArea label="Комментарий тренера" value={client.comment} onChange={(comment) => onChange({ comment })} />
      <CoachStrengthProgress records={strengthRecords} />
      <button onClick={onDelete} className="btn btn-danger btn-md"><Trash2 size={16} /> Удалить клиента</button>
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

const WorkoutEditor = ({ workout, clients, onChange, onDelete, onDuplicate, onBulkAssign }: { workout: Workout; clients: Client[]; onChange: (patch: Partial<Workout>) => void; onDelete: () => void; onDuplicate: () => void; onBulkAssign: (workout: Workout, clientIds: string[]) => Promise<void> | void }) => {
  const [draft, setDraft] = useState<Workout>({ ...workout, weeklyTemplate: workout.weeklyTemplate || createEmptyWeeklyTemplate() });
  const [status, setStatus] = useState("");
  const [bulkClientIds, setBulkClientIds] = useState<string[]>([]);

  useEffect(() => setDraft({ ...workout, weeklyTemplate: workout.weeklyTemplate || createEmptyWeeklyTemplate() }), [workout.id]);

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

  const addTrainingDay = () => {
    const day = availableDays[0];
    if (!day) return;
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
    onChange(draft);
    await onBulkAssign(draft, bulkClientIds);
    setBulkClientIds([]);
    setStatus("План назначен выбранным клиентам.");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Название недельного плана" value={draft.title} onChange={(title) => { setDraft({ ...draft, title }); setStatus(""); }} />
      </div>
      <TextArea label="Общие заметки к плану" value={draft.notes} onChange={(notes) => { setDraft({ ...draft, notes }); setStatus(""); }} />

      <div className="app-card rounded-2xl p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold">Тренировочные дни</h3>
            <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>Добавляй только те дни, когда у клиента есть тренировка. Дни отдыха не создаются.</p>
          </div>
          <button disabled={!availableDays.length} type="button" onClick={addTrainingDay} className="btn btn-primary btn-md"><Plus size={16} /> Добавить день</button>
        </div>
        {!usedDays.length && <p className="text-sm" style={{ color: "var(--ink-3)" }}>В плане пока нет тренировочных дней. Нажми «Добавить день».</p>}
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
                <ExerciseList exercises={dayWorkout.exercises || []} onChange={(exercises) => updateDay(day, { exercises })} />
                <TextArea label="Заметки к этому дню" value={dayWorkout.notes} onChange={(notes) => updateDay(day, { notes })} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="app-card rounded-2xl p-4">
        <h3 className="text-xl font-bold">Массовое назначение</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>Выбери клиентов, которым нужно назначить этот план сразу.</p>
        {!clients.length && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Клиентов пока нет.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {clients.map((client) => (
            <label key={client.id} className="app-card rounded-2xl p-3 flex items-center gap-3 cursor-pointer transition hover:bg-white/[.04]">
              <input type="checkbox" checked={bulkClientIds.includes(client.id)} onChange={() => toggleBulkClient(client.id)} />
              <span>{client.name}</span>
            </label>
          ))}
        </div>
        <button type="button" disabled={!bulkClientIds.length} onClick={handleBulkAssign} className="btn btn-primary btn-md mt-4">Назначить выбранным</button>
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

  useEffect(() => setDraft(settings), [settings]);

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
      setStatus(error instanceof Error ? error.message : "Не удалось загрузить фото");
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
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
      <div className="space-y-4">
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
            {draft.photoDataUrl ? <img src={draft.photoDataUrl} alt="Фото на главной" className="h-full w-full object-cover object-center" /> : <span style={{ color: "var(--ink-3)" }}>Фото не загружено</span>}
          </div>
          <input type="file" accept="image/*" disabled={isUploadingPhoto} onChange={(event) => uploadPhoto(event.target.files?.[0] || null)} className="field-input mt-4 disabled:opacity-50" />
          {isUploadingPhoto && <p className="mt-2 text-sm" style={{ color: "var(--accent)" }}>Загружаем...</p>}
          <button onClick={() => update({ photoDataUrl: "" })} className="btn btn-secondary btn-md mt-3">Убрать фото</button>
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
