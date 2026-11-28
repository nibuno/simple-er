import type { Point, Port } from "./types.ts";
export type Box = { l: number; r: number; t: number; b: number };
type Segment = { a: Point; b: Point };
type Obstacles = { hard: Box[]; preferred: Box[]; occupied: Segment[] };
type Exit = Point & { side: Port["side"] };
const MAX_VISITS = 65_536;

// Report just the overlaps and crossings which affect this row or column.
// Apply them in reservation order to preserve the router's tie breaking.
function scanLine(
  occupied: Segment[],
  vertical: boolean,
  at: number,
  parallel: (lo: number, hi: number, distance: number) => void,
  crossing: (coord: number) => void,
) {
  for (const { a, b } of occupied) {
    if (vertical === (a.x === b.x)) {
      const distance = Math.abs(at - (vertical ? a.x : a.y));
      if (vertical ? distance >= 12 : distance !== 0) continue;
      const v = vertical ? a.y : a.x,
        w = vertical ? b.y : b.x;
      parallel(Math.min(v, w), Math.max(v, w), distance);
    } else {
      const v = vertical ? a.x : a.y,
        w = vertical ? b.x : b.y;
      if (at > Math.min(v, w) && at < Math.max(v, w))
        crossing(vertical ? a.y : a.x);
    }
  }
}
function overlap(lo: number, hi: number, start: number, end: number) {
  return Math.max(0, Math.min(hi, end) - Math.max(lo, start));
}

export function interference(a: Point, b: Point, occupied: Segment[]) {
  const vertical = a.x === b.x;
  const v = vertical ? a.y : a.x,
    w = vertical ? b.y : b.x;
  const lo = Math.min(v, w),
    hi = Math.max(v, w);
  let cost = 0;
  scanLine(
    occupied,
    vertical,
    vertical ? a.x : a.y,
    (start, end, distance) => {
      cost += overlap(lo, hi, start, end) * 8 * (1 - distance / 12);
    },
    (coord) => {
      if (coord >= lo && coord <= hi)
        cost += coord === lo || coord === hi ? 320 : 640;
    },
  );
  return cost;
}

// The visibility graph can contain thousands of points for a large diagram.
// A heap and adjacent grid neighbors avoid quadratic graph construction/search.
class RouteQueue {
  items: [number, number, number][] = [];
  push(item: [number, number, number]) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][2] <= item[2]) break;
      a[i] = a[p];
      i = p;
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

// First grid interval whose end is at or beyond the coordinate.
function firstInterval(values: number[], coord: number) {
  let lo = 1,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < coord) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

// Add each obstacle or occupied segment to just the intervals it touches.
// Body intersections are forbidden; preferred whitespace is a soft cost.
function gridLine(
  values: number[],
  vertical: boolean,
  at: number,
  { hard, preferred, occupied }: Obstacles,
) {
  const costs = new Float64Array(values.length - 1);
  const clearance = new Float64Array(costs.length);
  for (const r of hard) {
    if (at <= (vertical ? r.l : r.t) || at >= (vertical ? r.r : r.b)) continue;
    const lo = vertical ? r.t : r.l,
      hi = vertical ? r.b : r.r;
    for (
      let i = firstInterval(values, lo);
      i < costs.length && values[i] < hi;
      i++
    )
      if (values[i + 1] > lo) costs[i] = Infinity;
  }
  for (const r of preferred) {
    if (at <= (vertical ? r.l : r.t) || at >= (vertical ? r.r : r.b)) continue;
    const lo = vertical ? r.t : r.l,
      hi = vertical ? r.b : r.r;
    for (
      let i = firstInterval(values, lo);
      i < costs.length && values[i] < hi;
      i++
    )
      clearance[i] += overlap(values[i], values[i + 1], lo, hi);
  }

  scanLine(
    occupied,
    vertical,
    at,
    (lo, hi, distance) => {
      for (
        let i = firstInterval(values, lo);
        i < costs.length && values[i] < hi;
        i++
      )
        costs[i] +=
          overlap(values[i], values[i + 1], lo, hi) * 8 * (1 - distance / 12);
    },
    (cross) => {
      const i = firstInterval(values, cross);
      if (cross < values[0] || i >= costs.length) return;
      if (values[i + 1] === cross) {
        // A crossing on a vertex charges half to each neighboring interval.
        costs[i] += 320;
        if (i + 1 < costs.length) costs[i + 1] += 320;
      } else costs[i] += values[i] === cross ? 320 : 640;
    },
  );
  for (let i = 0; i < costs.length; i++)
    costs[i] = values[i + 1] - values[i] + costs[i] + clearance[i] * 0.35;
  return costs;
}

export function detour(
  xs: number[],
  ys: number[],
  from: Exit,
  to: Exit,
  trunk: number,
  obstacles: Obstacles,
): Point[] | undefined {
  const inside = (p: Point) =>
    obstacles.hard.some(
      (r) => p.x > r.l && p.x < r.r && p.y > r.t && p.y < r.b,
    );
  if (inside(from) || inside(to)) return;
  const width = xs.length,
    size = width * ys.length;
  const start = ys.indexOf(from.y) * width + xs.indexOf(from.x);
  const goal = ys.indexOf(to.y) * width + xs.indexOf(to.x);
  const horizontalCosts: (Float64Array | undefined)[] = [];
  const verticalCosts: (Float64Array | undefined)[] = [];
  const dist = new Float64Array(size * 2).fill(Infinity);
  const prev = new Int32Array(size * 2);
  const queue = new RouteQueue();
  dist[start * 2] = 0;
  queue.push([start, 0, 0]);
  let end = -1;
  let visited = 0;
  while (queue.items.length && visited < MAX_VISITS) {
    const [n, dir, cost] = queue.pop();
    // Each grid point has two distances: arriving horizontally or vertically.
    const key = n * 2 + dir;
    if (cost !== dist[key]) continue;
    visited++;
    if (n === goal) {
      end = key;
      break;
    }
    const col = n % width,
      row = Math.floor(n / width);
    const horizontal = (horizontalCosts[row] ??= gridLine(
      xs,
      false,
      ys[row],
      obstacles,
    ));
    const vertical = (verticalCosts[col] ??= gridLine(
      ys,
      true,
      xs[col],
      obstacles,
    ));
    // Preserve the left/right/up/down neighbor order of the visibility graph.
    for (let side = 0; side < 4; side++) {
      const d = side >> 1,
        step = side % 2 ? 1 : -1;
      const nextCol = col + (d ? 0 : step),
        nextRow = row + (d ? step : 0);
      if (
        nextCol < 0 ||
        nextCol >= width ||
        nextRow < 0 ||
        nextRow >= ys.length
      )
        continue;
      const j = nextRow * width + nextCol;
      if (n === start && !d && step === (from.side === "right" ? -1 : 1))
        continue;
      if (j === goal && !d && step === (to.side === "right" ? 1 : -1)) continue;
      const len = d
        ? vertical[Math.min(row, nextRow)]
        : horizontal[Math.min(col, nextCol)];
      const next = j * 2 + d;
      const v =
        cost +
        len +
        (dir === d ? 0 : 180) +
        (j === goal && d === 1 ? 180 : 0) +
        (d === 1 ? Math.abs(xs[nextCol] - trunk) * 0.08 : 0);
      if (v < dist[next]) {
        dist[next] = v;
        prev[next] = key;
        queue.push([j, d, v]);
      }
    }
  }
  if (end === -1) {
    if (visited < MAX_VISITS) return;
    // The obstacle boundaries and the ports alone form a complete rectilinear
    // visibility grid. At 40 tables this fallback has at most 82 × 82 points.
    const boundaryX = [
      ...new Set([from.x, to.x, ...obstacles.hard.flatMap((r) => [r.l, r.r])]),
    ].sort((a, b) => a - b);
    const boundaryY = [
      ...new Set([from.y, to.y, ...obstacles.hard.flatMap((r) => [r.t, r.b])]),
    ].sort((a, b) => a - b);
    if (boundaryX.length < xs.length || boundaryY.length < ys.length)
      return detour(boundaryX, boundaryY, from, to, trunk, obstacles);
    return;
  }
  const points = [];
  for (let k = end; ; k = prev[k]) {
    const n = k >> 1;
    points.push({ x: xs[n % width], y: ys[Math.floor(n / width)] });
    if (k === start * 2) break;
  }
  return points.reverse();
}
