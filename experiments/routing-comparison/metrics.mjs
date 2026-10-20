import { tableWidth, height, port, simplify } from "../../src/geometry.ts";
import { relationshipLabels } from "../../src/relationships.ts";
const near = (a, b) => Math.abs(a - b) < 0.001;
export const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const segments = (ps) => ps.slice(1).map((b, i) => [ps[i], b]);
const intersects = (a, b) =>
  a.x < b.x + b.width - 0.001 &&
  a.x + a.width > b.x + 0.001 &&
  a.y < b.y + b.height - 0.001 &&
  a.y + a.height > b.y + 0.001;
const penetrates = ([a, b], r) =>
  near(a.x, b.x)
    ? a.x > r.x + 0.001 &&
      a.x < r.x + r.width - 0.001 &&
      Math.max(a.y, b.y) > r.y + 0.001 &&
      Math.min(a.y, b.y) < r.y + r.height - 0.001
    : a.y > r.y + 0.001 &&
      a.y < r.y + r.height - 0.001 &&
      Math.max(a.x, b.x) > r.x + 0.001 &&
      Math.min(a.x, b.x) < r.x + r.width - 0.001;
export function measure({ diagram: d, routes }) {
  const boxes = d.tables.map((t) => ({
    id: t.id,
    x: t.x,
    y: t.y,
    width: tableWidth(t),
    height: height(t),
  }));
  const paths = d.edges.map((e) => {
    const r = routes.get(e.id);
    return {
      e,
      r,
      ps: simplify(
        r.points.map((p) => ({
          x: Math.round(p.x * 1e6) / 1e6,
          y: Math.round(p.y * 1e6) / 1e6,
        })),
      ),
    };
  });
  let bends = 0,
    length = 0,
    penetrations = 0,
    nonOrthogonal = 0,
    endpointErrors = 0,
    shortStubs = 0,
    tableOverlaps = 0,
    crossings = 0,
    sharedLength = 0,
    unrelatedOverlapPairs = 0,
    unrelatedOverlapLength = 0;
  for (const { e, r, ps } of paths) {
    bends += Math.max(0, ps.length - 2);
    length += segments(ps).reduce((s, [a, b]) => s + distance(a, b), 0);
    const ss = segments(ps);
    if (boxes.some((box) => ss.some((s) => penetrates(s, box)))) penetrations++;
    nonOrthogonal += ss.filter(
      ([a, b]) => !near(a.x, b.x) && !near(a.y, b.y),
    ).length;
    for (const [i, p] of [e.from, e.to].entries()) {
      const side = (i === 0 ? r.fromSide : r.toSide) ?? p.side,
        expected = port(
          d.tables.find((t) => t.id === p.table),
          p.row,
          side,
        );
      const at = i === 0 ? ps[0] : ps.at(-1),
        next = i === 0 ? ps[1] : ps.at(-2);
      if (
        !at ||
        !next ||
        distance(expected, at) > 0.001 ||
        !near(at.y, next.y) ||
        (next.x - at.x) * (side === "right" ? 1 : -1) <= 0
      )
        endpointErrors++;
      else if (distance(at, next) < 27.999) shortStubs++;
    }
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (intersects(boxes[i], boxes[j])) tableOverlaps++;
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      const hits = new Set();
      let pairOverlap = 0;
      const ends = ({ e, r }) => [
        [e.from.table, e.from.row, r.fromSide ?? e.from.side].join(":"),
        [e.to.table, e.to.row, r.toSide ?? e.to.side].join(":"),
      ];
      const commonEndpoint = ends(paths[i]).some((p) =>
        ends(paths[j]).includes(p),
      );
      for (const [a, b] of segments(paths[i].ps))
        for (const [c, d] of segments(paths[j].ps)) {
          const v = near(a.x, b.x),
            w = near(c.x, d.x);
          if (v !== w) {
            const [p, q, r, s] = v ? [a, b, c, d] : [c, d, a, b];
            if (
              p.x > Math.min(r.x, s.x) + 0.001 &&
              p.x < Math.max(r.x, s.x) - 0.001 &&
              r.y > Math.min(p.y, q.y) + 0.001 &&
              r.y < Math.max(p.y, q.y) - 0.001
            )
              hits.add(`${p.x.toFixed(3)},${r.y.toFixed(3)}`);
          } else if (v ? near(a.x, c.x) : near(a.y, c.y)) {
            const axis = v ? "y" : "x";
            pairOverlap += Math.max(
              0,
              Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
                Math.max(
                  Math.min(a[axis], b[axis]),
                  Math.min(c[axis], d[axis]),
                ),
            );
          }
        }
      crossings += hits.size;
      sharedLength += pairOverlap;
      if (!commonEndpoint && pairOverlap > 0.001) {
        unrelatedOverlapPairs++;
        unrelatedOverlapLength += pairOverlap;
      }
    }
  const labels = [...relationshipLabels(d, routes).values()];
  const labelTableCollisions = labels.filter((l) =>
    boxes.some((b) => intersects(l, b)),
  ).length;
  let labelLabelCollisions = 0;
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      if (intersects(labels[i], labels[j])) labelLabelCollisions++;
  const points = [
    ...boxes.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
    ]),
    ...paths.flatMap((p) => p.ps),
    ...labels.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.width, y: b.y + b.height },
    ]),
  ];
  const left = Math.min(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y)),
    width = Math.max(...points.map((p) => p.x)) - left,
    height2 = Math.max(...points.map((p) => p.y)) - top;
  return {
    bends,
    length: Math.round(length),
    crossings,
    sharedLength: Math.round(sharedLength),
    unrelatedOverlapPairs,
    unrelatedOverlapLength: Math.round(unrelatedOverlapLength),
    penetrations,
    nonOrthogonal,
    endpointErrors,
    shortStubs,
    tableOverlaps,
    labelTableCollisions,
    labelLabelCollisions,
    bounds: { x: left, y: top, width, height: height2 },
    area: Math.round(width * height2),
  };
}
export function signature(result) {
  return JSON.stringify({
    tables: [...result.diagram.tables]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((t) => [t.id, t.x, t.y]),
    routes: [...result.routes]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, r]) => [
        id,
        r.points.map((p) => [+p.x.toFixed(3), +p.y.toFixed(3)]),
      ]),
  });
}
export function changedRoutes(a, b) {
  const old = new Map(
    [...a.routes].map(([id, r]) => [
      id,
      JSON.stringify(r.points.map((p) => [+p.x.toFixed(3), +p.y.toFixed(3)])),
    ]),
  );
  return [...b.routes]
    .filter(
      ([id, r]) =>
        old.has(id) &&
        old.get(id) !==
          JSON.stringify(
            r.points.map((p) => [+p.x.toFixed(3), +p.y.toFixed(3)]),
          ),
    )
    .map(([id]) => id);
}
