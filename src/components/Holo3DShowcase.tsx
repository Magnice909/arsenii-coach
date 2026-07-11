import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

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

/** Крупная витринная 3D-сцена на WebGL: гранёный кристалл, три орбитальных
 *  кольца на разных осях, звёздное поле частиц и bloom-постобработка для
 *  свечения. Занимает собственную полноширинную секцию (не делит место с
 *  текстом), чтобы можно было сделать её действительно большой и не
 *  беспокоиться о наложении на заголовок/форму. */
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

    const glowMaterial = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.2, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(geometry, glowMaterial);
    glow.scale.setScalar(1.3);
    group.add(glow);

    const edges = new THREE.EdgesGeometry(geometry);
    const wireframe = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.9 }));
    wireframe.scale.setScalar(1.015);
    group.add(wireframe);

    const coreLight = new THREE.PointLight(accent, 22, 11);
    group.add(coreLight);

    const ringConfigs = [
      { radius: 3.5, tube: 0.018, color: accent, tiltX: 1.15, tiltZ: 0.2, speed: 0.5 },
      { radius: 4.05, tube: 0.014, color: violet, tiltX: 0.4, tiltZ: 1.3, speed: -0.35 },
      { radius: 4.6, tube: 0.011, color: pink, tiltX: 1.42, tiltZ: -0.6, speed: 0.28 },
    ];
    const rings = ringConfigs.map(({ radius, tube, color, tiltX, tiltZ }) => {
      const ringGeo = new THREE.TorusGeometry(radius, tube, 16, 128);
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.set(tiltX, 0, tiltZ);
      group.add(ring);
      return ring;
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

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.95, 0.6, 0.15);
    composer.addPass(bloomPass);

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
        rings.forEach((ring, index) => { ring.rotation.z += ringConfigs[index].speed * 0.006; });
        particles.rotation.y = elapsed * 0.02;
      }
      composer.render();
    };
    raf = requestAnimationFrame(render);

    const handleResize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
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
      rings.forEach((ring) => { ring.geometry.dispose(); (ring.material as THREE.Material).dispose(); });
      particleGeometry.dispose();
      particleMaterial.dispose();
      particleTexture.dispose();
      composer.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className={`pointer-events-none select-none ${className}`} aria-hidden="true" />;
};

export default Holo3DShowcase;
