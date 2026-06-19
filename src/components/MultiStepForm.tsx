import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const TOTAL_STEPS = 8;
const goalOptions = ["Сжечь жир", "Набрать мышечную массу", "Стать сильнее", "Наладить режим и привычки"];
const commitmentOptions = ["Да, готов вкладываться", "Интересно, но хочу обсудить", "Пока присматриваюсь"];
const startOptions = ["Как можно скорее", "В течение 2–4 недель", "Позже"];
const lookingForOptions = ["План тренировок", "Питание и тренировки", "1:1 сопровождение и контроль"];
const investOptions = ["Да", "Возможно", "Пока нет"];

type Answers = {
  name: string; goal: string; duration: string; obstacle: string; commitment: string; startTimeline: string; lookingFor: string; readyToInvest: string; telegram: string; email: string; instagram: string;
};

const initialAnswers: Answers = { name: "", goal: "", duration: "", obstacle: "", commitment: "", startTimeline: "", lookingFor: "", readyToInvest: "", telegram: "@", email: "", instagram: "" };
const inputClass = "w-full px-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[rgba(104,225,253,0.30)]";
const inputStyle = { background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" };

const formatTelegram = (raw: string): string => raw.trim().startsWith("@") ? raw.trim() : raw.trim();
const isValidTelegram = (value: string): boolean => /^@[A-Za-z0-9_]{5,32}$/.test(value.trim());

const MultiStepForm = () => {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [submitted, setSubmitted] = useState(false);
  const [telegramError, setTelegramError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const next = () => { setDirection(1); setStep((s) => Math.min(s + 1, TOTAL_STEPS)); };
  const prev = () => { setDirection(-1); setStep((s) => Math.max(s - 1, 1)); };
  const handleSelect = (field: keyof Answers, value: string) => { setAnswers((prev) => ({ ...prev, [field]: value })); setTimeout(next, 250); };
  const handleTelegramChange = (raw: string) => { const formatted = formatTelegram(raw); setAnswers((p) => ({ ...p, telegram: formatted })); if (telegramError && isValidTelegram(formatted)) setTelegramError(""); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    if (!isValidTelegram(answers.telegram)) { setTelegramError("Введите Telegram, например @username"); return; }

    const application = {
      name: answers.name,
      goal: answers.goal,
      duration: answers.duration,
      obstacle: answers.obstacle,
      commitment: answers.commitment,
      start_timeline: answers.startTimeline,
      looking_for: answers.lookingFor,
      ready_to_invest: answers.readyToInvest,
      telegram: answers.telegram,
      email: answers.email,
      instagram: answers.instagram,
      created_at: new Date().toISOString(),
      status: "Новая",
    };
    setIsSubmitting(true);

    if (isSupabaseConfigured) {
      const { error } = await supabase.from("applications").insert(application);
      setIsSubmitting(false);
      if (error) {
        setSubmitError("Не удалось отправить заявку. Попробуйте ещё раз или напишите в Telegram @president_h.");
        return;
      }
    } else {
      const saved = JSON.parse(localStorage.getItem("arseniiCoachApplications") || "[]");
      localStorage.setItem("arseniiCoachApplications", JSON.stringify([application, ...saved]));
      setIsSubmitting(false);
    }

    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="glass rounded-3xl p-6 md:p-8">
        <h3 className="text-2xl font-bold tracking-[-.02em]">Заявка отправлена</h3>
        <p className="mt-3" style={{ color: "var(--ink-2)" }}>Арсений лично посмотрит анкету и свяжется с вами в Telegram или по email.</p>
        <div className="mt-5 rounded-2xl p-4 app-card">⇧ Дальше вы получите доступ к личному плану и приложению для тренировок.</div>
      </div>
    );
  }

  const slideVariants = { enter: (d: number) => ({ x: d > 0 ? 36 : -36, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: d > 0 ? -36 : 36, opacity: 0 }) };

  return (
    <form onSubmit={handleSubmit} className="glass rounded-3xl p-5 md:p-7 overflow-hidden">
      <div className="flex items-center justify-between mb-5">
        <div className="eyebrow">Шаг {step} из {TOTAL_STEPS}</div>
        {step > 1 && <button type="button" onClick={prev} className="text-sm" style={{ color: "var(--ink-3)" }}>Назад</button>}
      </div>
      <div className="h-1 rounded-full overflow-hidden mb-7" style={{ background: "var(--surface-2)" }}><div className="h-full" style={{ width: `${(step / TOTAL_STEPS) * 100}%`, background: "var(--accent)" }} /></div>
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div key={step} custom={direction} variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: .25 }}>
          {step === 1 && <StepWrapper question="Какая у вас главная цель?"><OptionList options={goalOptions} selected={answers.goal} onSelect={(opt) => handleSelect("goal", opt)} /></StepWrapper>}
          {step === 2 && <StepWrapper question="Как давно вы тренируетесь?"><TextInput value={answers.duration} onChange={(v) => setAnswers((p) => ({ ...p, duration: v }))} placeholder="Например: 6 месяцев, 2 года..." onNext={next} /></StepWrapper>}
          {step === 3 && <StepWrapper question="Что сейчас больше всего мешает результату?"><TextInput value={answers.obstacle} onChange={(v) => setAnswers((p) => ({ ...p, obstacle: v }))} placeholder="Режим, питание, техника, мотивация..." onNext={next} /></StepWrapper>}
          {step === 4 && <StepWrapper question="Готовы работать системно?"><OptionList options={commitmentOptions} selected={answers.commitment} onSelect={(opt) => handleSelect("commitment", opt)} /></StepWrapper>}
          {step === 5 && <StepWrapper question="Когда хотите начать?"><OptionList options={startOptions} selected={answers.startTimeline} onSelect={(opt) => handleSelect("startTimeline", opt)} /></StepWrapper>}
          {step === 6 && <StepWrapper question="Что именно вы ищете?"><OptionList options={lookingForOptions} selected={answers.lookingFor} onSelect={(opt) => handleSelect("lookingFor", opt)} /></StepWrapper>}
          {step === 7 && <StepWrapper question="Готовы инвестировать в сопровождение?"><OptionList options={investOptions} selected={answers.readyToInvest} onSelect={(opt) => handleSelect("readyToInvest", opt)} /></StepWrapper>}
          {step === 8 && (
            <StepWrapper question="Оставьте контакты">
              <div className="space-y-3">
                <input required value={answers.name} onChange={(e) => setAnswers((p) => ({ ...p, name: e.target.value }))} placeholder="Имя" className={inputClass} style={inputStyle} />
                <input required value={answers.telegram} onChange={(e) => handleTelegramChange(e.target.value)} placeholder="@username" className={inputClass} style={{ ...inputStyle, borderColor: telegramError ? "rgba(248,113,113,.5)" : "var(--line-2)" }} />
                {telegramError && <p className="text-xs text-red-300">{telegramError}</p>}
                <input required type="email" value={answers.email} onChange={(e) => setAnswers((p) => ({ ...p, email: e.target.value }))} placeholder="Email" className={inputClass} style={inputStyle} />
                <input value={answers.instagram} onChange={(e) => setAnswers((p) => ({ ...p, instagram: e.target.value }))} placeholder="Instagram / Telegram (необязательно)" className={inputClass} style={inputStyle} />
                {submitError && <p className="text-xs text-red-300">{submitError}</p>}
                <button disabled={isSubmitting} type="submit" className="w-full rounded-xl py-3 font-semibold disabled:opacity-60" style={{ background: "var(--accent)", color: "var(--bg)" }}>{isSubmitting ? "Отправляем..." : "Отправить заявку"}</button>
              </div>
            </StepWrapper>
          )}
        </motion.div>
      </AnimatePresence>
    </form>
  );
};

const StepWrapper = ({ question, children }: { question: string; children: React.ReactNode }) => <div><h3 className="text-2xl md:text-3xl font-bold tracking-[-.02em] mb-5">{question}</h3>{children}</div>;
const OptionList = ({ options, selected, onSelect }: { options: string[]; selected: string; onSelect: (value: string) => void }) => <div className="space-y-3">{options.map((option) => <button key={option} type="button" onClick={() => onSelect(option)} className="w-full text-left rounded-xl px-4 py-3 transition-all" style={{ background: selected === option ? "rgba(104,225,253,.16)" : "var(--bg)", border: selected === option ? "1px solid rgba(104,225,253,.45)" : "1px solid var(--line-2)", color: "var(--ink)" }}>{option}</button>)}</div>;
const TextInput = ({ value, onChange, placeholder, onNext }: { value: string; onChange: (v: string) => void; placeholder: string; onNext: () => void }) => <div className="space-y-4"><textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={4} className={inputClass} style={inputStyle} /><button type="button" onClick={onNext} disabled={!value.trim()} className="w-full rounded-xl py-3 font-semibold disabled:opacity-40" style={{ background: "var(--accent)", color: "var(--bg)" }}>Продолжить</button></div>;

export default MultiStepForm;
