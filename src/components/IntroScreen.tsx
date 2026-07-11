import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const IntroScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [phase, setPhase] = useState<"brand" | "tagline" | "exit">("brand");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("tagline"), 1100);
    const t2 = setTimeout(() => setPhase("exit"), 2600);
    const t3 = setTimeout(onComplete, 3300);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden" style={{ background: "var(--bg)" }} animate={phase === "exit" ? { opacity: 0 } : { opacity: 1 }} transition={{ duration: .7 }}>
      <div className="grid-overlay absolute inset-0 opacity-60" />
      <div className="absolute h-[520px] w-[520px] rounded-full blur-3xl" style={{ background: "var(--accent-glow)" }} />
      <div className="relative text-center">
        <AnimatePresence mode="wait">
          {phase === "brand" && (
            <motion.div key="brand" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <div className="mx-auto mb-6 logo-mark scale-125" />
              <div className="holo-text text-4xl md:text-6xl font-extrabold tracking-[-.02em]">ARSENIICOACH</div>
              <div className="eyebrow mt-4">Онлайн фитнес-коучинг</div>
            </motion.div>
          )}
          {phase === "tagline" && (
            <motion.div key="tagline" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }}>
              <div className="text-2xl md:text-5xl font-semibold tracking-[-.02em]">Структура. Контроль. Результат.</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div className="absolute bottom-0 left-0 h-1" style={{ background: "var(--accent)" }} initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 3.1, ease: "easeInOut" }} />
    </motion.div>
  );
};

export default IntroScreen;
