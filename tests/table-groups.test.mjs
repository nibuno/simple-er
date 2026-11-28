import { test } from "node:test";
import assert from "node:assert/strict";
import { initial } from "../src/initial.ts";
import { diagramDDL } from "../src/ddl.ts";
import { diagramMermaid } from "../src/mermaid.ts";
import { diagramSvg } from "../src/export.ts";
import { groupFrames, height, tableWidth } from "../src/geometry.ts";
import { tidyDiagram } from "../src/layout.ts";
import {
  decode,
  encode,
  documentFromDiagram,
  removeTable,
} from "../src/model.ts";
import { tableDefinition } from "../src/table-definition.ts";
import { moveGroup } from "../src/utils.ts";
import { relatedDiagram } from "../src/diagram-view.ts";

function grouped() {
  const diagram = structuredClone(initial);
  diagram.tables[1].color = "blue";
  diagram.groups = [
    { id: "sales", name: "受注<&", tableIds: ["orders", "order_items"] },
  ];
  return diagram;
}

test("presentation round-trips without changing SQL or Mermaid", () => {
  const diagram = grouped(),
    doc = documentFromDiagram(diagram);
  assert.deepEqual(doc.presentation.groups, diagram.groups);
  assert.equal(doc.presentation.tables[1].color, "blue");
  assert.deepEqual(doc.schema, documentFromDiagram(initial).schema);
  assert.deepEqual(decode(encode(diagram)), diagram);
  assert.equal(decode(encode(initial)).groups, undefined);
  assert.equal(diagramDDL(diagram), diagramDDL(initial));
  assert.equal(diagramMermaid(diagram), diagramMermaid(initial));
  assert.match(diagramSvg(diagram), /受注&lt;&amp;/);
  assert.match(diagramSvg(diagram), /#dfeaf5/);
  assert.match(tableDefinition(doc, "md"), /受注&#60;&amp;/);
  assert.match(tableDefinition(doc, "csv"), /グループ名/);
  assert.match(tableDefinition(doc, "csv"), /orders,,,受注<&/);
});

test("invalid group references and non-palette colors are rejected", () => {
  const diagram = grouped();
  for (const tableIds of [[], ["orders", "orders"], ["missing"]]) {
    assert.throws(() =>
      encode({ ...diagram, groups: [{ ...diagram.groups[0], tableIds }] }),
    );
  }
  assert.throws(() =>
    encode({
      ...diagram,
      groups: [...diagram.groups, { ...diagram.groups[0], id: "other" }],
    }),
  );
  diagram.tables[1].color = "constructor";
  assert.throws(() => encode(diagram));
});

test("frames follow visible members and tidy keeps groups separate and deterministic", () => {
  const diagram = grouped();
  diagram.groups.push({ id: "accounts", name: "利用者", tableIds: ["users"] });
  const arranged = tidyDiagram(diagram),
    [a, b] = groupFrames(arranged);
  assert.ok(
    a.x + a.width <= b.x ||
      b.x + b.width <= a.x ||
      a.y + a.height <= b.y ||
      b.y + b.height <= a.y,
  );
  for (const frame of [a, b]) {
    for (const t of arranged.tables.filter((t) =>
      frame.group.tableIds.includes(t.id),
    )) {
      assert.ok(t.x >= frame.x && t.x + tableWidth(t) <= frame.x + frame.width);
      assert.ok(t.y >= frame.y && t.y + height(t) <= frame.y + frame.height);
    }
  }
  assert.deepEqual(tidyDiagram(arranged), arranged);
  const [part] = groupFrames(relatedDiagram(diagram, "users"));
  assert.ok(part.width < groupFrames(diagram)[0].width);
  const remaining = removeTable(diagram, "orders").next;
  assert.deepEqual(remaining.groups[0].tableIds, ["order_items"]);
  assert.deepEqual(
    removeTable(remaining, "order_items").next.groups.map((g) => g.id),
    ["accounts"],
  );
});

test("group moves are atomic and carry the manual route between two members", () => {
  const diagram = grouped(),
    group = diagram.groups[0];
  Object.assign(diagram.edges[1], { manual: true, trunk: 800 });
  const moved = moveGroup(diagram, group, 24, 50);
  assert.deepEqual(
    moved.tables.map((t, i) => t.x - diagram.tables[i].x),
    [0, 24, 24],
  );
  assert.deepEqual(
    moved.tables.map((t, i) => t.y - diagram.tables[i].y),
    [0, 50, 50],
  );
  assert.equal(moved.edges[1].trunk, 824);
  assert.equal(moveGroup(diagram, group, -400, -170), null);
  assert.equal(moveGroup(diagram, group, 50000, 0), null);
});

test("tidy moves a table out of the space between two grouped members", () => {
  const diagram = grouped();
  diagram.groups[0].tableIds = ["users", "order_items"];
  const arranged = tidyDiagram(diagram);
  const [frame] = groupFrames(arranged);
  const outside = arranged.tables.find((t) => t.id === "orders");
  assert.ok(
    frame.x + frame.width <= outside.x ||
      outside.x + tableWidth(outside) <= frame.x ||
      frame.y + frame.height <= outside.y ||
      outside.y + height(outside) <= frame.y,
  );
  assert.deepEqual(arranged.groups, diagram.groups);
});
