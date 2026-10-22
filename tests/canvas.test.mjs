import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  arrange,
  attachNote,
  clone,
  decode,
  emptyDocument,
  encode,
  fitGroup,
  groupSelection,
  growNodes,
  historyReducer,
  makeNode,
  moveNodes,
  noteContent,
  pasteDocument,
  removeSelection,
  sampleDocument,
  selectionDocument,
} from "../canvas/src/model.ts";
import { documentRoutes, routeEdge } from "../canvas/src/geometry.ts";
import { toSvg } from "../canvas/src/export.ts";
import { boxTextArea, SHAPES, shapePaths } from "../canvas/src/shapes.ts";
import {
  COLOR_FAMILIES,
  contrastRatio,
  nodeAppearance,
} from "../canvas/src/colors.ts";

test("canvas JSON round-trips Japanese text, attachment identity, groups, and labelled edges", () => {
  let doc = growNodes(sampleDocument());
  doc = groupSelection(doc, ["queue", "worker"]).doc;
  doc.edges[0].label = "注文 <受付> & 保存";
  assert.deepEqual(decode(encode(doc)), doc);
  assert.equal(
    noteContent(
      doc.nodes.find((n) => n.id === "worker-note"),
      doc,
    ).body,
    doc.nodes.find((n) => n.id === "worker").body,
  );
});
test("all figure shapes retain their outline and safe text area through save, copy and SVG export", () => {
  const doc = emptyDocument();
  doc.nodes = SHAPES.map((shape, i) => ({
    ...makeNode("box", { x: i * 400, y: 100 }, shape),
    title: "注文の受付状態",
    description: "説明が長くなっても図形の内側に収める。",
  }));
  doc.edges = doc.nodes.slice(1).map((node, i) => ({
    id: "shape-edge-" + i,
    from: doc.nodes[i].id,
    to: node.id,
    label: "",
    dashed: false,
  }));
  growNodes(doc);
  assert.deepEqual(decode(encode(doc)), doc);
  const copied = pasteDocument(
    emptyDocument(),
    selectionDocument(
      doc,
      doc.nodes.map((n) => n.id),
    ),
    { x: 10, y: 20 },
  );
  assert.deepEqual(
    copied.doc.nodes.map((n) => n.shape),
    SHAPES,
  );
  const svg = new JSDOM(toSvg(doc), { contentType: "image/svg+xml" }).window
    .document;
  for (const node of doc.nodes) {
    assert.equal(
      svg
        .querySelector(`[data-node-shape="${node.shape}"] path`)
        .getAttribute("d"),
      shapePaths(node).outline,
    );
    const area = boxTextArea(node);
    assert.ok(area.x >= 0 && area.y >= 0 && area.w > 0 && area.h > 0);
    assert.ok(area.x + area.w <= node.w && area.y + area.h <= node.h);
  }
  assert.equal(svg.querySelectorAll("[marker-end]").length, 3);
});
test("invalid documents fail rather than silently dropping relationships", () => {
  const invalids = [
    (d) => (d.version = 2),
    (d) => (d.nodes[1].id = d.nodes[0].id),
    (d) => (d.nodes[1].w = -1),
    (d) => (d.nodes[1].x = null),
    (d) => (d.nodes[1].body = "x".repeat(6001)),
    (d) => (d.nodes[1].shape = "future-shape"),
    (d) => (d.nodes[1].groupId = "absent"),
    (d) => (d.nodes[1].attachedTo = "worker"),
    (d) => (d.edges[0].to = "absent"),
    (d) => (d.edges[0].id = d.nodes[0].id),
    (d) => (d.nodes[0].fillColor = "url(https://example.com/image.svg)"),
    (d) => (d.nodes[0].strokeColor = '#ffffff" onload="alert(1)'),
    (d) => (d.edges[0].strokeColor = "rgb(0,0,0)"),
  ];
  for (const invalidate of invalids) {
    const doc = sampleDocument();
    invalidate(doc);
    assert.throws(() => decode(JSON.stringify(doc)));
  }
});
test("colors survive save, copy, tidy and SVG export, including independently colored arrowheads", () => {
  const doc = emptyDocument();
  doc.nodes = SHAPES.map((shape, i) => ({
    ...makeNode("box", { x: i * 350, y: 0 }, shape),
    title: shape,
    fillColor: COLOR_FAMILIES[i].fill,
    strokeColor: COLOR_FAMILIES[i].stroke,
  }));
  const frame = {
    ...makeNode("group", { x: 0, y: 300 }),
    fillColor: "#ffd8a8",
    strokeColor: "#e8590c",
  };
  const note = {
    ...makeNode("note", { x: 40, y: 360 }),
    body: "メモ",
    fillColor: "#b2f2bb",
    strokeColor: "#2f9e44",
    groupId: frame.id,
  };
  doc.nodes.push(frame, note);
  doc.edges = doc.nodes.slice(1, 4).map((node, i) => ({
    id: "colored-edge-" + i,
    from: doc.nodes[i].id,
    to: node.id,
    label: "",
    dashed: false,
    strokeColor: COLOR_FAMILIES[i + 1].stroke,
  }));
  growNodes(doc);
  assert.deepEqual(decode(encode(doc)), doc);
  const colors = (d) => d.nodes.map((n) => [n.fillColor, n.strokeColor]);
  const copied = pasteDocument(
    emptyDocument(),
    selectionDocument(
      doc,
      doc.nodes.map((n) => n.id),
    ),
    { x: 50, y: 60 },
  ).doc;
  assert.deepEqual(colors(copied), colors(doc));
  assert.deepEqual(
    copied.edges.map((e) => e.strokeColor),
    doc.edges.map((e) => e.strokeColor),
  );
  assert.deepEqual(colors(arrange(doc, [])), colors(doc));
  const svg = new JSDOM(toSvg(doc), { contentType: "image/svg+xml" }).window
    .document;
  for (const node of doc.nodes.slice(0, 4)) {
    const path = svg.querySelector(`[data-node-shape="${node.shape}"] path`);
    assert.equal(path.getAttribute("fill"), node.fillColor);
    assert.equal(path.getAttribute("stroke"), node.strokeColor);
  }
  assert.ok(svg.querySelector('rect[fill="#ffd8a8"][stroke="#e8590c"]'));
  assert.ok(svg.querySelector('rect[fill="#b2f2bb"]'));
  doc.edges.forEach((edge, i) => {
    assert.equal(
      svg
        .querySelector(`path[marker-end="url(#arrow-${i})"]`)
        .getAttribute("stroke"),
      edge.strokeColor,
    );
    assert.equal(
      svg.querySelector(`#arrow-${i} path`).getAttribute("stroke"),
      edge.strokeColor,
    );
  });
});
test("preset and custom fills keep title and description text readable, including transparent notes in a dark frame", () => {
  const doc = emptyDocument(),
    node = makeNode("box", { x: 0, y: 0 });
  doc.nodes.push(node);
  for (const fillColor of [
    ...COLOR_FAMILIES.map((c) => c.fill),
    "#1e1e1e",
    "#6741d9",
    "#777777",
  ]) {
    node.fillColor = fillColor;
    const colors = nodeAppearance(node, doc);
    assert.ok(contrastRatio(colors.text, fillColor) >= 4.5);
    assert.ok(contrastRatio(colors.muted, fillColor) >= 4.5);
  }
  const frame = { ...makeNode("group", { x: 0, y: 0 }), fillColor: "#1e1e1e" };
  const note = { ...makeNode("note", { x: 0, y: 0 }), groupId: frame.id };
  doc.nodes.push(frame, note);
  assert.equal(nodeAppearance(note, doc).text, "#ffffff");
});
test("deleting a box retains the visible memo text and removes its connections", () => {
  const doc = growNodes(sampleDocument()),
    text = doc.nodes.find((n) => n.id === "worker").body;
  const next = removeSelection(doc, ["worker"]);
  const note = next.nodes.find((n) => n.id === "worker-note");
  assert.equal(note.body, text);
  assert.equal(note.title, "Worker のメモ");
  assert.equal(note.attachedTo, undefined);
  assert.ok(next.edges.every((e) => e.from !== "worker" && e.to !== "worker"));
  assert.equal(
    doc.nodes.find((n) => n.id === "worker-note").attachedTo,
    "worker",
  );
  decode(encode(next));
});
test("moving a group moves members and attached notes exactly once; removing the group keeps them", () => {
  const { doc, id } = groupSelection(growNodes(sampleDocument()), [
    "queue",
    "worker",
  ]);
  const moved = moveNodes(doc, [id, "worker"], 24, 48);
  for (const nodeId of ["queue", "worker", "worker-note", id]) {
    const a = doc.nodes.find((n) => n.id === nodeId),
      b = moved.nodes.find((n) => n.id === nodeId);
    assert.equal(b.x - a.x, 24);
    assert.equal(b.y - a.y, 48);
  }
  assert.deepEqual(
    moved.nodes.find((n) => n.id === "api"),
    doc.nodes.find((n) => n.id === "api"),
  );
  const ungrouped = removeSelection(moved, [id]);
  assert.ok(ungrouped.nodes.some((n) => n.id === "worker"));
  assert.ok(ungrouped.nodes.every((n) => n.groupId !== id));
});
test("duplicating a group remaps membership, memo references and internal connections", () => {
  const { doc, id } = groupSelection(growNodes(sampleDocument()), [
    "queue",
    "worker",
  ]);
  const fragment = selectionDocument(doc, [id]),
    result = pasteDocument(doc, fragment, { x: 30, y: 30 }),
    copied = result.doc.nodes.filter((n) => result.ids.includes(n.id));
  const group = copied.find((n) => n.kind === "group"),
    worker = copied.find((n) => n.title === "Worker"),
    note = copied.find((n) => n.attachedTo);
  assert.equal(worker.groupId, group.id);
  assert.equal(note.attachedTo, worker.id);
  assert.ok(
    result.doc.edges.some(
      (e) => result.ids.includes(e.from) && e.to === worker.id,
    ),
  );
  assert.equal(
    new Set(result.doc.nodes.map((n) => n.id)).size,
    result.doc.nodes.length,
  );
  decode(encode(result.doc));
});
test("copying just an attached note materializes its content", () => {
  const doc = growNodes(sampleDocument()),
    fragment = selectionDocument(doc, ["worker-note"]);
  assert.equal(fragment.nodes[0].attachedTo, undefined);
  assert.equal(
    fragment.nodes[0].body,
    doc.nodes.find((n) => n.id === "worker").body,
  );
  decode(encode(fragment));
});
test("arrange handles cycles and preserves unselected boxes and free notes", () => {
  const doc = growNodes(sampleDocument());
  doc.edges.push({
    id: "cycle",
    from: "worker",
    to: "queue",
    label: "再試行",
    dashed: true,
  });
  const result = arrange(doc, ["queue", "worker"]);
  for (const n of doc.nodes.filter(
    (n) =>
      ["browser", "api", "db"].includes(n.id) ||
      (n.kind === "note" && !n.attachedTo),
  ))
    assert.deepEqual(
      result.nodes.find((x) => x.id === n.id),
      n,
    );
  assert.ok(
    result.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)),
  );
  assert.deepEqual(arrange(doc, ["queue", "worker"]), result);
  decode(encode(result));
});
test("one drag is one undo step, including attachment positions; cancel adds no history", () => {
  const initial = growNodes(sampleDocument());
  let history = { present: initial, past: [], future: [] };
  history = historyReducer(history, {
    type: "preview",
    next: moveNodes(initial, ["worker"], 20, 20),
  });
  history = historyReducer(history, {
    type: "preview",
    next: moveNodes(initial, ["worker"], 40, 50),
  });
  history = historyReducer(history, {
    type: "commit",
    next: history.present,
    before: initial,
  });
  assert.equal(history.past.length, 1);
  history = historyReducer(history, { type: "undo" });
  assert.deepEqual(history.present, initial);
  history = historyReducer(history, { type: "redo" });
  assert.equal(history.present.nodes.find((n) => n.id === "worker").x, 760);
  const before = history.present;
  history = historyReducer(history, {
    type: "preview",
    next: moveNodes(before, ["worker"], 12, 12),
  });
  history = historyReducer(history, { type: "commit", next: before, before });
  assert.equal(history.past.length, 1);
  assert.deepEqual(history.present, before);
});
test("long Japanese notes grow and their own saved JSON stays readable", () => {
  const doc = emptyDocument(),
    note = makeNode("note", { x: 0, y: 0 });
  note.w = 160;
  note.body = "日本語".repeat(2000);
  doc.nodes.push(note);
  growNodes(doc);
  assert.ok(note.h > 10000);
  assert.ok(note.h <= 20000);
  assert.deepEqual(decode(encode(doc)), doc);
});
test("adding an existing attachment is idempotent; frames fit all members", () => {
  const doc = growNodes(sampleDocument()),
    existing = attachNote(doc, "worker");
  assert.equal(existing.doc, doc);
  const result = attachNote(doc, "api");
  assert.equal(result.doc.nodes.length, doc.nodes.length + 1);
  const grouped = groupSelection(result.doc, ["api"]),
    fitted = fitGroup(grouped.doc, grouped.id),
    frame = fitted.nodes.find((n) => n.id === grouped.id);
  for (const n of fitted.nodes.filter((n) => n.groupId === frame.id)) {
    assert.ok(n.x >= frame.x);
    assert.ok(n.y + n.h <= frame.y + frame.h);
  }
});
test("automatic routes follow boundaries and avoid a blocking box", () => {
  const doc = emptyDocument();
  doc.nodes = ["a", "block", "b"].map((id, i) => ({
    ...makeNode("box", { x: i * 300, y: 100 }),
    id,
  }));
  const route = routeEdge(
      { id: "e", from: "a", to: "b", label: "", dashed: false },
      doc.nodes,
    ),
    block = doc.nodes[1];
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1],
      b = route.points[i];
    assert.ok(a.x === b.x || a.y === b.y);
    const crosses =
      a.x === b.x
        ? a.x > block.x &&
          a.x < block.x + block.w &&
          Math.max(a.y, b.y) > block.y &&
          Math.min(a.y, b.y) < block.y + block.h
        : a.y > block.y &&
          a.y < block.y + block.h &&
          Math.max(a.x, b.x) > block.x &&
          Math.min(a.x, b.x) < block.x + block.w;
    assert.equal(crosses, false);
  }
  assert.ok(route.path.startsWith("M "));
});
test("portable SVG is valid XML, escapes text and includes attached memo contents", () => {
  const doc = growNodes(sampleDocument());
  doc.title = '構成 <A> & "B"';
  doc.nodes[0].title = "<script>alert(1)</script>\u0007";
  const svg = toSvg(doc),
    parsed = new JSDOM(svg, { contentType: "image/svg+xml" });
  assert.equal(parsed.window.document.querySelectorAll("script").length, 0);
  assert.equal(
    parsed.window.document.querySelector("title").textContent,
    doc.title,
  );
  assert.ok(
    parsed.window.document.documentElement.textContent.includes("同じ通知"),
  );
  assert.equal(
    parsed.window.document.querySelectorAll("[marker-end]").length,
    doc.edges.length,
  );
  assert.equal(documentRoutes(doc).size, doc.edges.length);
  assert.equal(
    parsed.window.document.querySelectorAll('[stroke-dasharray="3 5"]').length,
    doc.nodes.filter((node) => node.attachedTo).length,
  );
});
test("a new figure is placed clear of figures, lines and labels", async () => {
  const { placeInFreeSpace } = await import("../canvas/src/model.ts");
  const doc = growNodes(sampleDocument()),
    // Centered on the API → Queue line and its label.
    node = makeNode("box", { x: 400, y: 190 });
  placeInFreeSpace(node, doc);
  const hit = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  assert.ok(
    doc.nodes.every((n) => n.kind === "group" || !hit(node, n)),
    "overlaps a figure",
  );
  for (const r of documentRoutes(doc).values())
    r.points.slice(1).forEach((p, i) => {
      const q = r.points[i];
      const seg = {
        x: Math.min(p.x, q.x),
        y: Math.min(p.y, q.y),
        w: Math.abs(p.x - q.x),
        h: Math.abs(p.y - q.y),
      };
      assert.ok(!hit(node, seg), "crosses a line");
    });
});
test("guides snap the nearest edge or center within the threshold on each axis", async () => {
  const { snapToGuides } = await import("../canvas/src/spatial.ts");
  const other = { x: 100, y: 100, w: 200, h: 80 };
  const near = snapToGuides({ x: 104, y: 300, w: 120, h: 60 }, [other], 6);
  assert.equal(near.dx, -4);
  assert.equal(near.dy, null);
  assert.deepEqual(near.guides, [{ x1: 100, x2: 100, y1: 100, y2: 360 }]);
  const centered = snapToGuides({ x: 400, y: 107, w: 100, h: 60 }, [other], 6);
  // Its center (137) is nearer to the other's center (140) than its top is.
  assert.equal(centered.dy, 3);
  assert.equal(
    snapToGuides({ x: 120, y: 300, w: 120, h: 60 }, [other], 6).dx,
    null,
  );
});
test("a long line label is kept clear of the figures it would sit under", async () => {
  const { labelBox } = await import("../canvas/src/geometry.ts");
  const doc = emptyDocument(),
    api = { ...makeNode("box", { x: 0, y: 0 }), id: "api", title: "API" },
    queue = {
      ...makeNode("box", { x: 330, y: 0 }),
      id: "queue",
      title: "Queue",
    };
  doc.nodes = [api, queue];
  doc.edges = [
    {
      id: "e",
      from: "api",
      to: "queue",
      label: "注文確定イベント（注文ID・送信先・メッセージ種別を含む）",
      dashed: false,
    },
  ];
  const route = documentRoutes(doc).get("e"),
    box = labelBox(route.label, route.labelLines),
    hit = (a, b) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  assert.ok(!hit(box, api) && !hit(box, queue), JSON.stringify(box));
  assert.equal(route.labelLines.join(""), doc.edges[0].label);
});
test("only figures on a chosen color get a fixed text color; others follow the theme", () => {
  const doc = sampleDocument(),
    worker = doc.nodes.find((n) => n.id === "worker");
  assert.equal(nodeAppearance(worker, doc).customBackground, false);
  assert.equal(
    nodeAppearance({ ...worker, fillColor: "transparent" }, doc)
      .customBackground,
    false,
  );
  assert.equal(
    nodeAppearance({ ...worker, fillColor: "#1971c2" }, doc).customBackground,
    true,
  );
  const group = {
    ...makeNode("group", { x: 0, y: 0 }),
    id: "g",
    fillColor: "#343a40",
  };
  doc.nodes.push(group);
  const note = doc.nodes.find((n) => n.kind === "note" && !n.attachedTo);
  assert.equal(
    nodeAppearance({ ...note, groupId: "g" }, doc).customBackground,
    true,
  );
});
