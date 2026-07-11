/** Декоративная «голограмма» гантели: светящийся wireframe, который парит,
 *  слегка покачивается и просвечивается бегущей линией сканирования — как
 *  проекция в спортивном приложении из фантастики. Чисто декоративный
 *  элемент, поэтому помечен aria-hidden. */
const HoloDumbbell = ({ className = "" }: { className?: string }) => (
  <div className={`holo-sport pointer-events-none select-none ${className}`} aria-hidden="true">
    <div className="holo-sport-ring" />
    <svg viewBox="0 0 200 120" className="holo-sport-svg" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="holoSportGrad" x1="0" y1="0" x2="200" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--secondary-accent)" />
        </linearGradient>
      </defs>
      <line x1="52" y1="60" x2="148" y2="60" stroke="url(#holoSportGrad)" strokeWidth="6" strokeLinecap="round" />
      <rect x="18" y="28" width="26" height="64" rx="9" stroke="url(#holoSportGrad)" strokeWidth="5" />
      <rect x="4" y="42" width="16" height="36" rx="6" stroke="url(#holoSportGrad)" strokeWidth="5" />
      <rect x="156" y="28" width="26" height="64" rx="9" stroke="url(#holoSportGrad)" strokeWidth="5" />
      <rect x="180" y="42" width="16" height="36" rx="6" stroke="url(#holoSportGrad)" strokeWidth="5" />
    </svg>
    <div className="holo-sport-scan" />
  </div>
);

export default HoloDumbbell;
