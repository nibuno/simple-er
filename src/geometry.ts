import type { Table, Edge, Point, Port, Route } from "./types.ts";
type Box = { l: number; r: number; t: number; b: number };
export const WIDTH = 230,
  HEADER = 52,
  ROW = 38,
  PAD = 18;
const textWidth = (text: unknown, size: number) =>
  [...String(text ?? "")].reduce(
    (sum, c) => sum + (c.codePointAt(0)! > 255 ? size : size * 0.66),
    0,
  );
export function tableWidth(t: Table) {
  const name = Math.max(
    ...t.columns.map((c) => Math.max(textWidth(c[0], 14), textWidth(c[4], 14))),
    0,
  );
  const type = Math.max(...t.columns.map((c) => textWidth(c[1], 12)), 0);
  const heading =
    Math.max(textWidth(t.name ?? t.id, 17), textWidth(t.logicalName, 17)) + 82;
  return Math.ceil(Math.max(WIDTH, heading, 39 + name + 24 + type + 14));
}
export const height = (t: Table) => HEADER + t.columns.length * ROW + 10;
export const boxes = (ts: Table[]) =>
  ts.map((t) => ({
    id: t.id,
    l: t.x - PAD,
    r: t.x + tableWidth(t) + PAD,
    t: t.y - PAD,
    b: t.y + height(t) + PAD,
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
export function route(edge: Edge, ts: Table[]): Route {
  const s = ts.find((t) => t.id === edge.from.table)!,
    t = ts.find((t) => t.id === edge.to.table)!,
    a = port(s, edge.from.row, edge.from.side),
    b = port(t, edge.to.row, edge.to.side),
    aa = { x: a.x + (edge.from.side === "right" ? PAD : -PAD), y: a.y },
    bb = { x: b.x + (edge.to.side === "right" ? PAD : -PAD), y: b.y },
    rs = boxes(ts);
  let x = edge.trunk ?? (aa.x + bb.x) / 2;
  const natural =
    (edge.from.side === "right" && edge.to.side === "left" && aa.x <= bb.x) ||
    (edge.from.side === "left" && edge.to.side === "right" && aa.x >= bb.x);
  if (natural)
    x = Math.max(Math.min(aa.x, bb.x), Math.min(Math.max(aa.x, bb.x), x));
  const simple = [aa, { x, y: aa.y }, { x, y: bb.y }, bb];
  if (natural && simple.every((p, i) => !i || clear(simple[i - 1], p, rs)))
    return {
      points: simplify([a, ...simple, b]),
      handle: {
        x,
        y: (aa.y + bb.y) / 2,
        y1: aa.y,
        y2: bb.y,
        min: Math.min(aa.x, bb.x),
        max: Math.max(aa.x, bb.x),
      },
      detour: false,
    };
  const xs = [
      ...new Set([aa.x, bb.x, x, ...rs.flatMap((r) => [r.l, r.r])]),
    ].sort((a, b) => a - b),
    ys = [...new Set([aa.y, bb.y, ...rs.flatMap((r) => [r.t, r.b])])].sort(
      (a, b) => a - b,
    );
  const nodes = [];
  for (const y of ys)
    for (const x of xs)
      if (!rs.some((r) => x > r.l && x < r.r && y > r.t && y < r.b))
        nodes.push({ x, y });
  const start = nodes.findIndex((p) => p.x === aa.x && p.y === aa.y),
    goal = nodes.findIndex((p) => p.x === bb.x && p.y === bb.y);
  if (start < 0 || goal < 0) return { points: [a, aa, bb, b], blocked: true };
  const adjacency: [number, number, number][][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      let p = nodes[i],
        q = nodes[j];
      if ((p.x === q.x || p.y === q.y) && clear(p, q, rs)) {
        const dir = p.x === q.x ? 1 : 0,
          len = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
        adjacency[i].push([j, dir, len]);
        adjacency[j].push([i, dir, len]);
      }
    }
  const dist = new Map([[`${start},0`, 0]]),
    prev = new Map<string, string>(),
    queue = [[start, 0, 0]];
  let end: string | null = null;
  while (queue.length) {
    queue.sort((a, b) => b[2] - a[2]);
    const [n, dir, cost] = queue.pop()!,
      key = `${n},${dir}`;
    if (cost !== dist.get(key)) continue;
    if (n === goal) {
      end = key;
      break;
    }
    for (const [j, d, len] of adjacency[n]) {
      const next = `${j},${d}`,
        v =
          cost +
          len +
          (dir === d ? 0 : 110) +
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
