import { useEffect, useMemo, useState } from "react";
import { Apple, CalendarDays, CheckCircle2, ClipboardList, Dumbbell, History as HistoryIcon, LogOut, MessageCircle, MoreHorizontal, Plus, Send, TrendingUp, X, type LucideIcon } from "lucide-react";
import { enablePushNotifications, sendCoachPush } from "../lib/push";
import { addDaysToISO, CompletionHistoryItem, StrengthRecord, createNotification, createStrengthRecord, fetchClientCompletionHistory, fetchClientData, fetchClientStrengthRecords, fetchCurrentPlanPeriod, getCompletionForToday, getDayWorkout, markWorkoutCompleted, PlanPeriod, weekDays } from "../lib/db";
import { Client, DayWorkout, getUser, logout, Workout } from "../lib/storage";
import { isSupabaseConfigured } from "../lib/supabase";
import { getErrorMessage } from "../lib/errors";
import CalendarView from "../components/CalendarView";
import { buildCalendarEntries, CalendarWorkoutEntry, toISODate } from "../lib/calendar";

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
  const [refreshKey, setRefreshKey] = useState(0);

  // Тренер меняет план в отдельной вкладке/сессии кабинета тренера, а этот кабинет
  // клиента — обычное SPA-состояние, которое само по себе не узнаёт об изменениях
  // в базе. Если клиент просто переключался между вкладками (или телефон гас и
  // включался), план и статус «выполнено» на экране оставались от прошлой загрузки
  // и не совпадали с тем, что реально назначено сейчас. Обновляем данные при
  // возврате на вкладку.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") setRefreshKey((key) => key + 1); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, []);

  useEffect(() => {
    if (!client?.id) { setCurrentPeriod(null); setPeriodLoading(false); return; }
    let cancelled = false;
    setPeriodLoading(true);
    fetchCurrentPlanPeriod(client.id)
      .then((period) => { if (!cancelled) setCurrentPeriod(period); })
      .catch(() => { if (!cancelled) setCurrentPeriod(null); })
      .finally(() => { if (!cancelled) setPeriodLoading(false); });
    return () => { cancelled = true; };
  }, [client?.id, refreshKey]);

  const todayName = weekDays[(new Date().getDay() + 6) % 7];
  // «Сегодня» теперь определяется активным 7-дневным периодом (currentPeriod),
  // а не напрямую шаблоном client.weeklyPlan — иначе клиент видел бы тренировку
  // по шаблону даже когда тренер ни разу не назначал на неё конкретные даты,
  // или когда предыдущий период уже закончился и не продлён.
  const workout = useMemo(() => workouts.find((w) => w.id === currentPeriod?.workoutId), [workouts, currentPeriod]);
  const todayWorkout = currentPeriod ? getDayWorkout(workout, todayName) : null;
  // «Мой план» показывает недельное расписание строго из активного периода —
  // как и «Сегодня»/«Календарь». Раньше здесь брался client.weeklyPlan
  // (устаревшая таблица weekly_plans из старой модели назначения плана), и
  // если у клиента там оставались старые записи, «Мой план» показывал дни
  // тренировок, которых по факту уже нет — а «Сегодня» честно говорило, что
  // плана нет, и это выглядело как противоречие/баг.
  const activeWeeklyPlan = useMemo(() => (currentPeriod && workout?.weeklyTemplate ? Object.fromEntries(Object.keys(workout.weeklyTemplate).map((day) => [day, workout.id])) : {}), [currentPeriod, workout]);
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
    // Сбрасываем сразу, а не только по результату запроса: иначе если план
    // сменился на тренировку, которой ещё нет в уже загрученном workouts
    // (workout не резолвится), эффект ниже выходит по guard'у и статус
    // «выполнено» от предыдущей тренировки остаётся висеть на экране.
    if (!client?.id || !currentPeriod?.workoutId) { setCompletedToday(false); return; }
    if (!workout?.id) { setCompletedToday(false); return; }
    getCompletionForToday(client.id, workout.id, todayName).then(setCompletedToday).catch(() => setCompletedToday(false));
  }, [client?.id, workout?.id, currentPeriod?.workoutId, todayName]);

  const loadCalendarMonth = async (anchor: Date) => {
    if (!isSupabaseConfigured || !client) { setCalendarEntries(new Map()); return; }
    setCalendarLoading(true);
    try {
      const rangeStart = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 21);
      const rangeEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 10);
      const entries = await buildCalendarEntries([client], workouts, toISODate(rangeStart), toISODate(rangeEnd));
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
  }, [user?.id, refreshKey]);

  const enableClientPush = async () => {
    try {
      await enablePushNotifications(user?.id);
      setPushStatus("Уведомления включены на этом устройстве");
    } catch (error) {
      setPushStatus(getErrorMessage(error, "Не удалось включить уведомления"));
    }
  };


  const exit = async () => { await logout(); window.location.hash = "/"; };

  if (loading) {
    return <main className="min-h-screen grid place-items-center px-4" style={{ background: "var(--bg)" }}><section className="glass rounded-[2rem] p-6 max-w-xl"><h1 className="text-3xl font-bold">Загружаем план...</h1></section></main>;
  }

  if (error) {
    return <main className="min-h-screen grid place-items-center px-4" style={{ background: "var(--bg)" }}><section className="glass rounded-[2rem] p-6 max-w-xl"><h1 className="text-3xl font-bold">Ошибка загрузки</h1><p className="mt-3" style={{ color: "#ff8a98" }}>{error}</p><button onClick={exit} className="btn btn-secondary btn-md glass mt-5">Выйти</button></section></main>;
  }

  if (!client) {
    return <main className="min-h-screen grid place-items-center px-4" style={{ background: "var(--bg)" }}><section className="glass rounded-[2rem] p-6 max-w-xl"><h1 className="text-3xl font-bold">План пока не назначен</h1><p className="mt-3" style={{ color: "var(--ink-2)" }}>Тренер ещё не назначил вам план тренировок в Supabase. Свяжитесь с тренером в Telegram.</p><button onClick={exit} className="btn btn-secondary btn-md glass mt-5">Выйти</button></section></main>;
  }

  const markDone = async () => {
    if (completedToday || !workout) return;
    try {
      await markWorkoutCompleted(client.id, workout.id, todayName);
      setCompletedToday(true);
      if (user?.id) { const updated = await fetchClientData(user.id); if (updated) { setClient(updated.client); setWorkouts(updated.workouts); setHistory(await fetchClientCompletionHistory(updated.client.id, user.id)); setStrengthRecords(await fetchClientStrengthRecords(updated.client.id, user.id)); } }
      if (client.coachId) {
        try {
          await createNotification(client.coachId, "Новая отметка тренировки", `${user?.name || client.name} выполнил тренировку ${todayWorkout?.title || workout.title}`, "/#/coach");
        } catch {
          // Тренировка уже отмечена выполненной — сбой отправки уведомления не должен
          // превращать успешную отметку в сообщение об ошибке для клиента.
        }
      }
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

      <nav className="tabbar-glass lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch pb-[env(safe-area-inset-bottom)]">
        {clientNavItems.filter((item) => clientMobilePrimaryIds.includes(item.id)).map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] relative">
            {tab === id && <span className="tabbar-glass-pill" />}
            <span className="relative">
              <Icon size={20} strokeWidth={tab === id ? 2.4 : 1.8} color={tab === id ? "var(--accent)" : "var(--ink-3)"} />
              {id === "today" && todayNeedsAttention && <span className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />}
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
          <div><div className="eyebrow">Кабинет клиента</div><h1 className="mt-2 text-3xl md:text-4xl font-extrabold tracking-[-.02em]">Привет, {user?.name || client.name}</h1><p className="mt-1" style={{ color: "var(--ink-2)" }}>Telegram: {user?.telegram || client.telegram}</p></div>
        </header>

        {tab === "today" && <Panel title={`Сегодня: ${todayWorkout?.title || "тренировки нет"}`} subtitle={todayName}><p className="mb-4" style={{ color: "var(--ink-2)" }}>{periodLoading ? "Загрузка..." : todayWorkout ? (todayWorkout.notes || workout?.notes || "Заметок к этой тренировке нет.") : "Тренер пока не назначил активный план на сегодня."}</p>{(todayWorkout?.exercises || []).length ? <div className="space-y-3">{(todayWorkout?.exercises || []).map((e, index) => <div key={`${index}-${e}`} className="app-card rounded-2xl p-4 flex gap-3 items-center"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-bold" style={{ background: "rgba(104,225,253,.16)", color: "var(--accent)" }}>{index + 1}</span><span>{e}</span></div>)}</div> : <div className="app-card rounded-2xl p-4" style={{ color: "var(--ink-2)" }}>На сегодня тренировка не назначена.</div>}<button disabled={completedToday || !todayWorkout || !(todayWorkout.exercises || []).length} onClick={markDone} className={`btn btn-lg mt-5 ${completedToday ? "btn-secondary glass" : "btn-primary"}`}>{completedToday && <CheckCircle2 size={18} />}{completedToday ? "Тренировка выполнена" : !todayWorkout ? "Сегодня тренировки нет" : "Отметить тренировку"}</button></Panel>}
        {tab === "calendar" && <Panel title="Календарь тренировок" subtitle="ваш недельный план на датах"><CalendarView entriesByDate={calendarEntries} loading={calendarLoading} onMonthChange={loadCalendarMonth} renderDay={(date, entries) => <ClientCalendarDay date={date} entries={entries} />} /></Panel>}
        {tab === "plan" && <Panel title="Мой план на неделю" subtitle="назначено тренером">{!periodLoading && (currentPeriod ? <p className="text-sm mb-4" style={{ color: "var(--accent)" }}>Активен сейчас: {currentPeriod.startDate} – {currentPeriod.endDate}</p> : <p className="text-sm mb-4" style={{ color: "var(--ink-3)" }}>Сейчас нет активного плана на текущую неделю — тренер ещё не назначил даты.</p>)}<WeeklySchedule weeklyPlan={activeWeeklyPlan} workouts={workouts} currentPeriod={currentPeriod} history={history} /><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5"><Info title="Цель" value={client.goal || "Арсений пока не указал цель"} /><Info title="Следующая тренировка" value={nextWorkoutLabel} /></div></Panel>}
        {tab === "history" && <Panel title="Пройденные тренировки" subtitle="история выполненных планов"><CompletionHistory history={history} /></Panel>}
                {tab === "progress" && <Panel title="Мой прогресс" subtitle="силовые показатели и выполнение"><div className="grid grid-cols-1 md:grid-cols-3 gap-4"><Metric title="Выполнение" value={`${client.progress}%`} /><Metric title="Статус" value={client.status} /><Metric title="План" value={workout?.title || "Не назначен"} /></div><div className="mt-5 h-4 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.08)" }}><div className="h-full" style={{ width: `${client.progress}%`, background: "linear-gradient(90deg,var(--accent),var(--secondary-accent))" }} /></div><StrengthProgress client={client} userId={user?.id || ""} workouts={workouts} records={strengthRecords} onAdd={(record) => setStrengthRecords((current) => [...current, record])} /></Panel>}
        {tab === "nutrition" && <Panel title="Питание" subtitle="рекомендации от тренера"><p style={{ color: "var(--ink-2)" }}>{client.nutrition || "Арсений пока не добавил рекомендации по питанию."}</p></Panel>}
        {tab === "chat" && <Panel title="Связь с тренером" subtitle="связь через Telegram"><p style={{ color: "var(--ink-2)" }}>Все контакты на сайте переведены на Telegram.</p><a className="btn btn-primary btn-lg mt-5" href="https://t.me/president_h" target="_blank" rel="noreferrer"><Send size={17} /> Написать в Telegram @president_h</a><div className="app-card rounded-2xl p-5 mt-5"><h3 className="text-xl font-bold">Уведомления о тренировках</h3><p className="mt-2 text-sm" style={{ color: "var(--ink-2)" }}>Включи уведомления на этом устройстве, чтобы получать сообщения о новом или обновлённом плане. На iPhone сайт должен быть сохранён на экран «Домой».</p><button onClick={enableClientPush} className="btn btn-primary btn-md mt-4">Включить уведомления клиенту</button>{pushStatus && <p className="mt-3 text-sm" style={{ color: pushStatus.includes("включ") ? "var(--accent)" : "#ff8a98" }}>{pushStatus}</p>}</div></Panel>}
      </section>
    </main>
  );
};

const Panel = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => <section className="relative z-10 glass rounded-[1.75rem] p-5 md:p-7"><div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-6"><h2 className="text-2xl md:text-[1.75rem] font-bold tracking-[-.02em]">{title}</h2><span className="text-sm" style={{ color: "var(--ink-3)" }}>{subtitle}</span></div>{children}</section>;
const CompletionHistory = ({ history }: { history: CompletionHistoryItem[] }) => {
  const [selectedWorkoutId, setSelectedWorkoutId] = useState("all");
  const plans = Array.from(new Map(history.map((item) => [item.workoutId, item.workoutTitle])).entries());
  const filteredHistory = selectedWorkoutId === "all" ? history : history.filter((item) => item.workoutId === selectedWorkoutId);

  if (!history.length) return <p style={{ color: "var(--ink-2)" }}>Выполненных тренировок пока нет.</p>;

  return (
    <div className="space-y-4">
      <label className="block text-sm" style={{ color: "var(--ink-3)" }}>
        Фильтр по плану
        <select value={selectedWorkoutId} onChange={(event) => setSelectedWorkoutId(event.target.value)} className="field-input">
          <option value="all">Все планы</option>
          {plans.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
      </label>

      {!filteredHistory.length && <p style={{ color: "var(--ink-2)" }}>По выбранному плану выполненных тренировок пока нет.</p>}

      {filteredHistory.map((item) => (
        <div key={item.id} className="app-card rounded-2xl p-5">
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>{new Date(item.completedDate).toLocaleDateString("ru-RU")} • {item.dayOfWeek}</p>
          <b className="text-xl mt-2 block">{item.dayWorkoutTitle}</b>
          <p className="text-sm mt-2" style={{ color: "var(--ink-2)" }}>{item.workoutTitle} • {item.exerciseCount} упражнений</p>
          {!!item.exercises.length && <ul className="mt-3 space-y-2">{item.exercises.map((exercise, index) => <li key={`${index}-${exercise}`} className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,.04)", color: "var(--ink-2)" }}>{exercise}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
};

const WeeklySchedule = ({ weeklyPlan, workouts, currentPeriod, history }: { weeklyPlan: Record<string, string>; workouts: Workout[]; currentPeriod: PlanPeriod | null; history: CompletionHistoryItem[] }) => {
  const trainingDays = Object.keys(weeklyPlan || {}).sort((a, b) => weekDays.indexOf(a) - weekDays.indexOf(b));
  if (!trainingDays.length) return <p style={{ color: "var(--ink-2)" }}>План пока пуст. Тренер ещё не добавил тренировочные дни.</p>;
  // Дата конкретного дня внутри активного периода — чтобы отметить его выполненным,
  // только если клиент отметил именно эту тренировку в эту календарную неделю, а не
  // в какую-то из прошлых недель с тем же днём/планом.
  const periodStartDayIndex = currentPeriod ? weekDays.indexOf(weekDays[(new Date(currentPeriod.startDate + "T00:00:00").getDay() + 6) % 7]) : -1;
  return <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{trainingDays.map((day) => {
    const workout = workouts.find((item) => item.id === weeklyPlan[day]);
    const dayWorkout = getDayWorkout(workout, day);
    const isCurrentPeriodWorkout = currentPeriod && weeklyPlan[day] === currentPeriod.workoutId;
    const dayDate = isCurrentPeriodWorkout ? addDaysToISO(currentPeriod!.startDate, (weekDays.indexOf(day) - periodStartDayIndex + 7) % 7) : null;
    const isDone = Boolean(dayDate && history.some((item) => item.workoutId === currentPeriod!.workoutId && item.dayOfWeek === day && item.completedDate === dayDate));
    return <div key={day} className="app-card rounded-2xl p-5">
      <div className="flex items-center justify-between"><p className="text-sm" style={{ color: "var(--ink-3)" }}>{day}</p>{isDone && <span className="badge badge-accent">Выполнено</span>}</div>
      <b className="text-xl mt-2 block">{dayWorkout?.title || "Тренировка"}</b>
      {dayWorkout && <p className="text-sm mt-2" style={{ color: "var(--ink-2)" }}>{`${dayWorkout.exercises.length} упражнений`}</p>}
      {!!dayWorkout?.exercises.length && <ul className="mt-3 space-y-1.5">{dayWorkout.exercises.map((exercise, index) => <li key={`${index}-${exercise}`} className="text-sm rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,.04)", color: "var(--ink-2)" }}>{exercise}</li>)}</ul>}
    </div>;
  })}</div>;
};

const muscleGroups = ["Грудь", "Спина", "Ноги", "Плечи", "Руки", "Кор", "Другое"];

// В плане тренировок упражнение записано одной строкой вместе с подходами/
// повторами («Жим лёжа 4x8») — для подсказки в трекере силового прогресса
// нужно только название, иначе оно не совпадает с уже сохранёнными записями
// («Жим лёжа»).
const stripSetsReps = (exercise: string) => exercise.replace(/\s*\d+\s*[xхX×]\s*\d+\s*$/u, "").trim();

const StrengthProgress = ({ client, userId, workouts, records, onAdd }: { client: Client; userId: string; workouts: Workout[]; records: StrengthRecord[]; onAdd: (record: StrengthRecord) => void }) => {
  const exerciseOptions = Array.from(new Set(workouts.flatMap((workout) => Object.values(workout.weeklyTemplate || {}) as DayWorkout[]).flatMap((day) => day.exercises || []).map(stripSetsReps))).filter(Boolean);
  const [muscleGroup, setMuscleGroup] = useState(muscleGroups[0]);
  const [exerciseName, setExerciseName] = useState(exerciseOptions[0] || "");
  const [maxWeight, setMaxWeight] = useState("");
  const [recordedDate, setRecordedDate] = useState(toISODate(new Date()));
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
      setStatus(getErrorMessage(error, "Не удалось добавить запись"));
    }
  };

  return (
    <div className="mt-6 space-y-5">
      <div className="app-card rounded-2xl p-5">
        <h3 className="text-2xl font-bold">Силовой прогресс</h3>
        <p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>Добавляй максимальный вес по упражнениям в любое время. Данные сохраняются отдельно от отметки тренировки.</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Группа мышц<select value={muscleGroup} onChange={(event) => setMuscleGroup(event.target.value)} className="field-input">{muscleGroups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Упражнение<input list="strength-exercises" value={exerciseName} onChange={(event) => setExerciseName(event.target.value)} className="field-input" /><datalist id="strength-exercises">{exerciseOptions.map((exercise) => <option key={exercise} value={exercise} />)}</datalist></label>
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Максимальный вес, кг<input type="number" min="0" step="0.5" value={maxWeight} onChange={(event) => setMaxWeight(event.target.value)} className="field-input" /></label>
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Дата<input type="date" value={recordedDate} onChange={(event) => setRecordedDate(event.target.value)} className="field-input" style={{ fontSize: "16px", WebkitAppearance: "none" }} /></label>
        </div>
        <button onClick={addRecord} className="btn btn-primary btn-md mt-4"><Plus size={16} /> Добавить показатель</button>
        {status && <p className="mt-3 text-sm" style={{ color: status.includes("добавлена") ? "var(--accent)" : "#ff8a98" }}>{status}</p>}
      </div>

      <div className="app-card rounded-2xl p-5">
        <h3 className="text-2xl font-bold">Диаграмма силы</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Фильтр по группе<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="field-input"><option value="all">Все группы</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
          <label className="block text-sm" style={{ color: "var(--ink-3)" }}>Фильтр по упражнению<select value={exerciseFilter} onChange={(event) => setExerciseFilter(event.target.value)} className="field-input"><option value="all">Все упражнения</option>{exercises.map((exercise) => <option key={exercise} value={exercise}>{exercise}</option>)}</select></label>
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
        <div key={entry.workoutId} className="app-card rounded-2xl p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <b>{entry.title}</b>
              <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>{entry.exerciseCount} упражнений</p>
            </div>
            <span className={`badge shrink-0 ${entry.completed ? "badge-accent" : "badge-neutral"}`}>
              {entry.completed ? "Выполнено" : "Запланировано"}
            </span>
          </div>
          {!!entry.exercises.length && <ul className="mt-2.5 space-y-1.5">{entry.exercises.map((exercise, index) => <li key={`${index}-${exercise}`} className="text-sm rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,.04)", color: "var(--ink-2)" }}>{exercise}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
};

const Metric = ({ title, value }: { title: string; value: string }) => <div className="stat-tile glass rounded-3xl p-5"><p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>{title}</p><b className="text-[2.1rem] leading-none mt-3 block tracking-tight">{value}</b></div>;
const Info = ({ title, value }: { title: string; value: string }) => <div className="app-card rounded-2xl p-5"><p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>{title}</p><b className="text-lg mt-2 block">{value}</b></div>;

export default ClientDashboard;
