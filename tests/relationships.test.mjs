import { test } from "node:test";
import assert from "node:assert/strict";
import { graph, branching } from "./layout-fixtures.mjs";
import { childMaximum, relationshipLabels } from "../src/relationships.ts";
import { tidyDiagram } from "../src/layout.ts";
import { routeEdges, height, tableWidth } from "../src/geometry.ts";
import { encode, decode, validateDiagram } from "../src/model.ts";

test("cardinality infers maxima from uniqueness, never a regular index or guessed minima", () => {
  const d = graph([["parent"], ["child", ["parent"], 1]]),
    t = d.tables[1],
    f = t.foreignKeys[0];
  assert.equal(childMaximum(t, f), "many");
  t.keys.push({
    id: "extra",
    name: "",
    kind: "index",
    columnIds: [...f.columnIds],
  });
  assert.equal(childMaximum(t, f), "many");
  t.keys.at(-1).kind = "unique";
  assert.equal(childMaximum(t, f), "one");
  t.keys.at(-1).columnIds.push("child-extra-0");
  assert.equal(
    childMaximum(t, f),
    "many",
    "a wider unique key does not make its FK subset unique",
  );
  f.columnIds.push("child-extra-0");
  assert.equal(childMaximum(t, f), "one");
});

test("labels and explicit minimum cardinalities roundtrip; old files retain unknown minima", () => {
  const d = graph([["parent"], ["child", ["parent"]]]),
    f = d.tables[1].foreignKeys[0];
  const old = decode(encode(d)).tables[1].foreignKeys[0];
  assert.equal(old.label, undefined);
  assert.equal(old.cardinality, undefined);
  f.label = " 所有する ";
  f.cardinality = { parentMinimum: 1, childMinimum: 0 };
  const restored = decode(encode(d)).tables[1].foreignKeys[0];
  assert.equal(restored.label, "所有する");
  assert.deepEqual(restored.cardinality, { parentMinimum: 1, childMinimum: 0 });
  for (const invalid of [
    { parentMinimum: 2 },
    { parentMinimum: null },
    { parentMinimum: "1" },
    { childMinimum: -1 },
    { maximum: "many" },
    null,
    [],
  ]) {
    const bad = structuredClone(d);
    bad.tables[1].foreignKeys[0].cardinality = invalid;
    assert.throws(() => validateDiagram(bad));
  }
  f.label = "あ".repeat(81);
  assert.throws(() => validateDiagram(d));
});

const overlaps = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
function verifyLabels(input) {
  const d = tidyDiagram(input),
    labels = [...relationshipLabels(d, routeEdges(d.edges, d.tables)).values()];
  assert.equal(
    labels.length,
    d.tables.flatMap((t) => t.foreignKeys).filter((f) => f.label).length,
  );
  for (const [i, label] of labels.entries()) {
    for (const t of d.tables)
      assert.ok(
        !overlaps(label, { ...t, width: tableWidth(t), height: height(t) }),
        `label intersects ${t.id}`,
      );
    for (const other of labels.slice(i + 1))
      assert.ok(!overlaps(label, other), "labels must stay separate");
  }
  assert.deepEqual(tidyDiagram(d), d);
  return { d, labels };
}
test("tidy leaves readable space for labels on short, long and branching relationships", () => {
  const d = graph([
    ["users", [], 1],
    ["streams", ["users"]],
    ["comments", ["users", "streams"], 2],
  ]);
  for (const t of d.tables)
    for (const f of t.foreignKeys) f.label = "コメントを投稿する";
  verifyLabels(d);
  const b = branching();
  for (const t of b.tables) for (const f of t.foreignKeys) f.label = "関連する";
  verifyLabels(b);
  d.tables[1].foreignKeys[0].label = "あ".repeat(80);
  const { labels } = verifyLabels(d);
  assert.ok(labels.some((l) => l.lines.length > 1));
});

test("a composite FK has one label for all its column connections", () => {
  const d = graph([
      ["a", [], 1],
      ["b", ["a"], 1],
    ]),
    [a, b] = d.tables;
  a.keys[0].columnIds.push("a-extra-0");
  b.foreignKeys[0].columnIds.push("b-extra-0");
  b.foreignKeys[0].target.columnIds.push("a-extra-0");
  b.foreignKeys[0].label = "関連する";
  const { d: tidied, labels } = verifyLabels(d);
  assert.equal(tidied.edges.length, 2);
  assert.equal(labels.length, 1);
});
