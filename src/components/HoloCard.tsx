import { useCallback, useRef } from "react";

/** Карточка с лёгким 3D-наклоном и голографическим бликом, следующим за курсором.
 *  Позиция и наклон пишутся напрямую в CSS-переменные через ref, а не через
 *  useState — иначе каждое движение мыши гоняло бы React-рендер. */
const HoloCard = ({ children, className = "", intensity = 7, flat = false }: { children: React.ReactNode; className?: string; intensity?: number; flat?: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (flat) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    el.style.setProperty("--holo-x", `${px * 100}%`);
    el.style.setProperty("--holo-y", `${py * 100}%`);
    el.style.setProperty("--holo-rx", `${(py - 0.5) * -intensity}deg`);
    el.style.setProperty("--holo-ry", `${(px - 0.5) * intensity}deg`);
    el.style.setProperty("--holo-opacity", "1");
  }, [intensity, flat]);

  const handleLeave = useCallback(() => {
    if (flat) return;
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--holo-rx", "0deg");
    el.style.setProperty("--holo-ry", "0deg");
    el.style.setProperty("--holo-opacity", "0");
  }, [flat]);

  return (
    <div ref={ref} onMouseMove={handleMove} onMouseLeave={handleLeave} className={`holo-card ${className}`}>
      {!flat && <div className="holo-card-sheen" />}
      <div className="holo-card-content">{children}</div>
    </div>
  );
};

export default HoloCard;
