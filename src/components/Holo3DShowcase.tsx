import { useEffect, useRef } from "react";
import * as THREE from "three";

/** Текстовая метка-«таблетка» на канвасе, натянутая на THREE.Sprite.
 *  Спрайт в three.js всегда развёрнут на камеру независимо от вращения
 *  родителя — в отличие от текста на гранях куба (две прошлые попытки),
 *  здесь текст физически не может оказаться перевёрнутым или нечитаемым
 *  ни в одной фазе вращения сцены. */
const makeLabelSprite = (text: string, borderColor: string) => {
  const fontSize = 46;
  const paddingX = 34;
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d")!;
  measureCtx.font = `700 ${fontSize}px Inter, sans-serif`;
  const textWidth = measureCtx.measureText(text).width;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(textWidth + paddingX * 2);
  canvas.height = Math.ceil(fontSize * 2.1);
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  const radius = h / 2;

  ctx.beginPath();
  ctx.moveTo(radius, 2);
  ctx.arcTo(w, 2, w, h - 2, radius);
  ctx.arcTo(w, h - 2, 0, h - 2, radius);
  ctx.arcTo(0, h - 2, 0, 2, radius);
  ctx.arcTo(0, 2, w, 2, radius);
  ctx.closePath();
  const bgGradient = ctx.createLinearGradient(0, 0, w, 0);
  bgGradient.addColorStop(0, "rgba(10,18,28,.55)");
  bgGradient.addColorStop(1, "rgba(10,18,28,.4)");
  ctx.fillStyle = bgGradient;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = borderColor;
  ctx.stroke();

  ctx.font = `700 ${fontSize}px Inter, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.shadowColor = borderColor;
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#dcf1ff";
  ctx.fillText(text, w / 2, h / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const spriteHeight = 1.05;
  sprite.scale.set(spriteHeight * (w / h), spriteHeight, 1);
  return { sprite, material, texture };
};

/** Мягкая круглая точка на канвасе — текстура для частиц. Без внешнего файла:
 *  проще держать в бандле и не тянуть отдельный ассет ради одной картинки. */
const makeParticleTexture = () => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(180,220,255,.65)");
  gradient.addColorStop(1, "rgba(180,220,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
};

/** Крупная витринная 3D-сцена на WebGL: гранёный кристалл, вокруг него по
 *  своим орбитам летают текстовые метки «План/Питание/Контроль», звёздное
 *  поле частиц и bloom-постобработка для свечения. Занимает собственную
 *  полноширинную секцию (не делит место с текстом), чтобы можно было
 *  сделать её действительно большой и не беспокоиться о наложении на
 *  заголовок/форму. */
const Holo3DShowcase = ({ className = "" }: { className?: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = container.clientWidth;
    let height = container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0, 9.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const accent = new THREE.Color(0x68e1fd);
    const violet = new THREE.Color(0x8b5cf6);
    const pink = new THREE.Color(0xff8ad8);

    scene.add(new THREE.AmbientLight(0x4a6478, 2));
    const keyLight = new THREE.PointLight(accent, 70, 34);
    keyLight.position.set(4, 4, 6);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(violet, 54, 34);
    rimLight.position.set(-5, -3, -4);
    scene.add(rimLight);
    const fillLight = new THREE.PointLight(pink, 24, 26);
    fillLight.position.set(0, -4, 4);
    scene.add(fillLight);

    const group = new THREE.Group();
    scene.add(group);

    const geometry = new THREE.IcosahedronGeometry(2.3, 0);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x0a1622,
      metalness: 0.05,
      roughness: 0.16,
      transparent: true,
      opacity: 0.55,
      emissive: violet,
      emissiveIntensity: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      side: THREE.DoubleSide,
    });
    const gem = new THREE.Mesh(geometry, material);
    group.add(gem);

    const glowMaterial = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.3, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(geometry, glowMaterial);
    glow.scale.setScalar(1.3);
    group.add(glow);

    const edges = new THREE.EdgesGeometry(geometry);
    const wireframe = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.9 }));
    wireframe.scale.setScalar(1.015);
    group.add(wireframe);

    const coreLight = new THREE.PointLight(accent, 22, 11);
    group.add(coreLight);

    // Подписи из убранных мини-карточек «План/Питание/Контроль» — не на
    // гранях объекта (там текст неизбежно уходит на ребро и искажается),
    // а спрайтами, летающими по своей орбите вокруг кристалла.
    const labelConfigs = [
      { text: "План", color: "rgba(104,225,253,.85)", radius: 4.3, speed: 0.3, phase: 0 },
      { text: "Питание", color: "rgba(139,92,246,.85)", radius: 4.6, speed: 0.3, phase: (Math.PI * 2) / 3 },
      { text: "Контроль", color: "rgba(255,138,216,.85)", radius: 4.45, speed: 0.3, phase: (Math.PI * 4) / 3 },
    ];
    const labels = labelConfigs.map(({ text, color }) => {
      const { sprite, material: labelMaterial, texture: labelTexture } = makeLabelSprite(text, color);
      group.add(sprite);
      return { sprite, material: labelMaterial, texture: labelTexture };
    });

    const particleCount = 320;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      const radius = 5.2 + Math.random() * 4.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particleTexture = makeParticleTexture();
    const particleMaterial = new THREE.PointsMaterial({ size: 0.09, map: particleTexture, color: accent, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // Лёгкий параллакс за курсором мыши по всей странице — не только над
    // самой сценой, это ощущается как реакция всей витрины на присутствие
    // пользователя, а не просто hover-эффект в узкой зоне.
    let targetRotY = 0;
    let targetRotX = 0;
    const handlePointerMove = (event: PointerEvent) => {
      const x = event.clientX / window.innerWidth - 0.5;
      const y = event.clientY / window.innerHeight - 0.5;
      targetRotY = x * 0.5;
      targetRotX = y * 0.28;
    };
    window.addEventListener("pointermove", handlePointerMove);

    let isVisible = true;
    const intersectionObserver = new IntersectionObserver(([entry]) => { isVisible = entry.isIntersecting; }, { threshold: 0.05 });
    intersectionObserver.observe(container);

    let raf = 0;
    const start = performance.now();
    const render = (time: number) => {
      raf = requestAnimationFrame(render);
      if (!isVisible) return;
      const elapsed = (time - start) / 1000;
      if (!prefersReducedMotion) {
        const autoY = elapsed * 0.12;
        group.rotation.y += (targetRotY + autoY - group.rotation.y) * 0.04;
        group.rotation.x += (targetRotX - 0.15 - group.rotation.x) * 0.04;
        group.position.y = Math.sin(elapsed * 0.6) * 0.18;
        labels.forEach(({ sprite }, index) => {
          const { radius, speed, phase } = labelConfigs[index];
          const angle = elapsed * speed + phase;
          sprite.position.set(Math.cos(angle) * radius, Math.sin(angle * 0.6 + index) * 1.2, Math.sin(angle) * radius);
        });
        particles.rotation.y = elapsed * 0.02;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(render);

    const handleResize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      const aspect = width / height;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      // На узких (портретных) контейнерах горизонтальный угол обзора
      // меньше при том же вертикальном FOV, и орбиты меток с широким
      // радиусом упирались в край канваса и обрезались. Сжимаем всю
      // группу (кристалл + метки + кольца орбит), когда контейнер уже,
      // чем широк, — так орбиты остаются в кадре при любой ширине.
      group.scale.setScalar(aspect < 1.3 ? 0.62 : 1);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      geometry.dispose();
      edges.dispose();
      material.dispose();
      glowMaterial.dispose();
      (wireframe.material as THREE.Material).dispose();
      labels.forEach(({ material: labelMaterial, texture: labelTexture }) => { labelMaterial.dispose(); labelTexture.dispose(); });
      particleGeometry.dispose();
      particleMaterial.dispose();
      particleTexture.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className={`pointer-events-none select-none ${className}`} style={{ filter: "drop-shadow(0 0 60px rgba(104,225,253,.16)) drop-shadow(0 0 100px rgba(139,92,246,.12))" }} aria-hidden="true" />;
};

export default Holo3DShowcase;
