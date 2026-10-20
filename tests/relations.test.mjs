import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDiagram,
  migrateLegacyDiagram,
  encode,
  decode,
  editTable,
  removeForeignKey,
  makeEdge,
} from "../src/model.ts";
import { tidyDiagram } from "../src/layout.ts";
import { route, height, tableWidth } from "../src/geometry.ts";
function fixture() {
  return validateDiagram({
    schemaVersion: 2,
    edges: [],
    tables: [
      {
        id: "parent",
        name: "parents",
        x: 0,
        y: 0,
        columns: [
          { name: "tenant", type: "uuid", key: "", id: "p1" },
          { name: "id", type: "uuid", key: "", id: "p2" },
        ],
        keys: [
          {
            id: "pk",
            name: "parent_pk",
            kind: "primary",
            columnIds: ["p1", "p2"],
          },
        ],
        foreignKeys: [],
      },
      {
        id: "child",
        name: "children",
        x: 500,
        y: 300,
        columns: [
          { name: "tenant", type: "uuid", key: "", id: "c1" },
          { name: "parent", type: "uuid", key: "", id: "c2" },
        ],
        keys: [
          { id: "idx", name: "lookup", kind: "index", columnIds: ["c2", "c1"] },
        ],
        foreignKeys: [
          {
            id: "fk",
            name: "parent_fk",
            columnIds: ["c1", "c2"],
            target: { tableId: "parent", columnIds: ["p1", "p2"] },
          },
        ],
      },
    ],
  });
}
test("composite FK owns all lines and survives rename, reorder, round trip and group deletion", () => {
  const d = fixture();
  assert.equal(d.edges.length, 2);
  assert.ok(d.edges.every((e) => e.foreignKeyId === "fk"));
  const t = structuredClone(d.tables[1]);
  t.name = "renamed";
  t.columns.reverse();
  t.columns[0].name = "new_name";
  const edited = decode(encode(editTable(d, t)));
  assert.deepEqual(edited.tables[1].foreignKeys[0].columnIds, ["c1", "c2"]);
  assert.deepEqual(
    edited.edges.map((e) => e.to.row),
    [1, 0],
  );
  assert.deepEqual(edited.tables[1].keys[0].columnIds, ["c2", "c1"]);
  const removed = removeForeignKey(edited, "fk");
  assert.equal(removed.edges.length, 0);
  assert.ok(removed.tables[1].columns.every((c) => c.key === ""));
  assert.equal(edited.edges.length, 2);
});
test("version 2 persistence separates definitions from presentation", () => {
  const d = fixture();
  d.edges[0].manual = true;
  d.edges[0].trunk = 390;
  const file = JSON.parse(encode(d));
  assert.equal(file.version, 2);
  assert.ok(!("x" in file.schema.tables[0]));
  assert.ok(!("key" in file.schema.tables[0].columns[0]));
  assert.equal(file.presentation.routes[0].foreignKeyId, "fk");
  assert.deepEqual(decode(JSON.stringify(file)), d);
});
test("FK rejects partial keys, wrong order, missing IDs and duplicate columns; unique target works", () => {
  for (const cols of [["p1"], ["p2", "p1"], ["missing", "p2"], ["p1", "p1"]]) {
    const d = fixture();
    d.tables[1].foreignKeys[0].target.columnIds = cols;
    assert.throws(() => validateDiagram(d));
  }
  const d = fixture();
  d.tables[0].keys[0].kind = "unique";
  assert.equal(validateDiagram(d).edges.length, 2);
});
test("deleting a target column retains the dependent FK without mutating input", () => {
  const d = fixture(),
    before = structuredClone(d),
    t = structuredClone(d.tables[0]);
  t.columns.pop();
  const after = editTable(d, t);
  assert.equal(after.edges.length, 0);
  assert.equal(after.tables[1].foreignKeys.length, 1);
  assert.equal(after.tables[1].foreignKeys[0].target, undefined);
  assert.deepEqual(d, before);
});
test("legacy ambiguous links remain unresolved and unresolved FK flags survive saving", () => {
  const old = {
    tables: ["a", "b"].map((id) => ({
      id,
      x: 0,
      y: 0,
      columns: [["id", "uuid", "PK,FK"]],
    })),
    edges: [
      {
        id: "legacy",
        from: { table: "a", row: 0, side: "left" },
        to: { table: "b", row: 0, side: "right" },
        trunk: 200,
        manual: true,
      },
    ],
  };
  const migrated = decode(
    JSON.stringify({ format: "er-sketch", version: 1, diagram: old }),
  );
  assert.equal(migrated.edges.length, 0);
  assert.equal(migrated.unresolvedEdges.length, 1);
  assert.ok(
    migrated.tables.every(
      (t) => t.foreignKeys.length === 1 && !t.foreignKeys[0].target,
    ),
  );
  assert.deepEqual(decode(encode(migrated)), migrated);
});
test("legacy reversed definite connection keeps routing and direction", () => {
  const old = {
    tables: [
      { id: "p", x: 0, y: 0, columns: [["id", "uuid", "PK"]] },
      { id: "c", x: 500, y: 0, columns: [["pid", "uuid", "FK"]] },
    ],
    edges: [
      {
        id: "e",
        from: { table: "c", row: 0, side: "left" },
        to: { table: "p", row: 0, side: "right" },
        trunk: 380,
        manual: true,
      },
    ],
  };
  const d = migrateLegacyDiagram(old);
  assert.equal(d.edges[0].from.table, "p");
  assert.equal(d.edges[0].trunk, 380);
  assert.equal(d.edges[0].to.side, "left");
});
test("layout is independent of coordinates, order and viewport; chain top edges align and forks share rank", () => {
  const d = fixture();
  d.tables.push({
    id: "sibling",
    name: "sibling",
    x: -200,
    y: 900,
    columns: [
      { name: "a", type: "uuid", key: "", id: "s1" },
      { name: "b", type: "uuid", key: "", id: "s2" },
    ],
    keys: [],
    foreignKeys: [
      {
        id: "sfk",
        name: "",
        columnIds: ["s1", "s2"],
        target: { tableId: "parent", columnIds: ["p1", "p2"] },
      },
    ],
  });
  const a = tidyDiagram(d),
    shuffled = structuredClone(d);
  shuffled.tables.reverse();
  shuffled.tables.forEach((t) => {
    t.x = 99;
    t.y = -420;
  });
  const b = tidyDiagram(shuffled, 0.2);
  const positions = (d) => d.tables.map((t) => [t.id, t.x, t.y]).sort();
  assert.deepEqual(positions(a), positions(b));
  const [p, c, s] = a.tables;
  assert.ok(p.x < c.x);
  assert.equal(p.y, c.y);
  assert.equal(c.x, s.x);
  assert.ok(s.y >= c.y + height(c) + 96);
  assert.deepEqual(tidyDiagram(a), a);
});
test("cycles and self references are deterministic, nonoverlapping and routable", () => {
  const d = fixture();
  d.tables[1].keys = [
    { id: "cpk", name: "", kind: "primary", columnIds: ["c1", "c2"] },
  ];
  d.tables[0].foreignKeys = [
    {
      id: "reverse",
      name: "",
      columnIds: ["p1", "p2"],
      target: { tableId: "child", columnIds: ["c1", "c2"] },
    },
    {
      id: "self",
      name: "",
      columnIds: ["p1", "p2"],
      target: { tableId: "parent", columnIds: ["p1", "p2"] },
    },
  ];
  const placed = tidyDiagram(d);
  const [a, b] = placed.tables;
  assert.equal(a.x, b.x);
  assert.ok(a.y + height(a) + 96 <= b.y || b.y + height(b) + 96 <= a.y);
  assert.ok(placed.edges.every((e) => !route(e, placed.tables).blocked));
  assert.deepEqual(tidyDiagram(placed), placed);
});
test("incomplete new definitions are rejected instead of silently discarded by table editing", () => {
  const d = fixture(),
    t = structuredClone(d.tables[1]);
  t.keys.push({ id: "new", name: "", kind: "unique", columnIds: [""] });
  assert.throws(() => editTable(d, t), /存在しない/);
  t.keys.pop();
  t.foreignKeys.push({ id: "new", name: "", columnIds: [] });
  assert.throws(() => editTable(d, t), /空/);
});

test("key removal retains incoming FK; source removal deletes it; normalization is idempotent", () => {
  const d = fixture();
  const parent = structuredClone(d.tables[0]);
  parent.keys = [];
  const pending = editTable(d, parent);
  assert.equal(pending.tables[1].foreignKeys[0].target, undefined);
  assert.deepEqual(validateDiagram(pending), pending);
  assert.deepEqual(decode(encode(pending)), pending);
  const child = structuredClone(d.tables[1]);
  child.columns.pop();
  const removed = editTable(d, child);
  assert.equal(removed.tables[1].foreignKeys.length, 0);
});

test("retargeting an FK resets manual routing while reordering columns preserves it", () => {
  const d = fixture();
  d.edges.forEach((e) => {
    e.manual = true;
    e.trunk = 350;
  });
  const child = structuredClone(d.tables[1]);
  child.columns.reverse();
  assert.ok(
    editTable(d, child).edges.every((e) => e.manual && e.trunk === 350),
  );
  const other = structuredClone(d.tables[0]);
  other.id = "other";
  other.name = "other";
  other.keys[0].id = "other-pk";
  d.tables.push(other);
  child.foreignKeys[0].target.tableId = "other";
  assert.ok(
    editTable(d, child).edges.every((e) => !e.manual && e.trunk === null),
  );
});

test("deleting a self-reference target keeps its source definition pending", () => {
  const d = fixture();
  const t = d.tables[0];
  t.columns.push(
    { name: "parent_tenant", type: "uuid", key: "", id: "ref1" },
    { name: "parent_id", type: "uuid", key: "", id: "ref2" },
  );
  t.foreignKeys.push({
    id: "self",
    name: "",
    columnIds: ["ref1", "ref2"],
    target: { tableId: t.id, columnIds: ["p1", "p2"] },
  });
  const valid = validateDiagram(d);
  const replacement = structuredClone(valid.tables[0]);
  replacement.columns = replacement.columns.filter((c) => c.id !== "p2");
  const after = editTable(valid, replacement);
  assert.equal(after.tables[0].foreignKeys[0].target, undefined);
  assert.deepEqual(after.tables[0].foreignKeys[0].columnIds, ["ref1", "ref2"]);
});

test("all example documents have stable v2 round trips and derived edge counts", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  for (const file of await readdir(new URL("../examples/", import.meta.url))) {
    if (!file.endsWith(".json")) continue;
    const d = decode(
      await readFile(new URL(`../examples/${file}`, import.meta.url), "utf8"),
    );
    assert.equal(encode(decode(encode(d))), encode(d), file);
    assert.deepEqual(validateDiagram(d), d, file);
    assert.equal(
      d.edges.length,
      d.tables
        .flatMap((t) => t.foreignKeys)
        .filter((f) => f.target)
        .reduce((n, f) => n + f.columnIds.length, 0),
      file,
    );
  }
});

test("explicit foreign keys are never migrated twice when the version marker is omitted", () => {
  const d = fixture();
  delete d.schemaVersion;
  const normalized = validateDiagram(d);
  assert.equal(normalized.tables[1].foreignKeys.length, 1);
  assert.equal(normalized.edges.length, 2);
  assert.deepEqual(validateDiagram(normalized), normalized);
});

test("reconnecting a pending FK retains its ID, label, name and cardinality", () => {
  const d = fixture();
  d.tables[0].keys[0].columnIds = ["p1"];
  const fk = d.tables[1].foreignKeys[0];
  fk.columnIds = ["c1"];
  delete fk.target;
  fk.label = "所属";
  fk.cardinality = { parentMinimum: 1, childMinimum: 0 };
  const next = validateDiagram(d);
  const edge = makeEdge(
    next,
    { table: "parent", row: 0 },
    { table: "child", row: 0 },
  );
  assert.equal(edge.foreignKeyId, "fk");
  assert.equal(next.tables[1].foreignKeys.length, 1);
  assert.equal(next.tables[1].foreignKeys[0].name, "parent_fk");
  assert.equal(next.tables[1].foreignKeys[0].label, "所属");
  assert.deepEqual(next.tables[1].foreignKeys[0].cardinality, fk.cardinality);
});
