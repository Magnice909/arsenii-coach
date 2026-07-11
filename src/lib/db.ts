import { Client, DayWorkout, makeId, Message, SiteSettings, WeeklyTemplate, Workout } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

/** Локальная дата в формате YYYY-MM-DD, без прохода через UTC.
 *  `date.toISOString().slice(0, 10)` считает по UTC: в часовых поясах восточнее
 *  UTC (Москва и т.п.) в первые часы суток это ошибочно даёт вчерашний день —
 *  из-за этого «сегодня», недельные границы и даты периодов плана съезжали
 *  на день, а end_date переставал совпадать с CHECK-ограничением в базе
 *  (end_date = start_date + 6), и создание/продление плана падало с ошибкой. */
export const toISODate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getCurrentWeekRange = () => {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toISODate(monday), end: toISODate(sunday) };
};

const makeProgressKey = (day: string, workoutId: string) => `${day}::${workoutId}`;

const calculateProgress = (scheduledPlan: Record<string, string>, completions: { day_of_week: string; workout_id: string }[]) => {
  const scheduledKeys = Object.entries(scheduledPlan).map(([day, workoutId]) => makeProgressKey(day, workoutId));
  if (!scheduledKeys.length) return 0;
  const completedKeys = new Set(completions.map((row) => makeProgressKey(row.day_of_week, row.workout_id)));
  const completed = scheduledKeys.filter((key) => completedKeys.has(key)).length;
  return Math.min(100, Math.round((completed / scheduledKeys.length) * 100));
};

const isNextPlanDue = (date?: string | null) => Boolean(date && new Date(date + "T00:00:00") <= new Date());
const buildWeeklyPlanFromWorkout = (workout?: Workout): Record<string, string> => workout?.weeklyTemplate ? Object.fromEntries(Object.keys(workout.weeklyTemplate).map((day) => [day, workout.id])) : {};

const dbClientToClient = (row: any, workouts: Workout[] = [], weeklyPlan: Record<string, string> = {}): Client => {
  const assignedWorkoutId = Object.values(weeklyPlan)[0] || "";
  const workout = workouts.find((item) => item.id === assignedWorkoutId);
  return {
    id: row.id,
    userId: row.user_id || undefined,
    coachId: row.coach_id || undefined,
    name: row.name || "Клиент",
    telegram: row.telegram || "@username",
    email: row.email || "",
    goal: row.goal || "",
    plan: workout?.title || "",
    status: row.status || "Новый",
    progress: row.progress || 0,
    nextWorkout: row.next_workout || "",
    comment: row.comment || "",
    nutrition: row.nutrition || "",
    assignedWorkoutId,
    weeklyPlan,
    nextPlanId: row.next_plan_id || undefined,
    nextPlanWeekStart: row.next_plan_week_start || undefined,
  };
};

export const weekDays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

export const createEmptyWeeklyTemplate = (): WeeklyTemplate => ({});

export const getDayWorkout = (workout: Workout | undefined, day: string): DayWorkout | null => {
  if (!workout) return null;
  if (workout.weeklyTemplate?.[day]) return workout.weeklyTemplate[day];
  if (workout.day === day) return { title: workout.title, focus: workout.focus, notes: workout.notes, exercises: workout.exercises };
  return { title: "Отдых", focus: "", notes: "", exercises: [] };
};

const parseWeeklyTemplate = (value: unknown): WeeklyTemplate | undefined => {
  if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
  const candidate = value as { type?: string; days?: WeeklyTemplate };
  return candidate.days || undefined;
};

const serializeWorkoutExercises = (workout: Workout) => workout.weeklyTemplate ? { type: "weekly_template", days: workout.weeklyTemplate } : workout.exercises;

const dbWorkoutToWorkout = (row: any): Workout => {
  const weeklyTemplate = parseWeeklyTemplate(row.exercises);
  return {
    id: row.id,
    title: row.title || "Тренировка",
    day: row.day || "Понедельник",
    focus: row.focus || "",
    notes: row.notes || "",
    exercises: Array.isArray(row.exercises) ? row.exercises : [],
    weeklyTemplate,
  };
};

export const fetchCoachData = async (coachId: string) => {
  if (!isSupabaseConfigured) return { clients: [] as Client[], workouts: [] as Workout[] };

  const [{ data: workoutRows, error: workoutsError }, { data: clientRows, error: clientsError }, { data: planRows, error: plansError }] = await Promise.all([
    supabase.from("workouts").select("*").eq("coach_id", coachId).order("created_at", { ascending: false }),
    supabase.from("clients").select("*").eq("coach_id", coachId).order("created_at", { ascending: false }),
    supabase.from("weekly_plans").select("*").eq("coach_id", coachId),
  ]);

  if (workoutsError) throw workoutsError;
  if (clientsError) throw clientsError;
  if (plansError) throw plansError;

  const workouts = (workoutRows || []).map(dbWorkoutToWorkout);
  const planByClient: Record<string, Record<string, string>> = {};
  for (const row of planRows || []) {
    planByClient[row.client_id] = planByClient[row.client_id] || {};
    planByClient[row.client_id][row.day_of_week] = row.workout_id;
  }

  const clientIds = (clientRows || []).map((row) => row.id);
  const { start, end } = getCurrentWeekRange();
  const todayIso = toISODate(new Date());
  const [{ data: completionRows }, activePeriods] = await Promise.all([
    clientIds.length
      ? supabase.from("workout_completions").select("client_id, day_of_week, workout_id").in("client_id", clientIds).gte("completed_date", start).lte("completed_date", end)
      : Promise.resolve({ data: [] as any[] }),
    fetchPlanPeriodsInRange(clientIds, todayIso, todayIso),
  ]);

  // Активный 7-дневный план (plan_periods) — новый источник истины о том, что
  // назначено клиенту прямо сейчас. Раньше прогресс и «текущий план» на этой
  // странице считались только по старым weekly_plans/next_plan_id, из-за чего
  // тренер видел не тот план (и не тот прогресс), что реально видит клиент.
  const activeWorkoutIdByClient: Record<string, string> = {};
  for (const period of activePeriods) activeWorkoutIdByClient[period.clientId] = period.workoutId;

  const completedByClient: Record<string, { day_of_week: string; workout_id: string }[]> = {};
  for (const row of completionRows || []) {
    completedByClient[row.client_id] = completedByClient[row.client_id] || [];
    completedByClient[row.client_id].push({ day_of_week: row.day_of_week, workout_id: row.workout_id });
  }

  const clients = (clientRows || []).map((row) => {
    const activeWorkout = workouts.find((workout) => workout.id === activeWorkoutIdByClient[row.id]);
    const dueNextWorkout = isNextPlanDue(row.next_plan_week_start) ? workouts.find((workout) => workout.id === row.next_plan_id) : undefined;
    const weeklyPlan = activeWorkout ? buildWeeklyPlanFromWorkout(activeWorkout) : dueNextWorkout ? buildWeeklyPlanFromWorkout(dueNextWorkout) : (planByClient[row.id] || {});
    const client = dbClientToClient(row, workouts, weeklyPlan);
    if (activeWorkout) {
      client.assignedWorkoutId = activeWorkout.id;
      client.plan = activeWorkout.title;
    } else if (dueNextWorkout) {
      client.assignedWorkoutId = dueNextWorkout.id;
      client.plan = dueNextWorkout.title;
    }
    client.progress = calculateProgress(weeklyPlan, completedByClient[row.id] || []);
    return client;
  });
  return { clients, workouts };
};

export const createClientRecord = async (coachId: string): Promise<Client> => {
  const { data, error } = await supabase
    .from("clients")
    .insert({ coach_id: coachId, name: "Новый клиент", telegram: "@username", email: "", status: "Новый", progress: 0 })
    .select("*")
    .single();
  if (error) throw error;
  return dbClientToClient(data);
};

export const createClientRecordFromClient = async (coachId: string, client: Client): Promise<Client> => {
  const { data, error } = await supabase
    .from("clients")
    .insert({
      coach_id: coachId,
      name: client.name || "Новый клиент",
      telegram: client.telegram || "@username",
      email: client.email || "",
      goal: client.goal || "",
      status: client.status || "Новый",
      progress: client.progress || 0,
      next_workout: client.nextWorkout || "",
      comment: client.comment || "",
      nutrition: client.nutrition || "",
      user_id: client.userId || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return dbClientToClient(data, [], client.weeklyPlan || {});
};


export const updateClientRecord = async (coachId: string, client: Client) => {
  const { error } = await supabase.from("clients").update({
    name: client.name,
    telegram: client.telegram,
    email: client.email,
    goal: client.goal,
    status: client.status,
    progress: client.progress,
    next_workout: client.nextWorkout,
    comment: client.comment,
    nutrition: client.nutrition,
    user_id: client.userId || null,
    next_plan_id: client.nextPlanId || null,
    next_plan_week_start: client.nextPlanWeekStart || null,
  }).eq("id", client.id).eq("coach_id", coachId);
  if (error) throw error;
};

export const deleteClientRecord = async (coachId: string, clientId: string) => {
  const { error } = await supabase.from("clients").delete().eq("id", clientId).eq("coach_id", coachId);
  if (error) throw error;
};

export const createWorkoutRecord = async (coachId: string): Promise<Workout> => {
  const { data, error } = await supabase
    .from("workouts")
    .insert({ coach_id: coachId, title: "Новый недельный план", day: "Понедельник", focus: "", notes: "", exercises: { type: "weekly_template", days: createEmptyWeeklyTemplate() } })
    .select("*")
    .single();
  if (error) throw error;
  return dbWorkoutToWorkout(data);
};

export const updateWorkoutRecord = async (coachId: string, workout: Workout) => {
  const { error } = await supabase.from("workouts").update({
    title: workout.title,
    day: workout.day,
    focus: workout.focus,
    notes: workout.notes,
    exercises: serializeWorkoutExercises(workout),
  }).eq("id", workout.id).eq("coach_id", coachId);
  if (error) throw error;
};

export const deleteWorkoutRecord = async (coachId: string, workoutId: string) => {
  const { error } = await supabase.from("workouts").delete().eq("id", workoutId).eq("coach_id", coachId);
  if (error) throw error;
};

export const replaceWeeklyPlanRecord = async (coachId: string, clientId: string, weeklyPlan: Record<string, string>) => {
  const { error: deleteError } = await supabase.from("weekly_plans").delete().eq("client_id", clientId).eq("coach_id", coachId);
  if (deleteError) throw deleteError;

  const rows = Object.entries(weeklyPlan)
    .filter(([, workoutId]) => Boolean(workoutId))
    .map(([day, workoutId]) => ({ coach_id: coachId, client_id: clientId, workout_id: workoutId, day_of_week: day }));

  if (!rows.length) return;
  const { error } = await supabase.from("weekly_plans").insert(rows);
  if (error) throw error;
};

export const fetchClientData = async (userId: string) => {
  const { data: clientRow, error: clientError } = await supabase.from("clients").select("*").eq("user_id", userId).maybeSingle();
  if (clientError) throw clientError;
  if (!clientRow) return null;

  const [{ data: planRows, error: plansError }, { data: periodRows, error: periodsError }] = await Promise.all([
    supabase.from("weekly_plans").select("*").eq("client_id", clientRow.id),
    supabase.from("plan_periods").select("*").eq("client_id", clientRow.id),
  ]);
  if (plansError) throw plansError;
  if (periodsError) throw periodsError;

  // Периоды (plan_periods) — новый источник активного плана клиента. Раньше
  // их workout_id не попадал в список загружаемых тренировок, и если тренер
  // назначал план только через «Активный план (7 дней)» (не дублируя его же
  // в старом «Шаблоне тренировок»), клиент не видел свою тренировку вообще:
  // ни на вкладке «Сегодня», ни в календаре, ни в прогрессе.
  const periods = (periodRows || []).map(dbPlanPeriodToPeriod);
  const todayIso = toISODate(new Date());
  const currentPeriod = periods.find((period) => period.startDate <= todayIso && todayIso <= period.endDate);

  const workoutIds = [...new Set([
    ...(planRows || []).map((row) => row.workout_id),
    ...periods.map((period) => period.workoutId),
    clientRow.next_plan_id,
  ].filter(Boolean))];
  const { data: workoutRows, error: workoutsError } = workoutIds.length
    ? await supabase.from("workouts").select("*").in("id", workoutIds)
    : { data: [], error: null } as any;
  if (workoutsError) throw workoutsError;

  const workouts = (workoutRows || []).map(dbWorkoutToWorkout);
  const weeklyPlan: Record<string, string> = {};
  for (const row of planRows || []) weeklyPlan[row.day_of_week] = row.workout_id;

  const { start, end } = getCurrentWeekRange();
  const { data: completionRows } = await supabase
    .from("workout_completions")
    .select("day_of_week, workout_id")
    .eq("client_id", clientRow.id)
    .eq("user_id", userId)
    .gte("completed_date", start)
    .lte("completed_date", end);

  const activeWorkout = currentPeriod ? workouts.find((item: Workout) => item.id === currentPeriod.workoutId) : undefined;
  const dueNextWorkout = isNextPlanDue(clientRow.next_plan_week_start) ? workouts.find((item: Workout) => item.id === clientRow.next_plan_id) : undefined;
  const effectiveWeeklyPlan = activeWorkout ? buildWeeklyPlanFromWorkout(activeWorkout) : dueNextWorkout ? buildWeeklyPlanFromWorkout(dueNextWorkout) : weeklyPlan;
  const client = dbClientToClient(clientRow, workouts, effectiveWeeklyPlan);
  if (activeWorkout) {
    client.assignedWorkoutId = activeWorkout.id;
    client.plan = activeWorkout.title;
  } else if (dueNextWorkout) {
    client.assignedWorkoutId = dueNextWorkout.id;
    client.plan = dueNextWorkout.title;
  }
  client.progress = calculateProgress(effectiveWeeklyPlan, (completionRows || []) as { day_of_week: string; workout_id: string }[]);

  return { client, workouts };
};

export const fetchSiteSettingsDb = async (): Promise<SiteSettings | null> => {
  const { data, error } = await supabase.from("site_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    brand: data.brand || "ARSENIICOACH",
    heroBadge: data.hero_badge || "Сейчас открыт набор на 1:1 сопровождение",
    heroTitle: data.hero_title || "1:1 онлайн фитнес-коучинг",
    heroSubtitle: data.hero_subtitle || "",
    ctaText: data.cta_text || "Оставить заявку",
    quote: data.quote || "",
    approachTitle: data.approach_title || "Почему онлайн-сопровождение?",
    approachText1: data.approach_text_1 || "",
    approachText2: data.approach_text_2 || "",
    photoDataUrl: data.photo_url || "",
    introTagline: data.intro_tagline || "Онлайн фитнес-коучинг",
    introSlogan: data.intro_slogan || "Структура. Контроль. Результат.",
  };
};

export const saveSiteSettingsDb = async (settings: SiteSettings) => {
  const { error } = await supabase.from("site_settings").upsert({
    id: 1,
    brand: settings.brand,
    hero_badge: settings.heroBadge,
    hero_title: settings.heroTitle,
    hero_subtitle: settings.heroSubtitle,
    cta_text: settings.ctaText,
    quote: settings.quote,
    approach_title: settings.approachTitle,
    approach_text_1: settings.approachText1,
    approach_text_2: settings.approachText2,
    photo_url: settings.photoDataUrl,
    intro_tagline: settings.introTagline,
    intro_slogan: settings.introSlogan,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
};

/** Загружает фото в Supabase Storage и возвращает публичный URL.
 *  Раньше фото грузилось как base64 прямо в текстовую колонку БД —
 *  несколько мегабайт текста на каждую загрузку лендинга кем угодно.
 *  Теперь в базе хранится только короткая ссылка. */
export const uploadSitePhoto = async (file: File): Promise<string> => {
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `hero-photo-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("site-assets")
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("site-assets").getPublicUrl(path);
  return data.publicUrl;
};

export const fetchCoachNotifications = async (): Promise<Message[]> => {
  const { data, error } = await supabase.from("notifications").select("*").is("read_at", null).order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  return (data || []).map((row: any) => ({ id: row.id || makeId(), from: row.title || "Уведомление", text: row.body || "", time: row.created_at ? new Date(row.created_at).toLocaleString("ru-RU") : "", url: row.url || "/#/coach" }));
};

export const createNotification = async (recipientId: string, title: string, body: string, url = "/") => {
  const { data: sessionData } = await supabase.auth.getSession();
  const senderId = sessionData.session?.user.id;
  const { error } = await supabase.from("notifications").insert({ recipient_id: recipientId, sender_id: senderId, title, body, url });
  if (error) throw error;
};


export const getCompletionForToday = async (clientId: string, workoutId: string, dayOfWeek: string): Promise<boolean> => {
  const today = toISODate(new Date());
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return false;
  const { data, error } = await supabase
    .from("workout_completions")
    .select("id")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .eq("workout_id", workoutId)
    .eq("day_of_week", dayOfWeek)
    .eq("completed_date", today)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
};

export const markWorkoutCompleted = async (clientId: string, workoutId: string, dayOfWeek: string) => {
  const today = toISODate(new Date());
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Сессия клиента не найдена");

  const { error } = await supabase.from("workout_completions").insert({
    client_id: clientId,
    user_id: userId,
    workout_id: workoutId,
    day_of_week: dayOfWeek,
    completed_date: today,
  });

  if (error && !error.message.toLowerCase().includes("duplicate")) throw error;
};


export type CompletionHistoryItem = {
  id: string;
  dayOfWeek: string;
  completedDate: string;
  workoutId: string;
  workoutTitle: string;
  dayWorkoutTitle: string;
  exerciseCount: number;
  exercises: string[];
};

export const fetchClientCompletionHistory = async (clientId: string, userId: string): Promise<CompletionHistoryItem[]> => {
  const { data, error } = await supabase
    .from("workout_completions")
    .select("id, workout_id, day_of_week, completed_date, created_at")
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .order("completed_date", { ascending: false })
    .limit(50);

  if (error) throw error;
  const rows = data || [];
  const workoutIds = [...new Set(rows.map((row: any) => row.workout_id))];
  const { data: workoutRows, error: workoutsError } = workoutIds.length
    ? await supabase.from("workouts").select("*").in("id", workoutIds)
    : { data: [], error: null } as any;
  if (workoutsError) throw workoutsError;

  const workouts = (workoutRows || []).map(dbWorkoutToWorkout);
  return rows.map((row: any) => {
    const workout = workouts.find((item: Workout) => item.id === row.workout_id);
    const dayWorkout = getDayWorkout(workout, row.day_of_week);
    return {
      id: row.id,
      dayOfWeek: row.day_of_week,
      completedDate: row.completed_date,
      workoutId: row.workout_id,
      workoutTitle: workout?.title || "План",
      dayWorkoutTitle: dayWorkout?.title || "Тренировка",
      exerciseCount: dayWorkout?.exercises.length || 0,
      exercises: dayWorkout?.exercises || [],
    };
  });
};


export type StrengthRecord = {
  id: string;
  clientId: string;
  userId: string;
  muscleGroup: string;
  exerciseName: string;
  maxWeight: number;
  recordedDate: string;
  createdAt?: string;
};

const dbStrengthRecordToRecord = (row: any): StrengthRecord => ({
  id: row.id,
  clientId: row.client_id,
  userId: row.user_id,
  muscleGroup: row.muscle_group || "Другое",
  exerciseName: row.exercise_name || "Упражнение",
  maxWeight: Number(row.max_weight || 0),
  recordedDate: row.recorded_date,
  createdAt: row.created_at,
});

export const fetchClientStrengthRecords = async (clientId: string, userId: string): Promise<StrengthRecord[]> => {
  const { data, error } = await supabase
    .from("strength_records")
    .select("*")
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .order("recorded_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data || []).map(dbStrengthRecordToRecord);
};

export const createStrengthRecord = async (record: {
  clientId: string;
  userId: string;
  muscleGroup: string;
  exerciseName: string;
  maxWeight: number;
  recordedDate: string;
}): Promise<StrengthRecord> => {
  const { data, error } = await supabase
    .from("strength_records")
    .insert({
      client_id: record.clientId,
      user_id: record.userId,
      muscle_group: record.muscleGroup,
      exercise_name: record.exerciseName,
      max_weight: record.maxWeight,
      recorded_date: record.recordedDate,
    })
    .select("*")
    .single();

  if (error) throw error;
  return dbStrengthRecordToRecord(data);
};


export const markNotificationRead = async (notificationId: string) => {
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId);
  if (error) throw error;
};


export const fetchCoachClientStrengthRecords = async (clientId: string): Promise<StrengthRecord[]> => {
  const { data, error } = await supabase
    .from("strength_records")
    .select("*")
    .eq("client_id", clientId)
    .order("recorded_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data || []).map(dbStrengthRecordToRecord);
};

// ============================================================
// Планы на 7-дневные периоды (plan_periods)
// ============================================================

export type PlanPeriod = {
  id: string;
  clientId: string;
  workoutId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
};

const dbPlanPeriodToPeriod = (row: any): PlanPeriod => ({
  id: row.id,
  clientId: row.client_id,
  workoutId: row.workout_id,
  startDate: row.start_date,
  endDate: row.end_date,
});

export const addDaysToISO = (iso: string, days: number): string => {
  const [year, month, day] = iso.split("-").map(Number);
  return toISODate(new Date(year, month - 1, day + days));
};

/** Создаёт новый 7-дневный план, начинающийся с указанной даты.
 *  end_date всегда start_date + 6 — это проверяется и на уровне БД (CHECK). */
export const createPlanPeriod = async (clientId: string, workoutId: string, startDate: string): Promise<PlanPeriod> => {
  const endDate = addDaysToISO(startDate, 6);

  // У клиента не может быть двух активных планов на одну и ту же дату.
  // Раньше при создании плана поверх уже существующего (повторное
  // назначение, гонка «Продлить»/«Назначить») в базе оставались две
  // пересекающиеся строки — календарь показывал план нормально (берёт
  // первый подходящий период), а вкладка «Сегодня» ломалась: она ищет
  // ровно один активный период через .maybeSingle() и при двух строках
  // получает ошибку «several rows returned», которая тихо превращалась
  // в «плана нет». Поэтому чистим пересекающиеся периоды перед вставкой.
  const { error: deleteError } = await supabase
    .from("plan_periods")
    .delete()
    .eq("client_id", clientId)
    .lte("start_date", endDate)
    .gte("end_date", startDate);
  if (deleteError) throw deleteError;

  const { data, error } = await supabase
    .from("plan_periods")
    .insert({ client_id: clientId, workout_id: workoutId, start_date: startDate, end_date: endDate })
    .select("*")
    .single();
  if (error) throw error;
  return dbPlanPeriodToPeriod(data);
};

/** «Продлить» — создаёт следующий 7-дневный период сразу после последнего
 *  существующего периода клиента (или с сегодня, если периодов ещё нет),
 *  с тем же шаблоном тренировок. */
export const extendClientPlan = async (clientId: string, workoutId: string): Promise<PlanPeriod> => {
  const { data: lastPeriod, error: lastError } = await supabase
    .from("plan_periods")
    .select("end_date")
    .eq("client_id", clientId)
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;

  const todayIso = toISODate(new Date());
  const nextStart = lastPeriod?.end_date ? addDaysToISO(lastPeriod.end_date, 1) : todayIso;
  return createPlanPeriod(clientId, workoutId, nextStart);
};

/** Текущий активный план клиента — период, в диапазон которого попадает
 *  сегодняшняя дата. Переход на новый период происходит автоматически:
 *  просто меняется результат этого запроса, без какого-либо ручного действия. */
export const fetchCurrentPlanPeriod = async (clientId: string): Promise<PlanPeriod | null> => {
  const todayIso = toISODate(new Date());
  // Без .limit(1) перед выборкой одной строки: если для клиента всё же
  // оказалось два периода на сегодня (старые данные до фикса в
  // createPlanPeriod), .maybeSingle() бросает ошибку «several rows
  // returned», и клиент видит «плана нет», хотя план есть и виден в
  // календаре. Берём один — самый недавно созданный — вместо падения.
  const { data, error } = await supabase
    .from("plan_periods")
    .select("*")
    .eq("client_id", clientId)
    .lte("start_date", todayIso)
    .gte("end_date", todayIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? dbPlanPeriodToPeriod(data) : null;
};

/** Все периоды клиента, пересекающиеся с диапазоном дат — для построения
 *  календаря (тренер видит и прошлые, и будущие назначенные периоды). */
export const fetchPlanPeriodsInRange = async (clientIds: string[], rangeStart: string, rangeEnd: string): Promise<PlanPeriod[]> => {
  if (!clientIds.length) return [];
  const { data, error } = await supabase
    .from("plan_periods")
    .select("*")
    .in("client_id", clientIds)
    .lte("start_date", rangeEnd)
    .gte("end_date", rangeStart);
  if (error) throw error;
  return (data || []).map(dbPlanPeriodToPeriod);
};

