import { useEffect, useMemo, useState } from "react";
import { enablePushNotifications } from "../lib/push";
import { createClientAccount, deleteClientAccount } from "../lib/admin";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { Client, getClients, getMessages, getSiteSettings, getUser, getWorkouts, logout, makeId, Message, resetSiteSettings, setClients, setMessages, setSiteSettings, setWorkouts, SiteSettings, Workout } from "../lib/storage";
import { createClientRecord, createWorkoutRecord, deleteClientRecord, createEmptyWeeklyTemplate, deleteWorkoutRecord, fetchCoachData, fetchCoachNotifications, fetchSiteSettingsDb, replaceWeeklyPlanRecord, saveSiteSettingsDb, updateClientRecord, updateWorkoutRecord, createClientRecordFromClient } from "../lib/db";

type Application = {
  id: string;
  name: string;
  goal: string;
  duration: string;
  obstacle: string;
  commitment: string;
  start_timeline?: string;
  startTimeline?: string;
  looking_for?: string;
  lookingFor?: string;
  ready_to_invest?: string;
  readyToInvest?: string;
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
  const [syncStatus, setSyncStatus] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || "");
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(workouts[0]?.id || "");
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

  useEffect(() => { loadAllData(); }, [user?.id]);
  useEffect(() => { if (tab === "applications") loadApplications(); }, [tab]);
  useEffect(() => { if (tab === "messages" && isSupabaseConfigured) fetchCoachNotifications().then((next) => { updateMessages(next); setMessages(next); }).catch(() => {}); }, [tab]);

  const saveClients = (next: Client[]) => { updateClients(next); setClients(next); };
  const saveWorkouts = (next: Workout[]) => { updateWorkouts(next); setWorkouts(next); };

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


  const updateClient = (patch: Partial<Client>) => {
    if (!selectedClient) return;
    const updated = { ...selectedClient, ...patch };
    const next = clients.map((client) => client.id === selectedClient.id ? updated : client);
    saveClients(next);

    if (isSupabaseConfigured && user?.id) {
      updateClientRecord(user.id, updated)
        .then(() => {
          if (patch.weeklyPlan || patch.assignedWorkoutId) return replaceWeeklyPlanRecord(user.id!, updated.id, updated.weeklyPlan || {});
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
        for (const client of nextClients.filter((item) => clientIds.includes(item.id))) {
          await updateClientRecord(user.id, client);
          await replaceWeeklyPlanRecord(user.id, client.id, client.weeklyPlan || {});
        }
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
      comment: `Опыт: ${application.duration || "—"}\nМешает: ${application.obstacle || "—"}\nГотовность: ${application.commitment || "—"}\nСтарт: ${application.start_timeline || application.startTimeline || "—"}\nИщет: ${application.looking_for || application.lookingFor || "—"}\nИнвестиции: ${application.ready_to_invest || application.readyToInvest || "—"}`,
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

  const exit = () => { logout(); window.location.hash = "/"; };

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-[270px_1fr]" style={{ background: "var(--bg)" }}>
      <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden fixed top-4 left-4 z-50 rounded-full px-4 py-3 glass font-semibold">Меню</button>
      {mobileMenuOpen && <div className="fixed inset-0 z-[80] lg:hidden">
        <button className="absolute inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} aria-label="Закрыть меню" />
        <aside className="absolute left-0 top-0 h-full w-[82vw] max-w-[340px] p-5 overflow-y-auto" style={{ background: "#080c12", borderRight: "1px solid var(--line)" }}>
          <div className="flex items-center justify-between mb-8">
            <button onClick={() => { window.location.hash = "/"; setMobileMenuOpen(false); }} className="flex items-center gap-3 font-bold"><span className="logo-mark" /> ARSENIICOACH</button>
            <button onClick={() => setMobileMenuOpen(false)} className="rounded-full px-4 py-2 glass">×</button>
          </div>
          {[ ["overview", "Обзор"], ["applications", "Заявки"], ["clients", "Клиенты"], ["workouts", "Планы тренировок"], ["messages", "Сообщения"], ["settings", "Настройки"] ].map(([id, label]) => <button key={id} onClick={() => { setTab(id); setMobileMenuOpen(false); }} className="w-full text-left rounded-2xl px-4 py-3 mb-2" style={{ background: tab === id ? "rgba(104,225,253,.14)" : "transparent", color: tab === id ? "var(--ink)" : "var(--ink-3)", border: tab === id ? "1px solid rgba(104,225,253,.28)" : "1px solid transparent" }}>{label}</button>)}
          <button onClick={exit} className="w-full text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}>Выйти</button>
        </aside>
      </div>}

      <aside className="hidden lg:block border-r p-5 lg:min-h-screen" style={{ borderColor: "var(--line)", background: "rgba(0,0,0,.18)" }}>
        <button onClick={() => window.location.hash = "/"} className="flex items-center gap-3 font-bold mb-8"><span className="logo-mark" /> ARSENIICOACH</button>
        {[ ["overview", "Обзор"], ["applications", "Заявки"], ["clients", "Клиенты"], ["workouts", "Планы тренировок"], ["messages", "Сообщения"], ["settings", "Настройки"] ].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className="w-full text-left rounded-2xl px-4 py-3 mb-2" style={{ background: tab === id ? "rgba(104,225,253,.14)" : "transparent", color: tab === id ? "var(--ink)" : "var(--ink-3)", border: tab === id ? "1px solid rgba(104,225,253,.28)" : "1px solid transparent" }}>{label}</button>)}
        <button onClick={exit} className="w-full text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}>Выйти</button>
      </aside>

      <section className="p-4 pt-20 md:p-8 relative overflow-hidden">
        <div className="grid-overlay fixed inset-0 opacity-30 pointer-events-none" />
        <header className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div><div className="eyebrow">Кабинет тренера</div><h1 className="mt-2 text-4xl md:text-6xl font-extrabold tracking-[-.025em]">Привет, {user?.name || "Арсений"}</h1><p style={{ color: "var(--ink-2)" }}>Telegram: {user?.telegram || "@president_h"}</p></div>
          <div className="flex gap-3 flex-wrap"><button onClick={addClient} className="rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Добавить клиента</button><button onClick={addWorkout} className="rounded-full px-5 py-3 glass">Создать план</button></div>
        </header>

        {syncStatus && <div className="relative z-10 mb-4 app-card rounded-2xl p-4" style={{ color: "#ffb4c1" }}>{syncStatus}</div>}

        {tab === "overview" && <div className="relative z-10 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><Metric title="Клиентов" value={clients.length} /><Metric title="Планов" value={workouts.length} /><Metric title="Средний прогресс" value={`${average}%`} /><Metric title="Нужно ответить" value={messages.length} onClick={() => setTab("messages")} hint="Открыть" /></div>
          <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_.85fr] gap-5"><Panel title="Клиенты" subtitle="статусы и назначенные планы"><ClientList clients={clients} workouts={workouts} onSelect={(id) => { setSelectedClientId(id); setTab("clients"); }} /></Panel><Panel title="Уведомления" subtitle="из кабинета клиентов"><MessageList messages={messages} onOpenClients={() => setTab("clients")} /></Panel></div>
        </div>}

        {tab === "applications" && <Panel title="Заявки с главной страницы" subtitle="анкеты, которые заполнили посетители сайта"><div className="flex justify-end mb-4"><button onClick={loadApplications} className="rounded-full px-5 py-3 glass">Обновить заявки</button></div>{applicationsStatus && <p className="mb-4" style={{ color: "var(--ink-2)" }}>{applicationsStatus}</p>}<ApplicationsList applications={applications} clients={clients} onCreateClient={createClientFromApplication} onDeleteApplication={deleteApplication} /></Panel>}

        {tab === "clients" && !selectedClient && <Panel title="Клиенты" subtitle="список пока пуст"><p style={{ color: "var(--ink-2)" }}>Клиентов пока нет. Нажмите «Добавить клиента», чтобы создать первого.</p></Panel>}
        {tab === "clients" && selectedClient && <Panel title="Редактирование клиента" subtitle="можно менять всё: контакты, цель, питание, тренировку, прогресс"><div className="grid grid-cols-1 xl:grid-cols-[330px_1fr] gap-5"><div className="space-y-3">{clients.map(c => <button key={c.id} onClick={() => setSelectedClientId(c.id)} className="w-full text-left app-card rounded-3xl p-4" style={{ borderColor: selectedClient.id === c.id ? "rgba(104,225,253,.45)" : "var(--line)" }}><b>{c.name}</b><p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{c.telegram} • {c.progress}%</p></button>)}</div><ClientEditor client={selectedClient} workouts={workouts} onChange={updateClient} onDelete={deleteClient} /></div></Panel>}

        {tab === "workouts" && !selectedWorkout && <Panel title="Планы тренировок" subtitle="список пока пуст"><p style={{ color: "var(--ink-2)" }}>Планов пока нет. Нажмите «Создать план», чтобы добавить первый план тренировок.</p></Panel>}
        {tab === "workouts" && selectedWorkout && <Panel title="Конструктор планов тренировок" subtitle="создавай и редактируй программы, потом назначай клиентам"><div className="grid grid-cols-1 xl:grid-cols-[330px_1fr] gap-5"><div className="space-y-3">{workouts.map(w => <button key={w.id} onClick={() => setSelectedWorkoutId(w.id)} className="w-full text-left app-card rounded-3xl p-4" style={{ borderColor: selectedWorkout.id === w.id ? "rgba(104,225,253,.45)" : "var(--line)" }}><b>{w.title}</b><p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{w.day} • {w.exercises.length} упражнений</p></button>)}</div><WorkoutEditor workout={selectedWorkout} clients={clients} onChange={updateWorkout} onDelete={deleteWorkout} onDuplicate={duplicateWorkout} onBulkAssign={assignWorkoutToClients} /></div></Panel>}

        {tab === "messages" && <Panel title="Сообщения и Telegram" subtitle="уведомления и контакты клиентов"><MessageList messages={messages} onOpenClients={() => setTab("clients")} /><div className="mt-5 app-card rounded-3xl p-5"><h3 className="text-xl font-bold">Telegram интеграция</h3><p className="mt-2" style={{ color: "var(--ink-2)" }}>В продакшене сюда можно подключить Telegram Bot API, чтобы заявки и уведомления приходили в Telegram @president_h.</p></div></Panel>}
        {tab === "settings" && <Panel title="Редактирование главной страницы" subtitle="текст, кнопка и фото на лендинге"><SiteEditor settings={siteSettingsState} onChange={(next) => { updateSiteSettingsState(next); setSiteSettings(next); if (isSupabaseConfigured) saveSiteSettingsDb(next).catch((error) => setSyncStatus(error instanceof Error ? error.message : "Не удалось сохранить главную")); }} /></Panel>}
      </section>
    </main>
  );
};

const Metric = ({ title, value, onClick, hint }: { title: string; value: string | number; onClick?: () => void; hint?: string }) => {
  const content = <><p className="text-sm" style={{ color: "var(--ink-3)" }}>{title}</p><b className="text-3xl mt-2 block">{value}</b>{hint && <span className="text-xs mt-2 block" style={{ color: "var(--accent)" }}>{hint}</span>}</>;
  if (onClick) return <button onClick={onClick} className="glass rounded-3xl p-5 text-left hover:scale-[1.01] transition">{content}</button>;
  return <div className="glass rounded-3xl p-5">{content}</div>;
};
const Panel = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => <section className="relative z-10 glass rounded-[2rem] p-5 md:p-6"><div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-5"><h2 className="text-3xl font-bold tracking-[-.02em]">{title}</h2><span className="text-sm" style={{ color: "var(--ink-3)" }}>{subtitle}</span></div>{children}</section>;
const ClientList = ({ clients, workouts, onSelect }: { clients: Client[]; workouts: Workout[]; onSelect: (id: string) => void }) => <div className="space-y-3">{clients.map(c => <button key={c.id} onClick={() => onSelect(c.id)} className="w-full text-left app-card rounded-3xl p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3"><div><h3 className="font-bold text-xl">{c.name}</h3><p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>{workouts.find(w => w.id === c.assignedWorkoutId)?.title || c.plan} • {c.telegram}</p></div><div className="text-left md:text-right"><span className="rounded-full px-3 py-1 text-sm" style={{ background: c.status === "Пропуск" ? "rgba(255,120,140,.13)" : "rgba(104,225,253,.13)", color: c.status === "Пропуск" ? "#ff8a98" : "var(--accent)" }}>{c.status}</span><p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>Прогресс {c.progress}%</p></div></button>)}</div>;
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
        <div key={application.id} className="app-card rounded-3xl p-5">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-bold">{application.name || "Без имени"}</h3>
                <span className="rounded-full px-3 py-1 text-xs" style={{ background: "rgba(104,225,253,.13)", color: "var(--accent)" }}>{isAdded ? "Добавлена в клиенты" : "Новая"}</span>
              </div>
              <p className="mt-1" style={{ color: "var(--ink-2)" }}>{application.telegram} • {application.email}</p>
              {application.created_at && <p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>{new Date(application.created_at).toLocaleString("ru-RU")}</p>}
            </div>
            <div className="flex gap-2 flex-wrap">
              {isAdded ? <span className="rounded-full px-5 py-3 font-semibold" style={{ background: "rgba(104,225,253,.12)", color: "var(--accent)" }}>Уже в клиентах</span> : <button onClick={() => onCreateClient(application)} className="rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Добавить в клиенты</button>}
              <button onClick={() => onDeleteApplication(application)} className="rounded-full px-5 py-3 font-semibold" style={{ background: "rgba(255,120,140,.13)", color: "#ff8a98" }}>Удалить заявку</button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5 text-sm" style={{ color: "var(--ink-2)" }}>
            <p><b style={{ color: "var(--ink)" }}>Цель:</b> {application.goal || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Опыт:</b> {application.duration || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Мешает:</b> {application.obstacle || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Готовность:</b> {application.commitment || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Когда старт:</b> {application.start_timeline || application.startTimeline || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Что ищет:</b> {application.looking_for || application.lookingFor || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Инвестиции:</b> {application.ready_to_invest || application.readyToInvest || "—"}</p>
            <p><b style={{ color: "var(--ink)" }}>Instagram:</b> {application.instagram || "—"}</p>
          </div>
        </div>
        );
      })}
    </div>
  );
};

const MessageList = ({ messages, onOpenClients }: { messages: Message[]; onOpenClients?: () => void }) => (
  <div className="space-y-3">
    <div className="app-card rounded-2xl p-4">
      <b>Как с этим работать</b>
      <p className="mt-1 text-sm" style={{ color: "var(--ink-2)" }}>Это не чат, а список событий: заявка, выполненная тренировка или действие клиента. Чтобы ответить, открой клиента и напиши ему в Telegram, либо поменяй план/комментарий в карточке клиента.</p>
      {onOpenClients && <button onClick={onOpenClients} className="mt-3 rounded-full px-4 py-2 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Открыть клиентов</button>}
    </div>
    {!messages.length && <p style={{ color: "var(--ink-2)" }}>Новых событий пока нет.</p>}
    {messages.map(m => <div key={m.id} className="app-card rounded-2xl p-4">
      <b>{m.from}</b>
      <p className="mt-1" style={{ color: "var(--ink-2)" }}>{m.text}</p>
      <span className="text-xs" style={{ color: "var(--ink-3)" }}>{m.time}</span>
      <div className="mt-3 flex gap-2 flex-wrap">
        {onOpenClients && <button onClick={onOpenClients} className="rounded-full px-4 py-2 glass text-sm">Открыть клиента</button>}
        {m.url && <a href={m.url} className="rounded-full px-4 py-2 glass text-sm">Открыть событие</a>}
      </div>
    </div>)}
  </div>
);

const Field = ({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) => <label className="block text-sm" style={{ color: "var(--ink-3)" }}>{label}<input value={value} type={type} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} /></label>;
const TextArea = ({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) => <label className="block text-sm" style={{ color: "var(--ink-3)" }}>{label}<textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} /></label>;
const ReadOnlyInput = ({ label, value }: { label: string; value: string }) => <Field label={label} value={value} onChange={() => {}} />;

const ClientEditor = ({ client, workouts, onChange, onDelete }: { client: Client; workouts: Workout[]; onChange: (patch: Partial<Client>) => void; onDelete: () => void }) => {
  const [clientPassword, setClientPassword] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [showClientPassword, setShowClientPassword] = useState(false);
  const [assignedPlanDraft, setAssignedPlanDraft] = useState(client.assignedWorkoutId || "");
  const [nextPlanDraft, setNextPlanDraft] = useState(client.nextPlanId || "");
  const [nextPlanDateDraft, setNextPlanDateDraft] = useState(client.nextPlanWeekStart || "");

  const buildPassword = () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  };

  const passwordStorageKey = (clientId: string) => `arseniiCoachTempPassword:${clientId}`;

  useEffect(() => {
    setAssignedPlanDraft(client.assignedWorkoutId || "");
    setNextPlanDraft(client.nextPlanId || "");
    setNextPlanDateDraft(client.nextPlanWeekStart || "");
  }, [client.id, client.assignedWorkoutId, client.nextPlanId, client.nextPlanWeekStart]);

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

  const nextMonday = () => {
    const date = new Date();
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day + 7);
    return date.toISOString().slice(0, 10);
  };

  const savePlanAssignment = () => {
    const workout = workouts.find((item) => item.id === assignedPlanDraft);
    const weeklyPlan = workout?.weeklyTemplate ? Object.fromEntries(Object.keys(workout.weeklyTemplate).map((day) => [day, assignedPlanDraft])) : {};
    onChange({
      assignedWorkoutId: assignedPlanDraft,
      weeklyPlan,
      plan: workout?.title || "",
      nextPlanId: nextPlanDraft || undefined,
      nextPlanWeekStart: nextPlanDraft ? (nextPlanDateDraft || nextMonday()) : undefined,
    });
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

      <div className="app-card rounded-3xl p-4">
        <h3 className="text-xl font-bold">Аккаунт клиента</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>
          Пароль не сохраняется в коде сайта и не записывается в базу clients. Он передаётся в Supabase Auth через защищённую серверную функцию.
        </p>
        <div className="grid grid-cols-1 gap-3">
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
            Временный пароль клиента
            <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2">
              <input value={clientPassword} type={showClientPassword ? "text" : "password"} readOnly className="w-full rounded-xl px-4 py-3 cursor-default" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} />
              <button type="button" onClick={() => setShowClientPassword((value) => !value)} className="rounded-xl px-4 glass">{showClientPassword ? "Скрыть" : "Показать"}</button>
              <button type="button" onClick={generatePassword} className="rounded-xl px-4 glass">Сгенерировать</button>
            </div>
          </label>
          <button disabled={isCreatingAccount || !clientPassword} onClick={createAccount} className="rounded-xl px-5 py-3 font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--bg)" }}>
            {client.userId ? (isCreatingAccount ? "Обновляю..." : "Обновить пароль") : (isCreatingAccount ? "Создаю..." : "Создать аккаунт")}
          </button>
        </div>
        {client.userId && <p className="text-sm mt-3" style={{ color: "var(--accent)" }}>Клиентский аккаунт привязан. Пароль можно в любой момент сгенерировать заново и обновить.</p>}
        {accountStatus && <p className="text-sm mt-3" style={{ color: ["создан", "сгенерирован", "обновлён", "привязан", "Скопируй"].some((word) => accountStatus.includes(word)) ? "var(--accent)" : "#ff8a98" }}>{accountStatus}</p>}
      </div>

      <div className="app-card rounded-3xl p-4">
        <h3 className="text-xl font-bold">Назначение плана</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>Выбери текущий план и, если нужно, план на следующую неделю. Изменения применятся после кнопки «Сохранить назначение».</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
            Текущий план
            <select value={assignedPlanDraft} onChange={(e) => setAssignedPlanDraft(e.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
              <option value="">План не выбран</option>
              {workouts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
          </label>
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
            План на следующую неделю
            <select value={nextPlanDraft} onChange={(e) => { setNextPlanDraft(e.target.value); if (e.target.value && !nextPlanDateDraft) setNextPlanDateDraft(nextMonday()); }} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
              <option value="">Не назначать заранее</option>
              {workouts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
          </label>
          <Field label="Дата начала следующего плана" type="date" value={nextPlanDateDraft} onChange={setNextPlanDateDraft} />
        </div>
        <button type="button" onClick={savePlanAssignment} className="mt-4 rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Сохранить назначение</button>
      </div>
      <TextArea label="Цель клиента" value={client.goal} onChange={(goal) => onChange({ goal })} />
      <TextArea label="Питание / рекомендации" value={client.nutrition} onChange={(nutrition) => onChange({ nutrition })} />
      <TextArea label="Комментарий тренера" value={client.comment} onChange={(comment) => onChange({ comment })} />
      <button onClick={onDelete} className="rounded-full px-5 py-3" style={{ background: "rgba(255,120,140,.13)", color: "#ff8a98" }}>Удалить клиента</button>
    </div>
  );
};

const weekDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

const WeeklyPlanEditor = ({ client, workouts, onChange }: { client: Client; workouts: Workout[]; onChange: (patch: Partial<Client>) => void }) => {
  const plan = client.weeklyPlan || {};
  const setDay = (day: string, workoutId: string) => {
    const next = { ...plan };
    if (!workoutId) delete next[day];
    else next[day] = workoutId;
    const firstWorkoutId = Object.values(next)[0] || client.assignedWorkoutId;
    const firstWorkout = workouts.find((workout) => workout.id === firstWorkoutId);
    onChange({ weeklyPlan: next, assignedWorkoutId: firstWorkoutId, plan: firstWorkout?.title || client.plan });
  };
  return (
    <div className="app-card rounded-3xl p-4">
      <h3 className="text-xl font-bold">План на неделю</h3>
      <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>Можно назначить сразу несколько тренировок на разные дни недели.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {weekDays.map((day) => (
          <label key={day} className="block text-sm" style={{ color: "var(--ink-3)" }}>
            {day}
            <select value={plan[day] || ""} onChange={(event) => setDay(day, event.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
              <option value="">Отдых</option>
              {workouts.map((workout) => <option key={workout.id} value={workout.id}>{workout.title}</option>)}
            </select>
          </label>
        ))}
      </div>
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
        <button type="button" onClick={addExercise} className="rounded-full px-4 py-2 text-sm glass">Добавить упражнение</button>
      </div>
      <div className="space-y-2">
        {exercises.length === 0 && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Упражнений пока нет. Нажмите «Добавить упражнение».</p>}
        {exercises.map((exercise, index) => (
          <div key={index} className="grid grid-cols-[1fr_auto] gap-2">
            <input value={exercise} onChange={(event) => updateExercise(index, event.target.value)} placeholder="Например: Жим лёжа — 4×8" className="w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} />
            <button type="button" onClick={() => removeExercise(index)} className="rounded-xl px-3" style={{ background: "rgba(255,120,140,.13)", color: "#ff8a98" }}>×</button>
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
        <Field label="Краткий фокус плана" value={draft.focus} onChange={(focus) => { setDraft({ ...draft, focus }); setStatus(""); }} />
      </div>
      <TextArea label="Общие заметки к плану" value={draft.notes} onChange={(notes) => { setDraft({ ...draft, notes }); setStatus(""); }} />

      <div className="app-card rounded-3xl p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold">Тренировочные дни</h3>
            <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>Добавляй только те дни, когда у клиента есть тренировка. Дни отдыха не создаются.</p>
          </div>
          <button disabled={!availableDays.length} type="button" onClick={addTrainingDay} className="rounded-full px-5 py-3 font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--bg)" }}>Добавить день</button>
        </div>
        {!usedDays.length && <p className="text-sm" style={{ color: "var(--ink-3)" }}>В плане пока нет тренировочных дней. Нажми «Добавить день».</p>}
        <div className="space-y-5">
          {usedDays.sort((a, b) => weekDays.indexOf(a) - weekDays.indexOf(b)).map((day) => {
            const dayWorkout = draft.weeklyTemplate?.[day] || { title: "Новая тренировка", focus: "", notes: "", exercises: [] };
            return (
              <div key={day} className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                  <select value={day} onChange={(event) => renameTrainingDay(day, event.target.value)} className="rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
                    {[day, ...availableDays].sort((a, b) => weekDays.indexOf(a) - weekDays.indexOf(b)).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <button type="button" onClick={() => removeTrainingDay(day)} className="rounded-full px-4 py-2" style={{ background: "rgba(255,120,140,.13)", color: "#ff8a98" }}>Удалить день</button>
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

      <div className="app-card rounded-3xl p-4">
        <h3 className="text-xl font-bold">Массовое назначение</h3>
        <p className="text-sm mt-1 mb-4" style={{ color: "var(--ink-3)" }}>Выбери клиентов, которым нужно назначить этот план сразу.</p>
        {!clients.length && <p className="text-sm" style={{ color: "var(--ink-3)" }}>Клиентов пока нет.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {clients.map((client) => (
            <label key={client.id} className="app-card rounded-2xl p-3 flex items-center gap-3">
              <input type="checkbox" checked={bulkClientIds.includes(client.id)} onChange={() => toggleBulkClient(client.id)} />
              <span>{client.name}</span>
            </label>
          ))}
        </div>
        <button type="button" disabled={!bulkClientIds.length} onClick={handleBulkAssign} className="mt-4 rounded-full px-5 py-3 font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--bg)" }}>Назначить выбранным</button>
      </div>

      <div className="sticky bottom-4 z-20 glass rounded-3xl p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div>
          <h3 className="font-bold">Сохранение плана</h3>
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>Изменения применятся только после нажатия кнопки.</p>
          {status && <p className="text-sm mt-1" style={{ color: "var(--accent)" }}>{status}</p>}
        </div>
        <div className="flex gap-3 flex-wrap">
          <button onClick={save} className="rounded-full px-6 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Сохранить план</button>
          <button onClick={onDuplicate} className="rounded-full px-5 py-3 glass">Дублировать план</button>
          <button onClick={onDelete} className="rounded-full px-5 py-3" style={{ background: "rgba(255,120,140,.13)", color: "#ff8a98" }}>Удалить план</button>
        </div>
      </div>
    </div>
  );
};

const SiteEditor = ({ settings, onChange }: { settings: SiteSettings; onChange: (settings: SiteSettings) => void }) => {
  const [draft, setDraft] = useState<SiteSettings>(settings);
  const [status, setStatus] = useState("");

  useEffect(() => setDraft(settings), [settings]);

  const update = (patch: Partial<SiteSettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus("");
  };

  const uploadPhoto = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update({ photoDataUrl: String(reader.result || "") });
    reader.readAsDataURL(file);
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
          <button onClick={save} className="rounded-full px-6 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Сохранить изменения</button>
        </div>
      </div>
      <div className="space-y-4">
        <div className="app-card rounded-3xl p-4">
          <h3 className="text-xl font-bold">Фото на главной</h3>
          <p className="text-sm mt-2" style={{ color: "var(--ink-3)" }}>Лучше загружать уже обрезанный вертикальный портрет 4:5 или 3:4.</p>
          <div className="mt-4 aspect-[4/5] rounded-3xl overflow-hidden grid place-items-center" style={{ background: "rgba(255,255,255,.06)", border: "1px solid var(--line)" }}>
            {draft.photoDataUrl ? <img src={draft.photoDataUrl} alt="Фото на главной" className="h-full w-full object-cover object-center rounded-2xl" /> : <span style={{ color: "var(--ink-3)" }}>Фото не загружено</span>}
          </div>
          <input type="file" accept="image/*" onChange={(event) => uploadPhoto(event.target.files?.[0] || null)} className="mt-4 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} />
          <button onClick={() => update({ photoDataUrl: "" })} className="mt-3 rounded-full px-5 py-3 app-card">Убрать фото</button>
        </div>
        <div className="app-card rounded-3xl p-4">
          <h3 className="text-xl font-bold">Предпросмотр</h3>
          <p className="text-sm mt-2" style={{ color: "var(--ink-3)" }}>Сначала нажми «Сохранить изменения», затем открой главную.</p>
          <button onClick={() => window.location.hash = "/"} className="mt-4 rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Открыть главную</button>
          <button onClick={reset} className="mt-3 ml-0 xl:ml-3 rounded-full px-5 py-3" style={{ background: "rgba(255,120,140,.13)", color: "#ff8a98" }}>Сбросить тексты</button>
        </div>
      </div>
    </div>
  );
};

export default CoachDashboard;
