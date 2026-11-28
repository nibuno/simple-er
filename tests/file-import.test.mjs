import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { appendDiagram, erFormat } from "../src/file-import.ts";
import {
  decodeDocument,
  documentFromDiagram,
  projectDocument,
} from "../src/model.ts";
import { diagramMermaid } from "../src/mermaid.ts";
import { tableDefinition } from "../src/table-definition.ts";

const source = readFileSync(
  new URL("../examples/composite-keys.json", import.meta.url),
  "utf8",
);
const doc = decodeDocument(source);
test("detect generated files and pasted text by contents", () => {
  const diagram = { ...projectDocument(doc), title: "受注" };
  for (const [text, format] of [
    [source, "JSON"],
    [diagramMermaid(diagram), "Mermaid"],
    [tableDefinition(doc, "csv"), "定義書（CSV）"],
    [tableDefinition(doc, "md"), "定義書（Markdown）"],
    ["-- dump\nCREATE TABLE a(id int);", "DDL"],
    ["自由な文章", ""],
  ])
    assert.equal(erFormat(text, ""), format);
  assert.equal(erFormat(source, "sample.sql"), "JSON");
});
test("adding an independent document remaps overlapping IDs and preserves routes and groups", () => {
  const base = projectDocument(doc),
    other = structuredClone(base);
  for (const t of other.tables) t.schemaName = "archive";
  other.groups = [
    { id: "g", name: "履歴", tableIds: other.tables.map((t) => t.id) },
  ];
  other.edges[0].manual = true;
  other.edges[0].trunk = 200;
  const merged = appendDiagram(base, other);
  const added = merged.tables.slice(base.tables.length);
  assert.deepEqual(
    merged.groups.at(-1).tableIds,
    added.map((t) => t.id),
  );
  assert.equal(merged.edges.length, 2 * base.edges.length);
  assert.ok(added.every((t) => !base.tables.some((b) => b.id === t.id)));
  assert.ok(
    added
      .flatMap((t) => t.foreignKeys)
      .filter((f) => f.target)
      .every((f) => added.some((t) => t.id === f.target.tableId)),
  );
  assert.equal(
    merged.edges[base.edges.length].trunk,
    200 + added[0].x - other.tables[0].x,
  );
  assert.deepEqual(projectDocument(documentFromDiagram(merged)), merged);
  assert.throws(() => appendDiagram(base, base), /重複/);
});
