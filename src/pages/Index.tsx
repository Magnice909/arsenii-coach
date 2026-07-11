import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import IntroScreen from "../components/IntroScreen";
import MultiStepForm from "../components/MultiStepForm";
import ScrollReveal from "../components/ScrollReveal";
import FloatingAppPreview from "../components/FloatingAppPreview";
import HoloCard from "../components/HoloCard";
import { getSiteSettings } from "../lib/storage";
import { fetchSiteSettingsDb } from "../lib/db";
import { isSupabaseConfigured } from "../lib/supabase";

// WebGL-сцена — тяжёлая (three.js), грузим отдельным чанком отдельно от
// остального лендинга, чтобы она не задерживала первую отрисовку страницы.
const Holo3DGem = lazy(() => import("../components/Holo3DGem"));

const features = [
  { icon: "◉", title: "Персональный план тренировок", desc: "Программа строится вокруг вашего графика, уровня и цели.", tag: "Training" },
  { icon: "★", title: "Питание без крайностей", desc: "Понятная стратегия по калориям, белку и привычкам.", tag: "Nutrition" },
  { icon: "↻", title: "Еженедельные check-in", desc: "Корректировки по фото, весам, замерам и самочувствию.", tag: "Tracking" },
  { icon: "⇧", title: "Доступ к приложению для тренировок", desc: "Тренировки, прогресс, коммуникация и отметки выполнения в одном месте.", tag: "Приложение" },
];

const Index = () => {
  const [showIntro, setShowIntro] = useState(true);
  const [settings, setSettings] = useState(getSiteSettings());
  const handleIntroComplete = useCallback(() => setShowIntro(false), []);
  const scrollToApply = () => document.getElementById("apply")?.scrollIntoView({ behavior: "smooth" });

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    fetchSiteSettingsDb()
      .then((remote) => { if (remote) setSettings(remote); })
      .catch(() => { /* остаёмся на локальных дефолтах, если запрос не удался */ });
  }, []);

  return (
    <>
      <AnimatePresence>{showIntro && <IntroScreen onComplete={handleIntroComplete} brand={settings.brand} tagline={settings.introTagline} slogan={settings.introSlogan} />}</AnimatePresence>
      <div className="min-h-screen relative overflow-hidden" style={{ background: "var(--bg)" }}>
        <div className="grid-overlay fixed inset-0 opacity-60 pointer-events-none" />
        <div className="aurora-a fixed -top-44 left-1/2 h-[560px] w-[560px] rounded-full blur-3xl pointer-events-none" style={{ background: "var(--accent-glow)" }} />
        <div className="aurora-b fixed top-1/3 -right-40 h-[430px] w-[430px] rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(139,92,246,.18)" }} />
        <div className="aurora-c fixed bottom-0 left-10 h-[380px] w-[380px] rounded-full blur-3xl pointer-events-none" style={{ background: "rgba(255,138,216,.10)" }} />

        <header className="fixed top-5 left-1/2 z-40 w-[calc(100%-32px)] max-w-6xl -translate-x-1/2 glass rounded-full px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex items-center gap-3 font-bold tracking-[-.02em]">
              <span className="logo-mark" /> {settings.brand}
            </button>
            <nav className="hidden md:flex items-center gap-7 text-sm" style={{ color: "var(--ink-2)" }}>
              <a href="#included">Что входит</a><a href="#approach">Подход</a><a href="#results">Результаты</a>
            </nav>
            <div className="flex items-center gap-2"><button onClick={() => window.location.hash = "/login"} className="inline-flex rounded-full px-4 sm:px-5 py-2.5 text-sm font-semibold glass">Войти</button><button onClick={scrollToApply} className="btn-shine rounded-full px-4 sm:px-5 py-2.5 text-sm font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>{settings.ctaText}</button></div>
          </div>
        </header>

        <main className="relative z-10 pt-32 md:pt-40">
          <section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 md:grid-cols-[1fr_430px] md:items-center 2xl:grid-cols-[1fr_240px_430px]">
            <div className="relative">
              <motion.div className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm mb-7" style={{ borderColor: "var(--line)", color: "var(--ink-2)", background: "rgba(255,255,255,.04)" }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <span className="pulse-dot" /> {settings.heroBadge}
              </motion.div>
              <motion.h1 className="holo-text text-6xl md:text-8xl font-extrabold leading-[.86] tracking-[-.035em] max-w-4xl" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1 }}>
                {settings.heroTitle}
              </motion.h1>
              <motion.p className="mt-7 max-w-2xl text-lg md:text-xl" style={{ color: "var(--ink-2)" }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 }}>
                {settings.heroSubtitle}
              </motion.p>
              <motion.div className="mt-8 flex flex-wrap gap-3" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .3 }}>
                <button onClick={scrollToApply} className="btn-shine rounded-full px-6 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>{settings.ctaText}</button>
                <a href="#included" className="rounded-full px-6 py-3 glass">Что входит</a>
              </motion.div>
              <div className="mt-10 flex justify-center 2xl:hidden">
                <Suspense fallback={null}><Holo3DGem /></Suspense>
              </div>
            </div>
            {/* Отдельная колонка сетки для 2xl+, а не absolute-позиционирование
                поверх заголовка: heroTitle редактируется тренером и может стать
                длиннее — тогда абсолютный куб просто наехал бы на текст. Своя
                колонка исключает наложение при любой длине текста. */}
            <div className="hidden 2xl:flex items-center justify-center">
              <Suspense fallback={null}><Holo3DGem /></Suspense>
            </div>
            <div id="apply"><MultiStepForm /></div>
          </section>

          <section className="mx-auto mt-16 max-w-6xl px-4">
            <ScrollReveal>
              <HoloCard className="glass rounded-[2rem]" intensity={4}>
                <div className="p-5 md:p-8 text-center text-xl md:text-3xl font-semibold tracking-[-.02em]">
                  “{settings.quote}”
                </div>
              </HoloCard>
            </ScrollReveal>
          </section>

          <section id="included" className="mx-auto max-w-6xl px-4 py-24">
            <ScrollReveal className="mb-10">
              <div className="eyebrow">Что входит в работу</div>
              <h2 className="mt-4 text-5xl md:text-7xl font-extrabold tracking-[-.02em]">Что входит.</h2>
            </ScrollReveal>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {features.map((f, i) => (
                <ScrollReveal key={f.title} delay={i * .06}>
                  <HoloCard className="glass rounded-[1.75rem] h-full transition-colors hover:border-[rgba(104,225,253,.34)]">
                    <article className="p-6 h-full">
                      <div className="text-3xl mb-10">{f.icon}</div>
                      <h3 className="text-xl font-bold tracking-[-.02em]">{f.title}</h3>
                      <p className="mt-3 text-sm" style={{ color: "var(--ink-2)" }}>{f.desc}</p>
                      <div className="eyebrow mt-8">{f.tag}</div>
                    </article>
                  </HoloCard>
                </ScrollReveal>
              ))}
            </div>
          </section>

          <section id="approach" className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-12 md:grid-cols-2 md:items-center">
            <ScrollReveal>
              <HoloCard className="rounded-[2rem] glass min-h-[500px]" intensity={5}>
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(104,225,253,.18),transparent_45%)]" />
                {settings.photoDataUrl ? <img src={settings.photoDataUrl} alt="Фото Арсения" className="absolute inset-0 h-full w-full object-cover object-center" /> : <div className="absolute inset-6 rounded-[1.5rem] bg-gradient-to-br from-[rgba(104,225,253,.22)] to-[rgba(139,92,246,.18)] border border-white/10 grid place-items-center text-center"><div><div className="text-6xl font-extrabold tracking-[-.02em]">AC</div><p style={{ color: "var(--ink-2)" }}>место для фото Арсения</p></div></div>}
              </HoloCard>
            </ScrollReveal>
            <ScrollReveal delay={0.1}>
              <div className="eyebrow">Подход</div>
              <h2 className="mt-4 text-5xl md:text-7xl font-extrabold tracking-[-.02em]">{settings.approachTitle}</h2>
              <p className="mt-6 text-lg" style={{ color: "var(--ink-2)" }}>{settings.approachText1}</p>
              <p className="mt-4 text-lg" style={{ color: "var(--ink-2)" }}>{settings.approachText2}</p>
            </ScrollReveal>
          </section>

          <section id="results" className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-24 md:grid-cols-[.9fr_1.1fr] md:items-center">
            <FloatingAppPreview />
            <ScrollReveal delay={0.1}>
              <div className="eyebrow">Система результата</div>
              <h2 className="mt-4 text-5xl md:text-7xl font-extrabold tracking-[-.02em]">Не просто план, а система контроля.</h2>
              <p className="mt-6 text-lg" style={{ color: "var(--ink-2)" }}>В формате ArseniiCoach клиент получает тренировки, питание, отчёты, приложение для отметок и регулярную связь. Тренер видит активность, может корректировать программу и держать человека в процессе.</p>
              <button onClick={scrollToApply} className="btn-shine mt-8 rounded-full px-6 py-3 font-semibold" style={{ background: "var(--accent)", color: "var(--bg)" }}>Заполнить анкету</button>
            </ScrollReveal>
          </section>
        </main>

        <footer className="relative z-10 mx-auto max-w-6xl px-4 pb-10">
          <div className="border-t pt-7 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
            <div>© {new Date().getFullYear()} ArseniiCoach. Все права защищены.</div>
          </div>
        </footer>

        <button onClick={scrollToApply} className="btn-shine fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full px-6 py-3 font-semibold shadow-2xl md:hidden" style={{ background: "var(--accent)", color: "var(--bg)" }}>ОСТАВИТЬ ЗАЯВКУ</button>
      </div>
    </>
  );
};

export default Index;
