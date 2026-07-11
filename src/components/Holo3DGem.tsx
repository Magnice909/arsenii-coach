import { useEffect, useRef } from "react";
import * as THREE from "three";

/** Настоящий 3D через WebGL, а не CSS-имитация: гранёный кристалл со
 *  стеклянным материалом (transmission) и тонким светящимся каркасом поверх.
 *  Каркас даёт "голографический" читаемый силуэт, стекло — настоящую глубину,
 *  преломление и блики от источников света — то, что на чистом CSS
 *  физически не получить. Без текста и иконок на гранях: две прошлые
 *  попытки с надписями на кубе выглядели как плоская "инфо-карточка",
 *  а не эффектный объект. */
const Holo3DGem = ({ className = "" }: { className?: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 0, 6.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const accent = new THREE.Color(0x68e1fd);
    const violet = new THREE.Color(0x8b5cf6);

    const ambient = new THREE.AmbientLight(0x4a6478, 2.2);
    scene.add(ambient);
    const keyLight = new THREE.PointLight(accent, 40, 22);
    keyLight.position.set(3, 3, 4);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(violet, 34, 22);
    rimLight.position.set(-3.5, -2, -3);
    scene.add(rimLight);

    const group = new THREE.Group();
    scene.add(group);

    // Без environment map физически точное "стекло" (transmission) рендерится
    // почти чёрным — ему нечего преломлять на прозрачном фоне. Вместо этого —
    // полупрозрачный светящийся кристалл (emissive + низкая opacity) и отдельная
    // увеличенная копия геометрии с обратными гранями как fresnel-подсветка по
    // краю: классический дешёвый приём для "свечения" без env-карты.
    const geometry = new THREE.IcosahedronGeometry(1.6, 0);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x0a1622,
      metalness: 0.05,
      roughness: 0.2,
      transparent: true,
      opacity: 0.5,
      emissive: violet,
      emissiveIntensity: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.15,
      side: THREE.DoubleSide,
    });
    const gem = new THREE.Mesh(geometry, material);
    group.add(gem);

    const glowMaterial = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(geometry, glowMaterial);
    glow.scale.setScalar(1.22);
    group.add(glow);

    const edges = new THREE.EdgesGeometry(geometry);
    const wireframe = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.85 }));
    wireframe.scale.setScalar(1.015);
    group.add(wireframe);

    const coreLight = new THREE.PointLight(accent, 14, 8);
    group.add(coreLight);

    let raf = 0;
    let start = performance.now();
    const render = (time: number) => {
      const elapsed = (time - start) / 1000;
      if (!prefersReducedMotion) {
        group.rotation.y = elapsed * 0.35;
        group.rotation.x = Math.sin(elapsed * 0.4) * 0.18;
        group.position.y = Math.sin(elapsed * 0.9) * 0.12;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      geometry.dispose();
      edges.dispose();
      material.dispose();
      glowMaterial.dispose();
      (wireframe.material as THREE.Material).dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className={`pointer-events-none select-none ${className}`} style={{ width: 220, height: 220 }} aria-hidden="true" />;
};

export default Holo3DGem;
