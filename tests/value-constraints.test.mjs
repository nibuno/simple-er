import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { importDDL } from "../src/ddl-import.ts";
import { diagramDDL } from "../src/ddl.ts";
import { importMermaid } from "../src/mermaid-import.ts";
import { diagramMermaid } from "../src/mermaid.ts";
import {
  decode,
  documentFromDiagram,
  encode,
  projectDocument,
} from "../src/model.ts";
import { tableDefinition } from "../src/table-definition.ts";
import { importTableDefinition } from "../src/table-definition-import.ts";
import { diagramSvg } from "../src/export.ts";

const source = `CREATE TYPE delivery_state AS ENUM ('pending', 'it''s, ready', '発送済み');
CREATE TYPE unused AS ENUM ('a', 'b');
CREATE TABLE orders (
  id integer, tenant integer, status delivery_state,
  quantity integer CONSTRAINT positive CHECK (quantity > 0),
  CONSTRAINT order_pk PRIMARY KEY (tenant, id),
  CONSTRAINT uq_status UNIQUE (id, status),
  CONSTRAINT uq_quantity UNIQUE (quantity),
  CONSTRAINT nonnegative CHECK (id >= 0 AND (tenant > 0 OR status = 'it''s, ready'))
);
CREATE TABLE items (
  order_id integer, tenant integer, status delivery_state,
  CONSTRAINT order_fk FOREIGN KEY (tenant, order_id) REFERENCES orders (tenant, id)
);
ALTER TABLE items ADD CHECK (order_id <> 0);`;
function fixture() {
  const parsed = importDDL(source);
  assert.deepEqual(parsed.issues, []);
  return parsed.diagram;
}
function assertSchema(actual, original) {
  assert.deepEqual(
    actual.enums?.toSorted((a, b) => a.name.localeCompare(b.name)),
    original.enums?.toSorted((a, b) => a.name.localeCompare(b.name)),
  );
  assert.deepEqual(
    actual.tables.map((t) => t.checks),
    original.tables.map((t) => t.checks),
  );
  assert.equal(
    diagramDDL({ ...actual, enums: original.enums }),
    diagramDDL(original),
  );
}
for (const dialect of ["PostgreSQL", "MySQL", "SQLite"])
  test(
    dialect + " preserves named shared ENUMs, checks and ordered keys",
    () => {
      const diagram = fixture();
      const ddl = diagramDDL(diagram, dialect);
      const parsed = importDDL(ddl);
      assert.deepEqual(parsed.issues, []);
      assertSchema(parsed.diagram, diagram);
      if (dialect === "SQLite") {
        const db = new DatabaseSync(":memory:");
        try {
          db.exec("PRAGMA foreign_keys=ON;" + ddl);
          db.exec(
            "INSERT INTO orders VALUES(1,2,'pending',1); INSERT INTO items VALUES(1,2,'発送済み')",
          );
          assert.throws(
            () => db.exec("INSERT INTO orders VALUES(2,2,'other',2)"),
            /CHECK/,
          );
          assert.throws(
            () => db.exec("INSERT INTO orders VALUES(2,2,'pending',0)"),
            /CHECK/,
          );
          assert.throws(
            () => db.exec("INSERT INTO items VALUES(2,2,'pending')"),
            /FOREIGN KEY/,
          );
        } finally {
          db.close();
        }
      }
    },
  );
test("quoted CHECK identifiers and SQL literals retain their meaning across dialects", () => {
  const { diagram, issues } = importDDL(
    "CREATE TABLE t (`part.no` text, CHECK (`part.no` <> 'A,B'))",
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(diagram.tables[0].checks, [
    { name: "", expression: "\"part.no\" <> 'A,B'" },
  ]);
  for (const dialect of ["PostgreSQL", "MySQL", "SQLite"])
    assert.deepEqual(
      importDDL(diagramDDL(diagram, dialect)).diagram.tables[0].checks,
      diagram.tables[0].checks,
    );
});

test("native inline ENUMs retain labels beyond the old custom-type limit", () => {
  const sql =
    "CREATE TABLE t (state ENUM('a,b','long label that exceeds forty characters in total','it''s done'))";
  const parsed = importDDL(sql);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.diagram.enums[0].values, [
    "a,b",
    "long label that exceeds forty characters in total",
    "it's done",
  ]);
  assert.equal(
    parsed.diagram.tables[0].columns[0].type,
    parsed.diagram.enums[0].name,
  );
});
test("an untagged SQLite IN condition and an edited tagged condition remain checks", () => {
  const original = fixture();
  const sql = diagramDDL(original, "SQLite").replaceAll(
    '"status" IN (',
    'lower("status") IN (',
  );
  const edited = importDDL(sql);
  assert.deepEqual(edited.issues, []);
  assert.equal(edited.diagram.tables[0].columns[2].type, "TEXT");
  assert.ok(
    edited.diagram.tables[0].checks.some((c) =>
      c.expression.startsWith('lower("status") IN'),
    ),
  );
  assert.deepEqual(
    importDDL("CREATE TABLE t (s TEXT CHECK (s IN ('a','b')))").diagram
      .tables[0].checks,
    [{ name: "", expression: "s IN ('a','b')" }],
  );
});

test("old inline ENUM strings and current JSON round-trip", () => {
  const doc = documentFromDiagram(fixture());
  delete doc.schema.enums;
  doc.schema.tables[0].columns[2].type = "enum('new','old')";
  const migrated = projectDocument(doc);
  assert.deepEqual(migrated.enums[0].values, ["new", "old"]);
  assert.deepEqual(decode(encode(migrated)), migrated);
});
test("Mermaid retains shared and unused ENUMs, named CHECKs and composite key order", () => {
  const original = fixture();
  const mmd = diagramMermaid(original);
  assert.match(mmd, /integer quantity UK/);
  const parsed = importMermaid(mmd);
  assert.deepEqual(parsed.issues, []);
  assertSchema(parsed.diagram, original);
  assert.match(diagramSvg(original), />UK1<\/text>/);
  assert.match(diagramSvg(original), />CHECK 2<\/text>/);
});
for (const format of ["md", "csv"])
  for (const logical of [false, true])
    test(
      format +
        " definition is editable and imports all constraints; logical first " +
        logical,
      () => {
        const diagram = fixture();
        const doc = documentFromDiagram(diagram);
        doc.title = "注文一覧";
        doc.schema.tables[0].logicalName = "注文";
        doc.schema.tables[0].columns[0].note = 'line1\n|,<br> &amp; "test"';
        const content = tableDefinition(doc, format, logical);
        assert.match(content, /CHECK 制約/);
        assert.match(content, /発送済み/);
        const imported = importTableDefinition(
          content.replaceAll("positive", "positive_quantity"),
        );
        assert.equal(imported.title, "注文一覧");
        assert.equal(
          imported.schema.tables[0].columns[0].note,
          doc.schema.tables[0].columns[0].note,
        );
        doc.schema.tables[0].checks[0].name = "positive_quantity";
        assertSchema(projectDocument(imported), projectDocument(doc));
      },
    );
