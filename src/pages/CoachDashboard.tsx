import { useEffect, useMemo, useState } from "react";
import { enablePushNotifications } from "../lib/push";
import { createClientAccount } from "../lib/admin";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { Client, getClients, getMessages, getSiteSettings, getUser, getWorkouts, logout, makeId, Message, resetSiteSettings, setClients, setMessages, setSiteSettings, setWorkouts, SiteSettings, Workout } from "../lib/storage";

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

const emptyWorkout = (): Workout => ({ id: makeId(), title: "Новая тренировка", day: "Понедельник", focus: "", notes: "", exercises: ["Новое упражнение — 3×10"] });

const CoachDashboard = () => {
  const user = getUser();
  const [tab, setTab] = useState("overview");
  const [clients, updateClients] = useState<Client[]>(getClients().map((client) => ({ ...client, weeklyPlan: client.weeklyPlan || { "Понедельник": client.assignedWorkoutId } })));
  const [workouts, updateWorkouts] = useState<Workout[]>(getWorkouts());
  const [messages, updateMessages] = useState<Message[]>(getMessages());
  const [siteSettingsState, updateSiteSettingsState] = useState<SiteSettings>(getSiteSettings());
  const [applications, setApplications] = useState<Application[]>([]);
  const [applicationsStatus, setApplicationsStatus] = useState("");
  const [pushStatus, setPushStatus] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || "");
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(workouts[0]?.id || "");
  const selectedClient = clients.find((c) => c.id === selectedClientId) || clients[0];
  const selectedWorkout = workouts.find((w) => w.id === selectedWorkoutId) || workouts[0];
  const average = useMemo(() => clients.length ? Math.round(clients.reduce((sum, c) => sum + c.progress, 0) / clients.length) : 0, [clients]);

  useEffect(() => { if (tab === "applications") loadApplications(); }, [tab]);

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
    saveClients(clients.map((client) => client.id === selectedClient.id ? { ...client, ...patch } : client));
  };

  const addClient = () => {
    const client = emptyClient(workouts[0]?.id || "");
    const next = [client, ...clients];
    saveClients(next);
    setSelectedClientId(client.id);
    setTab("clients");
  };

  const deleteClient = () => {
    if (!selectedClient || !confirm(`Удалить клиента ${selectedClient.name}?`)) return;
    const next = clients.filter((client) => client.id !== selectedClient.id);
    saveClients(next);
    setSelectedClientId(next[0]?.id || "");
  };

  const updateWorkout = (patch: Partial<Workout>) => {
    if (!selectedWorkout) return;
    saveWorkouts(workouts.map((workout) => workout.id === selectedWorkout.id ? { ...workout, ...patch } : workout));
  };

  const addWorkout = () => {
    const workout = emptyWorkout();
    const next = [workout, ...workouts];
    saveWorkouts(next);
    setSelectedWorkoutId(workout.id);
    setTab("workouts");
  };

  const deleteWorkout = () => {
    if (!selectedWorkout || workouts.length <= 1) return alert("Нельзя удалить последнюю тренировку");
    if (!confirm(`Удалить тренировку ${selectedWorkout.title}?`)) return;
    const next = workouts.filter((workout) => workout.id !== selectedWorkout.id);
    saveWorkouts(next);
    setSelectedWorkoutId(next[0]?.id || "");
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

    saveClients([client, ...clients]);
    setSelectedClientId(client.id);
    setTab("clients");

    if (isSupabaseConfigured) {
      await supabase.from("applications").update({ status: "Добавлена в клиенты" }).eq("id", application.id);
      loadApplications();
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
      <aside className="border-r p-5 lg:min-h-screen" style={{ borderColor: "var(--line)", background: "rgba(0,0,0,.18)" }}>
        <button onClick={() => window.location.hash = "/"} className="flex items-center gap-3 font-bold mb-8"><span className="logo-mark" /> ARSENIICOACH</button>
        {[ ["overview", "Обзор"], ["applications", "Заявки"], ["clients", "Клиенты"], ["workouts", "Планы тренировок"], ["messages", "Сообщения"], ["settings", "Настройки"] ].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className="w-full text-left rounded-2xl px-4 py-3 mb-2" style={{ background: tab === id ? "rgba(104,225,253,.14)" : "transparent", color: tab === id ? "var(--ink)" : "var(--ink-3)", border: tab === id ? "1px solid rgba(104,225,253,.28)" : "1px solid transparent" }}>{label}</button>)}
        <button onClick={exit} className="w-full text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}>Выйти</button>
      </aside>

      <section className="p-4 md:p-8 relative overflow-hidden">
        <div className="grid-overlay fixed inset-0 opacity-30 pointer-events-none" />
        <header className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div><div className="eyebrow">Кабинет тренера</div><h1 className="mt-2 text-4xl md:text-6xl font-extrabold tracking-[-.025em]">Привет, {user?.name || "Арсений"}</h1><p style={{ color: "var(--ink-2)" }}>Telegram: {user?.telegram || "@president_h"}</p></div>
          <div className="flex gap-3 flex-wrap"><button onClick={addClient} className="rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Добавить клиента</button><button onClick={addWorkout} className="rounded-full px-5 py-3 glass">Создать план</button></div>
        </header>

        {tab === "overview" && <div className="relative z-10 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><Metric title="Клиентов" value={clients.length} /><Metric title="Планов" value={workouts.length} /><Metric title="Средний прогресс" value={`${average}%`} /><Metric title="Нужно ответить" value={messages.length} /></div>
          <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_.85fr] gap-5"><Panel title="Клиенты" subtitle="статусы и назначенные планы"><ClientList clients={clients} workouts={workouts} onSelect={(id) => { setSelectedClientId(id); setTab("clients"); }} /></Panel><Panel title="Уведомления" subtitle="из кабинета клиентов"><MessageList messages={messages} /></Panel></div>
        </div>}

        {tab === "applications" && <Panel title="Заявки с главной страницы" subtitle="анкеты, которые заполнили посетители сайта"><div className="flex justify-end mb-4"><button onClick={loadApplications} className="rounded-full px-5 py-3 glass">Обновить заявки</button></div>{applicationsStatus && <p className="mb-4" style={{ color: "var(--ink-2)" }}>{applicationsStatus}</p>}<ApplicationsList applications={applications} onCreateClient={createClientFromApplication} /></Panel>}

        {tab === "clients" && !selectedClient && <Panel title="Клиенты" subtitle="список пока пуст"><p style={{ color: "var(--ink-2)" }}>Клиентов пока нет. Нажмите «Добавить клиента», чтобы создать первого.</p></Panel>}
        {tab === "clients" && selectedClient && <Panel title="Редактирование клиента" subtitle="можно менять всё: контакты, цель, питание, тренировку, прогресс"><div className="grid grid-cols-1 xl:grid-cols-[330px_1fr] gap-5"><div className="space-y-3">{clients.map(c => <button key={c.id} onClick={() => setSelectedClientId(c.id)} className="w-full text-left app-card rounded-3xl p-4" style={{ borderColor: selectedClient.id === c.id ? "rgba(104,225,253,.45)" : "var(--line)" }}><b>{c.name}</b><p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{c.telegram} • {c.progress}%</p></button>)}</div><ClientEditor client={selectedClient} workouts={workouts} onChange={updateClient} onDelete={deleteClient} /></div></Panel>}

        {tab === "workouts" && !selectedWorkout && <Panel title="Планы тренировок" subtitle="список пока пуст"><p style={{ color: "var(--ink-2)" }}>Планов пока нет. Нажмите «Создать план», чтобы добавить первый план тренировок.</p></Panel>}
        {tab === "workouts" && selectedWorkout && <Panel title="Конструктор планов тренировок" subtitle="создавай и редактируй программы, потом назначай клиентам"><div className="grid grid-cols-1 xl:grid-cols-[330px_1fr] gap-5"><div className="space-y-3">{workouts.map(w => <button key={w.id} onClick={() => setSelectedWorkoutId(w.id)} className="w-full text-left app-card rounded-3xl p-4" style={{ borderColor: selectedWorkout.id === w.id ? "rgba(104,225,253,.45)" : "var(--line)" }}><b>{w.title}</b><p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{w.day} • {w.exercises.length} упражнений</p></button>)}</div><WorkoutEditor workout={selectedWorkout} onChange={updateWorkout} onDelete={deleteWorkout} /></div></Panel>}

        {tab === "messages" && <Panel title="Сообщения и Telegram" subtitle="уведомления и контакты клиентов"><MessageList messages={messages} /><div className="mt-5 app-card rounded-3xl p-5"><h3 className="text-xl font-bold">Telegram интеграция</h3><p className="mt-2" style={{ color: "var(--ink-2)" }}>В продакшене сюда можно подключить Telegram Bot API, чтобы заявки и уведомления приходили в Telegram @president_h.</p></div></Panel>}
        {tab === "settings" && <Panel title="Редактирование главной страницы" subtitle="текст, кнопка и фото на лендинге"><SiteEditor settings={siteSettingsState} onChange={(next) => { updateSiteSettingsState(next); setSiteSettings(next); }} /></Panel>}
      </section>
    </main>
  );
};

const Metric = ({ title, value }: { title: string; value: string | number }) => <div className="glass rounded-3xl p-5"><p className="text-sm" style={{ color: "var(--ink-3)" }}>{title}</p><b className="text-3xl mt-2 block">{value}</b></div>;
const Panel = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => <section className="relative z-10 glass rounded-[2rem] p-5 md:p-6"><div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-5"><h2 className="text-3xl font-bold tracking-[-.02em]">{title}</h2><span className="text-sm" style={{ color: "var(--ink-3)" }}>{subtitle}</span></div>{children}</section>;
const ClientList = ({ clients, workouts, onSelect }: { clients: Client[]; workouts: Workout[]; onSelect: (id: string) => void }) => <div className="space-y-3">{clients.map(c => <button key={c.id} onClick={() => onSelect(c.id)} className="w-full text-left app-card rounded-3xl p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3"><div><h3 className="font-bold text-xl">{c.name}</h3><p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>{workouts.find(w => w.id === c.assignedWorkoutId)?.title || c.plan} • {c.telegram}</p></div><div className="text-left md:text-right"><span className="rounded-full px-3 py-1 text-sm" style={{ background: c.status === "Пропуск" ? "rgba(255,120,140,.13)" : "rgba(104,225,253,.13)", color: c.status === "Пропуск" ? "#ff8a98" : "var(--accent)" }}>{c.status}</span><p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>Прогресс {c.progress}%</p></div></button>)}</div>;
const ApplicationsList = ({ applications, onCreateClient }: { applications: Application[]; onCreateClient: (application: Application) => void }) => {
  if (!applications.length) return <p style={{ color: "var(--ink-2)" }}>Заявок пока нет.</p>;

  return (
    <div className="space-y-4">
      {applications.map((application) => (
        <div key={application.id} className="app-card rounded-3xl p-5">
          <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-bold">{application.name || "Без имени"}</h3>
                <span className="rounded-full px-3 py-1 text-xs" style={{ background: "rgba(104,225,253,.13)", color: "var(--accent)" }}>{application.status || "Новая"}</span>
              </div>
              <p className="mt-1" style={{ color: "var(--ink-2)" }}>{application.telegram} • {application.email}</p>
              {application.created_at && <p className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>{new Date(application.created_at).toLocaleString("ru-RU")}</p>}
            </div>
            <button onClick={() => onCreateClient(application)} className="rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Добавить в клиенты</button>
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
      ))}
    </div>
  );
};

const MessageList = ({ messages }: { messages: Message[] }) => <div className="space-y-3">{messages.map(m => <div key={m.id} className="app-card rounded-2xl p-4"><b>{m.from}</b><p className="mt-1" style={{ color: "var(--ink-2)" }}>{m.text}</p><span className="text-xs" style={{ color: "var(--ink-3)" }}>{m.time}</span></div>)}</div>;

const Field = ({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) => <label className="block text-sm" style={{ color: "var(--ink-3)" }}>{label}<input value={value} type={type} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} /></label>;
const TextArea = ({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) => <label className="block text-sm" style={{ color: "var(--ink-3)" }}>{label}<textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} /></label>;
const ReadOnlyInput = ({ label, value }: { label: string; value: string }) => <Field label={label} value={value} onChange={() => {}} />;

const ClientEditor = ({ client, workouts, onChange, onDelete }: { client: Client; workouts: Workout[]; onChange: (patch: Partial<Client>) => void; onDelete: () => void }) => {
  const [clientPassword, setClientPassword] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);

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
      });
      onChange({ userId: created.userId });
      setClientPassword("");
      setAccountStatus("Аккаунт клиента создан. Теперь клиент может войти по email и паролю.");
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
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <Field label="Временный пароль клиента" type="password" value={clientPassword} onChange={setClientPassword} />
          <button disabled={isCreatingAccount || Boolean(client.userId)} onClick={createAccount} className="rounded-xl px-5 py-3 font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--bg)" }}>
            {client.userId ? "Аккаунт создан" : isCreatingAccount ? "Создаю..." : "Создать аккаунт"}
          </button>
        </div>
        {client.userId && <p className="text-sm mt-3" style={{ color: "var(--accent)" }}>Клиентский аккаунт привязан к этому клиенту.</p>}
        {accountStatus && <p className="text-sm mt-3" style={{ color: accountStatus.includes("создан") ? "var(--accent)" : "#ff8a98" }}>{accountStatus}</p>}
      </div>

      <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
        Основной план
        <select value={client.assignedWorkoutId} onChange={(e) => { const workout = workouts.find(w => w.id === e.target.value); onChange({ assignedWorkoutId: e.target.value, plan: workout?.title || client.plan }); }} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
          <option value="">План не выбран</option>
          {workouts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
      </label>
      <WeeklyPlanEditor client={client} workouts={workouts} onChange={onChange} />
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

const WorkoutEditor = ({ workout, onChange, onDelete }: { workout: Workout; onChange: (patch: Partial<Workout>) => void; onDelete: () => void }) => <div className="space-y-4"><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Field label="Название плана" value={workout.title} onChange={(title) => onChange({ title })} /><Field label="День" value={workout.day} onChange={(day) => onChange({ day })} /><Field label="Фокус" value={workout.focus} onChange={(focus) => onChange({ focus })} /></div><TextArea label="Упражнения — каждое с новой строки" rows={8} value={workout.exercises.join("\n")} onChange={(value) => onChange({ exercises: value.split("\n").filter(Boolean) })} /><TextArea label="Заметки к тренировке" value={workout.notes} onChange={(notes) => onChange({ notes })} /><button onClick={onDelete} className="rounded-full px-5 py-3" style={{ background: "rgba(255,120,140,.13)", color: "#ff8a98" }}>Удалить план</button></div>;


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
          <p className="text-sm mt-2" style={{ color: "var(--ink-3)" }}>Лучше загружать вертикальное фото 4:5 или 3:4. Фото больше не растягивается и не обрезается грубо.</p>
          <div className="mt-4 aspect-[4/5] rounded-3xl overflow-hidden grid place-items-center p-3" style={{ background: "rgba(255,255,255,.06)", border: "1px solid var(--line)" }}>
            {draft.photoDataUrl ? <img src={draft.photoDataUrl} alt="Фото на главной" className="h-full w-full object-contain rounded-2xl" /> : <span style={{ color: "var(--ink-3)" }}>Фото не загружено</span>}
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
