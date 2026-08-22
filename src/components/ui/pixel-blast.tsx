"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils/cn";

/**
 * A dithered pixel field, from React Bits.
 * Inspired by github.com/zavalit/bayer-dithering-webgl-demo
 *
 * Ported to TypeScript with four changes to the upstream source, all of which
 * this codebase has already been bitten by once:
 *
 * - **It never actually paused.** `autoPauseOffscreen` read a visibility ref
 *   that nothing ever wrote to, so the loop ran at full rate forever. It is
 *   wired to an IntersectionObserver now, and to tab visibility.
 * - **It ran at the display's refresh rate.** A slow-drifting field looks the
 *   same at 30fps as at 240 and costs a fraction of the GPU, so the loop is
 *   capped.
 * - **`prefers-reduced-motion` was ignored.** It now paints one frame and
 *   stops.
 * - **The liquid strength update was a no-op**, assigning `.value` to the
 *   Effect rather than to its uniform.
 *
 * Liquid and the click ripples are off by default here: this is a background,
 * and a background that reacts to every stray pointer move is a background
 * competing with the page in front of it.
 */

const SHAPE_MAP = { square: 0, circle: 1, triangle: 2, diamond: 3 } as const;

export type PixelBlastVariant = keyof typeof SHAPE_MAP;

const VERTEX_SRC = /* glsl */ `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SRC = /* glsl */ `
precision highp float;

uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uPixelJitter;
uniform int   uEnableRipples;
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleIntensity;
uniform float uEdgeFade;

uniform int   uShapeType;
const int SHAPE_CIRCLE   = 1;
const int SHAPE_TRIANGLE = 2;
const int SHAPE_DIAMOND  = 3;

const int MAX_CLICKS = 10;

uniform vec2  uClickPos  [MAX_CLICKS];
uniform float uClickTimes[MAX_CLICKS];

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2. + a.y * a.y * .75);
}
#define Bayer4(a) (Bayer2(.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(.5*(a))*0.25 + Bayer2(a))

#define FBM_OCTAVES     5
#define FBM_LACUNARITY  1.25
#define FBM_GAIN        1.0

float hash11(float n){ return fract(sin(n)*43758.5453); }

float vnoise(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n100 = hash11(dot(ip + vec3(1.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n010 = hash11(dot(ip + vec3(0.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n110 = hash11(dot(ip + vec3(1.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n001 = hash11(dot(ip + vec3(0.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n101 = hash11(dot(ip + vec3(1.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n011 = hash11(dot(ip + vec3(0.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  float n111 = hash11(dot(ip + vec3(1.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  vec3 w = fp*fp*fp*(fp*(fp*6.0-15.0)+10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t){
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < FBM_OCTAVES; ++i){
    sum  += amp * vnoise(p * freq);
    freq *= FBM_LACUNARITY;
    amp  *= FBM_GAIN;
  }
  return sum * 0.5 + 0.5;
}

float maskCircle(vec2 p, float cov){
  float r = sqrt(cov) * .25;
  float d = length(p - 0.5) - r;
  float aa = 0.5 * fwidth(d);
  return cov * (1.0 - smoothstep(-aa, aa, d * 2.0));
}

float maskTriangle(vec2 p, vec2 id, float cov){
  bool flip = mod(id.x + id.y, 2.0) > 0.5;
  if (flip) p.x = 1.0 - p.x;
  float r = sqrt(cov);
  float d  = p.y - r*(1.0 - p.x);
  float aa = fwidth(d);
  return cov * clamp(0.5 - d/aa, 0.0, 1.0);
}

float maskDiamond(vec2 p, float cov){
  float r = sqrt(cov) * 0.564;
  return step(abs(p.x - 0.49) + abs(p.y - 0.49), r);
}

void main(){
  float pixelSize = uPixelSize;
  vec2 fragCoord = gl_FragCoord.xy - uResolution * .5;
  float aspectRatio = uResolution.x / uResolution.y;

  vec2 pixelId = floor(fragCoord / pixelSize);
  vec2 pixelUV = fract(fragCoord / pixelSize);

  float cellPixelSize = 8.0 * pixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;

  float feed = base + (uDensity - 0.5) * 0.3;

  float speed     = uRippleSpeed;
  float thickness = uRippleThickness;
  const float dampT = 1.0;
  const float dampR = 10.0;

  if (uEnableRipples == 1) {
    for (int i = 0; i < MAX_CLICKS; ++i){
      vec2 pos = uClickPos[i];
      if (pos.x < 0.0) continue;
      float cps = 8.0 * pixelSize;
      vec2 cuv = (((pos - uResolution * .5 - cps * .5) / (uResolution))) * vec2(aspectRatio, 1.0);
      float t = max(uTime - uClickTimes[i], 0.0);
      float r = distance(uv, cuv);
      float waveR = speed * t;
      float ring  = exp(-pow((r - waveR) / thickness, 2.0));
      float atten = exp(-dampT * t) * exp(-dampR * r);
      feed = max(feed, ring * atten * uRippleIntensity);
    }
  }

  float bayer = Bayer8(fragCoord / uPixelSize) - 0.5;
  float bw = step(0.5, feed + bayer);

  float h = fract(sin(dot(floor(fragCoord / uPixelSize), vec2(127.1, 311.7))) * 43758.5453);
  float jitterScale = 1.0 + (h - 0.5) * uPixelJitter;
  float coverage = bw * jitterScale;

  float M;
  if      (uShapeType == SHAPE_CIRCLE)   M = maskCircle (pixelUV, coverage);
  else if (uShapeType == SHAPE_TRIANGLE) M = maskTriangle(pixelUV, pixelId, coverage);
  else if (uShapeType == SHAPE_DIAMOND)  M = maskDiamond(pixelUV, coverage);
  else                                   M = coverage;

  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
    float fade = smoothstep(0.0, uEdgeFade, edge);
    M *= fade;
  }

  vec3 color = uColor;
  vec3 srgbColor = mix(
    color * 12.92,
    1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, color)
  );

  fragColor = vec4(srgbColor, M);
}
`;

const MAX_CLICKS = 10;

export interface PixelBlastProps {
  variant?: PixelBlastVariant;
  /** Base pixel size, scaled for DPI. */
  pixelSize?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  patternScale?: number;
  patternDensity?: number;
  pixelSizeJitter?: number;
  /** Click ripples. Off by default: a background should not answer back. */
  enableRipples?: boolean;
  rippleSpeed?: number;
  rippleThickness?: number;
  rippleIntensityScale?: number;
  speed?: number;
  /** 0–1. How far in from the edges the field dissolves. */
  edgeFade?: number;
  /** Render cap. A drifting field reads the same at 30 as at 240. */
  fps?: number;
}

export function PixelBlast({
  variant = "square",
  pixelSize = 4,
  color = "#B497CF",
  className,
  style,
  patternScale = 2,
  patternDensity = 1,
  pixelSizeJitter = 0,
  enableRipples = false,
  rippleSpeed = 0.3,
  rippleThickness = 0.1,
  rippleIntensityScale = 1,
  speed = 0.5,
  edgeFade = 0.25,
  fps = 30,
}: PixelBlastProps) {
  const container = useRef<HTMLDivElement>(null);

  /** Live props the render loop reads without being torn down and rebuilt. */
  const live = useRef({
    speed,
    color,
    variant,
    pixelSize,
    patternScale,
    patternDensity,
    pixelSizeJitter,
    enableRipples,
    rippleSpeed,
    rippleThickness,
    rippleIntensityScale,
    edgeFade,
    fps,
  });
  // Synced after each render rather than during it: a ref written while
  // rendering is a value React cannot see change, and the rule that flags it
  // is right — the loop below only ever reads this between frames.
  useEffect(() => {
    live.current = {
      speed,
      color,
      variant,
      pixelSize,
      patternScale,
      patternDensity,
      pixelSizeJitter,
      enableRipples,
      rippleSpeed,
      rippleThickness,
      rippleIntensityScale,
      edgeFade,
      fps,
    };
  });

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearAlpha(0);
    node.appendChild(renderer.domElement);

    const uniforms = {
      uResolution: { value: new THREE.Vector2(0, 0) },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(live.current.color) },
      uClickPos: {
        value: Array.from({ length: MAX_CLICKS }, () => new THREE.Vector2(-1, -1)),
      },
      uClickTimes: { value: new Float32Array(MAX_CLICKS) },
      uShapeType: { value: SHAPE_MAP[live.current.variant] ?? 0 },
      uPixelSize: { value: live.current.pixelSize * renderer.getPixelRatio() },
      uScale: { value: live.current.patternScale },
      uDensity: { value: live.current.patternDensity },
      uPixelJitter: { value: live.current.pixelSizeJitter },
      uEnableRipples: { value: live.current.enableRipples ? 1 : 0 },
      uRippleSpeed: { value: live.current.rippleSpeed },
      uRippleThickness: { value: live.current.rippleThickness },
      uRippleIntensity: { value: live.current.rippleIntensityScale },
      uEdgeFade: { value: live.current.edgeFade },
    };

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SRC,
      fragmentShader: FRAGMENT_SRC,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    const quad = new THREE.Mesh(geometry, material);
    scene.add(quad);

    const setSize = () => {
      const w = node.clientWidth || 1;
      const h = node.clientHeight || 1;
      renderer.setSize(w, h, false);
      uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
      uniforms.uPixelSize.value = live.current.pixelSize * renderer.getPixelRatio();
    };
    setSize();

    const observer = new ResizeObserver(setSize);
    observer.observe(node);

    /*
     * Upstream shipped an `autoPauseOffscreen` flag whose visibility ref was
     * never written to, so it always read `true` and the loop never paused.
     * Both signals are wired here: leaving the viewport and leaving the tab.
     */
    let onScreen = true;
    const intersection = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
      },
      { rootMargin: "120px" },
    );
    intersection.observe(node);

    const clock = new THREE.Clock();
    const timeOffset = Math.random() * 1000;
    let clickIx = 0;
    let raf = 0;
    let last = -Infinity;

    const draw = () => {
      uniforms.uTime.value = timeOffset + clock.getElapsedTime() * live.current.speed;
      uniforms.uColor.value.set(live.current.color);
      uniforms.uShapeType.value = SHAPE_MAP[live.current.variant] ?? 0;
      uniforms.uScale.value = live.current.patternScale;
      uniforms.uDensity.value = live.current.patternDensity;
      uniforms.uPixelJitter.value = live.current.pixelSizeJitter;
      uniforms.uEnableRipples.value = live.current.enableRipples ? 1 : 0;
      uniforms.uRippleSpeed.value = live.current.rippleSpeed;
      uniforms.uRippleThickness.value = live.current.rippleThickness;
      uniforms.uRippleIntensity.value = live.current.rippleIntensityScale;
      uniforms.uEdgeFade.value = live.current.edgeFade;
      renderer.render(scene, camera);
    };

    if (reduced) {
      // One frame, then nothing. The field still gives the page its texture.
      draw();
    } else {
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (!onScreen || document.visibilityState === "hidden") return;
        const interval = 1000 / Math.max(1, live.current.fps);
        if (now - last < interval) return;
        last = now;
        draw();
      };
      raf = requestAnimationFrame(tick);
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!live.current.enableRipples) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const scaleX = renderer.domElement.width / rect.width;
      const scaleY = renderer.domElement.height / rect.height;
      uniforms.uClickPos.value[clickIx].set(
        (event.clientX - rect.left) * scaleX,
        (rect.height - (event.clientY - rect.top)) * scaleY,
      );
      uniforms.uClickTimes.value[clickIx] = uniforms.uTime.value;
      clickIx = (clickIx + 1) % MAX_CLICKS;
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === node) node.removeChild(renderer.domElement);
    };
    // Built once. Everything tunable is read from the ref inside the loop, so
    // a prop change re-tints the field rather than tearing down a GL context.
  }, []);

  return (
    <div
      ref={container}
      className={cn("relative h-full w-full overflow-hidden", className)}
      style={style}
      aria-hidden
    />
  );
}

export default PixelBlast;
