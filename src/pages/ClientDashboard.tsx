import { useEffect, useMemo, useState } from "react";
import { Apple, CalendarDays, ClipboardList, Dumbbell, History as HistoryIcon, LogOut, MessageCircle, MoreHorizontal, TrendingUp, X, type LucideIcon } from "lucide-react";
import { enablePushNotifications, sendCoachPush } from "../lib/push";
import { CompletionHistoryItem, StrengthRecord, createNotification, createStrengthRecord, fetchClientCompletionHistory, fetchClientData, fetchClientStrengthRecords, fetchCurrentPlanPeriod, getCompletionForToday, getDayWorkout, markWorkoutCompleted, PlanPeriod, weekDays } from "../lib/db";
import { Client, DayWorkout, getUser, logout, Workout } from "../lib/storage";
import { isSupabaseConfigured } from "../lib/supabase";
import CalendarView from "../components/CalendarView";
import { buildCalendarEntries, CalendarWorkoutEntry } from "../lib/calendar";

type NavItem = { id: string; label: string; icon: LucideIcon };
const clientNavItems: NavItem[] = [
  { id: "today", label: "Сегодня", icon: Dumbbell },
  { id: "calendar", label: "Календарь", icon: CalendarDays },
  { id: "plan", label: "Мой план", icon: ClipboardList },
  { id: "history", label: "История", icon: HistoryIcon },
  { id: "progress", label: "Прогресс", icon: TrendingUp },
  { id: "nutrition", label: "Питание", icon: Apple },
  { id: "chat", label: "Связь", icon: MessageCircle },
];
// Вкладки в нижней панели на мобильном — самые частые действия клиента.
// Остальные (и выход) остаются в полном меню за кнопкой «Ещё».
const clientMobilePrimaryIds = ["today", "calendar", "plan", "progress"];

const NavList = ({ items, activeTab, showDotForId, onSelect }: { items: NavItem[]; activeTab: string; showDotForId?: string; onSelect: (id: string) => void }) => (
  <div>
    {items.map(({ id, label, icon: Icon }) => (
      <button key={id} onClick={() => onSelect(id)} aria-current={activeTab === id ? "page" : undefined} className="w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 mb-2 transition-colors" style={{ background: activeTab === id ? "rgba(104,225,253,.14)" : "transparent", color: activeTab === id ? "var(--ink)" : "var(--ink-3)", border: activeTab === id ? "1px solid rgba(104,225,253,.28)" : "1px solid transparent" }}>
        <span className="relative">
          <Icon size={18} strokeWidth={activeTab === id ? 2.4 : 1.8} />
          {id === showDotForId && <span className="absolute -top-0.5 -right-1 h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />}
        </span>
        <span className="flex-1">{label}</span>
      </button>
    ))}
  </div>
);

const ClientDashboard = () => {
  const user = getUser();
  const [tab, setTab] = useState("today");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [client, setClient] = useState<Client | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completedToday, setCompletedToday] = useState(false);
  const [history, setHistory] = useState<CompletionHistoryItem[]>([]);
  const [strengthRecords, setStrengthRecords] = useState<StrengthRecord[]>([]);
  const [pushStatus, setPushStatus] = useState("");
  const [calendarEntries, setCalendarEntries] = useState<Map<string, CalendarWorkoutEntry[]>>(new Map());
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [currentPeriod, setCurrentPeriod] = useState<PlanPeriod | null>(null);
  const [periodLoading, setPeriodLoading] = useState(true);

  useEffect(() => {
    if (!client?.id) { setCurrentPeriod(null); setPeriodLoading(false); return; }
    let cancelled = false;
    setPeriodLoading(true);
    fetchCurrentPlanPeriod(client.id)
      .then((period) => { if (!cancelled) setCurrentPeriod(period); })
      .catch(() => { if (!cancelled) setCurrentPeriod(null); })
      .finally(() => { if (!cancelled) setPeriodLoading(false); });
    return () => { cancelled = true; };
  }, [client?.id]);

  const todayName = weekDays[(new Date().getDay() + 6) % 7];
  // «Сегодня» теперь определяется активным 7-дневным периодом (currentPeriod),
  // а не напрямую шаблоном client.weeklyPlan — иначе клиент видел бы тренировку
  // по шаблону даже когда тренер ни разу не назначал на неё конкретные даты,
  // или когда предыдущий период уже закончился и не продлён.
  const workout = useMemo(() => workouts.find((w) => w.id === currentPeriod?.workoutId), [workouts, currentPeriod]);
  const todayWorkout = currentPeriod ? getDayWorkout(workout, todayName) : null;
  const nextWorkoutLabel = (() => {
    if (periodLoading) return "Загрузка...";
    if (!currentPeriod || !workout?.weeklyTemplate) return "План не назначен";
    const todayIndex = weekDays.indexOf(todayName);
    const periodEnd = new Date(currentPeriod.endDate + "T00:00:00");
    for (let offset = 0; offset < 7; offset += 1) {
      if (offset === 0 && completedToday) continue;
      const candidateDate = new Date();
      candidateDate.setHours(0, 0, 0, 0);
      candidateDate.setDate(candidateDate.getDate() + offset);
      if (candidateDate > periodEnd) break; // не заглядываем за пределы активного периода
      const day = weekDays[(todayIndex + offset) % 7];
      const dayWorkout = getDayWorkout(workout, day);
      if (!dayWorkout) continue;
      return `${day}: ${dayWorkout.title}`;
    }
    return "В рамках текущего плана тренировок больше нет";
  })();

  useEffect(() => {
    if (!client?.id || !workout?.id) return;
    getCompletionForToday(client.id, workout.id, todayName).then(setCompletedToday).catch(() => setCompletedToday(false));
  }, [client?.id, workout?.id, todayName]);

  const loadCalendarMonth = async (anchor: Date) => {
    if (!isSupabaseConfigured || !client) { setCalendarEntries(new Map()); return; }
    setCalendarLoading(true);
    try {
      const rangeStart = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 21);
      const rangeEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 10);
      const toIso = (d: Date) => d.toISOString().slice(0, 10);
      const entries = await buildCalendarEntries([client], workouts, toIso(rangeStart), toIso(rangeEnd));
      setCalendarEntries(entries);
    } catch {
      setCalendarEntries(new Map());
    } finally {
      setCalendarLoading(false);
    }
  };

  useEffect(() => { if (tab === "calendar" && client) loadCalendarMonth(new Date()); }, [tab, client?.id, workouts.length]);

  useEffect(() => {
    const load = async () => {
      if (!user?.id || !isSupabaseConfigured) {
        setError("Данные клиента доступны после входа через Supabase.");
        setLoading(false);
        return;
      }

      try {
        const data = await fetchClientData(user.id);
        if (!data) {
          setClient(null);
          setWorkouts([]);
        } else {
          setClient(data.client);
          setWorkouts(data.workouts);
          setHistory(await fetchClientCompletionHistory(data.client.id, user.id));
          setStrengthRecords(await fetchClientStrengthRecords(data.client.id, user.id));
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить план клиента");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.id]);

  const enableClientPush = async () => {
    try {
      await enablePushNotifications(user?.id);
      setPushStatus("Уведомления включены на этом устройстве");
    } catch (error) {
      setPushStatus(error instanceof Error ? error.message : "Не удалось включить уведомления");
    }
  };


  const exit = async () => { await logout(); window.location.hash = "/"; };

  if (loading) {
    return <main className="min-h-screen grid place-items-center px-4" style={{ background: "var(--bg)" }}><section className="glass rounded-[2rem] p-6 max-w-xl"><h1 className="text-3xl font-bold">Загружаем план...</h1></section></main>;
  }

  if (error) {
    return <main className="min-h-screen grid place-items-center px-4" style={{ background: "var(--bg)" }}><section className="glass rounded-[2rem] p-6 max-w-xl"><h1 className="text-3xl font-bold">Ошибка загрузки</h1><p className="mt-3" style={{ color: "#ff8a98" }}>{error}</p><button onClick={exit} className="mt-5 rounded-full px-5 py-3 glass">Выйти</button></section></main>;
  }

  if (!client) {
    return <main className="min-h-screen grid place-items-center px-4" style={{ background: "var(--bg)" }}><section className="glass rounded-[2rem] p-6 max-w-xl"><h1 className="text-3xl font-bold">План пока не назначен</h1><p className="mt-3" style={{ color: "var(--ink-2)" }}>Тренер ещё не назначил вам план тренировок в Supabase. Свяжитесь с тренером в Telegram.</p><button onClick={exit} className="mt-5 rounded-full px-5 py-3 glass">Выйти</button></section></main>;
  }

  const markDone = async () => {
    if (completedToday || !workout) return;
    try {
      await markWorkoutCompleted(client.id, workout.id, todayName);
      setCompletedToday(true);
      if (user?.id) { const updated = await fetchClientData(user.id); if (updated) { setClient(updated.client); setWorkouts(updated.workouts); setHistory(await fetchClientCompletionHistory(updated.client.id, user.id)); setStrengthRecords(await fetchClientStrengthRecords(updated.client.id, user.id)); } }
      if (client.coachId) await createNotification(client.coachId, "Новая отметка тренировки", `${user?.name || client.name} выполнил тренировку ${todayWorkout?.title || workout.title}`, "/#/coach");
      sendCoachPush("Новая отметка тренировки", `${user?.name || client.name} выполнил тренировку ${todayWorkout?.title || workout.title}`);
      alert("Тренировка отмечена. Арсений увидит уведомление в кабинете тренера.");
    } catch {
      alert("Не удалось отметить тренировку. Попробуйте ещё раз.");
    }
  };

  const todayNeedsAttention = Boolean(todayWorkout && (todayWorkout.exercises || []).length && !completedToday);

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-[270px_1fr]" style={{ background: "var(--bg)" }}>
      {mobileMenuOpen && <div className="fixed inset-0 z-[80] lg:hidden">
        <button className="absolute inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} aria-label="Закрыть меню" />
        <aside className="absolute left-0 top-0 h-full w-[82vw] max-w-[340px] p-5 overflow-y-auto" style={{ background: "#080c12", borderRight: "1px solid var(--line)" }}>
          <div className="flex items-center justify-between mb-8">
            <button onClick={() => { window.location.hash = "/"; setMobileMenuOpen(false); }} className="flex items-center gap-3 font-bold"><span className="logo-mark" /> ARSENIICOACH</button>
            <button onClick={() => setMobileMenuOpen(false)} className="rounded-full p-2 glass" aria-label="Закрыть меню"><X size={18} /></button>
          </div>
          <NavList items={clientNavItems} activeTab={tab} showDotForId={todayNeedsAttention ? "today" : undefined} onSelect={(id) => { setTab(id); setMobileMenuOpen(false); }} />
          <button onClick={exit} className="w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}><LogOut size={18} /> Выйти</button>
        </aside>
      </div>}

      <aside className="hidden lg:flex lg:flex-col border-r p-5 lg:min-h-screen" style={{ borderColor: "var(--line)", background: "rgba(0,0,0,.18)" }}>
        <button onClick={() => window.location.hash = "/"} className="flex items-center gap-3 font-bold mb-8"><span className="logo-mark" /> ARSENIICOACH</button>
        <NavList items={clientNavItems} activeTab={tab} showDotForId={todayNeedsAttention ? "today" : undefined} onSelect={setTab} />
        <button onClick={exit} className="w-full flex items-center gap-3 text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}><LogOut size={18} /> Выйти</button>
      </aside>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch pb-[env(safe-area-inset-bottom)]" style={{ background: "rgba(8,12,18,.92)", backdropFilter: "blur(14px)", borderTop: "1px solid var(--line)" }}>
        {clientNavItems.filter((item) => clientMobilePrimaryIds.includes(item.id)).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px]">
            <span className="relative">
              <Icon size={20} strokeWidth={tab === id ? 2.4 : 1.8} color={tab === id ? "var(--accent)" : "var(--ink-3)"} />
              {id === "today" && todayNeedsAttention && <span className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />}
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
          <div><div className="eyebrow">Кабинет клиента</div><h1 className="mt-2 text-4xl md:text-6xl font-extrabold tracking-[-.025em]">Привет, {user?.name || client.name}</h1><p style={{ color: "var(--ink-2)" }}>Telegram: {user?.telegram || client.telegram}</p></div>

        </header>

        {tab === "today" && <Panel title={`Сегодня: ${todayWorkout?.title || "тренировки нет"}`} subtitle={todayName}><p className="mb-4" style={{ color: "var(--ink-2)" }}>{todayWorkout?.notes || workout?.notes || (periodLoading ? "Загрузка..." : "Тренер пока не назначил активный план на сегодня.")}</p>{(todayWorkout?.exercises || []).length ? <div className="space-y-3">{(todayWorkout?.exercises || []).map((e, index) => <div key={`${index}-${e}`} className="app-card rounded-2xl p-4 flex gap-3 items-center"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-bold" style={{ background: "rgba(104,225,253,.16)", color: "var(--accent)" }}>{index + 1}</span><span>{e}</span></div>)}</div> : <div className="app-card rounded-2xl p-4" style={{ color: "var(--ink-2)" }}>На сегодня тренировка не назначена.</div>}<button disabled={completedToday || !todayWorkout || !(todayWorkout.exercises || []).length} onClick={markDone} className="mt-5 rounded-full px-5 py-3 font-semibold disabled:opacity-55" style={{ background: completedToday ? "rgba(104,225,253,.25)" : "var(--accent)", color: completedToday ? "var(--ink)" : "var(--bg)" }}>{completedToday ? "Тренировка выполнена" : !todayWorkout ? "Сегодня тренировки нет" : "Отметить тренировку"}</button></Panel>}
        {tab === "calendar" && <Panel title="Календарь тренировок" subtitle="ваш недельный план на датах"><CalendarView entriesByDate={calendarEntries} loading={calendarLoading} onMonthChange={loadCalendarMonth} renderDay={(date, entries) => <ClientCalendarDay date={date} entries={entries} />} /></Panel>}
        {tab === "plan" && <Panel title="Мой план на неделю" subtitle="назначено тренером">{!periodLoading && (currentPeriod ? <p className="text-sm mb-4" style={{ color: "var(--accent)" }}>Активен сейчас: {currentPeriod.startDate} – {currentPeriod.endDate}</p> : <p className="text-sm mb-4" style={{ color: "var(--ink-3)" }}>Сейчас нет активного плана на текущую неделю — тренер ещё не назначил даты.</p>)}<WeeklySchedule weeklyPlan={client.weeklyPlan || {}} workouts={workouts} /><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5"><Info title="Цель" value={client.goal || "Арсений пока не указал цель"} /><Info title="Следующая тренировка" value={nextWorkoutLabel} /></div></Panel>}
        {tab === "history" && <Panel title="Пройденные тренировки" subtitle="история выполненных планов"><CompletionHistory history={history} /></Panel>}
                {tab === "progress" && <Panel title="Мой прогресс" subtitle="силовые показатели и выполнение"><div className="grid grid-cols-1 md:grid-cols-3 gap-4"><Metric title="Выполнение" value={`${client.progress}%`} /><Metric title="Статус" value={client.status} /><Metric title="План" value={workout?.title || "Не назначен"} /></div><div className="mt-5 h-4 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.08)" }}><div className="h-full" style={{ width: `${client.progress}%`, background: "linear-gradient(90deg,var(--accent),var(--secondary-accent))" }} /></div><StrengthProgress client={client} userId={user?.id || ""} workouts={workouts} records={strengthRecords} onAdd={(record) => setStrengthRecords((current) => [...current, record])} /></Panel>}
        {tab === "nutrition" && <Panel title="Питание" subtitle="рекомендации от тренера"><p style={{ color: "var(--ink-2)" }}>{client.nutrition || "Арсений пока не добавил рекомендации по питанию."}</p></Panel>}
        {tab === "chat" && <Panel title="Связь с тренером" subtitle="связь через Telegram"><p style={{ color: "var(--ink-2)" }}>Все контакты на сайте переведены на Telegram.</p><a className="inline-flex mt-5 rounded-full px-5 py-3 font-semibold" href="https://t.me/president_h" target="_blank" rel="noreferrer" style={{ background: "var(--accent)", color: "var(--bg)" }}>Написать в Telegram @president_h</a><div className="app-card rounded-3xl p-5 mt-5"><h3 className="text-xl font-bold">Уведомления о тренировках</h3><p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>Включи уведомления на этом устройстве, чтобы получать сообщения о новом или обновлённом плане. На iPhone сайт должен быть сохранён на экран «Домой».</p><button onClick={enableClientPush} className="mt-4 rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Включить уведомления клиенту</button>{pushStatus && <p className="mt-3 text-sm" style={{ color: pushStatus.includes("включ") ? "var(--accent)" : "#ff8a98" }}>{pushStatus}</p>}</div></Panel>}
      </section>
    </main>
  );
};

const Panel = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => <section className="relative z-10 glass rounded-[2rem] p-5 md:p-6"><div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-5"><h2 className="text-3xl font-bold tracking-[-.02em]">{title}</h2><span className="text-sm" style={{ color: "var(--ink-3)" }}>{subtitle}</span></div>{children}</section>;
const CompletionHistory = ({ history }: { history: CompletionHistoryItem[] }) => {
  const [selectedWorkoutId, setSelectedWorkoutId] = useState("all");
  const plans = Array.from(new Map(history.map((item) => [item.workoutId, item.workoutTitle])).entries());
  const filteredHistory = selectedWorkoutId === "all" ? history : history.filter((item) => item.workoutId === selectedWorkoutId);

  if (!history.length) return <p style={{ color: "var(--ink-2)" }}>Выполненных тренировок пока нет.</p>;

  return (
    <div className="space-y-4">
      <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
        Фильтр по плану
        <select value={selectedWorkoutId} onChange={(event) => setSelectedWorkoutId(event.target.value)} className="mt-2 block w-full max-w-full min-w-0 rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>
          <option value="all">Все планы</option>
          {plans.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
      </label>

      {!filteredHistory.length && <p style={{ color: "var(--ink-2)" }}>По выбранному плану выполненных тренировок пока нет.</p>}

      {filteredHistory.map((item) => (
        <div key={item.id} className="app-card rounded-3xl p-5">
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>{new Date(item.completedDate).toLocaleDateString("ru-RU")} • {item.dayOfWeek}</p>
          <b className="text-xl mt-2 block">{item.dayWorkoutTitle}</b>
          <p className="text-sm mt-2" style={{ color: "var(--ink-2)" }}>{item.workoutTitle} • {item.exerciseCount} упражнений</p>
          {!!item.exercises.length && <ul className="mt-3 space-y-2">{item.exercises.map((exercise, index) => <li key={`${index}-${exercise}`} className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,.04)", color: "var(--ink-2)" }}>{exercise}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
};

const WeeklySchedule = ({ weeklyPlan, workouts }: { weeklyPlan: Record<string, string>; workouts: Workout[] }) => {
  const trainingDays = Object.keys(weeklyPlan || {}).sort((a, b) => weekDays.indexOf(a) - weekDays.indexOf(b));
  if (!trainingDays.length) return <p style={{ color: "var(--ink-2)" }}>План пока пуст. Тренер ещё не добавил тренировочные дни.</p>;
  return <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{trainingDays.map((day) => { const workout = workouts.find((item) => item.id === weeklyPlan[day]); const dayWorkout = getDayWorkout(workout, day); return <div key={day} className="app-card rounded-3xl p-5"><p className="text-sm" style={{ color: "var(--ink-3)" }}>{day}</p><b className="text-xl mt-2 block">{dayWorkout?.title || "Тренировка"}</b>{dayWorkout && <p className="text-sm mt-2" style={{ color: "var(--ink-2)" }}>{`${dayWorkout.exercises.length} упражнений`}</p>}</div>; })}</div>;
};

const muscleGroups = ["Грудь", "Спина", "Ноги", "Плечи", "Руки", "Кор", "Другое"];

const StrengthProgress = ({ client, userId, workouts, records, onAdd }: { client: Client; userId: string; workouts: Workout[]; records: StrengthRecord[]; onAdd: (record: StrengthRecord) => void }) => {
  const exerciseOptions = Array.from(new Set(workouts.flatMap((workout) => Object.values(workout.weeklyTemplate || {}) as DayWorkout[]).flatMap((day) => day.exercises || []))).filter(Boolean);
  const [muscleGroup, setMuscleGroup] = useState(muscleGroups[0]);
  const [exerciseName, setExerciseName] = useState(exerciseOptions[0] || "");
  const [maxWeight, setMaxWeight] = useState("");
  const [recordedDate, setRecordedDate] = useState(new Date().toISOString().slice(0, 10));
  const [groupFilter, setGroupFilter] = useState("all");
  const [exerciseFilter, setExerciseFilter] = useState("all");
  const [status, setStatus] = useState("");

  const groups = Array.from(new Set([...muscleGroups, ...records.map((record) => record.muscleGroup)])).filter(Boolean);
  const exercises = Array.from(new Set([...exerciseOptions, ...records.map((record) => record.exerciseName)])).filter(Boolean);
  const filteredRecords = records
    .filter((record) => groupFilter === "all" || record.muscleGroup === groupFilter)
    .filter((record) => exerciseFilter === "all" || record.exerciseName === exerciseFilter)
    .sort((a, b) => a.recordedDate.localeCompare(b.recordedDate));

  const addRecord = async () => {
    setStatus("");
    if (!exerciseName.trim()) {
      setStatus("Укажи упражнение");
      return;
    }
    const weight = Number(maxWeight);
    if (!weight || weight <= 0) {
      setStatus("Укажи максимальный вес больше 0");
      return;
    }
    try {
      const created = await createStrengthRecord({
        clientId: client.id,
        userId,
        muscleGroup,
        exerciseName: exerciseName.trim(),
        maxWeight: weight,
        recordedDate,
      });
      onAdd(created);
      setMaxWeight("");
      setGroupFilter(created.muscleGroup);
      setExerciseFilter(created.exerciseName);
      setStatus("Запись добавлена");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не удалось добавить запись");
    }
  };

  return (
    <div className="mt-6 space-y-5">
      <div className="app-card rounded-3xl p-5">
        <h3 className="text-2xl font-bold">Силовой прогресс</h3>
        <p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>Добавляй максимальный вес по упражнениям в любое время. Данные сохраняются отдельно от отметки тренировки.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Группа мышц<select value={muscleGroup} onChange={(event) => setMuscleGroup(event.target.value)} className="mt-2 block w-full max-w-full min-w-0 rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}>{muscleGroups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Упражнение<input list="strength-exercises" value={exerciseName} onChange={(event) => setExerciseName(event.target.value)} className="mt-2 block w-full max-w-full min-w-0 rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} /><datalist id="strength-exercises">{exerciseOptions.map((exercise) => <option key={exercise} value={exercise} />)}</datalist></label>
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Максимальный вес, кг<input type="number" min="0" step="0.5" value={maxWeight} onChange={(event) => setMaxWeight(event.target.value)} className="mt-2 block w-full max-w-full min-w-0 rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} /></label>
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Дата<input type="date" value={recordedDate} onChange={(event) => setRecordedDate(event.target.value)} className="mt-2 block w-full max-w-full min-w-0 rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)", boxSizing: "border-box", fontSize: "16px", WebkitAppearance: "none" }} /></label>
        </div>
        <button onClick={addRecord} className="mt-4 rounded-full px-5 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Добавить показатель</button>
        {status && <p className="mt-3 text-sm" style={{ color: status.includes("добавлена") ? "var(--accent)" : "#ff8a98" }}>{status}</p>}
      </div>

      <div className="app-card rounded-3xl p-5">
        <h3 className="text-2xl font-bold">Диаграмма силы</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Фильтр по группе<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="mt-2 block w-full max-w-full min-w-0 rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}><option value="all">Все группы</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Фильтр по упражнению<select value={exerciseFilter} onChange={(event) => setExerciseFilter(event.target.value)} className="mt-2 block w-full max-w-full min-w-0 rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }}><option value="all">Все упражнения</option>{exercises.map((exercise) => <option key={exercise} value={exercise}>{exercise}</option>)}</select></label>
        </div>
        <StrengthChart records={filteredRecords} />
      </div>
    </div>
  );
};

const StrengthChart = ({ records }: { records: StrengthRecord[] }) => {
  if (!records.length) return <p className="mt-4" style={{ color: "var(--ink-2)" }}>Пока нет данных по выбранному фильтру.</p>;
  const width = 640;
  const height = 260;
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
  const first = records[0].maxWeight;
  const last = records[records.length - 1].maxWeight;
  const diff = last - first;

  return (
    <div className="mt-4">
      <div className="mb-3 text-sm" style={{ color: diff >= 0 ? "var(--accent)" : "#ff8a98" }}>{records.length > 1 ? `Изменение: ${diff > 0 ? "+" : ""}${diff} кг` : "Добавь ещё одну запись, чтобы увидеть динамику"}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-3xl" style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }} role="img" aria-label="Диаграмма силового прогресса">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,.18)" />
        <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="rgba(255,255,255,.18)" />
        <polyline fill="none" stroke="var(--accent)" strokeWidth="4" points={points.map((point) => `${point.x},${point.y}`).join(" ")} />
        {points.map((point) => <g key={`${point.record.id}-${point.x}`}><circle cx={point.x} cy={point.y} r="6" fill="var(--accent)" /><text x={point.x} y={point.y - 12} textAnchor="middle" fontSize="13" fill="white">{point.record.maxWeight} кг</text></g>)}
      </svg>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">{records.slice().reverse().map((record) => <div key={record.id} className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,.04)" }}><b>{record.exerciseName}</b><p className="text-sm" style={{ color: "var(--ink-2)" }}>{record.muscleGroup} • {record.maxWeight} кг • {new Date(record.recordedDate).toLocaleDateString("ru-RU")}</p></div>)}</div>
    </div>
  );
};

const ClientCalendarDay = ({ date, entries }: { date: string; entries: CalendarWorkoutEntry[] }) => {
  if (!entries.length) return <p style={{ color: "var(--ink-2)" }}>На {new Date(date).toLocaleDateString("ru-RU")} тренировка не назначена — день отдыха.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm mb-1" style={{ color: "var(--ink-3)" }}>{new Date(date).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" })}</p>
      {entries.map((entry) => (
        <div key={entry.workoutId} className="app-card rounded-2xl p-3 flex items-center justify-between gap-3">
          <div>
            <b>{entry.title}</b>
            <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>{entry.exerciseCount} упражнений</p>
          </div>
          <span className="rounded-full px-3 py-1 text-xs shrink-0" style={{ background: entry.completed ? "rgba(104,225,253,.16)" : "rgba(255,255,255,.08)", color: entry.completed ? "var(--accent)" : "var(--ink-3)" }}>
            {entry.completed ? "Выполнено" : "Запланировано"}
          </span>
        </div>
      ))}
    </div>
  );
};

const Metric = ({ title, value }: { title: string; value: string }) => <div className="app-card rounded-3xl p-5"><p className="text-sm" style={{ color: "var(--ink-3)" }}>{title}</p><b className="text-2xl mt-2 block">{value}</b></div>;
const Info = ({ title, value }: { title: string; value: string }) => <div className="app-card rounded-3xl p-5"><p className="text-sm" style={{ color: "var(--ink-3)" }}>{title}</p><b className="text-xl mt-2 block">{value}</b></div>;

export default ClientDashboard;
