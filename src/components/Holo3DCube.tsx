import { Apple, Dumbbell, Target, TrendingUp } from "lucide-react";

/** Настоящий 3D-объект (не плоская иконка): куб с четырьмя гранями,
 *  расставленными в пространстве через transform-style: preserve-3d и
 *  непрерывно вращающийся вокруг своей оси. Грани полупрозрачные —
 *  сквозь них видно противоположную, за счёт этого читается как
 *  голографическая проекция, а не физический предмет. Чисто декоративный
 *  элемент, поэтому помечен aria-hidden. */
const faces = [
  { icon: Dumbbell, label: "Тренировки", position: "front" },
  { icon: Apple, label: "Питание", position: "right" },
  { icon: TrendingUp, label: "Прогресс", position: "back" },
  { icon: Target, label: "Контроль", position: "left" },
];

const Holo3DCube = ({ className = "" }: { className?: string }) => (
  // Позиционирование (className снаружи) и анимация парения (holo-cube-scene
  // внутри) намеренно на разных узлах: CSS-анимация transform на одном
  // элементе полностью замещает transform от статичных классов на нём же,
  // а не складывается с ним — иначе translate из className просто пропадал бы.
  <div className={`pointer-events-none select-none ${className}`} aria-hidden="true">
    <div className="holo-cube-scene">
      <div className="holo-cube-base" />
      <div className="holo-cube">
        {faces.map(({ icon: Icon, label, position }) => (
          <div key={label} className={`holo-cube-face holo-cube-face--${position}`}>
            <Icon size={26} strokeWidth={1.6} />
            <span>{label}</span>
          </div>
        ))}
        {/* Верх и низ без иконок — просто стеклянные грани, замыкающие куб.
            Без них видна дыра в «крыше», и вращение читается как гнущаяся
            открытая коробка, а не цельный объект. */}
        <div className="holo-cube-face holo-cube-face--top" />
        <div className="holo-cube-face holo-cube-face--bottom" />
      </div>
    </div>
  </div>
);

export default Holo3DCube;
