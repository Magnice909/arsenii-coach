import { motion } from "framer-motion";
import { FormEvent, useState } from "react";
import { setUser } from "../lib/storage";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (!isSupabaseConfigured) {
      setError("Supabase ещё не подключён. Добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Vercel.");
      return;
    }

    setLoading(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (signInError || !data.user) {
      setError("Неверная почта или пароль");
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, name, telegram")
      .eq("id", data.user.id)
      .single();

    const role = profile?.role === "coach" ? "coach" : "client";
    setUser({
      id: data.user.id,
      email: data.user.email || email,
      name: profile?.name || data.user.email || "Пользователь",
      telegram: profile?.telegram || "",
      role,
    });
    window.location.hash = role === "coach" ? "/coach" : "/client";
  };

  return (
    <main className="min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-14" style={{ background: "var(--bg)" }}>
      <div className="grid-overlay fixed inset-0 opacity-60" />
      <div className="fixed h-[520px] w-[520px] rounded-full blur-3xl" style={{ background: "var(--accent-glow)" }} />
      <motion.section className="relative z-10 glass rounded-[2rem] p-6 md:p-8 w-full max-w-xl" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
        <button onClick={() => window.location.hash = "/"} className="flex items-center gap-3 font-bold tracking-[-.02em] mb-8">
          <span className="logo-mark" /> ARSENIICOACH
        </button>
        <div className="eyebrow">Личный кабинет</div>
        <h1 className="mt-3 text-4xl md:text-6xl font-extrabold tracking-[-.03em]">Вход</h1>
        <p className="mt-4" style={{ color: "var(--ink-2)" }}>Введите почту и пароль. Аккаунты создаются в Supabase, пароль не хранится в коде сайта.</p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <input value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} type="email" placeholder="Email" className="w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} />
          <input value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} type="password" placeholder="Пароль" className="w-full rounded-xl px-4 py-3" style={{ background: "var(--bg)", border: "1px solid var(--line-2)", color: "var(--ink)" }} />
          {error && <p className="text-sm" style={{ color: "#ff8a98" }}>{error}</p>}
          <button disabled={loading} className="w-full rounded-xl py-3 font-semibold disabled:opacity-60" style={{ background: "var(--accent)", color: "var(--bg)" }}>{loading ? "Входим..." : "Войти"}</button>
        </form>
      </motion.section>
    </main>
  );
};

export default Login;
