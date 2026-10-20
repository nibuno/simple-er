import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyDiagram } from "../src/layout.ts";
import { validateDiagram, encode, decode } from "../src/model.ts";
import { tableWidth, height } from "../src/geometry.ts";
import { graph, branching } from "./layout-fixtures.mjs";
function fixture(n = 8) {
  return validateDiagram({
    tables: Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      name: `table_${i}`,
      x: (i % 3) * 37,
      y: Math.floor(i / 3) * 23,
      columns: Array.from({ length: (i % 5) + 1 }, (_, j) => ({
        name: `column_${j}`,
        type: "uuid",
        key: j ? "FK" : "PK",
      })),
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
test("tidy preserves data, relationships, resets routing and the input snapshot for undo", () => {
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
  assert.equal(after.edges[0].manual, false);
  assert.equal(after.edges[0].id, before.edges[0].id);
});
test("tidy handles empty and single-table diagrams", () => {
  assert.deepEqual(tidyDiagram(fixture(0)), fixture(0));
  assert.equal(tidyDiagram(fixture(1)).tables.length, 1);
});

test("branches follow their parents instead of crossing in ID order", () => {
  const d = tidyDiagram(
    graph([
      ["root"],
      ["a", ["root"], 6],
      ["b", ["root"]],
      ["c", ["b"]],
      ["d", ["a"]],
      ["join", ["c", "d"]],
    ]),
  );
  const t = Object.fromEntries(d.tables.map((t) => [t.id, t]));
  assert.ok(
    (t.a.y - t.b.y) * (t.d.y - t.c.y) > 0,
    "two branches must not swap vertical order",
  );
  assert.equal(t.a.y, t.d.y);
  assert.equal(t.b.y, t.c.y, "the lower branch stays beside its own parent");
  assert.ok(t.b.y >= t.a.y + height(t.a) + 96);
});

test("chains stay top aligned regardless of table heights", () => {
  const d = tidyDiagram(
    graph([
      ["a", [], 8],
      ["b", ["a"]],
      ["c", ["b"], 20],
    ]),
  );
  assert.equal(new Set(d.tables.map((t) => t.y)).size, 1);
  assert.ok(d.tables[0].x < d.tables[1].x && d.tables[1].x < d.tables[2].x);
});

test("independent tables are packed into shelves, independent of viewport", () => {
  const input = graph(Array.from({ length: 12 }, (_, i) => [`table_${i}`]));
  const d = tidyDiagram(input);
  assert.ok(new Set(d.tables.map((t) => t.x)).size > 1);
  assert.ok(Math.max(...d.tables.map((t) => t.y + height(t))) < 1000);
  assert.deepEqual(d, tidyDiagram(input, 0.2));
});

test("branching, long references and independent groups stay stable after save and reordering", () => {
  const input = branching(),
    d = tidyDiagram(input);
  const shuffled = structuredClone(input);
  shuffled.tables.reverse().forEach((t) => {
    t.foreignKeys.reverse();
    t.x = -500;
    t.y = 999;
  });
  const positions = (d) => d.tables.map((t) => [t.id, t.x, t.y]).sort();
  assert.deepEqual(positions(d), positions(tidyDiagram(shuffled)));
  assert.deepEqual(tidyDiagram(decode(encode(d))), d);
  const connectedBottom = Math.max(
    ...d.tables
      .filter((t) => !["settings", "audit_events"].includes(t.id))
      .map((t) => t.y + height(t)),
  );
  assert.ok(
    d.tables
      .filter((t) => ["settings", "audit_events"].includes(t.id))
      .every((t) => t.y + height(t) <= connectedBottom),
    "independent tables should use empty space instead of making this diagram taller",
  );
  for (const [i, a] of d.tables.entries())
    for (const b of d.tables.slice(i + 1))
      assert.ok(
        a.x + tableWidth(a) + 44 <= b.x ||
          b.x + tableWidth(b) + 44 <= a.x ||
          a.y + height(a) + 44 <= b.y ||
          b.y + height(b) + 44 <= a.y,
      );
});

test("a continuing branch leads the layout before a terminal table", () => {
  const d = tidyDiagram(
    graph([
      ["root"],
      ["a_leaf", ["root"]],
      ["z_branch", ["root"]],
      ["tail", ["z_branch"]],
    ]),
  );
  const t = Object.fromEntries(d.tables.map((t) => [t.id, t]));
  assert.equal(t.root.y, t.z_branch.y);
  assert.equal(t.z_branch.y, t.tail.y);
  assert.ok(t.a_leaf.y > t.z_branch.y);
});

test("a join never pulls the flow upward from one of its parents", () => {
  const d = tidyDiagram(branching());
  const ts = new Map(d.tables.map((t) => [t.id, t]));
  for (const t of d.tables)
    for (const fk of t.foreignKeys ?? [])
      if (fk.target) {
        const p = ts.get(fk.target.tableId);
        assert.ok(t.x > p.x, `${p.name} → ${t.name} flows right`);
        assert.ok(t.y >= p.y, `${p.name} → ${t.name} does not flow upward`);
      }
});

test("independent tables use the same column grid as the connected flow", () => {
  const d = tidyDiagram(branching());
  const connected = d.tables.filter(
    (t) => !["audit_events", "settings"].includes(t.id),
  );
  for (const t of d.tables.filter((t) =>
    ["audit_events", "settings"].includes(t.id),
  ))
    assert.ok(
      connected.some((c) => c.x === t.x),
      `${t.id} aligns with a table column`,
    );
});
