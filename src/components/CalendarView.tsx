import { useEffect, useMemo, useState } from "react";
import { buildMonthGrid, toISODate, CalendarWorkoutEntry } from "../lib/calendar";

const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

type CalendarViewProps = {
  entriesByDate: Map<string, CalendarWorkoutEntry[]>;
  loading?: boolean;
  onMonthChange: (anchor: Date) => void;
  /** Рендер содержимого раскрытого дня — разный для тренера (список клиентов) и клиента (своя тренировка). */
  renderDay: (date: string, entries: CalendarWorkoutEntry[]) => React.ReactNode;
};

const CalendarView = ({ entriesByDate, loading, onMonthChange, renderDay }: CalendarViewProps) => {
  const [anchor, setAnchor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => { onMonthChange(anchor); }, [anchor.getFullYear(), anchor.getMonth()]);

  const grid = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const todayIso = toISODate(new Date());

  const goToMonth = (offset: number) => {
    setSelectedDate(null);
    setAnchor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <div className="app-card rounded-3xl p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => goToMonth(-1)} className="rounded-full px-4 py-2 glass" aria-label="Предыдущий месяц">←</button>
        <h3 className="text-xl font-bold">{monthNames[anchor.getMonth()]} {anchor.getFullYear()}</h3>
        <button onClick={() => goToMonth(1)} className="rounded-full px-4 py-2 glass" aria-label="Следующий месяц">→</button>
      </div>

      {loading && <p className="text-sm mb-3" style={{ color: "var(--ink-3)" }}>Загружаем тренировки...</p>}

      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {weekdayLabels.map((label) => (
          <div key={label} className="text-center text-xs py-1" style={{ color: "var(--ink-3)" }}>{label}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {grid.map((date) => {
          const iso = toISODate(date);
          const isCurrentMonth = date.getMonth() === anchor.getMonth();
          const entries = entriesByDate.get(iso) || [];
          const isToday = iso === todayIso;
          const isSelected = iso === selectedDate;
          const allCompleted = entries.length > 0 && entries.every((entry) => entry.completed);

          return (
            <button
              key={iso}
              onClick={() => setSelectedDate((current) => (current === iso ? null : iso))}
              className="aspect-square rounded-xl p-1.5 flex flex-col items-center justify-start gap-1 text-sm transition-colors"
              style={{
                background: isSelected ? "rgba(104,225,253,.18)" : "rgba(255,255,255,.03)",
                border: isToday ? "1px solid rgba(104,225,253,.55)" : "1px solid transparent",
                color: isCurrentMonth ? "var(--ink)" : "var(--ink-3)",
                opacity: isCurrentMonth ? 1 : 0.45,
              }}
            >
              <span>{date.getDate()}</span>
              {entries.length > 0 && (
                <span
                  className="min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold flex items-center justify-center"
                  style={{
                    background: allCompleted ? "rgba(104,225,253,.22)" : "rgba(255,255,255,.10)",
                    color: allCompleted ? "var(--accent)" : "var(--ink-2)",
                  }}
                  aria-label={allCompleted ? "Все тренировки выполнены" : "Есть тренировки"}
                >
                  {entries.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="mt-4 rounded-2xl p-4" style={{ background: "rgba(255,255,255,.04)", border: "1px solid var(--line)" }}>
          {renderDay(selectedDate, entriesByDate.get(selectedDate) || [])}
        </div>
      )}
    </div>
  );
};

export default CalendarView;
