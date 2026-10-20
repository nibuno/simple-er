import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { initial } from "../src/initial.ts";
import {
  documentFromDiagram,
  projectDocument,
  decodeDocument,
  encodeDocument,
  editTable,
  makeEdge,
} from "../src/model.ts";
import { historyReducer } from "../src/history.ts";

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test("canonical documents contain only definitions, presentation and legacy issues", () => {
  const doc = documentFromDiagram(initial);
  assert.equal(doc.version, 2);
  assert.ok(!("tables" in doc) && !("edges" in doc));
  for (const t of doc.schema.tables) {
    assert.ok(!("x" in t) && !("y" in t));
    for (const c of t.columns) {
      assert.deepEqual(Object.keys(c).sort(), [
        "id",
        "logicalName",
        "name",
        "type",
      ]);
      assert.equal(Array.isArray(c), false);
    }
  }
  for (const p of doc.presentation.tables)
    assert.deepEqual(Object.keys(p).sort(), ["tableId", "x", "y"]);
  for (const r of doc.presentation.routes)
    assert.ok(!("row" in r) && !("id" in r));
  assert.deepEqual(projectDocument(doc), initial);
});

test("projection does not mutate or alias canonical schema, constraints, positions or issues", () => {
  const doc = documentFromDiagram(initial);
  doc.unresolvedEdges.push({
    id: "old",
    from: { table: "gone", row: 0, side: "left" },
    to: { table: "users", row: 2, side: "right" },
    trunk: 100,
    manual: true,
  });
  const before = encodeDocument(doc);
  deepFreeze(doc);
  const rendered = projectDocument(doc);
  rendered.tables[0].columns[0].name = "renamed";
  rendered.tables[0].keys[0].columnIds.push("other");
  rendered.tables[1].foreignKeys[0].label = "changed";
  rendered.tables[0].x += 10;
  rendered.edges[0].trunk = 999;
  rendered.unresolvedEdges[0].from.row = 4;
  assert.equal(encodeDocument(doc), before);
});

test("canonical round trips are byte-stable and no-op commits preserve redo history", async () => {
  const docs = [documentFromDiagram(initial)];
  for (const file of await readdir(new URL("../examples/", import.meta.url))) {
    if (file.endsWith(".json"))
      docs.push(
        decodeDocument(
          await readFile(
            new URL(`../examples/${file}`, import.meta.url),
            "utf8",
          ),
        ),
      );
  }
  for (const doc of docs) {
    const roundtrip = documentFromDiagram(projectDocument(doc));
    assert.equal(encodeDocument(roundtrip), encodeDocument(doc));
    assert.equal(
      encodeDocument(decodeDocument(encodeDocument(doc))),
      encodeDocument(doc),
    );
    const state = { present: doc, past: [], future: [doc] };
    assert.deepEqual(
      historyReducer(state, { type: "commit", next: roundtrip, before: doc }),
      state,
    );
  }
});

test("column reorder keeps manual routes by FK and child column ID across document projections", async () => {
  const doc = decodeDocument(
    await readFile(
      new URL("../examples/composite-keys.json", import.meta.url),
      "utf8",
    ),
  );
  doc.presentation.routes.forEach((r, i) => {
    r.manual = true;
    r.trunk = 800 + i * 20;
  });
  const rendered = projectDocument(doc);
  const child = rendered.tables.find((t) =>
    t.foreignKeys.some((f) => f.target && f.columnIds.length > 1),
  );
  assert.ok(child);
  const nextTable = structuredClone(child);
  nextTable.columns.reverse();
  const changed = documentFromDiagram(editTable(rendered, nextTable));
  assert.deepEqual(changed.presentation.routes, doc.presentation.routes);
  const state = { present: doc, past: [], future: [] };
  const committed = historyReducer(state, { type: "commit", next: changed });
  assert.deepEqual(historyReducer(committed, { type: "undo" }).present, doc);
  assert.equal(
    encodeDocument(documentFromDiagram(projectDocument(changed))),
    encodeDocument(changed),
  );
});

test("pending and retargeted FKs cannot resurrect discarded manual routes", () => {
  const doc = documentFromDiagram(initial);
  doc.presentation.routes.forEach((r) => {
    r.manual = true;
    r.trunk = 700;
  });
  const view = projectDocument(doc);
  const users = structuredClone(view.tables[0]);
  users.keys = [];
  const pending = documentFromDiagram(editTable(view, users));
  assert.equal(
    pending.presentation.routes.some((r) => r.foreignKeyId === "e1"),
    false,
  );
  const restoredParent = structuredClone(projectDocument(pending).tables[0]);
  restoredParent.keys = structuredClone(initial.tables[0].keys);
  const reconnect = editTable(projectDocument(pending), restoredParent);
  const edge = makeEdge(
    reconnect,
    { table: "users", row: 0 },
    { table: "orders", row: 1 },
  );
  reconnect.edges.push(edge);
  const after = documentFromDiagram(reconnect);
  const route = after.presentation.routes.find((r) => r.foreignKeyId === "e1");
  assert.equal(route.manual, false);
  assert.equal(route.trunk, null);
});

test("legacy tuples and unresolved original row numbers migrate only at the v1 boundary", () => {
  const raw = JSON.stringify({
    format: "er-sketch",
    version: 1,
    diagram: {
      tables: ["a", "b"].map((id) => ({
        id,
        x: 0,
        y: 0,
        columns: [["id", "uuid", "PK,FK"]],
      })),
      edges: [
        {
          id: "old",
          from: { table: "a", row: 0, side: "left" },
          to: { table: "b", row: 0, side: "right" },
          manual: true,
          trunk: 120,
        },
      ],
    },
  });
  const doc = decodeDocument(raw);
  assert.equal(doc.unresolvedEdges.length, 1);
  assert.equal(doc.schema.tables[0].columns[0].id, "a:column:0");
  assert.equal(
    encodeDocument(decodeDocument(encodeDocument(doc))),
    encodeDocument(doc),
  );
  const dismissed = structuredClone(doc);
  dismissed.unresolvedEdges = [];
  const history = historyReducer(
    { present: doc, past: [], future: [] },
    { type: "commit", next: dismissed },
  );
  assert.deepEqual(
    historyReducer(history, { type: "undo" }).present.unresolvedEdges,
    doc.unresolvedEdges,
  );
  const badV2 = structuredClone(doc);
  badV2.schema.tables[0].columns = [["id", "uuid", "PK"]];
  assert.throws(() => decodeDocument(JSON.stringify(badV2)));
});

test("document import rejects duplicate, dangling and malformed presentation records", () => {
  const doc = documentFromDiagram(initial);
  const mutations = [
    (d) => d.presentation.tables.push(d.presentation.tables[0]),
    (d) => d.presentation.tables.pop(),
    (d) => {
      d.presentation.tables[0].tableId = "missing";
    },
    (d) => d.presentation.routes.push(d.presentation.routes[0]),
    (d) => {
      d.presentation.routes[0].columnId = "missing";
    },
    (d) => {
      d.presentation.routes[0].manual = "false";
    },
    (d) => {
      d.presentation.routes[0].trunk = "123";
    },
    (d) => {
      d.presentation.routes[0].fromSide = "above";
    },
    (d) => {
      delete d.schema.tables[0].columns[0].id;
    },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(doc);
    mutate(bad);
    assert.throws(() => decodeDocument(JSON.stringify(bad)));
  }
  const noRoutes = structuredClone(doc);
  noRoutes.presentation.routes = [];
  assert.equal(
    projectDocument(decodeDocument(JSON.stringify(noRoutes))).edges.length,
    2,
  );
});
