/** Tiny SVG path builders, so icon definitions read as shapes not as strings. */

const n = (value: number) => Math.round(value * 100) / 100;

export function circle(cx: number, cy: number, r: number): string {
  return `M ${n(cx - r)} ${n(cy)} A ${n(r)} ${n(r)} 0 0 1 ${n(cx + r)} ${n(cy)} A ${n(r)} ${n(r)} 0 0 1 ${n(cx - r)} ${n(cy)} Z`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${n(cx - rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(cx + rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(cx - rx)} ${n(cy)} Z`;
}

export function rr(x: number, y: number, w: number, h: number, r = 0): string {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (radius === 0) {
    return `M ${n(x)} ${n(y)} L ${n(x + w)} ${n(y)} L ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z`;
  }
  return [
    `M ${n(x + radius)} ${n(y)}`,
    `L ${n(x + w - radius)} ${n(y)}`,
    `A ${n(radius)} ${n(radius)} 0 0 1 ${n(x + w)} ${n(y + radius)}`,
    `L ${n(x + w)} ${n(y + h - radius)}`,
    `A ${n(radius)} ${n(radius)} 0 0 1 ${n(x + w - radius)} ${n(y + h)}`,
    `L ${n(x + radius)} ${n(y + h)}`,
    `A ${n(radius)} ${n(radius)} 0 0 1 ${n(x)} ${n(y + h - radius)}`,
    `L ${n(x)} ${n(y + radius)}`,
    `A ${n(radius)} ${n(radius)} 0 0 1 ${n(x + radius)} ${n(y)}`,
    "Z",
  ].join(" ");
}

export function poly(points: Array<[number, number]>, close = true): string {
  if (!points.length) return "";
  const [first, ...rest] = points;
  return `M ${n(first[0])} ${n(first[1])} ${rest.map(([x, y]) => `L ${n(x)} ${n(y)}`).join(" ")}${close ? " Z" : ""}`;
}

export function line(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${n(x1)} ${n(y1)} L ${n(x2)} ${n(y2)}`;
}

/** Quadratic arc between two points, bulging by `bow` perpendicular to the chord. */
export function curve(x1: number, y1: number, x2: number, y2: number, bow: number): string {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  return `M ${n(x1)} ${n(y1)} Q ${n(midX - (dy / length) * bow)} ${n(midY + (dx / length) * bow)} ${n(x2)} ${n(y2)}`;
}

/** Pie slice from `startTurn` to `endTurn`, both in turns (0..1) clockwise from 12 o'clock. */
export function slice(cx: number, cy: number, r: number, startTurn: number, endTurn: number): string {
  const sweep = endTurn - startTurn;
  if (sweep >= 0.999) return circle(cx, cy, r);

  const point = (turn: number) => {
    const angle = (turn - 0.25) * Math.PI * 2;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const;
  };
  const [sx, sy] = point(startTurn);
  const [ex, ey] = point(endTurn);
  const large = sweep > 0.5 ? 1 : 0;

  return `M ${n(cx)} ${n(cy)} L ${n(sx)} ${n(sy)} A ${n(r)} ${n(r)} 0 ${large} 1 ${n(ex)} ${n(ey)} Z`;
}

/** Arrow shaft plus a filled head, as two separate paths. */
export function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  head = 14,
): { shaft: string; head: string } {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const back = head * 0.92;
  const tipX = x2;
  const tipY = y2;
  const baseX = tipX - Math.cos(angle) * back;
  const baseY = tipY - Math.sin(angle) * back;
  const spread = head * 0.55;

  return {
    shaft: line(x1, y1, baseX, baseY),
    head: poly([
      [tipX, tipY],
      [baseX - Math.sin(angle) * -spread, baseY - Math.cos(angle) * spread],
      [baseX + Math.sin(angle) * -spread, baseY + Math.cos(angle) * spread],
    ]),
  };
}
