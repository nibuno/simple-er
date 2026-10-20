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
