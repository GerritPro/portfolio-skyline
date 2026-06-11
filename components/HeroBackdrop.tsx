"use client";

/**
 * Three-layer ambient WebGL backdrop behind the hero. All decorative —
 * never bound to portfolio data, never simulates a 3D camera over the
 * dataset. The point is atmosphere, like the colour of light in a room.
 *
 *   Layer 0 (z=-3): "Aurora" — domain-warped FBM driving a 3-stop
 *                    palette mix. The Vercel-gradient layer.
 *   Layer 1 (z=-2): "Contour grid" — additive SDF iso-lines from a
 *                    second noise field. The Stripe/Apple "engineered"
 *                    layer that breaks the soft aurora into something
 *                    legibly financial.
 *   Layer 2 (z=-1): "Orbs" — ~140 THREE.Points with soft-disk frag,
 *                    slow vertex drift, additive blend. The Linear
 *                    depth layer.
 *
 * Each layer reads `--bg-primary` / accent CSS vars on mount and on
 * `.dark` class flip, so light/dark theming "just works" without a
 * second source of truth. prefers-reduced-motion freezes time and
 * drops the particle layer.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

// -------------------- shaders --------------------

const PASSTHROUGH_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const AURORA_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uAspect;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uIntensity;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.55;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * uAspect;
    float t = uTime * 0.045;

    // Domain warping: distort the lookup coordinate with another noise.
    vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t * 0.7)));
    vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.3),
                  fbm(p + 4.0 * q + vec2(8.3, 2.8) - t * 0.4));
    float v = fbm(p + 4.0 * r);

    // Three-stop palette mix: dark → mid → bright.
    vec3 col = mix(uColorA, uColorB, smoothstep(0.15, 0.55, v));
    col = mix(col, uColorC, smoothstep(0.55, 0.85, v));

    // Radial-vertical fade: dies into transparency near the bottom and
    // edges so it never hard-cuts into the rest of the page.
    float yFade = smoothstep(1.0, 0.45, vUv.y);
    float rFade = 1.0 - smoothstep(0.55, 0.95, length(vUv - 0.5));
    float alpha = uIntensity * yFade * rFade;

    gl_FragColor = vec4(col, alpha);
  }
`;

const CONTOUR_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uAspect;
  uniform vec3 uLineColor;
  uniform float uIntensity;
  uniform float uDensity;     // how many iso-rings — finance loves dense lines
  uniform float uThickness;   // line crispness
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * uAspect;
    float t = uTime * 0.02;
    float h = fbm(p * 1.4 + vec2(t, -t * 0.6));

    // SDF-style iso-line: tightness controls the band thickness.
    float band = abs(fract(h * uDensity) - 0.5);
    float line = smoothstep(uThickness, 0.0, band);

    float yFade = smoothstep(1.0, 0.4, vUv.y);
    float rFade = 1.0 - smoothstep(0.5, 0.95, length(vUv - 0.5));
    float alpha = line * uIntensity * yFade * rFade;

    gl_FragColor = vec4(uLineColor, alpha);
  }
`;

const ORBS_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSize;
  attribute float aSeed;
  attribute float aSize;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    // Slow vertical drift + tiny lateral wobble. Looks like dust in
    // sunlight, not noise.
    float t = uTime * 0.15;
    p.y += sin(t * 0.6 + aSeed * 6.28) * 0.08;
    p.x += cos(t * 0.4 + aSeed * 3.14) * 0.04;
    gl_Position = vec4(p, 1.0);
    gl_PointSize = uSize * aSize * uPixelRatio;
    // Y-axis fade so orbs near the bottom dim out.
    vAlpha = smoothstep(-0.85, 0.4, p.y);
  }
`;

const ORBS_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    // Soft disk: 1.0 at centre, 0 at edge.
    float d = length(gl_PointCoord - 0.5);
    float disk = 1.0 - smoothstep(0.10, 0.5, d);
    // Subtle inner glow boost.
    float glow = exp(-d * 8.0) * 0.45;
    float a = (disk + glow) * vAlpha * uIntensity;
    gl_FragColor = vec4(uColor, a);
  }
`;

// -------------------- component --------------------

type Props = {
  /** Overall multiplier across all three layers. 1.0 = the new
   *  dramatic baseline. Drop to 0.6 to dial it back. */
  intensity?: number;
  className?: string;
};

export function HeroBackdrop({ intensity = 1.0, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: "low-power",
        // failIfMajorPerformanceCaveat lets the browser bail quickly on
        // software renderers / hostile environments instead of giving
        // us a fragile context.
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      return;
    }
    // Three.js does NOT throw when the browser blocks context creation
    // (which happens in dev when too many HMR cycles accumulate
    // contexts). It logs and hands back a dead renderer. Detect that
    // here and bail cleanly.
    const ctx = renderer.getContext();
    if (!ctx || ctx.isContextLost?.()) {
      try {
        renderer.dispose();
      } catch {
        /* swallow */
      }
      return;
    }
    const dpr = Math.min(window.devicePixelRatio ?? 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setClearAlpha(0);

    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    const fullscreen = new THREE.PlaneGeometry(2, 2);

    // ---- Layer 0: Aurora ----
    const auroraColors = {
      a: new THREE.Color(),
      b: new THREE.Color(),
      c: new THREE.Color(),
    };
    const auroraUniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uColorA: { value: auroraColors.a },
      uColorB: { value: auroraColors.b },
      uColorC: { value: auroraColors.c },
      uIntensity: { value: 0.85 * intensity },
    };
    const auroraMat = new THREE.ShaderMaterial({
      uniforms: auroraUniforms,
      vertexShader: PASSTHROUGH_VERT,
      fragmentShader: AURORA_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const aurora = new THREE.Mesh(fullscreen, auroraMat);
    aurora.renderOrder = 0;
    scene.add(aurora);

    // ---- Layer 1: Contour grid (additive) ----
    const contourColor = new THREE.Color();
    const contourUniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uLineColor: { value: contourColor },
      uIntensity: { value: 0.12 * intensity },
      uDensity: { value: 9.0 },
      uThickness: { value: 0.025 },
    };
    const contourMat = new THREE.ShaderMaterial({
      uniforms: contourUniforms,
      vertexShader: PASSTHROUGH_VERT,
      fragmentShader: CONTOUR_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const contour = new THREE.Mesh(fullscreen, contourMat);
    contour.renderOrder = 1;
    scene.add(contour);

    // ---- Layer 2: Orbs (THREE.Points, additive) ----
    const ORB_COUNT = 140;
    const orbPositions = new Float32Array(ORB_COUNT * 3);
    const orbSeeds = new Float32Array(ORB_COUNT);
    const orbSizes = new Float32Array(ORB_COUNT);
    for (let i = 0; i < ORB_COUNT; i++) {
      // Bias orbs toward the upper half + center where the aurora sits.
      orbPositions[i * 3] = (Math.random() - 0.5) * 1.8;
      orbPositions[i * 3 + 1] = Math.random() * 0.9 - 0.2;
      orbPositions[i * 3 + 2] = 0;
      orbSeeds[i] = Math.random();
      // Bias to small orbs with a few larger ones for character.
      const r = Math.random();
      orbSizes[i] = r < 0.85 ? 0.5 + Math.random() * 0.6 : 1.4 + Math.random() * 1.2;
    }
    const orbGeo = new THREE.BufferGeometry();
    orbGeo.setAttribute("position", new THREE.BufferAttribute(orbPositions, 3));
    orbGeo.setAttribute("aSeed", new THREE.BufferAttribute(orbSeeds, 1));
    orbGeo.setAttribute("aSize", new THREE.BufferAttribute(orbSizes, 1));

    const orbColor = new THREE.Color();
    const orbUniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uPixelRatio: { value: dpr },
      uSize: { value: 16.0 },
      uColor: { value: orbColor },
      uIntensity: { value: 0.55 * intensity },
    };
    const orbMat = new THREE.ShaderMaterial({
      uniforms: orbUniforms,
      vertexShader: ORBS_VERT,
      fragmentShader: ORBS_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const orbs = new THREE.Points(orbGeo, orbMat);
    orbs.renderOrder = 2;
    scene.add(orbs);

    // ---- Theme-aware palette ----
    function readThemeColors() {
      const isDark = document.documentElement.classList.contains("dark");
      if (isDark) {
        // Deep night palette — indigo → cyan → teal.
        auroraColors.a.set("#0C1336");
        auroraColors.b.set("#1B4FA8");
        auroraColors.c.set("#1FB6A0");
        contourColor.set("#7FB6FF");
        orbColor.set("#A6E3FF");
        contourUniforms.uIntensity.value = 0.18 * intensity;
        orbUniforms.uIntensity.value = 0.7 * intensity;
      } else {
        // Daylight palette — pale blue → lavender → mint, much softer.
        auroraColors.a.set("#E0EBFF");
        auroraColors.b.set("#A6C4FF");
        auroraColors.c.set("#9FE6CF");
        contourColor.set("#0071E3");
        orbColor.set("#3B9CFF");
        // Light mode needs lower contour alpha or it overpowers text.
        contourUniforms.uIntensity.value = 0.06 * intensity;
        orbUniforms.uIntensity.value = 0.45 * intensity;
      }
    }
    readThemeColors();
    const themeObserver = new MutationObserver(readThemeColors);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // ---- Sizing ----
    function resize() {
      const rect = el!.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h, false);
      const aspect = w / h;
      auroraUniforms.uAspect.value.set(aspect, 1);
      contourUniforms.uAspect.value.set(aspect, 1);
      // Orb pixel size scales with viewport so they don't look like
      // pinpricks on a 4K monitor.
      orbUniforms.uSize.value = Math.max(10, Math.min(22, h / 40));
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    el.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.setAttribute("aria-hidden", "true");

    // ---- Reduced motion / visibility ----
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    if (reduced) {
      // Hide the particle layer entirely — even subtle drift is motion.
      orbs.visible = false;
    }
    const onMotionChange = () => {
      reduced = motionQuery.matches;
      orbs.visible = !reduced;
      if (reduced) {
        auroraUniforms.uTime.value = 0;
        contourUniforms.uTime.value = 0;
        orbUniforms.uTime.value = 0;
        renderer.render(scene, camera);
      }
    };
    motionQuery.addEventListener?.("change", onMotionChange);

    let visible = !document.hidden;
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible && !reduced) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // ---- Render loop ----
    let raf = 0;
    const startTime = performance.now();
    function frame() {
      if (!visible) return;
      const t = (performance.now() - startTime) / 1000;
      auroraUniforms.uTime.value = t;
      contourUniforms.uTime.value = t;
      orbUniforms.uTime.value = t;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    function start() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
    if (reduced) renderer.render(scene, camera);
    else start();

    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      ro.disconnect();
      motionQuery.removeEventListener?.("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
      fullscreen.dispose();
      auroraMat.dispose();
      contourMat.dispose();
      orbGeo.dispose();
      orbMat.dispose();
      // Browsers cap live WebGL contexts (Chrome ≈ 16). Without an
      // explicit forceContextLoss, HMR reload cycles in dev pile up
      // contexts until the browser refuses to create any more.
      try {
        renderer.forceContextLoss();
      } catch {
        /* renderer may already be dead */
      }
      renderer.dispose();
      canvas.remove();
    };
  }, [intensity]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={
        "pointer-events-none absolute inset-0 overflow-hidden " + (className ?? "")
      }
    />
  );
}
