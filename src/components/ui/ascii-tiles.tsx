"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils/cn";

export interface AsciiTilesProps {
  className?: string;
  speed?: number;
  opacity?: number;
  glyphSize?: number;
  tileDensity?: number;
  tileShear?: number;
  bevelWidth?: number;
  bevelSoftness?: number;
  refractionStrength?: number;
  chromaticSpread?: number;
  specularExponent?: number;
  specularStrength?: number;
  patternFreqX?: number;
  patternFreqY?: number;
  patternFreqXY?: number;
  glyphColor?: string;
  recessColor?: string;
  backgroundColor?: string;
  cursorInteraction?: boolean;
  cursorRadius?: number;
  cursorIntensity?: number;
  dpr?: number;
}

function hexToRgb(hex: string): [number, number, number] {
  let cleaned = hex.replace("#", "").trim();
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(cleaned, 16);
  if (Number.isNaN(num)) return [1, 1, 1];
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

const VERTEX_SHADER_SRC = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = (a_position + 1.0) * 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER_SRC = `
  precision highp float;

  varying vec2 v_uv;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec2 u_mouse;
  uniform float u_mouse_active;
  uniform float u_speed;
  uniform float u_glyph_size;
  uniform float u_tile_density;
  uniform float u_tile_shear;
  uniform float u_bevel_width;
  uniform float u_bevel_softness;
  uniform float u_refraction;
  uniform float u_chromatic_spread;
  uniform float u_specular_exp;
  uniform float u_specular_strength;
  uniform float u_freq_x;
  uniform float u_freq_y;
  uniform float u_freq_xy;
  uniform vec3 u_glyph_color;
  uniform vec3 u_recess_color;
  uniform vec3 u_bg_color;
  uniform float u_cursor_radius;
  uniform float u_cursor_intensity;

  // Hash helper
  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  // Procedural ASCII glyph character renderer (dense 5x5 sub-glyph matrix)
  float asciiGlyph(vec2 uv, float charIndex) {
    vec2 p = fract(uv);
    vec2 grid = floor(p * 5.0);
    float subIndex = grid.y * 5.0 + grid.x;

    float seed = floor(charIndex * 14.0) * 17.13 + subIndex * 0.41;
    float bit = step(0.48 - charIndex * 0.32, hash21(vec2(seed, floor(charIndex * 9.0))));

    float margin = step(0.08, p.x) * step(p.x, 0.92) * step(0.08, p.y) * step(p.y, 0.92);
    return bit * margin;
  }

  void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    if (u_resolution.x < 1.0 || u_resolution.y < 1.0) {
      gl_FragColor = vec4(u_bg_color, 1.0);
      return;
    }

    vec2 st = fragCoord / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    vec2 uv = (st - 0.5) * vec2(aspect, 1.0);

    // Interactive mouse distortion
    if (u_mouse_active > 0.1) {
      vec2 mouseUV = (u_mouse / u_resolution - 0.5) * vec2(aspect, 1.0);
      float distToMouse = length(uv - mouseUV);
      float normRadius = u_cursor_radius / u_resolution.y;
      float mouseInfluence = smoothstep(normRadius, 0.0, distToMouse);
      vec2 pushDir = normalize(uv - mouseUV + 0.0001);
      uv += pushDir * mouseInfluence * (u_cursor_intensity * 0.06);
    }

    float t = u_time * u_speed;

    // Apply shear
    vec2 shearedUV = uv;
    shearedUV.x += shearedUV.y * u_tile_shear;

    // Tile grid
    vec2 tileCoord = shearedUV * u_tile_density;
    vec2 tileId = floor(tileCoord);
    vec2 tileFrac = fract(tileCoord);

    // Bevel computation for glass edges
    vec2 distToEdge = min(tileFrac, 1.0 - tileFrac);
    float minEdgeDist = min(distToEdge.x, distToEdge.y);
    float bevel = smoothstep(0.0, u_bevel_width + u_bevel_softness, minEdgeDist);

    // Surface normal estimation for refraction & specular lighting
    vec2 dTile = (tileFrac - 0.5) * 2.0;
    vec2 normal = dTile * (1.0 - bevel);

    // Sinusoidal wave animation driving glowing character intensity
    float wave = sin(tileId.x * (u_freq_x * 0.1) + t * 0.9) *
                 cos(tileId.y * (u_freq_y * 0.1) + t * 0.7) +
                 sin((tileId.x + tileId.y) * (u_freq_xy * 0.05) + t * 1.2);
    float charVal = clamp((wave + 1.4) / 2.8, 0.0, 1.0);

    // Sub-glyph coordinate grid
    vec2 glyphCoord = fragCoord / max(6.0, u_glyph_size);

    // Refraction offsets with chromatic separation
    vec2 refrOffset = normal * (u_refraction * 0.001);
    float spread = u_chromatic_spread * 0.002;

    float rGlyph = asciiGlyph(glyphCoord + refrOffset * (1.0 + spread), charVal);
    float gGlyph = asciiGlyph(glyphCoord + refrOffset, charVal);
    float bGlyph = asciiGlyph(glyphCoord + refrOffset * (1.0 - spread), charVal);

    vec3 glyphCol = vec3(
      rGlyph * u_glyph_color.r,
      gGlyph * u_glyph_color.g,
      bGlyph * u_glyph_color.b
    );

    // Base background & tile surface
    vec3 surface = mix(u_recess_color, u_bg_color, bevel);

    // Composite glowing ASCII characters
    vec3 finalColor = surface + glyphCol * (0.45 + 0.55 * charVal);

    // Glass specular highlights on tile edges
    vec2 lightDir = normalize(vec2(0.4, 0.7));
    float specDot = max(0.0, dot(normal, lightDir));
    float specular = pow(specDot, u_specular_exp) * u_specular_strength * (1.0 - bevel);
    finalColor += vec3(specular);

    // Subtle edge fade
    float edgeDist = min(min(st.x, 1.0 - st.x), min(st.y, 1.0 - st.y));
    float vignette = smoothstep(0.0, 0.08, edgeDist);
    finalColor = mix(u_bg_color, finalColor, vignette);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function AsciiTiles({
  className,
  speed = 0.5,
  opacity = 0.85,
  glyphSize = 10,
  tileDensity = 3.4,
  tileShear = -0.18,
  bevelWidth = 0.03,
  bevelSoftness = 0.12,
  refractionStrength = 55,
  chromaticSpread = 0.04,
  specularExponent = 120,
  specularStrength = 0.7,
  patternFreqX = 5.0,
  patternFreqY = 3.5,
  patternFreqXY = 8.0,
  glyphColor = "#F2F2F0",
  recessColor = "#080809",
  backgroundColor = "#0A0A0B",
  cursorInteraction = true,
  cursorRadius = 140,
  cursorIntensity = 0.8,
  dpr = 1.5,
}: AsciiTilesProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const effectiveSpeed = prefersReducedMotion ? 0.02 : speed;

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
    });
    if (!gl) return;

    const createShader = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vert = createShader(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const frag = createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vert || !frag) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }
    gl.useProgram(program);

    // Full screen triangle strip
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const posAttr = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const uRes = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uMouse = gl.getUniformLocation(program, "u_mouse");
    const uMouseActive = gl.getUniformLocation(program, "u_mouse_active");
    const uSpeed = gl.getUniformLocation(program, "u_speed");
    const uGlyphSize = gl.getUniformLocation(program, "u_glyph_size");
    const uTileDensity = gl.getUniformLocation(program, "u_tile_density");
    const uTileShear = gl.getUniformLocation(program, "u_tile_shear");
    const uBevelWidth = gl.getUniformLocation(program, "u_bevel_width");
    const uBevelSoftness = gl.getUniformLocation(program, "u_bevel_softness");
    const uRefraction = gl.getUniformLocation(program, "u_refraction");
    const uChromaticSpread = gl.getUniformLocation(program, "u_chromatic_spread");
    const uSpecularExp = gl.getUniformLocation(program, "u_specular_exp");
    const uSpecularStrength = gl.getUniformLocation(program, "u_specular_strength");
    const uFreqX = gl.getUniformLocation(program, "u_freq_x");
    const uFreqY = gl.getUniformLocation(program, "u_freq_y");
    const uFreqXY = gl.getUniformLocation(program, "u_freq_xy");
    const uGlyphColor = gl.getUniformLocation(program, "u_glyph_color");
    const uRecessColor = gl.getUniformLocation(program, "u_recess_color");
    const uBgColor = gl.getUniformLocation(program, "u_bg_color");
    const uCursorRadius = gl.getUniformLocation(program, "u_cursor_radius");
    const uCursorIntensity = gl.getUniformLocation(program, "u_cursor_intensity");

    const glyphRgb = hexToRgb(glyphColor);
    const recessRgb = hexToRgb(recessColor);
    const bgRgb = hexToRgb(backgroundColor);

    gl.uniform3f(uGlyphColor, glyphRgb[0], glyphRgb[1], glyphRgb[2]);
    gl.uniform3f(uRecessColor, recessRgb[0], recessRgb[1], recessRgb[2]);
    gl.uniform3f(uBgColor, bgRgb[0], bgRgb[1], bgRgb[2]);
    gl.uniform1f(uSpeed, effectiveSpeed);
    gl.uniform1f(uGlyphSize, glyphSize);
    gl.uniform1f(uTileDensity, tileDensity);
    gl.uniform1f(uTileShear, tileShear);
    gl.uniform1f(uBevelWidth, bevelWidth);
    gl.uniform1f(uBevelSoftness, bevelSoftness);
    gl.uniform1f(uRefraction, refractionStrength);
    gl.uniform1f(uChromaticSpread, chromaticSpread);
    gl.uniform1f(uSpecularExp, specularExponent);
    gl.uniform1f(uSpecularStrength, specularStrength);
    gl.uniform1f(uFreqX, patternFreqX);
    gl.uniform1f(uFreqY, patternFreqY);
    gl.uniform1f(uFreqXY, patternFreqXY);
    gl.uniform1f(uCursorRadius, cursorRadius);
    gl.uniform1f(uCursorIntensity, cursorIntensity);

    const pixelRatio = Math.min(window.devicePixelRatio || 1, dpr);
    const targetMouse = { x: 0, y: 0, active: 0 };
    const currentMouse = { x: 0, y: 0, active: 0 };

    const handleMouseMove = (e: MouseEvent) => {
      if (!cursorInteraction) return;
      const rect = container.getBoundingClientRect();
      targetMouse.x = (e.clientX - rect.left) * pixelRatio;
      targetMouse.y = (rect.height - (e.clientY - rect.top)) * pixelRatio;
      targetMouse.active = 1.0;
    };

    const handleMouseLeave = () => {
      targetMouse.active = 0.0;
    };

    if (cursorInteraction) {
      window.addEventListener("mousemove", handleMouseMove, { passive: true });
      window.addEventListener("mouseout", handleMouseLeave, { passive: true });
    }

    let animId: number;
    const startTime = performance.now();

    const render = (now: number) => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * pixelRatio));
      const h = Math.max(1, Math.floor(rect.height * pixelRatio));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);

      const elapsed = (now - startTime) * 0.001;

      currentMouse.x += (targetMouse.x - currentMouse.x) * 0.1;
      currentMouse.y += (targetMouse.y - currentMouse.y) * 0.1;
      currentMouse.active += (targetMouse.active - currentMouse.active) * 0.05;

      gl.uniform1f(uTime, elapsed);
      gl.uniform2f(uMouse, currentMouse.x, currentMouse.y);
      gl.uniform1f(uMouseActive, currentMouse.active);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      if (cursorInteraction) {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseout", handleMouseLeave);
      }
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
    };
  }, [
    speed,
    glyphSize,
    tileDensity,
    tileShear,
    bevelWidth,
    bevelSoftness,
    refractionStrength,
    chromaticSpread,
    specularExponent,
    specularStrength,
    patternFreqX,
    patternFreqY,
    patternFreqXY,
    glyphColor,
    recessColor,
    backgroundColor,
    cursorInteraction,
    cursorRadius,
    cursorIntensity,
    dpr,
  ]);

  return (
    <div
      ref={containerRef}
      className={cn("absolute inset-0 h-full w-full overflow-hidden", className)}
      style={{ opacity }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

export default AsciiTiles;
