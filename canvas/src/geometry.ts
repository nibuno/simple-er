import type { CanvasDocument, CanvasEdge, CanvasNode, Point } from "./types";
import { bounds, connectionAxis, overlapArea } from "./spatial";
import { textWidth, wrapText } from "./text";
import {
  clearSegment,
  findDetour,
  interference,
  segments,
  sharedLength,
  simplify,
} from "./orthogonal";
import type { Segment } from "./orthogonal";

export interface Route {
  points: Point[];
  path: string;
  label: Point;
  labelLines: string[];
}
const center = (n: CanvasNode) => ({
  x: Math.round((n.x + n.w / 2) * 1e6) / 1e6,
  y: Math.round((n.y + n.h / 2) * 1e6) / 1e6,
});
export function rounded(points: Point[], radius = 10) {
  const ps = simplify(points);
  if (!ps.length) return "";
  let path = "M " + ps[0].x + " " + ps[0].y;
  for (let i = 1; i < ps.length - 1; i++) {
    const a = ps[i - 1],
      b = ps[i],
      c = ps[i + 1],
      ab = Math.hypot(b.x - a.x, b.y - a.y),
      bc = Math.hypot(c.x - b.x, c.y - b.y),
      r = Math.min(radius, ab / 2, bc / 2);
    path +=
      " L " +
      (b.x + ((a.x - b.x) * r) / ab) +
      " " +
      (b.y + ((a.y - b.y) * r) / ab) +
      " Q " +
      b.x +
      " " +
      b.y +
      " " +
      (b.x + ((c.x - b.x) * r) / bc) +
      " " +
      (b.y + ((c.y - b.y) * r) / bc);
  }
  return path + " L " + ps.at(-1)!.x + " " + ps.at(-1)!.y;
}
type Side = "left" | "right" | "top" | "bottom";
function port(node: CanvasNode, side: Side) {
  const c = center(node);
  if (side === "left")
    return { p: { x: node.x, y: c.y }, out: { x: node.x - 24, y: c.y } };
  if (side === "right")
    return {
      p: { x: node.x + node.w, y: c.y },
      out: { x: node.x + node.w + 24, y: c.y },
    };
  if (side === "top")
    return { p: { x: c.x, y: node.y }, out: { x: c.x, y: node.y - 24 } };
  return {
    p: { x: c.x, y: node.y + node.h },
    out: { x: c.x, y: node.y + node.h + 24 },
  };
}
interface RouteContext {
  occupied?: Segment[];
  shared?: Segment[];
  trunk?: number;
  row?: number;
}
export function routeEdge(
  edge: CanvasEdge,
  nodes: CanvasNode[],
  context: RouteContext = {},
): Route {
  const from = nodes.find((n) => n.id === edge.from)!,
    to = nodes.find((n) => n.id === edge.to)!;
  if (!from || !to)
    return { points: [], path: "", label: { x: 0, y: 0 }, labelLines: [] };
  const obstacles = nodes.filter((n) => n.kind !== "group");
  const occupied = context.occupied || [],
    shared = context.shared || [],
    scene = bounds(obstacles),
    preferred: [Side, Side] =
      from.id === to.id
        ? ["right", "top"]
        : connectionAxis(from, to) === "x"
          ? center(from).x <= center(to).x
            ? ["right", "left"]
            : ["left", "right"]
          : center(from).y <= center(to).y
            ? ["bottom", "top"]
            : ["top", "bottom"],
    pairs: [Side, Side][] =
      from.id === to.id
        ? [
            ["right", "top"],
            ["left", "top"],
            ["right", "bottom"],
            ["left", "bottom"],
          ]
        : [
            ["right", "left"],
            ["bottom", "top"],
            ["left", "right"],
            ["top", "bottom"],
            ["right", "right"],
            ["left", "left"],
            ["top", "top"],
            ["bottom", "bottom"],
          ],
    nearby = obstacles
      .filter(
        (n) =>
          n.x + n.w > Math.min(from.x, to.x) - 48 &&
          n.x < Math.max(from.x + from.w, to.x + to.w) + 48 &&
          n.y + n.h > Math.min(from.y, to.y) - 48 &&
          n.y < Math.max(from.y + from.h, to.y + to.h) + 48,
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, 24);
  let best: Point[] = [],
    bestScore = Infinity,
    blocked = true;
  const accept = (raw: Point[], s: Side, t: Side) => {
    const points = simplify(raw);
    if (points.length < 2) return;
    const a = port(from, s),
      b = port(to, t),
      start = points[1],
      end = points.at(-2)!;
    // Connections leave and enter along the outward normal of the shape.
    if (
      (a.out.x !== a.p.x ? start.y !== a.p.y : start.x !== a.p.x) ||
      (start.x - a.p.x) * (a.out.x - a.p.x) +
        (start.y - a.p.y) * (a.out.y - a.p.y) <=
        0
    )
      return;
    if (
      (b.out.x !== b.p.x ? end.y !== b.p.y : end.x !== b.p.x) ||
      (end.x - b.p.x) * (b.out.x - b.p.x) +
        (end.y - b.p.y) * (b.out.y - b.p.y) <=
        0
    )
      return;
    let score =
        (points.length - 2) * 60 +
        (s === preferred[0] && t === preferred[1] ? 0 : 180),
      clear = true;
    for (const { a, b } of segments(points)) {
      score +=
        Math.abs(a.x - b.x) +
        Math.abs(a.y - b.y) +
        interference(a, b, occupied) -
        sharedLength(a, b, shared) * 0.08;
      if (!clearSegment(a, b, obstacles)) {
        clear = false;
        score += 1000000;
      }
      if (context.trunk !== undefined && a.x === b.x)
        score += Math.abs(a.x - context.trunk) * 0.08;
      if (context.row !== undefined && a.y === b.y)
        score += Math.abs(a.y - context.row) * 0.08;
    }
    if (score < bestScore) {
      bestScore = score;
      best = points;
      blocked = !clear;
    }
  };
  for (const [s, t] of pairs) {
    const a = port(from, s),
      b = port(to, t);
    const add = (mid: Point[]) =>
      accept([a.p, a.out, ...mid, b.out, b.p], s, t);
    if (a.p.x === b.p.x || a.p.y === b.p.y) accept([a.p, b.p], s, t);
    add([{ x: b.out.x, y: a.out.y }]);
    add([{ x: a.out.x, y: b.out.y }]);
    const xs = [
      ...new Set([
        context.trunk ?? (a.out.x + b.out.x) / 2,
        (a.out.x + b.out.x) / 2,
        scene.x - 36,
        scene.x + scene.w + 36,
        ...nearby.flatMap((n) => [n.x - 20, n.x + n.w + 20]),
        ...shared.filter(({ a, b }) => a.x === b.x).map(({ a }) => a.x),
        ...(context.trunk === undefined
          ? []
          : [-32, -16, 16, 32].map((offset) => context.trunk! + offset)),
      ]),
    ];
    const ys = [
      ...new Set([
        context.row ?? (a.out.y + b.out.y) / 2,
        (a.out.y + b.out.y) / 2,
        scene.y - 36,
        scene.y + scene.h + 36,
        ...nearby.flatMap((n) => [n.y - 20, n.y + n.h + 20]),
        ...shared.filter(({ a, b }) => a.y === b.y).map(({ a }) => a.y),
        ...(context.row === undefined
          ? []
          : [-32, -16, 16, 32].map((offset) => context.row! + offset)),
      ]),
    ];
    for (const x of xs)
      add([
        { x, y: a.out.y },
        { x, y: b.out.y },
      ]);
    for (const y of ys)
      add([
        { x: a.out.x, y },
        { x: b.out.x, y },
      ]);
  }
  if (blocked) {
    for (const [s, t] of pairs) {
      const a = port(from, s),
        b = port(to, t),
        path = findDetour(
          a,
          b,
          obstacles,
          occupied,
          context.trunk ?? (a.out.x + b.out.x) / 2,
          context.row,
        );
      if (path) accept(path, s, t);
    }
  }
  const placed = placeLabel(edge.label, best, obstacles, center(from));
  return {
    points: best,
    path: rounded(best),
    label: placed.at,
    labelLines: placed.lines,
  };
}
// The area a label's text covers when drawn centered at `at`.
export function labelBox(at: Point, lines: string[]) {
  const w = Math.max(0, ...lines.map((line) => textWidth(line, 12)));
  return {
    x: at.x - w / 2 - 4,
    y: at.y - 21,
    w: w + 8,
    h: lines.length * 18 + 8,
  };
}
// Prefer the middle of the longest segment, as before, but move a label that
// would sit under a figure: narrow it to fit a horizontal gap, or set it
// beside a vertical segment.
function placeLabel(
  text: string,
  points: Point[],
  obstacles: CanvasNode[],
  fallback: Point,
) {
  let best = { at: fallback, lines: wrapText(text, 200, 12) },
    bestScore = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      horizontal = a.y === b.y,
      size = Math.hypot(b.x - a.x, b.y - a.y) + (horizontal ? 40 : 0);
    const options: { at: Point; lines: string[]; cost: number }[] = [];
    if (horizontal) {
      for (const width of [200, Math.max(80, Math.abs(b.x - a.x) - 24)])
        options.push({ at: mid, lines: wrapText(text, width, 12), cost: 0 });
    } else {
      const lines = wrapText(text, 200, 12),
        half = labelBox(mid, lines).w / 2 + 6;
      options.push({ at: mid, lines, cost: 0 });
      for (const side of [1, -1])
        options.push({
          at: { x: mid.x + side * half, y: mid.y },
          lines,
          cost: 30,
        });
    }
    for (const option of options) {
      const box = labelBox(option.at, option.lines),
        covered = obstacles.reduce((sum, n) => sum + overlapArea(box, n), 0),
        score = covered * 100 - size + option.cost + option.lines.length * 4;
      if (score < bestScore) {
        bestScore = score;
        best = option;
      }
    }
  }
  return best;
}
export function documentRoutes(doc: CanvasDocument) {
  const nodes = new Map(doc.nodes.map((n) => [n.id, n])),
    routes = new Map<string, Route>(),
    routed: { edge: CanvasEdge; segments: Segment[] }[] = [];
  const edges = [...doc.edges].sort((a, b) => {
    const af = nodes.get(a.from)!,
      bf = nodes.get(b.from)!,
      at = nodes.get(a.to)!,
      bt = nodes.get(b.to)!;
    return (
      af.x - bf.x ||
      af.y - bf.y ||
      a.from.localeCompare(b.from) ||
      Math.abs(center(bt).y - center(bf).y) -
        Math.abs(center(at).y - center(af).y) ||
      at.x - bt.x ||
      a.to.localeCompare(b.to) ||
      a.id.localeCompare(b.id)
    );
  });
  for (const edge of edges) {
    const from = nodes.get(edge.from)!,
      to = nodes.get(edge.to)!,
      shared = routed.filter(
        (r) => r.edge.from === edge.from || r.edge.to === edge.to,
      ),
      occupied = routed.filter(
        (r) => r.edge.from !== edge.from && r.edge.to !== edge.to,
      );
    const columnRight = Math.max(
        ...doc.nodes
          .filter((n) => n.kind === "box" && n.x === from.x)
          .map((n) => n.x + n.w),
        from.x + from.w,
      ),
      nextColumn = Math.min(
        ...doc.nodes
          .filter((n) => n.kind === "box" && n.x > columnRight && n.x <= to.x)
          .map((n) => n.x),
        to.x,
      ),
      trunk =
        columnRight < nextColumn ? (columnRight + nextColumn) / 2 : undefined;
    const rowBottom = Math.max(
        from.y + from.h,
        ...doc.nodes
          .filter((n) => n.kind === "box" && n.y === from.y)
          .map((n) => n.y + n.h),
      ),
      nextRow = Math.min(
        to.y,
        ...doc.nodes
          .filter((n) => n.kind === "box" && n.y > rowBottom && n.y <= to.y)
          .map((n) => n.y),
      ),
      row = rowBottom < nextRow ? (rowBottom + nextRow) / 2 : undefined,
      axis = connectionAxis(from, to);
    const route = routeEdge(edge, doc.nodes, {
      occupied: occupied.flatMap((r) => r.segments),
      shared: shared.flatMap((r) => r.segments),
      trunk: axis === "x" ? trunk : undefined,
      row: axis === "y" ? row : undefined,
    });
    routes.set(edge.id, route);
    routed.push({ edge, segments: segments(route.points) });
  }
  placeLabels(doc, routes);
  return routes;
}
function placeLabels(doc: CanvasDocument, routes: Map<string, Route>) {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (const edge of [...doc.edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!edge.label) continue;
    const route = routes.get(edge.id)!,
      otherSegments = [...routes]
        .filter(([id]) => id !== edge.id)
        .flatMap(([, r]) => segments(r.points)),
      width =
        Math.max(...route.labelLines.map((line) => textWidth(line, 12))) + 12,
      height = route.labelLines.length * 18 + 10;
    let best = route.label,
      score = Infinity;
    for (const { a, b } of segments(route.points)) {
      const vertical = a.x === b.x,
        length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (length < 32) continue;
      for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const offset of vertical
          ? [width / 2 + 12, -width / 2 - 12]
          : [0, -height - 12, height + 12]) {
          const point = {
              x: a.x + (b.x - a.x) * fraction + (vertical ? offset : 0),
              y:
                a.y +
                (b.y - a.y) * fraction +
                (vertical ? 22 - height / 2 : offset),
            },
            box = {
              x: point.x - width / 2,
              y: point.y - 22,
              w: width,
              h: height,
            };
          const overlap = (n: { x: number; y: number; w: number; h: number }) =>
            box.x < n.x + n.w &&
            box.x + box.w > n.x &&
            box.y < n.y + n.h &&
            box.y + box.h > n.y;
          const cost =
            doc.nodes.filter((n) => n.kind !== "group" && overlap(n)).length *
              100000 +
            placed.filter(overlap).length * 10000 +
            otherSegments.filter(({ a, b }) => !clearSegment(a, b, [box]))
              .length *
              2000 +
            Math.max(0, (vertical ? height : width) + 24 - length) * 100 +
            sharedLength(a, b, otherSegments) +
            Math.abs(fraction - 0.5) * 20 +
            Math.abs(offset) * 0.2;
          if (cost < score) {
            score = cost;
            best = point;
          }
        }
      }
    }
    route.label = best;
    placed.push({
      x: best.x - width / 2,
      y: best.y - 22,
      w: width,
      h: route.labelLines.length * 18 + 10,
    });
  }
}
export function sceneBounds(doc: CanvasDocument, routes = documentRoutes(doc)) {
  const all = doc.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  routes.forEach((r) => {
    r.points.forEach((p) => all.push({ ...p, w: 0, h: 0 }));
    if (r.labelLines.some(Boolean))
      all.push({
        x: r.label.x - 110,
        y: r.label.y - 22,
        w: 220,
        h: r.labelLines.length * 18 + 22,
      });
  });
  return bounds(all as CanvasNode[]);
}
