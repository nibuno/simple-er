import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EdgeRouteCache, routeEdges, clear } from "../src/geometry.ts";
import { detour } from "../src/detour.ts";
import { graph } from "./layout-fixtures.mjs";

// Geometry from the ER-H1 fixture: x, y and the parent tables for FK rows 1..4.
const layout = [
  [80, 80, []],
  [430, 80, [0]],
  [780, 80, [0, 1]],
  [780, 694, [0, 1, 1]],
  [1130, 694, [3, 3, 1, 0]],
  [1130, 1308, [3, 0, 3, 3]],
  [1480, 1922, [4, 0, 5, 3]],
  [1830, 1922, [2, 5, 6, 1]],
  [1480, 1308, [1, 5, 0, 0]],
  [1830, 3150, [0, 8, 0, 6]],
  [1830, 2536, [3, 6, 0, 8]],
  [2180, 1922, [3, 7, 7, 8]],
  [2180, 2536, [3, 5, 3, 10]],
  [2530, 2536, [3, 12, 7, 4]],
  [2880, 3764, [0, 6, 13, 8]],
  [3230, 4992, [14, 10, 1, 2]],
  [2880, 3150, [9, 3, 10, 13]],
  [3230, 5606, [16, 6, 9, 9]],
  [3580, 5606, [15, 16, 12, 1]],
  [3580, 4992, [15, 7, 12, 13]],
  [3580, 6220, [5, 11, 17, 11]],
  [3230, 6220, [2, 14, 16, 3]],
  [3230, 4378, [5, 16, 12, 11]],
  [3580, 6834, [15, 0, 15, 1]],
  [3930, 5606, [9, 22, 19, 18]],
  [3930, 6220, [18, 12, 20, 5]],
  [3230, 3150, [5, 16, 7, 0]],
  [4280, 5606, [24, 6, 17, 17]],
  [3230, 3764, [7, 12, 16, 11]],
  [4630, 6220, [27, 18, 11, 14]],
  [4980, 6220, [29, 8, 21, 17]],
  [5330, 6834, [19, 30, 23, 0]],
  [4630, 5606, [24, 8, 13, 27]],
  [5330, 7448, [3, 30, 23, 12]],
  [5680, 6834, [32, 26, 31, 22]],
  [6030, 6834, [26, 22, 0, 34]],
  [6030, 7448, [34, 21, 29, 1]],
  [6380, 7448, [14, 11, 35, 11]],
  [6380, 6834, [5, 35, 16, 2]],
  [3580, 3764, [4, 5, 1, 28]],
];
function largeDiagram() {
  const d = graph(layout.map((_, i) => [`t${i}`, [], 11]));
  layout.forEach(([x, y, parents], i) => {
    const table = d.tables[i];
    table.x = x;
    table.y = y;
    parents.forEach((parent, k) =>
      d.edges.push({
        id: `t${i}_fk${k}:0`,
        from: { table: `t${parent}`, row: 0, side: "right" },
        to: { table: table.id, row: k + 1, side: "left" },
        manual: false,
        trunk: null,
      }),
    );
  });
  return d;
}

test("all 150 routes in the tidy diagram match the pre-optimization router, before and after a drag", () => {
  const d = largeDiagram();
  // SHA-256 of all ordered IDs, path vertices, sides and handles from 8fe1353.
  function check(expected) {
    const paths = routeEdges(d.edges, d.tables);
    assert.equal(paths.size, 150);
    assert.equal(
      createHash("sha256")
        .update(JSON.stringify([...paths]))
        .digest("hex"),
      expected,
    );
  }
  check("5148a440be897fed76923b3e66f627a24005778d0da6d44fffe89cdafe5079ac");
  d.tables[33].y += 80;
  check("4313fb418a21c167d6369ca2061603e0b25aae2aa721e041f1e30241004107d4");
});

test("a table drag reuses unrelated paths, and committing rechecks every obstacle", () => {
  const d = graph([["a"], ["b", ["a"]], ["c"], ["d", ["c"]]]);
  d.tables.forEach((t, i) => {
    t.x = [0, 1100, 450, 1100][i];
    t.y = i < 2 ? 0 : 400;
  });
  const cache = new EdgeRouteCache();
  const exact = () => routeEdges(d.edges, d.tables, { cache });
  const original = exact();
  const [ab, cd] = d.edges.map((e) => e.id);
  d.tables[2].y = 0;
  const preview = routeEdges(d.edges, d.tables, {
    preview: { tableId: "c", routes: original },
  });
  assert.equal(preview.get(ab), original.get(ab));
  assert.notDeepEqual(preview.get(cd).points, original.get(cd).points);
  const committed = exact();
  assert.deepEqual(committed, routeEdges(d.edges, d.tables));
  assert.notDeepEqual(committed.get(ab).points, preview.get(ab).points);
  d.tables[2].y = 400;
  const undo = exact();
  for (const [id, path] of original) assert.equal(undo.get(id), path);
});

test("within a layout, a changed port or trunk invalidates the following reservations", () => {
  const d = graph([["a"], ["b", ["a"]], ["c", ["a"]]]);
  d.tables.forEach((t, i) => {
    t.x = i ? 600 : 0;
    t.y = i === 2 ? 320 : 0;
  });
  const cache = new EdgeRouteCache();
  const exact = () => routeEdges(d.edges, d.tables, { cache });
  const first = exact();
  const second = exact();
  for (const [id, path] of first) assert.equal(second.get(id), path);
  const edge = d.edges[0];
  edge.manual = true;
  edge.trunk = 470;
  for (const side of ["right", "left"]) {
    edge.from.side = side;
    assert.deepEqual(exact(), routeEdges(d.edges, d.tables));
  }
});

test("an exhausted detour search still connects the ports around a table", () => {
  // Two directions per grid point exceed the detailed search budget.
  const coords = Array.from({ length: 240 }, (_, i) => i);
  const obstacle = { l: 90, r: 150, t: 90, b: 150 };
  const points = detour(
    coords,
    coords,
    { x: 0, y: 0, side: "right" },
    { x: 239, y: 239, side: "left" },
    120,
    { hard: [obstacle], preferred: [obstacle], occupied: [] },
  );
  assert.deepEqual(points[0], { x: 0, y: 0 });
  assert.deepEqual(points.at(-1), { x: 239, y: 239 });
  assert.ok(points.length < 10, "used the boundary grid");
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    assert.ok(a.x === b.x || a.y === b.y);
    assert.ok(clear(a, b, [obstacle]));
  }
});
