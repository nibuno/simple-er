import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { diagramSvg, exportFilename, titleFromFile } from "../src/export.ts";
import { decode } from "../src/model.ts";
import { graph } from "./layout-fixtures.mjs";
import { height, rounded, routeEdges, tableWidth } from "../src/geometry.ts";
import { relationshipLabels } from "../src/relationships.ts";

test("SVG includes complete self references and labels outside the table with a white margin", () => {
  const sample = decode(
    readFileSync(
      new URL("../examples/composite-keys.json", import.meta.url),
      "utf8",
    ),
  );
  const t = sample.tables.find((t) => t.id === "categories");
  t.x = -4000;
  t.y = -2000;
  t.logicalName = "分類 <一覧>";
  t.foreignKeys[0].label = "親 & 子\n親子の関係";
  t.foreignKeys[0].cardinality = { parentMinimum: 0, childMinimum: 1 };
  const state = {
    title: '商品 & "在庫"',
    tables: [t],
    edges: sample.edges.filter((e) => e.to.table === t.id),
  };
  const svg = diagramSvg(state, (t) => t.logicalName);
  const root = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document
    .documentElement;
  assert.equal(root.querySelector("title").textContent, state.title);
  const text = [...root.querySelectorAll("text")].map((e) => e.textContent);
  for (const value of [
    t.logicalName,
    "親 & 子",
    "親子の関係",
    "PK",
    "FK",
    ...t.columns.map((c) => c.name),
  ])
    assert.ok(text.includes(value), value);
  assert.ok(root.querySelector("circle")); // optional end of the self reference
  assert.equal(
    root.querySelector("pattern, foreignObject, image, script, style"),
    null,
  );
  assert.equal(
    root.querySelector(":scope > rect").getAttribute("fill"),
    "#fff",
  );
  const [x, y, w, h] = root.getAttribute("viewBox").split(" ").map(Number);
  const routes = routeEdges(state.edges, state.tables);
  const label = relationshipLabels(state, routes).values().next().value;
  const { points } = routes.get(state.edges[0].id);
  assert.ok(
    [...root.querySelectorAll("path")].some(
      (path) => path.getAttribute("d") === rounded(points),
    ),
  );
  for (const p of [
    t,
    { x: t.x + tableWidth(t), y: t.y + height(t) },
    ...points,
    label,
    { x: label.x + label.width, y: label.y + label.height },
  ]) {
    assert.ok(p.x >= x + 48 && p.x <= x + w - 48);
    assert.ok(p.y >= y + 48 && p.y <= y + h - 48);
  }
});

test("SVG uses the supplied visible paths, including a route held still during a drag", () => {
  const d = graph([["parent"], ["child", ["parent"]], ["obstacle"]]);
  d.tables[1].x = 1000;
  d.tables[2].y = 500;
  const visible = routeEdges(d.edges, d.tables);
  d.tables[2].x = 500;
  d.tables[2].y = 0;
  const wire = (svg) =>
    new JSDOM(svg, { contentType: "image/svg+xml" }).window.document
      .querySelector("svg > g > path")
      .getAttribute("d");
  assert.equal(
    wire(diagramSvg(d, undefined, undefined, visible)),
    rounded(visible.get(d.edges[0].id).points),
  );
  assert.notEqual(
    wire(diagramSvg(d)),
    rounded(visible.get(d.edges[0].id).points),
  );
});

test("filenames preserve diagram names and use the local date for unnamed diagrams", () => {
  assert.equal(exportFilename("図/受注"), "図_受注");
  assert.equal(
    exportFilename(" ", new Date(2026, 0, 2, 0, 1)),
    "simple-er-2026-01-02",
  );
  assert.equal(titleFromFile("受注管理.JSON"), "受注管理");
  assert.equal(titleFromFile("er-sketch-2026-01-01.json"), undefined);
  assert.equal(titleFromFile("simple-er-2026-01-01.json"), undefined);
});
