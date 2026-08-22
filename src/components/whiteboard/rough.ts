"use client";

/**
 * Hand-drawn path utilities.
 *
 * Geometrically perfect outlines read as clip art. Resampling a path and
 * nudging each sample gives the chunky marker edge the whole look depends on,
 * and smoothing through the midpoints keeps curves from becoming polygons.
 */

let measureRoot: SVGSVGElement | null = null;

export function measurementElement(): SVGPathElement {
  if (!measureRoot) {
    measureRoot = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    measureRoot.setAttribute("width", "1");
    measureRoot.setAttribute("height", "1");
    measureRoot.style.position = "absolute";
    measureRoot.style.left = "-9999px";
    measureRoot.style.top = "0";
    measureRoot.style.opacity = "0";
    measureRoot.style.pointerEvents = "none";
    document.body.appendChild(measureRoot);
  }
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  measureRoot.appendChild(path);
  return path;
}

/** Deterministic noise, so a given path wobbles the same way on every frame. */
function noise(seed: number) {
  let state = (seed * 1103515245 + 12345) & 0x7fffffff;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff - 0.5;
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

export function roughen(measure: SVGPathElement, length: number, seed: number): string {
  const source = measure.getAttribute("d") ?? "";
  if (length < 26) return source;

  const step = Math.max(9, Math.min(22, length / 26));
  const count = Math.max(3, Math.ceil(length / step));
  const amplitude = Math.max(0.7, Math.min(2.1, length / 320));
  const random = noise(seed + 1);

  const parts: string[] = [];
  let run: Array<{ x: number; y: number }> = [];

  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }
    parts.push(`M ${round(run[0].x)} ${round(run[0].y)}`);
    for (let index = 1; index < run.length - 1; index += 1) {
      const midX = (run[index].x + run[index + 1].x) / 2;
      const midY = (run[index].y + run[index + 1].y) / 2;
      parts.push(`Q ${round(run[index].x)} ${round(run[index].y)} ${round(midX)} ${round(midY)}`);
    }
    const last = run[run.length - 1];
    parts.push(`L ${round(last.x)} ${round(last.y)}`);
    run = [];
  };

  let previous: { x: number; y: number } | null = null;

  for (let index = 0; index <= count; index += 1) {
    let point: DOMPoint;
    try {
      point = measure.getPointAtLength((length * index) / count);
    } catch {
      break;
    }
    // A big jump means a new subpath started; don't bridge across it.
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > step * 4) flush();

    run.push({
      x: point.x + random() * amplitude * 2,
      y: point.y + random() * amplitude * 2,
    });
    previous = { x: point.x, y: point.y };
  }
  flush();

  return parts.length ? parts.join(" ") : source;
}

export interface RoughPath {
  fillPath: Path2D;
  outline: Path2D;
  length: number;
  measure: SVGPathElement;
}

export function buildRoughPath(d: string, seed: number, crisp = false): RoughPath | null {
  try {
    const measure = measurementElement();
    measure.setAttribute("d", d);
    const trueLength = measure.getTotalLength();
    if (!Number.isFinite(trueLength) || trueLength <= 0) return null;

    const outlineD = crisp ? d : roughen(measure, trueLength, seed);
    measure.setAttribute("d", outlineD);
    const length = measure.getTotalLength() || trueLength;

    return {
      fillPath: new Path2D(d),
      outline: new Path2D(outlineD),
      length,
      measure,
    };
  } catch {
    return null;
  }
}
