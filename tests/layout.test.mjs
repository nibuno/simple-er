import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyDiagram } from "../src/layout.ts";
import { validateDiagram, encode, decode } from "../src/model.ts";
import { tableWidth, height } from "../src/geometry.ts";
function fixture(n = 8) {
  return validateDiagram({
    tables: Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      name: `table_${i}`,
      x: (i % 3) * 37,
      y: Math.floor(i / 3) * 23,
      columns: Array.from({ length: (i % 5) + 1 }, (_, j) => [
        `column_${j}`,
        "uuid",
        j ? "FK" : "PK",
      ]),
    })),
    edges:
      n > 1
        ? [
            {
              id: "edge",
              from: { table: "t0", row: 0, side: "right" },
              to: { table: "t1", row: 1, side: "left" },
              manual: true,
              trunk: 150,
            },
          ]
        : [],
  });
}
test("tidy avoids overlaps for variable table sizes and narrow/wide canvases", () => {
  for (const aspect of [0.5, 1.5, 2]) {
    const result = tidyDiagram(fixture(40), aspect);
    for (const [i, a] of result.tables.entries())
      for (const b of result.tables.slice(i + 1)) {
        assert.ok(
          a.x + tableWidth(a) + 44 <= b.x ||
            b.x + tableWidth(b) + 44 <= a.x ||
            a.y + height(a) + 44 <= b.y ||
            b.y + height(b) + 44 <= a.y,
        );
      }
    assert.deepEqual(decode(encode(result)), result);
    assert.deepEqual(tidyDiagram(result, aspect), result);
  }
});
test("tidy preserves data, relationships, manual routing and the input snapshot for undo", () => {
  const before = fixture(),
    snapshot = structuredClone(before),
    after = tidyDiagram(before);
  assert.deepEqual(before, snapshot);
  for (let i = 0; i < before.tables.length; i++) {
    const { x, y, ...data } = before.tables[i],
      { x: ax, y: ay, ...newData } = after.tables[i];
    assert.deepEqual(newData, data);
  }
  assert.deepEqual(after.edges[0].from, before.edges[0].from);
  assert.deepEqual(after.edges[0].to, before.edges[0].to);
  assert.equal(after.edges[0].manual, true);
  assert.equal(after.edges[0].id, before.edges[0].id);
});
test("tidy handles empty and single-table diagrams", () => {
  assert.deepEqual(tidyDiagram(fixture(0)), fixture(0));
  assert.equal(tidyDiagram(fixture(1)).tables.length, 1);
});
