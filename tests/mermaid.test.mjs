import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { importMermaid } from "../src/mermaid-import.ts";
import { diagramMermaid } from "../src/mermaid.ts";
import { diagramDDL } from "../src/ddl.ts";
import { decode, encode, editTable, removeTable } from "../src/model.ts";
import { diagramSvg } from "../src/export.ts";
import { overlaps } from "../src/utils.ts";

test("all bundled samples keep their schema, column mappings and relationship labels on a Mermaid round trip", async () => {
  const examples = new URL("../examples/", import.meta.url);
  for (const file of (await readdir(examples)).filter((f) =>
    f.endsWith(".json"),
  )) {
    const original = decode(await readFile(new URL(file, examples), "utf8"));
    const text = diagramMermaid(original);
    const { diagram, issues } = importMermaid(text);
    assert.deepEqual(issues, [], file);
    const restored = decode(encode(diagram));
    assert.equal(diagramDDL(restored), diagramDDL(original), file);
    assert.deepEqual(
      restored.tables.map((t) =>
        t.foreignKeys.map((f) => [f.label, f.cardinality]),
      ),
      original.tables.map((t) =>
        t.foreignKeys.map((f) => [f.label, f.cardinality]),
      ),
      file,
    );
    assert.equal(restored.edges.length, original.edges.length, file);
    assert.equal(diagramMermaid(restored), text, file);
    assert.ok(restored.tables.every((t) => !overlaps(t, restored.tables)));
  }
});

test("both ends keep all four cardinalities, with named, empty and self relationships", () => {
  const pairs = ["||", "|o", "}|", "}o"].flatMap((from) =>
    ["||", "o|", "|{", "o{"].map((to) => ({ from, to })),
  );
  const text = [
    "erDiagram",
    ...pairs.map(({ from, to }, i) => `A ${from}..${to} A : "線 ${i}"`),
    "B",
    'A ||--|| B : ""',
  ].join("\n");
  const { diagram, issues } = importMermaid(text);
  assert.deepEqual(issues, []);
  assert.equal(diagram.tables[0].columns.length, 0);
  assert.ok(
    diagram.tables.every(
      (t) => t.foreignKeys.length === 0 && t.keys.length === 0,
    ),
  );
  assert.deepEqual(
    diagram.edges.slice(0, -1).map((e) => e.entityRelation),
    pairs.map(({ from, to }, i) => ({
      from,
      to,
      identifying: false,
      label: `線 ${i}`,
    })),
  );
  const restored = decode(encode(diagram));
  assert.deepEqual(restored, diagram);
  assert.match(diagramSvg(restored), /stroke-dasharray="5 4"/);
  assert.match(diagramSvg(restored), /線 0/);
  assert.equal(
    diagramMermaid(importMermaid(diagramMermaid(restored)).diagram),
    diagramMermaid(restored),
  );
  const a = restored.tables.find((t) => t.name === "A");
  assert.equal(editTable(restored, { ...a, name: "renamed" }).edges.length, 17);
  assert.equal(removeTable(restored, a.id).next.edges.length, 0);
});

test("forward declarations, aliases, combined badges and comments round-trip without guessing a column mapping", () => {
  const { diagram, issues } = importMermaid(`---
title: Example
---
erDiagram
  %% tables may be defined after a relationship
  direction LR
  "配信 回" ||--|{ views : "視聴 履歴"
  "配信 回"["番組"] { uuid *id "番組番号" }
  views {
    uuid channel PK, FK, UK "番号"
    timestamp created PK
    \`double precision\` \`score #35;1\` "点数 #34;暫定#34;"
  }`);
  assert.deepEqual(issues, []);
  const [parent, child] = diagram.tables;
  assert.equal(parent.logicalName, "番組");
  assert.equal(child.columns[0].key, "PK,FK");
  assert.equal(child.columns[2].name, "score #1");
  assert.equal(child.columns[2].logicalName, '点数 "暫定"');
  assert.equal(child.foreignKeys[0].target, undefined);
  assert.deepEqual(
    child.keys.map((k) => [k.kind, k.columnIds.length]),
    [
      ["primary", 2],
      ["unique", 1],
    ],
  );
  assert.equal(
    diagramMermaid(importMermaid(diagramMermaid(diagram)).diagram),
    diagramMermaid(diagram),
  );
});

test("line errors, duplicate entities, damaged constraint hints and an unterminated block leave valid work intact", () => {
  const base = importMermaid("erDiagram\nOld { int id PK }").diagram;
  const before = structuredClone(base);
  const { diagram, issues } = importMermaid(
    [
      "erDiagram",
      "Old {",
      "  text wrong",
      "}",
      "%% simple-er-keys {}",
      "New {",
      "  int id PK",
      "  broken",
      "Next { int ref FK }",
      "%% simple-er-fk {}",
      "New ||--o{ Next : link",
      "Old ||--o{ Next : skipped",
    ].join("\r\n"),
    base,
  );
  assert.deepEqual(base, before);
  assert.deepEqual(diagram.tables[0], before.tables[0]);
  assert.deepEqual(
    issues.map((i) => i.line),
    [2, 5, 6, 8, 10, 12],
  );
  assert.equal(diagram.edges.length, 1);
  assert.equal(diagram.edges[0].entityRelation.label, "link");
  assert.ok(diagram.tables.every((t) => !overlaps(t, diagram.tables)));
  assert.equal(importMermaid("flowchart TD\n A --> B").applied, 0);
});

test("a relationship alone can connect existing tables without moving them", () => {
  const base = importMermaid("erDiagram\nA\nB").diagram;
  const result = importMermaid("erDiagram\nB }o--o{ A : relates", base);
  assert.equal(result.tableCount, 0);
  assert.equal(result.applied, 1);
  assert.deepEqual(result.diagram.tables, base.tables);
  assert.equal(base.edges.length, 0);
  const alias = importMermaid(
    "erDiagram\nB many(0) optionally to only one A : relates",
    base,
  );
  assert.deepEqual(alias.diagram.edges[0].entityRelation, {
    from: "}o",
    to: "||",
    identifying: false,
    label: "relates",
  });
});
