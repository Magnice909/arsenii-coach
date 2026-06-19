import { useMemo, useState } from "react";
import { enablePushNotifications } from "../lib/push";
import { Client, getClients, getMessages, getSiteSettings, getUser, getWorkouts, logout, makeId, Message, resetSiteSettings, setClients, setMessages, setSiteSettings, setWorkouts, SiteSettings, Workout } from "../lib/storage";

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
  const [pushStatus, setPushStatus] = useState("");
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || "");
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(workouts[0]?.id || "");
  const selectedClient = clients.find((c) => c.id === selectedClientId) || clients[0];
  const selectedWorkout = workouts.find((w) => w.id === selectedWorkoutId) || workouts[0];
  const average = useMemo(() => clients.length ? Math.round(clients.reduce((sum, c) => sum + c.progress, 0) / clients.length) : 0, [clients]);

  const saveClients = (next: Client[]) => { updateClients(next); setClients(next); };
  const saveWorkouts = (next: Workout[]) => { updateWorkouts(next); setWorkouts(next); };

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

  const simulateNotification = () => {
    if (!clients.length) return;
    const client = clients[Math.floor(Math.random() * clients.length)];
    const nextMessages = [{ id: makeId(), from: client.name, text: `Обновил тренировку ${client.plan || "без названия"}`, time: "только что" }, ...messages].slice(0, 8);
    updateMessages(nextMessages);
    setMessages(nextMessages);
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
        {[ ["overview", "Обзор"], ["clients", "Клиенты"], ["workouts", "Планы тренировок"], ["messages", "Сообщения"], ["settings", "Настройки"] ].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className="w-full text-left rounded-2xl px-4 py-3 mb-2" style={{ background: tab === id ? "rgba(104,225,253,.14)" : "transparent", color: tab === id ? "var(--ink)" : "var(--ink-3)", border: tab === id ? "1px solid rgba(104,225,253,.28)" : "1px solid transparent" }}>{label}</button>)}
        <button onClick={exit} className="w-full text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}>Выйти</button>
      </aside>

      <section className="p-4 md:p-8 relative overflow-hidden">
        <div className="grid-overlay fixed inset-0 opacity-30 pointer-events-none" />
        <header className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div><div className="eyebrow">Кабинет тренера</div><h1 className="mt-2 text-4xl md:text-6xl font-extrabold tracking-[-.025em]">Привет, {user?.name || "Арсений"}</h1><p style={{ color: "var(--ink-2)" }}>Telegram: {user?.telegram || "@president_h"}</p></div>
          <div className="flex gap-3 flex-wrap"><button onClick={simulateNotification} className="rounded-full px-5 py-3 glass">Симулировать уведомление</button><button onClick={addClient} className="rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Добавить клиента</button><button onClick={addWorkout} className="rounded-full px-5 py-3 glass">Создать план</button></div>
        </header>

        {tab === "overview" && <div className="relative z-10 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><Metric title="Клиентов" value={clients.length} /><Metric title="Планов" value={workouts.length} /><Metric title="Средний прогресс" value={`${average}%`} /><Metric title="Нужно ответить" value={messages.length} /></div>
          <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_.85fr] gap-5"><Panel title="Клиенты" subtitle="статусы и назначенные планы"><ClientList clients={clients} workouts={workouts} onSelect={(id) => { setSelectedClientId(id); setTab("clients"); }} /></Panel><Panel title="Уведомления" subtitle="из кабинета клиентов"><MessageList messages={messages} /></Panel></div>
        </div>}

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
const MessageList = ({ messages }: { messages: Message[] }) => <div className="space-y-3">{messages.map(m => <div key={m.id} className="app-card rounded-2xl p-4"><b>{m.from}</b><p className="mt-1" style={{ color: "var(--ink-2)" }}>{m.text}</p><span className="text-xs" style={{ color: "var(--ink-3)" }}>{m.time}</span></div>)}</div>;

const Field = ({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (value: string) => void; type?: string }) => <label className="block text-sm" style={{ color: "var(--ink-3)" }}>{label}<input value={value} type={type} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} /></label>;
const TextArea = ({ label, value, onChange, rows = 4 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) => <label className="block text-sm" style={{ color: "var(--ink-3)" }}>{label}<textarea value={value} rows={rows} onChange={(e) => onChange(e.target.value)} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} /></label>;
const ReadOnlyInput = ({ label, value }: { label: string; value: string }) => <Field label={label} value={value} onChange={() => {}} />;

const ClientEditor = ({ client, workouts, onChange, onDelete }: { client: Client; workouts: Workout[]; onChange: (patch: Partial<Client>) => void; onDelete: () => void }) => <div className="space-y-4"><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Field label="Имя" value={client.name} onChange={(name) => onChange({ name })} /><Field label="Telegram" value={client.telegram} onChange={(telegram) => onChange({ telegram })} /><Field label="Email" value={client.email} onChange={(email) => onChange({ email })} /><Field label="Статус" value={client.status} onChange={(status) => onChange({ status })} /><Field label="Прогресс, %" type="number" value={client.progress} onChange={(progress) => onChange({ progress: Math.max(0, Math.min(100, Number(progress) || 0)) })} /><Field label="Следующая тренировка" value={client.nextWorkout} onChange={(nextWorkout) => onChange({ nextWorkout })} /></div><label className="block text-sm" style={{ color: "var(--ink-3)" }}>Основной план<select value={client.assignedWorkoutId} onChange={(e) => { const workout = workouts.find(w => w.id === e.target.value); onChange({ assignedWorkoutId: e.target.value, plan: workout?.title || client.plan }); }} className="mt-2 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>{workouts.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}</select></label><WeeklyPlanEditor client={client} workouts={workouts} onChange={onChange} /><TextArea label="Цель клиента" value={client.goal} onChange={(goal) => onChange({ goal })} /><TextArea label="Питание / рекомендации" value={client.nutrition} onChange={(nutrition) => onChange({ nutrition })} /><TextArea label="Комментарий тренера" value={client.comment} onChange={(comment) => onChange({ comment })} /><button onClick={onDelete} className="rounded-full px-5 py-3" style={{ background: "rgba(255,120,140,.13)", color: "#ff8a98" }}>Удалить клиента</button></div>;

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
  const update = (patch: Partial<SiteSettings>) => onChange({ ...settings, ...patch });
  const uploadPhoto = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update({ photoDataUrl: String(reader.result || "") });
    reader.readAsDataURL(file);
  };
  const reset = () => {
    resetSiteSettings();
    onChange(getSiteSettings());
  };
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
      <div className="space-y-4">
        <Field label="Название бренда" value={settings.brand} onChange={(brand) => update({ brand })} />
        <Field label="Текст бейджа над заголовком" value={settings.heroBadge} onChange={(heroBadge) => update({ heroBadge })} />
        <TextArea label="Главный заголовок" value={settings.heroTitle} onChange={(heroTitle) => update({ heroTitle })} rows={3} />
        <TextArea label="Описание под заголовком" value={settings.heroSubtitle} onChange={(heroSubtitle) => update({ heroSubtitle })} rows={4} />
        <Field label="Текст главной кнопки" value={settings.ctaText} onChange={(ctaText) => update({ ctaText })} />
        <Field label="Цитата" value={settings.quote} onChange={(quote) => update({ quote })} />
        <Field label="Заголовок блока о подходе" value={settings.approachTitle} onChange={(approachTitle) => update({ approachTitle })} />
        <TextArea label="Текст блока о подходе — часть 1" value={settings.approachText1} onChange={(approachText1) => update({ approachText1 })} rows={4} />
        <TextArea label="Текст блока о подходе — часть 2" value={settings.approachText2} onChange={(approachText2) => update({ approachText2 })} rows={4} />
      </div>
      <div className="space-y-4">
        <div className="app-card rounded-3xl p-4">
          <h3 className="text-xl font-bold">Фото на главной</h3>
          <p className="text-sm mt-2" style={{ color: "var(--ink-3)" }}>Загрузи фото, и оно заменит заглушку на главной странице.</p>
          <div className="mt-4 aspect-[4/5] rounded-3xl overflow-hidden grid place-items-center" style={{ background: "rgba(255,255,255,.06)", border: "1px solid var(--line)" }}>
            {settings.photoDataUrl ? <img src={settings.photoDataUrl} alt="Фото на главной" className="h-full w-full object-cover" /> : <span style={{ color: "var(--ink-3)" }}>Фото не загружено</span>}
          </div>
          <input type="file" accept="image/*" onChange={(event) => uploadPhoto(event.target.files?.[0] || null)} className="mt-4 w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} />
          <button onClick={() => update({ photoDataUrl: "" })} className="mt-3 rounded-full px-5 py-3 app-card">Убрать фото</button>
        </div>
        <div className="app-card rounded-3xl p-4">
          <h3 className="text-xl font-bold">Предпросмотр</h3>
          <p className="text-sm mt-2" style={{ color: "var(--ink-3)" }}>Открой главную после сохранения: изменения применяются сразу в этом браузере.</p>
          <button onClick={() => window.location.hash = "/"} className="mt-4 rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Открыть главную</button>
          <button onClick={reset} className="mt-3 ml-0 xl:ml-3 rounded-full px-5 py-3" style={{ background: "rgba(255,120,140,.13)", color: "#ff8a98" }}>Сбросить тексты</button>
        </div>
      </div>
    </div>
  );
};

export default CoachDashboard;
