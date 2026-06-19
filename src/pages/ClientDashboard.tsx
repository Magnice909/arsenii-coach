import { useEffect, useMemo, useState } from "react";
import { sendCoachPush } from "../lib/push";
import { CompletionHistoryItem, createNotification, fetchClientCompletionHistory, fetchClientData, getCompletionForToday, getDayWorkout, markWorkoutCompleted, weekDays } from "../lib/db";
import { Client, getUser, logout, Workout } from "../lib/storage";
import { isSupabaseConfigured } from "../lib/supabase";

const ClientDashboard = () => {
  const user = getUser();
  const [tab, setTab] = useState("today");
  const [client, setClient] = useState<Client | null>(null);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completedToday, setCompletedToday] = useState(false);
  const [history, setHistory] = useState<CompletionHistoryItem[]>([]);

  const todayName = weekDays[(new Date().getDay() + 6) % 7];
  const todayPlanId = client?.weeklyPlan?.[todayName];
  const weeklyIds = Object.values(client?.weeklyPlan || {});
  const workout = useMemo(() => workouts.find((w) => w.id === todayPlanId) || workouts.find((w) => w.id === weeklyIds[0]) || workouts.find((w) => w.id === client?.assignedWorkoutId) || workouts[0], [workouts, weeklyIds, client?.assignedWorkoutId, todayPlanId]);
  const todayWorkout = todayPlanId ? getDayWorkout(workouts.find((w) => w.id === todayPlanId), todayName) : null;
  const nextWorkoutLabel = (() => {
    if (!client?.weeklyPlan) return "Не назначено";
    const todayIndex = weekDays.indexOf(todayName);
    for (let offset = 0; offset < 7; offset += 1) {
      if (offset === 0 && completedToday) continue;
      const day = weekDays[(todayIndex + offset) % 7];
      const planId = client.weeklyPlan[day];
      if (!planId) continue;
      const plan = workouts.find((item) => item.id === planId);
      const dayWorkout = getDayWorkout(plan, day);
      return `${day}: ${dayWorkout?.title || plan?.title || "Тренировка"}`;
    }
    return "Не назначено";
  })();

  useEffect(() => {
    if (!client?.id || !workout?.id) return;
    getCompletionForToday(client.id, workout.id, todayName).then(setCompletedToday).catch(() => setCompletedToday(false));
  }, [client?.id, workout?.id, todayName]);

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
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить план клиента");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.id]);

  const exit = () => { logout(); window.location.hash = "/"; };

  if (loading) {
    return <main className="min-h-screen grid place-items-center px-4" style={{ background: "var(--bg)" }}><section className="glass rounded-[2rem] p-6 max-w-xl"><h1 className="text-3xl font-bold">Загружаем план...</h1></section></main>;
  }

  if (error) {
    return <main className="min-h-screen grid place-items-center px-4" style={{ background: "var(--bg)" }}><section className="glass rounded-[2rem] p-6 max-w-xl"><h1 className="text-3xl font-bold">Ошибка загрузки</h1><p className="mt-3" style={{ color: "#ff8a98" }}>{error}</p><button onClick={exit} className="mt-5 rounded-full px-5 py-3 glass">Выйти</button></section></main>;
  }

  if (!client || !workout) {
    return <main className="min-h-screen grid place-items-center px-4" style={{ background: "var(--bg)" }}><section className="glass rounded-[2rem] p-6 max-w-xl"><h1 className="text-3xl font-bold">План пока не назначен</h1><p className="mt-3" style={{ color: "var(--ink-2)" }}>Тренер ещё не назначил вам план тренировок в Supabase. Свяжитесь с тренером в Telegram.</p><button onClick={exit} className="mt-5 rounded-full px-5 py-3 glass">Выйти</button></section></main>;
  }

  const markDone = async () => {
    if (completedToday) return;
    try {
      await markWorkoutCompleted(client.id, workout.id, todayName);
      setCompletedToday(true);
      if (user?.id) { const updated = await fetchClientData(user.id); if (updated) { setClient(updated.client); setWorkouts(updated.workouts); setHistory(await fetchClientCompletionHistory(updated.client.id, user.id)); } }
      if (client.coachId) await createNotification(client.coachId, "Новая отметка тренировки", `${user?.name || client.name} выполнил тренировку ${todayWorkout?.title || workout.title}`, "/#/coach");
      sendCoachPush("Новая отметка тренировки", `${user?.name || client.name} выполнил тренировку ${todayWorkout?.title || workout.title}`);
      alert("Тренировка отмечена. Арсений увидит уведомление в кабинете тренера.");
    } catch {
      alert("Не удалось отметить тренировку. Попробуйте ещё раз.");
    }
  };

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-[270px_1fr]" style={{ background: "var(--bg)" }}>
      <aside className="border-r p-5 lg:min-h-screen" style={{ borderColor: "var(--line)", background: "rgba(0,0,0,.18)" }}>
        <button onClick={() => window.location.hash = "/"} className="flex items-center gap-3 font-bold mb-8"><span className="logo-mark" /> ARSENIICOACH</button>
        {[ ["today", "Сегодня"], ["plan", "Мой план"], ["history", "История"], ["progress", "Прогресс"], ["nutrition", "Питание"], ["chat", "Telegram"] ].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className="w-full text-left rounded-2xl px-4 py-3 mb-2" style={{ background: tab === id ? "rgba(104,225,253,.14)" : "transparent", color: tab === id ? "var(--ink)" : "var(--ink-3)", border: tab === id ? "1px solid rgba(104,225,253,.28)" : "1px solid transparent" }}>{label}</button>)}
        <button onClick={exit} className="w-full text-left rounded-2xl px-4 py-3 mt-6" style={{ color: "#ff8a98" }}>Выйти</button>
      </aside>

      <section className="p-4 md:p-8 relative overflow-hidden">
        <div className="grid-overlay fixed inset-0 opacity-30 pointer-events-none" />
        <header className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div><div className="eyebrow">Кабинет клиента</div><h1 className="mt-2 text-4xl md:text-6xl font-extrabold tracking-[-.025em]">Привет, {user?.name || client.name}</h1><p style={{ color: "var(--ink-2)" }}>Telegram: {user?.telegram || client.telegram}</p></div>
          <button disabled={completedToday || !todayWorkout || !(todayWorkout.exercises || []).length} onClick={markDone} className="rounded-full px-5 py-3 font-semibold disabled:opacity-55" style={{ background: completedToday ? "rgba(104,225,253,.25)" : "var(--accent)", color: completedToday ? "var(--ink)" : "var(--bg)" }}>{completedToday ? "Тренировка выполнена" : !todayWorkout ? "Сегодня тренировки нет" : "Отметить тренировку"}</button>
        </header>

        {tab === "today" && <Panel title={`Сегодня: ${todayWorkout?.title || "тренировки нет"}`} subtitle={todayName}><p className="mb-4" style={{ color: "var(--ink-2)" }}>{todayWorkout?.notes || workout.notes}</p>{(todayWorkout?.exercises || []).length ? <div className="space-y-3">{(todayWorkout?.exercises || []).map(e => <label key={e} className="app-card rounded-2xl p-4 flex gap-3 items-center"><input type="checkbox" checked={completedToday} disabled={completedToday} readOnly className="w-5 h-5" /><span>{e}</span></label>)}</div> : <div className="app-card rounded-2xl p-4" style={{ color: "var(--ink-2)" }}>На сегодня отдых или упражнения не указаны.</div>}</Panel>}
        {tab === "plan" && <Panel title="Мой план на неделю" subtitle="назначено тренером"><WeeklySchedule weeklyPlan={client.weeklyPlan || {}} workouts={workouts} /><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5"><Info title="Цель" value={client.goal || "Арсений пока не указал цель"} /><Info title="Следующая тренировка" value={nextWorkoutLabel} /></div></Panel>}
        {tab === "history" && <Panel title="Пройденные тренировки" subtitle="история выполненных планов"><CompletionHistory history={history} /></Panel>}
                {tab === "progress" && <Panel title="Мой прогресс" subtitle="обновляется тренером"><div className="grid grid-cols-1 md:grid-cols-3 gap-4"><Metric title="Выполнение" value={`${client.progress}%`} /><Metric title="Статус" value={client.status} /><Metric title="План" value={workout.title} /></div><div className="mt-5 h-4 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.08)" }}><div className="h-full" style={{ width: `${client.progress}%`, background: "linear-gradient(90deg,var(--accent),var(--secondary-accent))" }} /></div></Panel>}
        {tab === "nutrition" && <Panel title="Питание" subtitle="рекомендации от тренера"><p style={{ color: "var(--ink-2)" }}>{client.nutrition || "Арсений пока не добавил рекомендации по питанию."}</p></Panel>}
        {tab === "chat" && <Panel title="Связь с тренером" subtitle="связь через Telegram"><p style={{ color: "var(--ink-2)" }}>Все контакты на сайте переведены на Telegram.</p><a className="inline-flex mt-5 rounded-full px-5 py-3 font-semibold" href="https://t.me/president_h" target="_blank" rel="noreferrer" style={{ background: "var(--accent)", color: "var(--bg)" }}>Написать в Telegram @president_h</a></Panel>}
      </section>
    </main>
  );
};

const Panel = ({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) => <section className="relative z-10 glass rounded-[2rem] p-5 md:p-6"><div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-5"><h2 className="text-3xl font-bold tracking-[-.02em]">{title}</h2><span className="text-sm" style={{ color: "var(--ink-3)" }}>{subtitle}</span></div>{children}</section>;
const CompletionHistory = ({ history }: { history: CompletionHistoryItem[] }) => {
  if (!history.length) return <p style={{ color: "var(--ink-2)" }}>Выполненных тренировок пока нет.</p>;
  return (
    <div className="space-y-3">
      {history.map((item) => (
        <div key={item.id} className="app-card rounded-3xl p-5">
          <p className="text-sm" style={{ color: "var(--ink-3)" }}>{new Date(item.completedDate).toLocaleDateString("ru-RU")} • {item.dayOfWeek}</p>
          <b className="text-xl mt-2 block">{item.dayWorkoutTitle}</b>
          <p className="text-sm mt-2" style={{ color: "var(--ink-2)" }}>{item.workoutTitle} • {item.exerciseCount} упражнений</p>
        </div>
      ))}
    </div>
  );
};

const WeeklySchedule = ({ weeklyPlan, workouts }: { weeklyPlan: Record<string, string>; workouts: Workout[] }) => {
  const trainingDays = Object.keys(weeklyPlan || {}).sort((a, b) => weekDays.indexOf(a) - weekDays.indexOf(b));
  if (!trainingDays.length) return <p style={{ color: "var(--ink-2)" }}>План пока пуст. Тренер ещё не добавил тренировочные дни.</p>;
  return <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{trainingDays.map((day) => { const workout = workouts.find((item) => item.id === weeklyPlan[day]); const dayWorkout = getDayWorkout(workout, day); return <div key={day} className="app-card rounded-3xl p-5"><p className="text-sm" style={{ color: "var(--ink-3)" }}>{day}</p><b className="text-xl mt-2 block">{dayWorkout?.title || "Тренировка"}</b>{dayWorkout && <p className="text-sm mt-2" style={{ color: "var(--ink-2)" }}>{dayWorkout.focus || `${dayWorkout.exercises.length} упражнений`}</p>}</div>; })}</div>;
};
const Metric = ({ title, value }: { title: string; value: string }) => <div className="app-card rounded-3xl p-5"><p className="text-sm" style={{ color: "var(--ink-3)" }}>{title}</p><b className="text-2xl mt-2 block">{value}</b></div>;
const Info = ({ title, value }: { title: string; value: string }) => <div className="app-card rounded-3xl p-5"><p className="text-sm" style={{ color: "var(--ink-3)" }}>{title}</p><b className="text-xl mt-2 block">{value}</b></div>;

export default ClientDashboard;
