import { Client, Workout } from "./storage";
import { getDayWorkout, fetchPlanPeriodsInRange, PlanPeriod, toISODate } from "./db";
import { supabase } from "./supabase";

export { toISODate };

/** Русские названия дней недели, индекс совпадает с JS Date.getDay() (0 = воскресенье). */
const jsDayToName = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

export const dayNameForDate = (date: Date): string => jsDayToName[date.getDay()];

/** Все даты месяца, в котором лежит anchor, плюс хвосты соседних месяцев,
 *  чтобы сетка всегда была кратна 7 дням (как в обычном календарном виджете). */
export const buildMonthGrid = (anchor: Date): Date[] => {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);

  // Понедельник = начало недели. getDay(): 0=вс..6=сб, переводим в 0=пн..6=вс.
  const leadingEmptyDays = (firstOfMonth.getDay() + 6) % 7;
  const trailingEmptyDays = 6 - ((lastOfMonth.getDay() + 6) % 7);

  const start = new Date(year, month, 1 - leadingEmptyDays);
  const totalDays = leadingEmptyDays + lastOfMonth.getDate() + trailingEmptyDays;

  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
};

export type CalendarWorkoutEntry = {
  clientId: string;
  clientName: string;
  workoutId: string;
  title: string;
  exerciseCount: number;
  completed: boolean;
};

const findPeriodForDate = (periods: PlanPeriod[], clientId: string, iso: string): PlanPeriod | undefined =>
  periods.find((period) => period.clientId === clientId && period.startDate <= iso && iso <= period.endDate);

/** Для каждой даты в диапазоне определяет, есть ли у клиента активный
 *  7-дневный план на эту дату (plan_periods), и если есть — какой день
 *  недельного шаблона ей соответствует. Дата вне любого периода клиента
 *  считается пустой (план ещё не назначен на это время), а не "отдыхом
 *  по шаблону" — план больше не проецируется бессрочно во все стороны. */
export const buildCalendarEntries = async (
  clients: Client[],
  workouts: Workout[],
  rangeStart: string,
  rangeEnd: string
): Promise<Map<string, CalendarWorkoutEntry[]>> => {
  const result = new Map<string, CalendarWorkoutEntry[]>();
  if (!clients.length) return result;

  const clientIds = clients.map((client) => client.id);

  const [completionsResult, periods] = await Promise.all([
    supabase
      .from("workout_completions")
      .select("client_id, day_of_week, workout_id, completed_date")
      .in("client_id", clientIds)
      .gte("completed_date", rangeStart)
      .lte("completed_date", rangeEnd),
    fetchPlanPeriodsInRange(clientIds, rangeStart, rangeEnd),
  ]);

  if (completionsResult.error) throw completionsResult.error;

  const completedSet = new Set(
    (completionsResult.data || []).map((row: any) => `${row.client_id}::${row.completed_date}::${row.workout_id}`)
  );

  const start = new Date(rangeStart + "T00:00:00");
  const end = new Date(rangeEnd + "T00:00:00");

  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const iso = toISODate(date);
    const dayName = dayNameForDate(date);
    const entries: CalendarWorkoutEntry[] = [];

    for (const client of clients) {
      const period = findPeriodForDate(periods, client.id, iso);
      if (!period) continue;

      const workout = workouts.find((item) => item.id === period.workoutId);
      const dayWorkout = getDayWorkout(workout, dayName);
      if (!dayWorkout) continue;

      entries.push({
        clientId: client.id,
        clientName: client.name,
        workoutId: period.workoutId,
        title: dayWorkout.title,
        exerciseCount: dayWorkout.exercises?.length || 0,
        completed: completedSet.has(`${client.id}::${iso}::${period.workoutId}`),
      });
    }

    if (entries.length) result.set(iso, entries);
  }

  return result;
};

