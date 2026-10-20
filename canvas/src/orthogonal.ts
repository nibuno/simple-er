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
export function clearSegment(a: Point, b: Point, nodes: Rect[]) {
  return !nodes.some((n) =>
    a.x === b.x
      ? a.x > n.x + 0.5 &&
        a.x < n.x + n.w - 0.5 &&
        Math.max(a.y, b.y) > n.y + 0.5 &&
        Math.min(a.y, b.y) < n.y + n.h - 0.5
      : a.y > n.y + 0.5 &&
        a.y < n.y + n.h - 0.5 &&
        Math.max(a.x, b.x) > n.x + 0.5 &&
        Math.min(a.x, b.x) < n.x + n.w - 0.5,
  );
}
export function sharedLength(a: Point, b: Point, shared: Segment[]) {
  const vertical = a.x === b.x,
    start = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
    end = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
  const intervals = shared
    .flatMap(({ a: c, b: d }) => {
      if (vertical ? c.x !== a.x || d.x !== a.x : c.y !== a.y || d.y !== a.y)
        return [];
      const lo = Math.max(
          start,
          vertical ? Math.min(c.y, d.y) : Math.min(c.x, d.x),
        ),
        hi = Math.min(end, vertical ? Math.max(c.y, d.y) : Math.max(c.x, d.x));
      return hi > lo ? [[lo, hi]] : [];
    })
    .sort((a, b) => a[0] - b[0]);
  let length = 0,
    covered = start;
  for (const [lo, hi] of intervals) {
    length += Math.max(0, hi - Math.max(lo, covered));
    covered = Math.max(covered, hi);
  }
  return length;
}
export function interference(a: Point, b: Point, occupied: Segment[]) {
  let cost = 0;
  for (const { a: c, b: d } of occupied) {
    const vertical = a.x === b.x,
      otherVertical = c.x === d.x;
    if (vertical === otherVertical) {
      const distance = vertical ? Math.abs(a.x - c.x) : Math.abs(a.y - c.y);
      if (distance === 0 || (vertical && distance < 16)) {
        const overlap = vertical
          ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
            Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
          : Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
            Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
        cost += Math.max(0, overlap) * 12 * (1 - distance / 16);
      }
    } else {
      const at = vertical ? c.y : c.x,
        lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
        hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      const inside = vertical
        ? a.x > Math.min(c.x, d.x) && a.x < Math.max(c.x, d.x)
        : a.y > Math.min(c.y, d.y) && a.y < Math.max(c.y, d.y);
      if (inside && at >= lo && at <= hi)
        cost += at === lo || at === hi ? 320 : 640;
    }
  }
  return cost;
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
  nodes: CanvasNode[],
  occupied: Segment[],
  trunk: number,
  row?: number,
) {
  const a = from.out,
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
        nodes.some((n) => x > n.x && x < n.x + n.w && y > n.y && y < n.y + n.h)
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
      if (!clearSegment(p, q, nodes)) continue;
      const direction = p.x === q.x ? 1 : 0,
        cost =
          Math.abs(p.x - q.x) +
          Math.abs(p.y - q.y) +
          interference(p, q, occupied);
      adjacency[u].push([v, direction, cost]);
      adjacency[v].push([u, direction, cost]);
    }
  const direction = a.x === from.p.x ? 1 : 0,
    distance = new Map([[`${start},${direction}`, 0]]),
    previous = new Map<string, string>(),
    queue = new RouteQueue();
  queue.push([start, direction, 0]);
  let end: string | null = null;
  while (queue.items.length) {
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
