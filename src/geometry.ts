import type { Table, Edge, Point, Port, Route } from "./types.ts";
type Box = { l: number; r: number; t: number; b: number };
export const WIDTH = 230,
  HEADER = 52,
  ROW = 38,
  PAD = 28;
const CLEARANCE = 8,
  PREFERRED_CLEARANCE = 18;
const textWidth = (text: unknown, size: number) =>
  [...String(text ?? "")].reduce(
    (sum, c) => sum + (c.codePointAt(0)! > 255 ? size : size * 0.66),
    0,
  );
export function tableWidth(t: Table) {
  const name = Math.max(
    ...t.columns.map((c) =>
      Math.max(textWidth(c.name, 14), textWidth(c.logicalName, 14)),
    ),
    0,
  );
  const type = Math.max(...t.columns.map((c) => textWidth(c.type, 12)), 0);
  const heading =
    Math.max(textWidth(t.name ?? t.id, 17), textWidth(t.logicalName, 17)) + 82;
  return Math.ceil(Math.max(WIDTH, heading, 39 + name + 24 + type + 14));
}
export const height = (t: Table) => HEADER + t.columns.length * ROW + 10;
export const boxes = (ts: Table[], padding = PREFERRED_CLEARANCE) =>
  ts.map((t) => ({
    id: t.id,
    l: t.x - padding,
    r: t.x + tableWidth(t) + padding,
    t: t.y - padding,
    b: t.y + height(t) + padding,
  }));
export function simplify(ps: Point[]) {
  let a = ps.filter((p, i) => !i || p.x !== ps[i - 1].x || p.y !== ps[i - 1].y);
  for (let i = 1; i < a.length - 1;) {
    if (
      (a[i - 1].x === a[i].x && a[i].x === a[i + 1].x) ||
      (a[i - 1].y === a[i].y && a[i].y === a[i + 1].y)
    )
      a.splice(i, 1);
    else i++;
  }
  return a;
}
export function clear(a: Point, b: Point, rs: Box[]) {
  return !rs.some((r) =>
    a.x === b.x
      ? a.x > r.l &&
        a.x < r.r &&
        Math.max(a.y, b.y) > r.t &&
        Math.min(a.y, b.y) < r.b
      : a.y > r.t &&
        a.y < r.b &&
        Math.max(a.x, b.x) > r.l &&
        Math.min(a.x, b.x) < r.r,
  );
}
export function rounded(ps: Point[], r = 8) {
  if (!ps.length) return "";
  let d = `M ${ps[0].x} ${ps[0].y}`;
  for (let i = 1; i < ps.length - 1; i++) {
    let a = ps[i - 1],
      b = ps[i],
      c = ps[i + 1],
      ab = Math.hypot(a.x - b.x, a.y - b.y),
      bc = Math.hypot(c.x - b.x, c.y - b.y),
      n = Math.min(r, ab / 2, bc / 2);
    if (!ab || !bc) continue;
    let p = {
        x: b.x + ((a.x - b.x) * n) / ab,
        y: b.y + ((a.y - b.y) * n) / ab,
      },
      q = { x: b.x + ((c.x - b.x) * n) / bc, y: b.y + ((c.y - b.y) * n) / bc };
    d += ` L ${p.x} ${p.y} Q ${b.x} ${b.y} ${q.x} ${q.y}`;
  }
  let p = ps.at(-1)!;
  return d + ` L ${p.x} ${p.y}`;
}
export function port(t: Table, index: number, side: Port["side"]) {
  return {
    x: t.x + (side === "right" ? tableWidth(t) : 0),
    y: t.y + HEADER + ROW * (index + 0.5),
  };
}
type Segment = { a: Point; b: Point; source?: string; target?: string };
const endpointKey = (p: Port) => JSON.stringify([p.table, p.row, p.side]);

export function connectionSides(
  source: Table,
  target: Table,
): [Port["side"], Port["side"]] {
  if (source.id === target.id) return ["right", "right"];
  if (source.x + tableWidth(source) <= target.x) return ["right", "left"];
  if (target.x + tableWidth(target) <= source.x) return ["left", "right"];
  return ["right", "right"];
}

// Table bodies are hard obstacles. Preferred whitespace is a soft cost: it
// must not create an extra dogleg immediately before an otherwise clear port.
function clearanceCost(a: Point, b: Point, preferred: Box[]) {
  let cost = 0;
  for (const box of preferred) {
    if (a.x === b.x && a.x > box.l && a.x < box.r)
      cost += Math.max(
        0,
        Math.min(Math.max(a.y, b.y), box.b) -
          Math.max(Math.min(a.y, b.y), box.t),
      );
    if (a.y === b.y && a.y > box.t && a.y < box.b)
      cost += Math.max(
        0,
        Math.min(Math.max(a.x, b.x), box.r) -
          Math.max(Math.min(a.x, b.x), box.l),
      );
  }
  return cost * 0.35;
}
const segments = (points: Point[]): Segment[] =>
  points.slice(1).map((b, i) => ({ a: points[i], b }));

// Count shared corridors once even when several existing branches use them.
function sharedLength(a: Point, b: Point, shared: Segment[]) {
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

function interference(a: Point, b: Point, occupied: Segment[]) {
  let cost = 0;
  for (const { a: c, b: d } of occupied) {
    const vertical = a.x === b.x,
      otherVertical = c.x === d.x;
    if (vertical === otherVertical) {
      const distance = vertical ? Math.abs(a.x - c.x) : Math.abs(a.y - c.y);
      if (distance === 0 || (vertical && distance < 12)) {
        const overlap = vertical
          ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
            Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
          : Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
            Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
        cost += Math.max(0, overlap) * 8 * (1 - distance / 12);
      }
    } else {
      const at = vertical ? c.y : c.x;
      const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
      const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
      const insideOther = vertical
        ? a.x > Math.min(c.x, d.x) && a.x < Math.max(c.x, d.x)
        : a.y > Math.min(c.y, d.y) && a.y < Math.max(c.y, d.y);
      if (insideOther && at >= lo && at <= hi)
        // Grid subdivision must not make a crossing at a grid vertex free.
        cost += at === lo || at === hi ? 320 : 640;
    }
  }
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

export function route(
  edge: Edge,
  ts: Table[],
  occupied: Segment[] = [],
  lane = 0,
  shared: Segment[] = [],
): Route {
  const s = ts.find((t) => t.id === edge.from.table)!,
    t = ts.find((t) => t.id === edge.to.table)!,
    a = port(s, edge.from.row, edge.from.side),
    b = port(t, edge.to.row, edge.to.side),
    aa = { x: a.x + (edge.from.side === "right" ? PAD : -PAD), y: a.y },
    bb = { x: b.x + (edge.to.side === "right" ? PAD : -PAD), y: b.y },
    rs = boxes(ts, CLEARANCE),
    preferred = boxes(ts);
  if (
    s.id === t.id &&
    edge.from.row === edge.to.row &&
    edge.from.side === edge.to.side &&
    a.y === b.y
  ) {
    const sign = edge.from.side === "right" ? 1 : -1;
    return {
      points: [
        a,
        { x: a.x + 36 * sign, y: a.y },
        { x: a.x + 36 * sign, y: a.y + 18 },
        { x: a.x + 18 * sign, y: a.y + 18 },
        { x: a.x + 18 * sign, y: a.y },
        a,
      ],
      detour: true,
    };
  }
  let x = edge.trunk ?? (aa.x + bb.x) / 2;
  const natural =
    (edge.from.side === "right" && edge.to.side === "left" && aa.x <= bb.x) ||
    (edge.from.side === "left" && edge.to.side === "right" && aa.x >= bb.x);
  if (natural)
    x = Math.max(Math.min(aa.x, bb.x), Math.min(Math.max(aa.x, bb.x), x));
  const candidateXs = [x];
  if (!edge.manual && natural) {
    candidateXs.push(aa.x, bb.x);
    // References to different table columns otherwise get different midpoints.
    // Reuse a same-column stem when it fits, without forcing a blocked route.
    for (const { a, b } of shared)
      if (
        a.x === b.x &&
        a.y !== b.y &&
        a.x >= Math.min(aa.x, bb.x) &&
        a.x <= Math.max(aa.x, bb.x)
      )
        candidateXs.push(a.x);
    for (let step = 1; step <= 3; step++)
      for (const sign of [-1, 1]) {
        const candidate = x + step * 16 * sign;
        if (
          candidate >= Math.min(aa.x, bb.x) &&
          candidate <= Math.max(aa.x, bb.x)
        )
          candidateXs.push(candidate);
      }
  }
  const simplePaths = [...new Set(candidateXs)]
    .map((x) => ({ x, points: [aa, { x, y: aa.y }, { x, y: bb.y }, bb] }))
    .filter(
      (p) =>
        natural &&
        p.points.every((b, i) => !i || clear(p.points[i - 1], b, rs)),
    )
    .map((p) => ({
      ...p,
      penalty: segments(p.points).reduce(
        (sum, s) => sum + interference(s.a, s.b, occupied),
        0,
      ),
      shared: edge.manual
        ? 0
        : segments(p.points).reduce(
            (sum, s) => sum + sharedLength(s.a, s.b, shared),
            0,
          ),
    }))
    .sort(
      (a, b) =>
        a.penalty - b.penalty ||
        b.shared - a.shared ||
        Math.abs(a.x - x) - Math.abs(b.x - x),
    );
  const simple = simplePaths[0];
  if (simple && (edge.manual || simple.penalty < 160))
    return {
      points: simplify([a, ...simple.points, b]),
      handle: {
        x: simple.x,
        y: (aa.y + bb.y) / 2,
        y1: aa.y,
        y2: bb.y,
        min: Math.min(aa.x, bb.x),
        max: Math.max(aa.x, bb.x),
      },
      detour: false,
    };
  const spacing = 16 * (1 + (lane % 4));
  const xs = [
      ...new Set([
        aa.x,
        bb.x,
        ...candidateXs,
        ...rs.flatMap((r) => [r.l, r.r, r.l - spacing, r.r + spacing]),
      ]),
    ].sort((a, b) => a - b),
    ys = [
      ...new Set([
        aa.y,
        bb.y,
        ...rs.flatMap((r) => [r.t, r.b, r.t - spacing, r.b + spacing]),
      ]),
    ].sort((a, b) => a - b);
  const nodes: Point[] = [];
  const rows = new Map<number, number[]>(),
    columns = new Map<number, number[]>();
  for (const y of ys)
    for (const x of xs)
      if (!rs.some((r) => x > r.l && x < r.r && y > r.t && y < r.b)) {
        const i = nodes.length;
        nodes.push({ x, y });
        if (!rows.has(y)) rows.set(y, []);
        if (!columns.has(x)) columns.set(x, []);
        rows.get(y)!.push(i);
        columns.get(x)!.push(i);
      }
  const start = nodes.findIndex((p) => p.x === aa.x && p.y === aa.y),
    goal = nodes.findIndex((p) => p.x === bb.x && p.y === bb.y);
  if (start < 0 || goal < 0) return { points: [a, aa, bb, b], blocked: true };
  const adjacency: [number, number, number][][] = nodes.map(() => []);
  for (const line of [...rows.values(), ...columns.values()])
    for (let k = 1; k < line.length; k++) {
      const i = line[k - 1],
        j = line[k];
      let p = nodes[i],
        q = nodes[j];
      if ((p.x === q.x || p.y === q.y) && clear(p, q, rs)) {
        const dir = p.x === q.x ? 1 : 0,
          len =
            Math.abs(p.x - q.x) +
            Math.abs(p.y - q.y) +
            interference(p, q, occupied) +
            clearanceCost(p, q, preferred);
        adjacency[i].push([j, dir, len]);
        adjacency[j].push([i, dir, len]);
      }
    }
  const dist = new Map([[`${start},0`, 0]]),
    prev = new Map<string, string>(),
    queue = new RouteQueue();
  queue.push([start, 0, 0]);
  let end: string | null = null;
  while (queue.items.length) {
    const [n, dir, cost] = queue.pop()!,
      key = `${n},${dir}`;
    if (cost !== dist.get(key)) continue;
    if (n === goal) {
      end = key;
      break;
    }
    for (const [j, d, len] of adjacency[n]) {
      if (
        n === start &&
        d === 0 &&
        (nodes[j].x - aa.x) * (edge.from.side === "right" ? 1 : -1) < 0
      )
        continue;
      if (
        j === goal &&
        d === 0 &&
        (nodes[n].x - bb.x) * (edge.to.side === "right" ? 1 : -1) < 0
      )
        continue;
      const next = `${j},${d}`,
        v =
          cost +
          len +
          (dir === d ? 0 : 180) +
          (j === goal && d === 1 ? 180 : 0) +
          (d === 1 ? Math.abs(nodes[j].x - x) * 0.08 : 0);
      if (v < (dist.get(next) ?? Infinity)) {
        dist.set(next, v);
        prev.set(next, key);
        queue.push([j, d, v]);
      }
    }
  }
  if (!end) return { points: [a, aa, bb, b], blocked: true };
  const ps = [];
  for (let k: string | undefined = end; k; k = prev.get(k))
    ps.unshift(nodes[Number(k.split(",")[0])]);
  return { points: simplify([a, ...ps, b]), detour: true };
}

// Route nearby columns first. Within a fan-out to one column, route the farthest
// child first so shorter branches can nest without crossing it.
// Manual routes are kept and act as obstacles to overlapping automatic lines.
export function routeEdges(edges: Edge[], tables: Table[]): Map<string, Route> {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const effective = edges.map((e) => {
    if (e.manual) return e;
    const [fromSide, toSide] = connectionSides(
      byId.get(e.from.table)!,
      byId.get(e.to.table)!,
    );
    return {
      ...e,
      from: { ...e.from, side: fromSide },
      to: { ...e.to, side: toSide },
    };
  });
  const span = (e: Edge) => {
    const a = port(byId.get(e.from.table)!, e.from.row, e.from.side);
    const b = port(byId.get(e.to.table)!, e.to.row, e.to.side);
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  };
  const horizontalSpan = (e: Edge) =>
    Math.abs(
      port(byId.get(e.from.table)!, e.from.row, e.from.side).x -
        port(byId.get(e.to.table)!, e.to.row, e.to.side).x,
    );
  const nearest = new Map<string, number>();
  for (const e of effective) {
    const key = endpointKey(e.from);
    nearest.set(key, Math.min(nearest.get(key) ?? Infinity, span(e)));
  }
  const ordered = [...effective].sort(
    (a, b) =>
      Number(b.manual) - Number(a.manual) ||
      nearest.get(endpointKey(a.from))! - nearest.get(endpointKey(b.from))! ||
      endpointKey(a.from).localeCompare(endpointKey(b.from)) ||
      horizontalSpan(a) - horizontalSpan(b) ||
      span(b) - span(a) ||
      a.id.localeCompare(b.id),
  );
  const result = new Map<string, Route>(),
    occupied: Segment[] = [];
  for (const [i, edge] of ordered.entries()) {
    const sourceTable = byId.get(edge.from.table)!,
      targetTable = byId.get(edge.to.table)!;
    const sides: [Port["side"], Port["side"]][] = [
      [edge.from.side, edge.to.side],
    ];
    if (
      !edge.manual &&
      sourceTable.x < targetTable.x + tableWidth(targetTable) &&
      targetTable.x < sourceTable.x + tableWidth(sourceTable)
    ) {
      // In a vertical stack or cycle, either side may be the clear corridor.
      // Choosing ports and routing together avoids forcing every loop onto the
      // right side. Self references always use one side of their own table.
      sides.push(["left", "left"], ["right", "right"]);
      if (sourceTable.id !== targetTable.id)
        sides.push(["left", "right"], ["right", "left"]);
    }
    const candidates = sides
      .map(([fromSide, toSide], preference) => {
        const effective = {
          ...edge,
          from: { ...edge.from, side: fromSide },
          to: { ...edge.to, side: toSide },
        };
        const source = endpointKey(effective.from),
          target = endpointKey(effective.to);
        const obstacles = occupied.filter(
          (s) => s.source !== source && s.target !== target,
        );
        const shared = occupied.filter(
          (s) => s.source === source || s.target === target,
        );
        const path = route(
          effective,
          tables,
          edge.manual ? [] : obstacles,
          i,
          shared,
        );
        const score =
          (path.blocked ? 1e9 : 0) +
          segments(path.points).reduce(
            (sum, { a, b }) =>
              sum +
              Math.abs(a.x - b.x) +
              Math.abs(a.y - b.y) +
              interference(a, b, obstacles),
            0,
          ) +
          Math.max(0, path.points.length - 2) * 180 +
          preference;
        return { path, fromSide, toSide, source, target, score };
      })
      .sort((a, b) => a.score - b.score);
    const { path, fromSide, toSide, source, target } = candidates[0];
    path.fromSide = fromSide;
    path.toSide = toSide;
    result.set(edge.id, path);
    if (path.points.length >= 2) {
      // A whole stem may be shared when it belongs to the same column. Treating
      // only the first segment as shared made large fan-outs cross themselves.
      // Unrelated column connections still reserve their own corridors.
      occupied.push(
        ...segments(path.points).map((s) => ({ ...s, source, target })),
      );
    }
  }
  return result;
}
