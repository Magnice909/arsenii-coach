import { motion } from "framer-motion";
import HoloCard from "./HoloCard";

const feed = [
  ["Давид начал тренировку", "Верх тела B • 19 минут назад"],
  ["Анна завершила блок", "Ноги • 35 минут назад"],
  ["Илья обновил рабочий вес", "Жим +2.5 кг • 42 минуты назад"],
];

const FloatingAppPreview = () => {
  return (
    <motion.div initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .8, delay: .25 }}>
      <HoloCard className="glass rounded-[2rem]" intensity={5}>
        <div className="p-5 md:p-6 relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(104,225,253,.18),transparent_42%)]" />
          <div className="relative flex items-center justify-between mb-20 text-sm" style={{ color: "var(--ink-3)" }}><span>20:26</span><span>● ● ●</span></div>
          <div className="relative">
            <div className="eyebrow mb-3">Приложение тренера</div>
            <h3 className="text-3xl md:text-4xl font-bold tracking-[-.02em] mb-5">Уведомления тренера</h3>
            <div className="space-y-3">
              {feed.map((item, i) => (
                <motion.div key={item[0]} className="app-card rounded-2xl p-4" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .45 + i * .15 }}>
                  <b>{item[0]}</b>
                  <p className="text-sm mt-1" style={{ color: "var(--ink-3)" }}>{item[1]}</p>
                </motion.div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-3 h-24 items-end mt-6">
              {[42, 74, 58, 91, 67].map((h) => <div key={h} className="rounded-t-xl" style={{ height: `${h}%`, background: "linear-gradient(180deg, var(--accent), rgba(104,225,253,.08))" }} />)}
            </div>
          </div>
        </div>
      </HoloCard>
    </motion.div>
  );
};

export default FloatingAppPreview;
