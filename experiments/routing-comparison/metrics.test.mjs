import test from "node:test";
import assert from "node:assert/strict";
import { measure } from "./metrics.mjs";
const table = (id, x, y) => ({
  id,
  name: id,
  x,
  y,
  columns: [["id", "uuid", "PK", id + "-pk"]],
  keys: [],
  foreignKeys: [],
});
const edge = (id, from, to) => ({
  id,
  from: { table: from, row: 0, side: "right" },
  to: { table: to, row: 0, side: "left" },
});
const route = (points) => ({
  fromSide: "right",
  toSide: "left",
  points: points.map(([x, y]) => ({ x, y })),
});
test("counts one transverse crossing, no table penetration or port error", () => {
  const diagram = {
    tables: [
      table("a", 0, 0),
      table("b", 500, 100),
      table("c", 0, 200),
      table("d", 500, -100),
    ],
    edges: [edge("ab", "a", "b"), edge("cd", "c", "d")],
  };
  const routes = new Map([
    [
      "ab",
      route([
        [230, 71],
        [365, 71],
        [365, 171],
        [500, 171],
      ]),
    ],
    [
      "cd",
      route([
        [230, 271],
        [430, 271],
        [430, -29],
        [500, -29],
      ]),
    ],
  ]);
  const m = measure({ diagram, routes });
  assert.equal(m.crossings, 1);
  assert.equal(m.bends, 4);
  assert.equal(m.unrelatedOverlapPairs, 0);
  assert.equal(m.penetrations, 0);
  assert.equal(m.endpointErrors, 0);
});
test("distinguishes a shared source stem from unrelated overlapping lines", () => {
  const diagram = {
    tables: [
      table("a", 0, 0),
      table("b", 500, 100),
      table("c", 0, 200),
      table("d", 500, 200),
    ],
    edges: [edge("ab", "a", "b"), edge("ad", "a", "d")],
  };
  const routes = new Map([
    [
      "ab",
      route([
        [230, 71],
        [365, 71],
        [365, 171],
        [500, 171],
      ]),
    ],
    [
      "ad",
      route([
        [230, 71],
        [365, 71],
        [365, 271],
        [500, 271],
      ]),
    ],
  ]);
  const m = measure({ diagram, routes });
  assert.equal(m.crossings, 0);
  assert.equal(m.unrelatedOverlapPairs, 0);
  assert.equal(m.sharedLength, 235);
  diagram.edges[1].from.table = "c";
  routes.set(
    "ad",
    route([
      [230, 271],
      [365, 271],
      [365, 120],
      [450, 120],
      [450, 271],
      [500, 271],
    ]),
  );
  const n = measure({ diagram, routes });
  assert.equal(n.unrelatedOverlapPairs, 1);
  assert.equal(n.unrelatedOverlapLength, 51);
});
