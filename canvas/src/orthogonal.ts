import type { CanvasNode, Point } from "./types";
import type { Rect } from "./spatial";

export type Segment = { a: Point; b: Point };
export const segments = (points: Point[]): Segment[] =>
  points.slice(1).map((b, i) => ({ a: points[i], b }));
export function simplify(points: Point[]) {
  const result = points.filter(
    (p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y,
  );
  for (let i = 1; i < result.length - 1;) {
    const a = result[i - 1],
      b = result[i],
      c = result[i + 1];
    if (
      ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) &&
      (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0
    )
      result.splice(i, 1);
    else i++;
  }
  return result;
}
// Candidate corridors repeatedly query the same x or y. Keep the rectangles
// intersecting each such line, including its boundary for point queries.
export class ObstacleIndex {
  private columns = new Map<number, Rect[]>();
  private rows = new Map<number, Rect[]>();
  constructor(readonly nodes: CanvasNode[]) {}
  along(vertical: boolean, coordinate: number) {
    const lines = vertical ? this.columns : this.rows;
    let line = lines.get(coordinate);
    if (!line) {
      line = this.nodes.filter((n) =>
        vertical
          ? coordinate >= n.x && coordinate <= n.x + n.w
          : coordinate >= n.y && coordinate <= n.y + n.h,
      );
      lines.set(coordinate, line);
    }
    return line;
  }
  clear(a: Point, b: Point) {
    const vertical = a.x === b.x;
    return clearSegment(a, b, this.along(vertical, vertical ? a.x : a.y));
  }
}

type Endpoints = { from: string; to: string };
type Wire = {
  vertical: boolean;
  at: number;
  lo: number;
  hi: number;
  edge?: Endpoints;
};
type WireLine = { wires: Wire[]; indexed: number };

// Index just the wires that run along or cross each queried row/column.
// New routes are appended in order. Refresh a line only when it is queried.
export class WireIndex {
  private wires: Wire[] = [];
  private columns = new Map<number, WireLine>();
  private rows = new Map<number, WireLine>();
  add(parts: Segment[], edge?: Endpoints) {
    for (const { a, b } of parts) {
      const vertical = a.x === b.x,
        first = vertical ? a.y : a.x,
        last = vertical ? b.y : b.x;
      this.wires.push({
        vertical,
        at: vertical ? a.x : a.y,
        lo: Math.min(first, last),
        hi: Math.max(first, last),
        edge,
      });
    }
  }
  cost(a: Point, b: Point, edge: Endpoints) {
    const vertical = a.x === b.x,
      at = vertical ? a.x : a.y,
      first = vertical ? a.y : a.x,
      last = vertical ? b.y : b.x,
      lo = Math.min(first, last),
      hi = Math.max(first, last),
      lines = vertical ? this.columns : this.rows;
    let line = lines.get(at);
    if (!line) {
      line = { wires: [], indexed: 0 };
      lines.set(at, line);
    }
    for (let i = line.indexed; i < this.wires.length; i++) {
      const w = this.wires[i];
      if (w.vertical !== vertical) {
        if (at > w.lo && at < w.hi) line.wires.push(w);
      } else if (vertical ? Math.abs(at - w.at) < 16 : at === w.at)
        line.wires.push(w);
    }
    line.indexed = this.wires.length;
    let cost = 0;
    for (const wire of line.wires) {
      if (vertical !== wire.vertical) {
        if (
          wire.at < lo ||
          wire.at > hi ||
          wire.edge?.from === edge.from ||
          wire.edge?.to === edge.to
        )
          continue;
        cost += wire.at === lo || wire.at === hi ? 320 : 640;
      } else {
        const overlap = Math.min(hi, wire.hi) - Math.max(lo, wire.lo);
        if (
          overlap > 0 &&
          wire.edge?.from !== edge.from &&
          wire.edge?.to !== edge.to
        )
          cost += overlap * 12 * (1 - Math.abs(at - wire.at) / 16);
      }
    }
    return cost;
  }
}

export function crossesRect(a: Point, b: Point, n: Rect) {
  return a.x === b.x
    ? a.x > n.x + 0.5 &&
        a.x < n.x + n.w - 0.5 &&
        Math.max(a.y, b.y) > n.y + 0.5 &&
        Math.min(a.y, b.y) < n.y + n.h - 0.5
    : a.y > n.y + 0.5 &&
        a.y < n.y + n.h - 0.5 &&
        Math.max(a.x, b.x) > n.x + 0.5 &&
        Math.min(a.x, b.x) < n.x + n.w - 0.5;
}
export function clearSegment(a: Point, b: Point, nodes: Rect[]) {
  return !nodes.some((n) => crossesRect(a, b, n));
}
export function sharedLength(a: Point, b: Point, shared: Segment[]) {
  const vertical = a.x === b.x,
    start = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
    end = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
  const intervals: [number, number][] = [];
  for (const { a: c, b: d } of shared) {
    if (vertical ? c.x !== a.x || d.x !== a.x : c.y !== a.y || d.y !== a.y)
      continue;
    const first = vertical ? c.y : c.x,
      last = vertical ? d.y : d.x,
      lo = Math.max(start, Math.min(first, last)),
      hi = Math.min(end, Math.max(first, last));
    if (hi > lo) intervals.push([lo, hi]);
  }
  if (!intervals.length) return 0;
  if (intervals.length === 1) return intervals[0][1] - intervals[0][0];
  intervals.sort((a, b) => a[0] - b[0]);
  let length = 0,
    covered = start;
  for (const [lo, hi] of intervals) {
    length += Math.max(0, hi - Math.max(lo, covered));
    covered = Math.max(covered, hi);
  }
  return length;
}
class RouteQueue {
  items: [number, number, number][] = [];
  push(item: [number, number, number]) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][2] <= item[2]) break;
      a[i] = a[parent];
      i = parent;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items,
      first = a[0],
      last = a.pop()!;
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let child = i * 2 + 1;
        if (child + 1 < a.length && a[child + 1][2] < a[child][2]) child++;
        if (last[2] <= a[child][2]) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return first;
  }
}

// Use a visibility grid only when simple routes are blocked. Limiting the local
// grid keeps interactive dragging responsive; every segment still checks all
// nodes, and outer corridors remain available for longer detours.
export function findDetour(
  from: { p: Point; out: Point },
  to: { p: Point; out: Point },
  index: ObstacleIndex,
  occupied: WireIndex,
  edge: { from: string; to: string },
  trunk: number,
  row?: number,
) {
  const nodes = index.nodes,
    a = from.out,
    b = to.out,
    left = Math.min(a.x, b.x),
    right = Math.max(a.x, b.x),
    top = Math.min(a.y, b.y),
    bottom = Math.max(a.y, b.y);
  const nearby = [...nodes]
    .sort((n, m) => {
      const distance = (n: CanvasNode) =>
        Math.max(0, left - n.x - n.w, n.x - right) +
        Math.max(0, top - n.y - n.h, n.y - bottom);
      return distance(n) - distance(m) || n.id.localeCompare(m.id);
    })
    .slice(0, 40);
  const xs = [
      ...new Set([
        a.x,
        b.x,
        trunk,
        Math.min(...nodes.map((n) => n.x)) - 48,
        Math.max(...nodes.map((n) => n.x + n.w)) + 48,
        ...nearby.flatMap((n) => [n.x - 20, n.x + n.w + 20]),
      ]),
    ].sort((a, b) => a - b),
    ys = [
      ...new Set([
        a.y,
        b.y,
        ...(row === undefined ? [] : [row]),
        Math.min(...nodes.map((n) => n.y)) - 48,
        Math.max(...nodes.map((n) => n.y + n.h)) + 48,
        ...nearby.flatMap((n) => [n.y - 20, n.y + n.h + 20]),
      ]),
    ].sort((a, b) => a - b);
  const points: Point[] = [],
    rows = new Map<number, number[]>(),
    columns = new Map<number, number[]>();
  for (const y of ys)
    for (const x of xs) {
      if (
        index
          .along(true, x)
          .some((n) => x > n.x && x < n.x + n.w && y > n.y && y < n.y + n.h)
      )
        continue;
      const id = points.length;
      points.push({ x, y });
      if (!rows.has(y)) rows.set(y, []);
      if (!columns.has(x)) columns.set(x, []);
      rows.get(y)!.push(id);
      columns.get(x)!.push(id);
    }
  const start = points.findIndex((p) => p.x === a.x && p.y === a.y),
    goal = points.findIndex((p) => p.x === b.x && p.y === b.y);
  if (start < 0 || goal < 0) return null;
  const adjacency: [number, number, number][][] = points.map(() => []);
  for (const line of [...rows.values(), ...columns.values()])
    for (let i = 1; i < line.length; i++) {
      const u = line[i - 1],
        v = line[i],
        p = points[u],
        q = points[v];
      if (!index.clear(p, q)) continue;
      const direction = p.x === q.x ? 1 : 0,
        cost =
          Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + occupied.cost(p, q, edge);
      adjacency[u].push([v, direction, cost]);
      adjacency[v].push([u, direction, cost]);
    }
  const direction = a.x === from.p.x ? 1 : 0,
    distance = new Map([[`${start},${direction}`, 0]]),
    previous = new Map<string, string>(),
    queue = new RouteQueue();
  queue.push([start, direction, 0]);
  let end: string | null = null;
  // A pathological maze falls back to the best candidate already scored.
  let remaining = 8192;
  while (queue.items.length && remaining-- > 0) {
    const [id, dir, cost] = queue.pop(),
      key = `${id},${dir}`;
    if (cost !== distance.get(key)) continue;
    if (id === goal) {
      end = key;
      break;
    }
    for (const [nextId, nextDir, length] of adjacency[id]) {
      const nextPoint = points[nextId],
        current = points[id];
      if (
        id === start &&
        (nextPoint.x - a.x) * (a.x - from.p.x) +
          (nextPoint.y - a.y) * (a.y - from.p.y) <
          0
      )
        continue;
      if (
        nextId === goal &&
        (current.x - b.x) * (b.x - to.p.x) +
          (current.y - b.y) * (b.y - to.p.y) <
          0
      )
        continue;
      const nextKey = `${nextId},${nextDir}`,
        nextCost =
          cost +
          length +
          (dir === nextDir ? 0 : 60) +
          (nextId === goal && nextDir !== (b.x === to.p.x ? 1 : 0) ? 60 : 0);
      if (nextCost < (distance.get(nextKey) ?? Infinity)) {
        distance.set(nextKey, nextCost);
        previous.set(nextKey, key);
        queue.push([nextId, nextDir, nextCost]);
      }
    }
  }
  if (!end) return null;
  const path: Point[] = [];
  for (let key: string | undefined = end; key; key = previous.get(key))
    path.unshift(points[Number(key.split(",")[0])]);
  return simplify([from.p, ...path, to.p]);
}
