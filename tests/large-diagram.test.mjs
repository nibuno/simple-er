import { test } from "node:test";
import assert from "node:assert/strict";
import { importDDL } from "../src/ddl-import.ts";
import { diagramMermaid } from "../src/mermaid.ts";
import { importMermaid } from "../src/mermaid-import.ts";
import { decode, encode, validateDiagram } from "../src/model.ts";
import { routeEdges } from "../src/geometry.ts";

test("DDL, files and editing accept 150 tables and 400 links, and report each overflow", () => {
  const sql = ["CREATE TABLE parent (id int primary key);"];
  for (let i = 0; i < 149; i++) {
    const columns = Array.from(
      { length: i < 102 ? 3 : 2 },
      (_, j) => "ref_" + j + " int REFERENCES parent(id)",
    );
    sql.push("CREATE TABLE child_" + i + " (" + columns.join(", ") + ");");
  }
  const { diagram, issues } = importDDL(sql.join("\n"));
  assert.deepEqual(issues, []);
  assert.equal(diagram.tables.length, 150);
  assert.equal(diagram.edges.length, 400);
  assert.equal(decode(encode(diagram)).edges.length, 400);
  const mermaid = importMermaid(diagramMermaid(diagram));
  assert.deepEqual(mermaid.issues, []);
  assert.equal(mermaid.diagram.tables.length, 150);
  assert.equal(mermaid.diagram.edges.filter((e) => e.foreignKeyId).length, 400);
  const extra = importDDL(
    "CREATE TABLE extra (id int);\nALTER TABLE child_148 ADD FOREIGN KEY (ref_0) REFERENCES parent(id);",
    diagram,
  );
  assert.deepEqual(
    extra.issues.map((i) => i.message),
    ["テーブルは150個までです。", "接続は400本までです。"],
  );
  assert.throws(
    () =>
      validateDiagram({
        ...diagram,
        tables: [...diagram.tables, diagram.tables[0]],
      }),
    /150テーブル/,
  );
  assert.throws(
    () =>
      validateDiagram({
        ...diagram,
        edges: [...diagram.edges, diagram.edges[0]],
      }),
    /400接続/,
  );
});

test("large drawings with long logical names can reopen their exported JSON", () => {
  const diagram = {
    tables: Array.from({ length: 150 }, (_, i) => ({
      id: "t" + i,
      name: "t" + i,
      x: (i % 15) * 400,
      y: Math.floor(i / 15) * 3000,
      columns: Array.from({ length: 60 }, (_, j) => ({
        name: "col_" + j,
        type: "text",
        key: "",
        logicalName: "項".repeat(80),
      })),
    })),
    edges: [],
  };
  const json = encode(diagram);
  assert.ok(json.length > 2_000_000);
  assert.equal(
    decode(json).tables[149].columns[59].logicalName,
    "項".repeat(80),
  );
});

test("large-diagram detours clear an intervening table", () => {
  const { diagram } = importDDL(
    "CREATE TABLE a (id int PRIMARY KEY);CREATE TABLE b (id int REFERENCES a(id));" +
      Array.from(
        { length: 39 },
        (_, i) => "CREATE TABLE blocker_" + i + " (id int);",
      ).join(""),
  );
  diagram.tables.forEach((table, i) => {
    table.x = i * 360;
    table.y = 600;
  });
  const [a, b, blocker] = diagram.tables;
  a.x = 0;
  b.x = 800;
  blocker.x = 400;
  a.y = b.y = blocker.y = 0;
  const route = routeEdges(diagram.edges, diagram.tables).get(
    diagram.edges[0].id,
  );
  assert.ok(route.detour && !route.blocked);
  for (const [i, p] of route.points.entries()) {
    if (!i) continue;
    const q = route.points[i - 1];
    assert.ok(
      Math.max(p.x, q.x) <= 400 ||
        Math.min(p.x, q.x) >= 630 ||
        Math.max(p.y, q.y) <= 0 ||
        Math.min(p.y, q.y) >= 100,
    );
  }
});
