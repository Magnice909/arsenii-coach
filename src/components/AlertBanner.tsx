// Единая система цветов для предупреждений в обоих кабинетах: раньше каждое
// предупреждение (план кончается, клиент неактивен) задавало цвета инлайн и
// по отдельности, из-за чего было легко нечаянно завести третий несогласованный
// оттенок. Два уровня: warning — обратить внимание в ближайшее время,
// danger — требует действия прямо сейчас.
export type AlertLevel = "warning" | "danger";

export const alertColors: Record<AlertLevel, { border: string; bg: string; text: string }> = {
  warning: { border: "rgba(255,184,77,.35)", bg: "rgba(255,184,77,.08)", text: "#ffb84d" },
  danger: { border: "rgba(255,138,152,.35)", bg: "rgba(255,138,152,.08)", text: "#ff8a98" },
};

export const AlertBanner = ({ level, title, children, action }: { level: AlertLevel; title: string; children: React.ReactNode; action?: React.ReactNode }) => {
  const style = alertColors[level];
  return (
    <div className="app-card rounded-2xl p-4" style={{ borderColor: style.border, background: style.bg }}>
      <p className="font-semibold" style={{ color: style.text }}>{title}</p>
      <p className="text-sm mt-1" style={{ color: "var(--ink-2)" }}>{children}</p>
      {action}
    </div>
  );
};

export const AlertLine = ({ level, children }: { level: AlertLevel; children: React.ReactNode }) => (
  <p className="text-sm mt-1 font-semibold" style={{ color: alertColors[level].text }}>{children}</p>
);
