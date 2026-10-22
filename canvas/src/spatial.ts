import type { CanvasNode, Point } from "./types";

export type Rect = Point & { w: number; h: number };
export function bounds(nodes: Rect[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 800, h: 500 };
  const x = Math.min(...nodes.map((n) => n.x)),
    y = Math.min(...nodes.map((n) => n.y));
  return {
    x,
    y,
    w: Math.max(...nodes.map((n) => n.x + n.w)) - x,
    h: Math.max(...nodes.map((n) => n.y + n.h)) - y,
  };
}
export function overlapArea(a: Rect, b: Rect) {
  return (
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  );
}
export function connectionAxis(a: CanvasNode, b: CanvasNode): "x" | "y" {
  const dx = Math.abs(a.x + a.w / 2 - b.x - b.w / 2),
    dy = Math.abs(a.y + a.h / 2 - b.y - b.h / 2);
  return dx / ((a.w + b.w) / 2 + 24) >= dy / ((a.h + b.h) / 2 + 24) ? "x" : "y";
}
export interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
const alignLines = (r: Rect, axis: "x" | "y") =>
  axis === "x"
    ? [r.x, r.x + r.w / 2, r.x + r.w]
    : [r.y, r.y + r.h / 2, r.y + r.h];
// Aligns the moving rectangle's edges or center with the nearest other
// rectangle within the threshold, separately on each axis, and returns the
// offset to apply (null when nothing is in reach) with the guides to show.
export function snapToGuides(moving: Rect, others: Rect[], threshold: number) {
  const offset = (axis: "x" | "y") => {
    let best = Infinity;
    for (const other of others)
      for (const a of alignLines(moving, axis))
        for (const b of alignLines(other, axis))
          if (Math.abs(b - a) <= threshold && Math.abs(b - a) < Math.abs(best))
            best = b - a;
    return Number.isFinite(best) ? best : null;
  };
  const dx = offset("x"),
    dy = offset("y"),
    snapped = { ...moving, x: moving.x + (dx ?? 0), y: moving.y + (dy ?? 0) },
    guides: Guide[] = [];
  for (const other of others)
    for (const axis of ["x", "y"] as const)
      for (const b of alignLines(other, axis)) {
        if (!alignLines(snapped, axis).some((a) => Math.abs(a - b) < 0.5))
          continue;
        if (axis === "x")
          guides.push({
            x1: b,
            x2: b,
            y1: Math.min(snapped.y, other.y),
            y2: Math.max(snapped.y + snapped.h, other.y + other.h),
          });
        else
          guides.push({
            y1: b,
            y2: b,
            x1: Math.min(snapped.x, other.x),
            x2: Math.max(snapped.x + snapped.w, other.x + other.w),
          });
      }
  return { dx, dy, guides };
}
