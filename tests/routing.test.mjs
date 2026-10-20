import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clear,
  height,
  tableWidth,
  port,
  route,
  routeEdges,
  ROW,
} from "../src/geometry.ts";
import { tidyDiagram } from "../src/layout.ts";
import { graph, branching } from "./layout-fixtures.mjs";
import { encode, decode } from "../src/model.ts";

function checkRoutes(d) {
  const paths = routeEdges(d.edges, d.tables);
  const boxes = d.tables.map((t) => ({
    l: t.x,
    r: t.x + tableWidth(t),
    t: t.y,
    b: t.y + height(t),
  }));
  for (const edge of d.edges) {
    const path = paths.get(edge.id);
    assert.ok(!path.blocked, edge.id);
    for (const [endpoint, point] of [
      [{ ...edge.from, side: path.fromSide }, path.points[0]],
      [{ ...edge.to, side: path.toSide }, path.points.at(-1)],
    ]) {
      const center = port(
        d.tables.find((t) => t.id === endpoint.table),
        endpoint.row,
        endpoint.side,
      );
      assert.equal(point.x, center.x);
      assert.equal(point.y, center.y, "connections share the column center");
    }
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1],
        b = path.points[i];
      assert.ok(a.x === b.x || a.y === b.y, "route stays orthogonal");
      assert.ok(clear(a, b, boxes), `${edge.id} must not go through a table`);
    }
  }
  return paths;
}

test("branching and long references route around tables and remain deterministic", () => {
  const d = tidyDiagram(branching()),
    before = structuredClone(d);
  const paths = checkRoutes(d);
  assert.deepEqual(d, before);
  assert.deepEqual(
    [...paths].sort(),
    [...routeEdges([...d.edges].reverse(), [...d.tables].reverse())].sort(),
  );
});

test("parallel column connections use different vertical lanes", () => {
  const d = graph([
    ["a", [], 3],
    ["b", [], 4],
  ]);
  d.tables[0].x = 80;
  d.tables[0].y = 80;
  d.tables[1].x = 480;
  d.tables[1].y = 80;
  d.edges = [0, 1].map((i) => ({
    id: `edge${i}`,
    from: { table: "a", row: i, side: "right" },
    to: { table: "b", row: i + 2, side: "left" },
    trunk: null,
    manual: false,
  }));
  const paths = checkRoutes(d);
  const verticals = (path) =>
    path.points.slice(1).flatMap((b, i) => {
      const a = path.points[i];
      return a.x === b.x && a.y !== b.y ? [a.x] : [];
    });
  assert.ok(
    verticals(paths.get("edge0")).every(
      (x) => !verticals(paths.get("edge1")).includes(x),
    ),
  );
});

test("manual trunks remain fixed when other automatic lines are routed", () => {
  const d = tidyDiagram(branching());
  const e = d.edges.find((e) => e.from.table === "accounts");
  e.manual = true;
  e.trunk = 450;
  assert.equal(
    routeEdges(d.edges, d.tables).get(e.id).handle.x,
    route(e, d.tables).handle.x,
  );
});

test("cycles, self references and tall intermediate obstacles remain routable", () => {
  checkRoutes(
    tidyDiagram(
      graph([
        ["a", ["b", "a"], 12],
        ["b", ["a"]],
        ["c", ["b", "a"], 20],
      ]),
    ),
  );
});

test("fan-out routes nest without crossing the nearer branch", () => {
  const d = graph([
    ["source"],
    ["z_near", ["source"]],
    ["m_middle", ["source"]],
    ["a_far", ["source"]],
  ]);
  d.tables.forEach((t, i) => {
    t.x = i ? 430 : 80;
    t.y = i ? 80 + (i - 1) * 300 : 80;
  });
  const paths = [...checkRoutes(d).values()];
  assert.equal(countCrossings(paths), 0);
});

function countCrossings(paths) {
  let crossings = 0;
  for (const [i, p] of paths.entries())
    for (const q of paths.slice(i + 1)) {
      for (let j = 1; j < p.points.length; j++)
        for (let k = 1; k < q.points.length; k++) {
          const a = p.points[j - 1],
            b = p.points[j],
            c = q.points[k - 1],
            d = q.points[k];
          if ((a.x === b.x) === (c.x === d.x)) continue;
          const [v1, v2, h1, h2] = a.x === b.x ? [a, b, c, d] : [c, d, a, b];
          if (
            v1.x > Math.min(h1.x, h2.x) &&
            v1.x < Math.max(h1.x, h2.x) &&
            h1.y > Math.min(v1.y, v2.y) &&
            h1.y < Math.max(v1.y, v2.y)
          )
            crossings++;
        }
    }
  return crossings;
}

test("a reference skipping a short table reaches the FK without a final dogleg", () => {
  const d = tidyDiagram(
    graph([
      ["users", [], 1],
      ["live_streams", ["users"]],
      ["comments", ["live_streams", "users"], 2],
    ]),
  );
  const paths = checkRoutes(d);
  assert.equal(countCrossings([...paths.values()]), 0);
  const outgoing = d.edges
    .filter((e) => e.from.table === "users")
    .map((e) => paths.get(e.id));
  assert.equal(new Set(outgoing.map((p) => p.points[0].y)).size, 1);
  const edge = d.edges.find(
    (e) => e.from.table === "users" && e.to.table === "comments",
  );
  const ps = paths.get(edge.id).points;
  assert.equal(ps.length, 4, "only two bends are needed");
  assert.equal(ps.at(-2).y, ps.at(-1).y);
  assert.ok(
    ps.at(-1).x - ps.at(-2).x > 350,
    "approach the FK along a single long horizontal run",
  );
  assert.ok(
    sharedLength(outgoing[0], outgoing[1]) > 0,
    "the PK may share a stem",
  );
  assert.equal(
    outgoing[0].points[1].x,
    outgoing[1].points[1].x,
    "references to the same PK share the vertical stem across different columns",
  );
});

test("shared stems also work when the referenced table is on the right", () => {
  const d = tidyDiagram(
    graph([
      ["users", [], 1],
      ["live_streams", ["users"]],
      ["comments", ["live_streams", "users"], 2],
    ]),
  );
  for (const t of d.tables) t.x = 1400 - t.x - tableWidth(t);
  const paths = checkRoutes(d);
  const outgoing = d.edges
    .filter((e) => e.from.table === "users")
    .map((e) => paths.get(e.id));
  assert.ok(outgoing.every((p) => p.points.length === 4));
  assert.equal(outgoing[0].points[1].x, outgoing[1].points[1].x);
  assert.equal(countCrossings([...paths.values()]), 0);
});

test("an obstacle can split a shared stem while manual branches remain fixed", () => {
  const d = tidyDiagram(
    graph([
      ["users", [], 1],
      ["live_streams", ["users"]],
      ["comments", ["live_streams", "users"], 2],
    ]),
  );
  const near = d.edges.find(
    (e) => e.from.table === "users" && e.to.table === "live_streams",
  );
  const far = d.edges.find(
    (e) => e.from.table === "users" && e.to.table === "comments",
  );
  const initial = checkRoutes(d),
    trunk = initial.get(near.id).points[1].x;
  near.manual = true;
  near.trunk = trunk;
  const manual = route(near, d.tables);
  const obstacle = graph([["obstacle"]]).tables[0];
  obstacle.x = trunk - 15;
  obstacle.y = initial.get(near.id).points.at(-1).y + 12;
  d.tables.push(obstacle);
  const paths = checkRoutes(d);
  assert.notDeepEqual(paths.get(far.id).points, initial.get(far.id).points);
  assert.deepEqual(paths.get(near.id).points, manual.points);
  assert.deepEqual(
    [...paths].sort(),
    [...routeEdges([...d.edges].reverse(), [...d.tables].reverse())].sort(),
  );
});

function sharedLength(p, q) {
  let length = 0;
  for (let i = 1; i < p.points.length; i++)
    for (let j = 1; j < q.points.length; j++) {
      const a = p.points[i - 1],
        b = p.points[i],
        c = q.points[j - 1],
        d = q.points[j];
      if (a.x === b.x && c.x === d.x && a.x === c.x)
        length += Math.max(
          0,
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
            Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)),
        );
      if (a.y === b.y && c.y === d.y && a.y === c.y)
        length += Math.max(
          0,
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
            Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)),
        );
    }
  return length;
}

test("shared column ports remain deterministic after saving and reordering", () => {
  const d = tidyDiagram(
    graph([
      ["parent"],
      ["a", ["parent"]],
      ["b", ["parent"]],
      ["c", ["parent"]],
    ]),
  );
  const paths = checkRoutes(d);
  assert.equal(new Set([...paths.values()].map((p) => p.points[0].y)).size, 1);
  assert.equal(countCrossings([...paths.values()]), 0);
  assert.deepEqual(
    [...paths].sort(),
    [...routeEdges([...d.edges].reverse(), [...d.tables].reverse())].sort(),
  );
  const restored = decode(encode(d));
  assert.deepEqual(
    [...paths].sort(),
    [...routeEdges(restored.edges, restored.tables)].sort(),
  );
});

test("adding a table across a route recalculates the detour without moving existing tables", () => {
  const d = tidyDiagram(graph([["a"], ["b", ["a"]]]));
  d.tables[1].x = 800;
  const original = structuredClone(d.tables);
  const before = checkRoutes(d).get(d.edges[0].id).points;
  const obstacle = graph([["obstacle", [], 8]]).tables[0];
  obstacle.x = 440;
  obstacle.y = 80;
  d.tables.push(obstacle);
  const after = checkRoutes(d).get(d.edges[0].id).points;
  assert.notDeepEqual(after, before);
  assert.deepEqual(d.tables.slice(0, 2), original);
});

test("automatic endpoints follow a table moved across its parent; manual endpoints remain explicit", () => {
  const d = tidyDiagram(graph([["a"], ["b", ["a"]]]));
  const parent = d.tables.find((t) => t.id === "a"),
    child = d.tables.find((t) => t.id === "b");
  parent.x = 700;
  child.x = 80;
  const path = checkRoutes(d).get(d.edges[0].id);
  assert.equal(path.fromSide, "left");
  assert.equal(path.toSide, "right");
  d.edges[0].manual = true;
  const manual = checkRoutes(d).get(d.edges[0].id);
  assert.equal(manual.fromSide, d.edges[0].from.side);
  assert.equal(manual.toSide, d.edges[0].to.side);
});

test("eight references to the same column share a trunk without folding back or crossing", () => {
  const d = tidyDiagram(
    graph([
      ["Users", [], 2],
      ...[
        "Comments",
        "Likes",
        "Posts",
        "Sessions",
        "Profiles",
        "Uploads",
        "Messages",
        "Events",
      ].map((n, i) => [n, ["Users"], i % 4]),
    ]),
  );
  const paths = checkRoutes(d);
  assert.equal(countCrossings([...paths.values()]), 0);
  assert.ok(
    [...paths.values()].every((p) => p.points.length === 4),
    "each branch needs only two bends",
  );
  assert.equal(
    new Set([...paths.values()].map((p) => p.points[1].x)).size,
    1,
    "one shared trunk",
  );
  assert.deepEqual(
    [...paths].sort(),
    [...routeEdges([...d.edges].reverse(), [...d.tables].reverse())].sort(),
  );
});

test("cycles choose both sides while keeping unrelated column connections separate", () => {
  const d = tidyDiagram(
    graph([
      ["A", ["C"], 2],
      ["B", ["A"], 1],
      ["C", ["B"], 3],
      ["D", ["D", "A"], 2],
    ]),
  );
  const routes = checkRoutes(d);
  assert.ok(countCrossings([...routes.values()]) <= 1);
  assert.ok(
    [...routes.values()].some(
      (r) => r.fromSide === "left" || r.toSide === "left",
    ),
  );
  const endpoints = (e) => {
    const r = routes.get(e.id);
    return [
      [e.from.table, e.from.row, r.fromSide].join(":"),
      [e.to.table, e.to.row, r.toSide].join(":"),
    ];
  };
  for (const [i, a] of d.edges.entries())
    for (const b of d.edges.slice(i + 1))
      if (!endpoints(a).some((p) => endpoints(b).includes(p)))
        assert.equal(
          sharedLength(routes.get(a.id), routes.get(b.id)),
          0,
          `${a.id} and ${b.id} must remain distinct`,
        );
  for (const r of routes.values())
    for (const [a, b] of [
      [r.points[0], r.points[1]],
      [r.points.at(-1), r.points.at(-2)],
    ]) {
      assert.equal(a.y, b.y);
      assert.ok(Math.abs(a.x - b.x) >= 28, "room for cardinality marks");
    }
});
