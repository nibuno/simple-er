import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "http://localhost:5173" },
);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "SVGElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "localStorage",
  "HTMLInputElement",
])
  Object.defineProperty(globalThis, key, {
    value: dom.window[key],
    configurable: true,
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.CSS = { escape: (value) => value };
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const React = await import("react");
const { act } = React;
// jsdom has no SVG layout or pointer capture; provide deterministic geometry.
Object.defineProperty(dom.window.SVGSVGElement.prototype, "clientWidth", {
  get: () => 1200,
});
Object.defineProperty(dom.window.SVGSVGElement.prototype, "clientHeight", {
  get: () => 720,
});
dom.window.SVGSVGElement.prototype.getScreenCTM = function () {
  const [x, y, w, h] = this.getAttribute("viewBox").split(" ").map(Number);
  return { inverse: () => ({ x, y, sx: w / 1200, sy: h / 720 }) };
};
globalThis.DOMPoint = class {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  matrixTransform(m) {
    return { x: this.x * m.sx + m.x, y: this.y * m.sy + m.y };
  }
};
dom.window.Element.prototype.setPointerCapture = function (id) {
  this.capture = id;
};
dom.window.Element.prototype.hasPointerCapture = function (id) {
  return this.capture === id;
};
dom.window.Element.prototype.releasePointerCapture = function () {
  this.capture = null;
};
const { createRoot } = await import("react-dom/client");
const { App } = await import("../src/App.tsx");
const { encode, decode, validateDiagram } = await import("../src/model.ts");
const { initial } = await import("../src/initial.ts");
let root;
const storageKey = "er-sketch.local.v1";
function byText(text) {
  const element = [...document.querySelectorAll("button")].find(
    (e) => e.textContent === text,
  );
  assert.ok(element, `button: ${text}`);
  return element;
}
function byLabel(label) {
  const el = [...document.querySelectorAll("[aria-label]")].find(
    (e) => e.getAttribute("aria-label") === label,
  );
  assert.ok(el, `label: ${label}`);
  return el;
}
async function click(element) {
  await act(() =>
    element.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
}
async function type(element, value) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(element, key) {
  await act(() =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
  );
}
async function submit() {
  await act(() =>
    document
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
function saved() {
  return decode(localStorage.getItem(storageKey));
}
async function mount() {
  root = createRoot(document.getElementById("root"));
  await act(() => root.render(<App />));
}
beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem(storageKey, encode(initial));
  await mount();
});
afterEach(async () => {
  await act(() => root.unmount());
});

test("React restores legacy JSON, edits logical names, persists and undoes/redoes", async () => {
  assert.equal(document.querySelectorAll("[data-table]").length, 3);
  await click(byLabel("usersを編集"));
  await type(
    document.querySelector('input[placeholder="例: ユーザー"]'),
    "ユーザー",
  );
  await submit();
  assert.equal(saved().tables[0].logicalName, "ユーザー");
  await click(document.querySelector('input[value="logical"]'));
  assert.ok(byLabel("ユーザーを編集"));
  await click(byLabel("元に戻す"));
  assert.equal(saved().tables[0].logicalName, "");
  await click(byLabel("やり直す"));
  assert.equal(saved().tables[0].logicalName, "ユーザー");
  await act(() => root.unmount());
  await mount();
  assert.ok(byLabel("ユーザーを編集"));
});

test("column reorder retains stable relation identities and manual routing", async () => {
  await click(byLabel("usersを編集"));
  await key(
    byLabel("カラム1を並べ替え。ドラッグ、または上下矢印キーで移動"),
    "ArrowDown",
  );
  await submit();
  assert.equal(saved().tables[0].columns[1].name, "id");
  assert.equal(saved().edges[0].from.row, 1);
  assert.equal(saved().edges[0].trunk, 395);
});

test("custom type stays editable and cancellation does not persist draft", async () => {
  await click(byLabel("usersを編集"));
  await act(() => {
    const select = byLabel("カラム2の型");
    select.value = "__custom__";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await type(byLabel("カラム2の独自の型"), "varchar(32)");
  await submit();
  assert.equal(saved().tables[0].columns[1].type, "varchar(32)");
  await click(byLabel("usersを編集"));
  await type(byLabel("カラム2の物理名"), "changed");
  await click(byText("キャンセル"));
  assert.equal(saved().tables[0].columns[1].name, "name");
});

test("tidy, new diagram, undo and redo preserve the full diagram", async () => {
  const before = saved();
  await click(byText("整頓"));
  assert.notDeepEqual(saved(), before);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
  await click(byText("新しい図"));
  assert.equal(saved().tables.length, 0);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
  assert.equal(byLabel("やり直す").disabled, false);
  await click(byLabel("usersを移動。矢印キーで移動できます。"));
  await key(byLabel("usersを移動。矢印キーで移動できます。"), "ArrowLeft");
  assert.equal(saved().tables[0].x, before.tables[0].x - 8);
  assert.equal(byLabel("やり直す").disabled, true);
});

test("multiple relationships share one column attachment and remain individually selectable", async () => {
  const { graph } = await import("./layout-fixtures.mjs");
  await act(() => root.unmount());
  localStorage.setItem(
    storageKey,
    encode(
      graph([
        ["users"],
        ["orders", ["users"]],
        ["comments", ["users", "orders"]],
      ]),
    ),
  );
  await mount();
  await click(byText("整頓"));
  const markers = [
    ...byLabel("users.id を接続").querySelectorAll(".port"),
  ].filter((el) => Number(el.getAttribute("cx")) > 0);
  assert.equal(markers.length, 1);
  assert.equal(
    document.querySelectorAll('.cardinality[data-maximum="many"]').length,
    3,
  );
  await click(byLabel("usersからordersへの接続線"));
  assert.equal(document.querySelectorAll(".edge.selected").length, 1);
  await click(byLabel("usersからcommentsへの接続線"));
  assert.equal(document.querySelectorAll(".edge.selected").length, 1);
});

test("React can delete and manually reconnect a relation", async () => {
  await click(byLabel("usersからordersへの接続線"));
  await click(byText("外部キーを削除"));
  assert.equal(saved().edges.length, 1);
  await key(byLabel("users.id を接続"), "Enter");
  await key(byLabel("orders.user_id を接続"), "Enter");
  assert.equal(saved().edges.length, 2);
  await click(byLabel("元に戻す"));
  assert.equal(saved().edges.length, 1);
});

test("automatic connection candidates apply and can be undone", async () => {
  await click(byLabel("usersからordersへの接続線"));
  await click(byText("外部キーを削除"));
  await click(byText("自動で接続"));
  assert.match(
    document.querySelector("dialog").textContent,
    /orders.user_id → users.id/,
  );
  await click(byText("選択した候補を接続"));
  assert.equal(saved().edges.length, 2);
  await click(byLabel("元に戻す"));
  assert.equal(saved().edges.length, 1);
});

test("validation keeps original diagram and modal open on duplicate name", async () => {
  const before = saved();
  await click(byLabel("usersを編集"));
  await type(
    document.querySelector('input[placeholder="例: users"]'),
    "orders",
  );
  await submit();
  assert.match(document.querySelector('[role="alert"]').textContent, /重複/);
  assert.ok(document.querySelector("dialog[open]"));
  assert.deepEqual(saved(), before);
});

test("adding and deleting a table can be undone without losing existing relations", async () => {
  const before = saved();
  await click(byText("テーブルを追加"));
  await submit();
  assert.equal(saved().tables.length, 4);
  assert.deepEqual(saved().edges, before.edges);
  await click(byLabel("table_1を編集"));
  await click(byText("テーブルを削除"));
  assert.deepEqual(saved(), before);
  await click(byLabel("元に戻す"));
  assert.equal(saved().tables.length, 4);
});

test("invalid import preserves current data; valid legacy import is undoable", async () => {
  const before = saved(),
    input = document.querySelector('input[type="file"]');
  async function upload(text) {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ size: text.length, text: async () => text }],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await upload("{broken");
  assert.deepEqual(saved(), before);
  assert.match(
    document.querySelector(".instruction").textContent,
    /読み込めませんでした/,
  );
  await upload(encode(validateDiagram({ tables: [], edges: [] })));
  assert.equal(saved().tables.length, 0);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
});

async function pointer(element, type, x, y) {
  await act(() => {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    element.dispatchEvent(event);
  });
}
test("table pointer drag commits once, undo restores position, cancellation does not save", async () => {
  const before = saved(),
    svg = document.querySelector("#diagram");
  await pointer(
    byLabel("usersを移動。矢印キーで移動できます。"),
    "pointerdown",
    100,
    100,
  );
  await pointer(svg, "pointermove", 110, 110);
  await pointer(svg, "pointermove", 120, 120);
  assert.deepEqual(saved(), before);
  await pointer(svg, "pointerup", 120, 120);
  assert.equal(saved().tables[0].x, before.tables[0].x + 20);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
  assert.equal(byLabel("元に戻す").disabled, true);
  await pointer(
    byLabel("usersを移動。矢印キーで移動できます。"),
    "pointerdown",
    100,
    100,
  );
  await pointer(svg, "pointermove", 110, 110);
  await pointer(svg, "pointercancel", 110, 110);
  assert.deepEqual(saved(), before);
  assert.equal(
    document.querySelector('[data-table="users"]').getAttribute("transform"),
    `translate(${before.tables[0].x} ${before.tables[0].y})`,
  );
});
test("connection handle drag stays manual and undo restores its original route", async () => {
  const before = saved();
  await click(byLabel("usersからordersへの接続線"));
  assert.equal(document.querySelector(".drag-handle"), null);
  await click(byText("経路を調整"));
  const handle = byLabel("線の通り道を左右に調整"),
    svg = document.querySelector("#diagram");
  await pointer(handle, "pointerdown", 350, 250);
  await pointer(svg, "pointermove", 380, 250);
  await pointer(svg, "pointerup", 380, 250);
  assert.equal(saved().edges[0].manual, true);
  assert.notEqual(saved().edges[0].trunk, before.edges[0].trunk);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
});

async function wheel(element, options) {
  const event = new dom.window.WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(() => element.dispatchEvent(event));
  return event;
}
function currentView() {
  return document
    .querySelector("#diagram")
    .getAttribute("viewBox")
    .split(" ")
    .map(Number);
}
test("trackpad pans over tables at each zoom without modifying data or history", async () => {
  const before = saved();
  const table = document.querySelector(".table-heading");
  for (const zoom of [100, 125, 150]) {
    if (zoom !== 100) await click(byLabel("拡大"));
    const [x, y, w, h] = currentView();
    const event = await wheel(table, { deltaX: 24, deltaY: -48 });
    const next = currentView();
    assert.equal(event.defaultPrevented, true);
    assert.ok(Math.abs(next[0] - (x + (24 * 100) / zoom)) < 1e-8);
    assert.ok(Math.abs(next[1] - (y - (48 * 100) / zoom)) < 1e-8);
    assert.deepEqual(next.slice(2), [w, h]);
  }
  assert.deepEqual(saved(), before);
  assert.equal(byLabel("元に戻す").disabled, true);
});
test("scroll units are normalized, Command gestures pass through, and drag ignores scrolling", async () => {
  const svg = document.querySelector("#diagram");
  let [x, y, w, h] = currentView();
  await wheel(svg, { deltaMode: 1, deltaX: 2, deltaY: -3 });
  assert.deepEqual(currentView(), [x + 32, y - 48, w, h]);
  [x, y, w, h] = currentView();
  await wheel(svg, { deltaMode: 2, deltaX: -1, deltaY: 1 });
  assert.deepEqual(currentView(), [x - w, y + h, w, h]);
  const before = currentView();
  for (const modifier of ["metaKey"]) {
    const event = await wheel(svg, { deltaY: 60, [modifier]: true });
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(currentView(), before);
  }
  await pointer(
    document.querySelector(".table-heading"),
    "pointerdown",
    100,
    100,
  );
  await wheel(svg, { deltaX: 30, deltaY: 60 });
  assert.deepEqual(currentView(), before);
  await pointer(svg, "pointercancel", 100, 100);
});

test("pinch zoom anchors the cursor, clamps scale and leaves the diagram and history unchanged", async () => {
  const svg = document.querySelector("#diagram");
  const data = saved();
  const [x, y, w, h] = currentView();
  const anchor = [x + w / 4, y + h / 3];
  const event = await wheel(svg, {
    ctrlKey: true,
    deltaY: -Math.log(2) / 0.01,
    clientX: 300,
    clientY: 240,
  });
  assert.equal(event.defaultPrevented, true);
  let next = currentView();
  assert.ok(Math.abs(next[2] - w / 2) < 1e-8);
  assert.ok(Math.abs(next[0] + next[2] / 4 - anchor[0]) < 1e-8);
  assert.ok(Math.abs(next[1] + next[3] / 3 - anchor[1]) < 1e-8);
  assert.equal(document.querySelector("#zoom-label").textContent, "200%");
  await wheel(svg, { ctrlKey: true, deltaY: -10000 });
  assert.equal(document.querySelector("#zoom-label").textContent, "400%");
  await wheel(svg, { ctrlKey: true, deltaY: 10000 });
  assert.equal(document.querySelector("#zoom-label").textContent, "25%");
  assert.deepEqual(saved(), data);
  assert.equal(byLabel("元に戻す").disabled, true);
  const view = currentView();
  const outside = await wheel(document.querySelector("header"), {
    ctrlKey: true,
    deltaY: -40,
  });
  assert.equal(outside.defaultPrevented, false);
  assert.deepEqual(currentView(), view);
});
async function gesture(type, scale) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: 300, clientY: 240 });
  await act(() => document.querySelector("#diagram").dispatchEvent(event));
  assert.equal(event.defaultPrevented, true);
}
test("WebKit pinch uses cumulative scale without double applying wheel events and resumes panning", async () => {
  const [x, y, w, h] = currentView();
  await gesture("gesturestart", 1);
  await gesture("gesturechange", 1.5);
  await wheel(document.querySelector("#diagram"), {
    ctrlKey: true,
    deltaY: -40,
  });
  assert.equal(document.querySelector("#zoom-label").textContent, "150%");
  await gesture("gesturechange", 2);
  assert.equal(document.querySelector("#zoom-label").textContent, "200%");
  let next = currentView();
  assert.ok(Math.abs(next[0] + next[2] / 4 - (x + w / 4)) < 1e-8);
  assert.ok(Math.abs(next[1] + next[3] / 3 - (y + h / 3)) < 1e-8);
  await gesture("gestureend", 2);
  await gesture("gesturestart", 1);
  await gesture("gesturechange", 0.5);
  await gesture("gestureend", 0.5);
  assert.equal(document.querySelector("#zoom-label").textContent, "100%");
  next = currentView();
  await wheel(document.querySelector("#diagram"), { deltaX: 24, deltaY: -48 });
  assert.deepEqual(currentView(), [
    next[0] + 24,
    next[1] - 48,
    next[2],
    next[3],
  ]);
});

test("adding repeated columns focuses the new name and keeps edits as a cancellable draft", async () => {
  const before = saved();
  await click(byLabel("usersを編集"));
  const originalCount = document.querySelectorAll(".column-edit-row").length;
  for (let i = 1; i <= 12; i++) {
    await click(byText("カラムを追加"));
    const input = byLabel(`カラム${originalCount + i}の物理名`);
    assert.equal(document.activeElement, input);
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, input.value.length);
  }
  assert.deepEqual(saved(), before);
  await click(byText("キャンセル"));
  assert.deepEqual(saved(), before);
});

test("inline physical and logical rename supports cancel, validation, undo and redo", async () => {
  const before = saved();
  await key(byLabel("usersを移動。矢印キーで移動できます。"), "Enter");
  await type(byLabel("図上で物理名を編集"), "members");
  await submit();
  assert.equal(saved().tables[0].name, "members");
  assert.deepEqual(saved().edges, before.edges);
  await click(byLabel("元に戻す"));
  assert.equal(saved().tables[0].name, "users");
  await click(byLabel("やり直す"));
  assert.equal(saved().tables[0].name, "members");
  await key(byLabel("members.id を接続"), "F2");
  await type(byLabel("図上で物理名を編集"), "cancelled");
  await key(byLabel("図上で物理名を編集"), "Escape");
  assert.equal(saved().tables[0].columns[0].name, "id");
  await click(document.querySelector('input[value="logical"]'));
  await key(byLabel("members.id を接続"), "F2");
  await type(byLabel("図上で論理名を編集"), "会員番号");
  await submit();
  assert.equal(saved().tables[0].columns[0].logicalName, "会員番号");
  await key(byLabel("members.name を接続"), "F2");
  await key(byLabel("図上で論理名を編集"), "Escape");
});
test("key list edits ordered indexes and line selection opens the same reference editor", async () => {
  await click(byLabel("usersを編集"));
  await click(byText("＋ 追加"));
  await click(byLabel("emailを対象カラムに含める"));
  await click(byLabel("nameを対象カラムに含める"));
  await click(byText("完了"));
  assert.match(document.querySelector(".key-list").textContent, /email, name/);
  await submit();
  assert.deepEqual(saved().tables[0].keys[1].columnIds, [
    "users:column:2",
    "users:column:1",
  ]);
  await click(byLabel("usersからordersへの接続線"));
  await click(byText("外部キーを編集"));
  assert.ok(byLabel("外部キー1の参照先テーブル"));
  await click(byText("キャンセル"));
});
test("inline duplicate name keeps the editor open and does not change saved data", async () => {
  const before = saved();
  await key(byLabel("usersを移動。矢印キーで移動できます。"), "Enter");
  await type(byLabel("図上で物理名を編集"), "orders");
  await submit();
  assert.match(
    document.querySelector('.inline-name [role="alert"]').textContent,
    /重複/,
  );
  assert.deepEqual(saved(), before);
  await key(byLabel("図上で物理名を編集"), "Escape");
});
test("table deletion retains incoming foreign keys as unresolved and undo restores them", async () => {
  const before = saved();
  await click(byLabel("usersを編集"));
  await click(byText("テーブルを削除"));
  const orders = saved().tables.find((t) => t.id === "orders");
  assert.equal(orders.foreignKeys.length, 1);
  assert.equal(orders.foreignKeys[0].target, undefined);
  assert.equal(saved().edges.length, 1);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
});
test("legacy backup quota failure preserves the successfully loaded diagram", async () => {
  await act(() => root.unmount());
  const legacy = {
    tables: [{ id: "custom", x: 0, y: 0, columns: [["id", "uuid", "PK"]] }],
    edges: [],
  };
  localStorage.setItem(
    storageKey,
    JSON.stringify({ format: "er-sketch", version: 1, diagram: legacy }),
  );
  const proto = Object.getPrototypeOf(localStorage),
    original = proto.setItem;
  proto.setItem = function (key, value) {
    if (key.endsWith(".v1-backup")) throw new Error("quota");
    return original.call(this, key, value);
  };
  try {
    await mount();
    assert.ok(byLabel("customを編集"));
    assert.match(document.querySelector(".instruction").textContent, /退避先/);
  } finally {
    proto.setItem = original;
  }
});

test("foreign-key editor chooses a composite target and shows each mapping on the same row", async () => {
  await act(() => root.unmount());
  const d = structuredClone(initial);
  d.tables[0].keys[0].columnIds.push("users:column:1");
  d.tables[1].foreignKeys = [];
  localStorage.setItem(storageKey, encode(d));
  await mount();
  await click(byLabel("ordersを編集"));
  await click(byLabel("user_idに参照先を追加"));
  async function choose(label, value) {
    await act(() => {
      const select = byLabel(label);
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await choose("外部キー1の参照先テーブル", "users");
  assert.equal(document.querySelectorAll(".mapping-row").length, 2);
  await choose("外部キー1の参照元 1", "orders:column:0");
  await choose("外部キー1の参照元 2", "orders:column:1");
  assert.deepEqual(
    [...document.querySelectorAll(".mapping-target")].map((e) => e.textContent),
    ["id", "name"],
  );
  await click(byText("完了"));
  await click(byLabel("user_idの参照先 users.nameを編集"));
  assert.equal(byLabel("外部キー1の参照元 2").value, "orders:column:1");
  await submit();
  assert.doesNotMatch(
    document.querySelector(".instruction").textContent,
    /接続-\d|削除しました/,
  );
  const f = saved().tables[1].foreignKeys[0];
  assert.deepEqual(f.columnIds, ["orders:column:0", "orders:column:1"]);
  assert.deepEqual(f.target.columnIds, ["users:column:0", "users:column:1"]);
  await click(byLabel("usersからordersへの接続線"));
  assert.equal(document.querySelectorAll(".edge.selected").length, 2);
  await click(byText("外部キーを削除"));
  assert.equal(saved().tables[1].foreignKeys.length, 0);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved().tables[1].foreignKeys[0], f);
});

test("opening a second relationship expands its own settings", async () => {
  await act(() => root.unmount());
  const d = structuredClone(initial),
    fk = d.tables[1].foreignKeys[0];
  d.tables[1].foreignKeys.push({
    ...structuredClone(fk),
    id: "second-fk",
    name: "second",
    columnIds: ["orders:column:0"],
  });
  localStorage.setItem(storageKey, encode(d));
  await mount();
  const lines = document.querySelectorAll(".edge");
  await click(lines[1]);
  await click(byText("外部キーを編集"));
  const expanded = document.querySelector(".definition-editor");
  assert.match(expanded.querySelector("summary").textContent, /second/);
  assert.equal(byLabel("外部キー2の名前").value, "second");
  await click(byText("キャンセル"));
});

test("single-column FK can be entered source-first and target choices retain unique constraint identity", async () => {
  await act(() => root.unmount());
  const d = structuredClone(initial);
  d.tables[0].keys.push({
    id: "email-unique",
    kind: "unique",
    name: "email_unique",
    columnIds: ["users:column:2"],
  });
  d.tables[1].foreignKeys = [];
  localStorage.setItem(storageKey, encode(d));
  await mount();
  await click(byLabel("ordersを編集"));
  await click(byLabel("user_idに参照先を追加"));
  async function choose(label, value) {
    await act(() => {
      const select = byLabel(label);
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await choose("外部キー1の参照元 1", "orders:column:1");
  await choose("外部キー1の参照先テーブル", "users");
  assert.equal(byLabel("外部キー1の参照元 1").value, "orders:column:1");
  assert.equal(
    document.querySelectorAll(".reference-tables select, .mapping-grid select")
      .length,
    3,
  );
  assert.equal(byLabel("外部キー1の参照先キー").value, "");
  await choose("外部キー1の参照先キー", "email-unique");
  assert.equal(
    document.querySelector(".mapping-target select").value,
    "email-unique",
  );
  assert.equal(document.querySelectorAll(".mapping-row").length, 1);
  assert.equal(
    document.querySelector(".definition-editor .definition-name").open,
    false,
  );
  await submit();
  assert.deepEqual(saved().tables[1].foreignKeys[0].target, {
    tableId: "users",
    columnIds: ["users:column:2"],
  });
});

test("column checks maintain one composite PK and independent single-column unique constraints", async () => {
  const before = saved();
  await click(byLabel("order_itemsを編集"));
  assert.equal(document.querySelector(".editor-tabs"), null);
  await click(byLabel("quantityを主キーに含める"));
  await click(byLabel("product_nameの単独一意制約"));
  await click(byLabel("quantityの単独一意制約"));
  assert.match(document.querySelector(".key-list").textContent, /id, quantity/);
  await click(byText("＋ 追加"));
  await act(() => {
    const select = byLabel("キーの種類");
    select.value = "unique";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(byLabel("product_nameを対象カラムに含める"));
  await click(byLabel("quantityを対象カラムに含める"));
  await click(byText("完了"));
  await click(byLabel("quantityの単独一意制約"));
  await submit();
  const table = saved().tables.find((t) => t.id === "order_items");
  assert.deepEqual(
    table.keys.filter((k) => k.kind === "primary").map((k) => k.columnIds),
    [["order_items:column:0", "order_items:column:3"]],
  );
  assert.deepEqual(
    table.keys.filter((k) => k.kind === "unique").map((k) => k.columnIds),
    [
      ["order_items:column:2"],
      ["order_items:column:2", "order_items:column:3"],
    ],
  );
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
});

test("ordered key edits preserve the constraint ID and cancelling restores only that definition", async () => {
  await click(byLabel("order_itemsを編集"));
  await click(byLabel("quantityを主キーに含める"));
  await submit();
  const before = saved(),
    pk = before.tables[2].keys.find((k) => k.kind === "primary");
  await click(byLabel("order_itemsを編集"));
  await click(byLabel("主キー id, quantityを編集"));
  await click(byLabel("quantityを前へ"));
  await click(byText("完了"));
  await submit();
  assert.deepEqual(
    saved().tables[2].keys.find((k) => k.id === pk.id).columnIds,
    ["order_items:column:3", "order_items:column:0"],
  );
  await click(byLabel("order_itemsを編集"));
  await click(byLabel("主キー quantity, idを編集"));
  await click(byLabel("idを前へ"));
  await type(byLabel("カラム3の論理名"), "商品");
  await click(byText("編集を取り消す"));
  await submit();
  assert.deepEqual(
    saved().tables[2].keys.find((k) => k.id === pk.id).columnIds,
    ["order_items:column:3", "order_items:column:0"],
  );
  assert.equal(saved().tables[2].columns[2].logicalName, "商品");
});

test("reference entry and line entry edit the same FK; cancelling new and existing references preserves other edits", async () => {
  const before = saved();
  await click(byLabel("ordersを編集"));
  await click(byLabel("totalに参照先を追加"));
  await click(byText("編集を取り消す"));
  assert.ok(!document.querySelector(".definition-editor"));
  await click(byLabel("user_idの参照先 users.idを編集"));
  assert.equal(byLabel("外部キー1の参照先テーブル").value, "users");
  await act(() => {
    const select = byLabel("外部キー1の参照先テーブル");
    select.value = "orders";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await type(byLabel("カラム2の論理名"), "会員ID");
  await click(byText("編集を取り消す"));
  await submit();
  assert.deepEqual(saved().tables[1].foreignKeys, before.tables[1].foreignKeys);
  assert.deepEqual(saved().edges, before.edges);
  assert.equal(saved().tables[1].columns[1].logicalName, "会員ID");
});

test("an unfinished key cannot close or save silently and can be cancelled", async () => {
  const before = saved();
  await click(byLabel("usersを編集"));
  await click(byText("＋ 追加"));
  assert.equal(byText("完了").disabled, true);
  await submit();
  assert.ok(document.querySelector("dialog[open]"));
  assert.deepEqual(saved(), before);
  await click(byText("編集を取り消す"));
  await submit();
  assert.deepEqual(saved(), before);
});

test("relationship label and cardinality edits persist, render, undo and reload", async () => {
  const before = saved();
  await click(byLabel("usersからordersへの接続線"));
  await click(byText("外部キーを編集"));
  await type(byLabel("関係ラベル"), "注文する");
  for (const [label, value] of [
    ["参照先の件数", "1"],
    ["参照元の件数", "0"],
  ])
    await act(() => {
      const select = byLabel(label);
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await click(byText("完了"));
  await submit();
  const next = saved(),
    fk = next.tables[1].foreignKeys[0];
  assert.equal(fk.label, "注文する");
  assert.deepEqual(fk.cardinality, { parentMinimum: 1, childMinimum: 0 });
  assert.equal(
    document.querySelector(".relationship-label text").textContent,
    "注文する",
  );
  const edge = byLabel("usersからordersへの接続線");
  assert.ok(
    edge.querySelector('.cardinality[data-maximum="one"][data-minimum="1"]'),
  );
  assert.ok(
    edge.querySelector('.cardinality[data-maximum="many"][data-minimum="0"]'),
  );
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
  await click(byLabel("やり直す"));
  assert.deepEqual(saved(), next);
  await act(() => root.unmount());
  await mount();
  assert.equal(
    document.querySelector(".relationship-label text").textContent,
    "注文する",
  );
});

test("returning a manually adjusted line to automatic routing is undoable", async () => {
  await click(byLabel("usersからordersへの接続線"));
  await click(byText("経路を調整"));
  await key(byLabel("線の通り道を左右に調整"), "ArrowRight");
  const manual = saved();
  assert.equal(manual.edges[0].manual, true);
  await click(byText("線を自動に戻す"));
  assert.equal(saved().edges[0].trunk, null);
  assert.equal(saved().edges[0].manual, false);
  assert.equal(document.querySelector(".drag-handle"), null);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), manual);
});

test("legacy issue dismissal persists and undo restores it; pending FK opens its editor", async () => {
  await act(() => root.unmount());
  const d = validateDiagram(initial);
  d.unresolvedEdges = [
    {
      id: "old",
      from: { table: "users", row: 0, side: "right" },
      to: { table: "orders", row: 1, side: "left" },
      trunk: null,
      manual: false,
    },
  ];
  delete d.tables.find((t) => t.id === "orders").foreignKeys[0].target;
  localStorage.setItem(storageKey, encode(d));
  await mount();
  assert.match(
    document.querySelector(".migration-notice summary").textContent,
    /要確認 2件/,
  );
  await click(byLabel("旧データの線1を破棄"));
  assert.equal(saved().unresolvedEdges.length, 0);
  await click(byLabel("元に戻す"));
  assert.equal(saved().unresolvedEdges.length, 1);
  await click(document.querySelector(".issue-row button"));
  assert.ok(document.querySelector("#table-editor[open]"));
  assert.match(document.querySelector("#table-editor").textContent, /参照先/);
});

test("removing a referenced primary key shows impact and preserves an editable pending FK", async () => {
  await click(byLabel("usersを編集"));
  const checkbox = document.querySelector(
    'input[aria-label="idを主キーに含める"]',
  );
  assert.ok(checkbox);
  await click(checkbox);
  assert.match(
    document.querySelector(".reference-impact").textContent,
    /外部キー1件が参照先未設定/,
  );
  await submit();
  assert.equal(
    saved().tables.find((t) => t.id === "orders").foreignKeys[0].target,
    undefined,
  );
  assert.match(
    document.querySelector(".migration-notice").textContent,
    /orders.user_id/,
  );
  await click(byLabel("元に戻す"));
  assert.ok(
    saved().tables.find((t) => t.id === "orders").foreignKeys[0].target,
  );
});

test("another tab's write pauses ER autosave until the saved diagram is explicitly loaded", async () => {
  const remote = saved();
  remote.tables[0].name = "remote_users";
  const raw = encode(remote);
  localStorage.setItem(storageKey, raw);
  await act(() =>
    window.dispatchEvent(
      new dom.window.StorageEvent("storage", {
        key: storageKey,
        newValue: raw,
      }),
    ),
  );
  assert.match(document.body.textContent, /自動保存を停止/);
  await click(byLabel("usersを編集"));
  await submit();
  assert.equal(localStorage.getItem(storageKey), raw);
  await click(byText("保存されている図を読み込む"));
  assert.ok(byLabel("remote_usersを編集"));
  assert.doesNotMatch(document.body.textContent, /自動保存を停止/);
  assert.equal(byLabel("元に戻す").disabled, true);
  assert.equal(saved().tables[0].name, "remote_users");
});

test("no-op and cancelled document-backed drag preserve undo and redo boundaries", async () => {
  const raw = localStorage.getItem(storageKey);
  const svg = document.querySelector("#diagram");
  const header = () => byLabel("usersを移動。矢印キーで移動できます。");
  await pointer(header(), "pointerdown", 100, 100);
  await pointer(svg, "pointerup", 100, 100);
  assert.equal(localStorage.getItem(storageKey), raw);
  assert.equal(byLabel("元に戻す").disabled, true);
  await pointer(header(), "pointerdown", 100, 100);
  await pointer(svg, "pointermove", 120, 120);
  await pointer(svg, "pointerup", 120, 120);
  await click(byLabel("元に戻す"));
  assert.equal(byLabel("やり直す").disabled, false);
  await pointer(header(), "pointerdown", 100, 100);
  await pointer(svg, "pointermove", 130, 130);
  await pointer(svg, "pointercancel", 130, 130);
  assert.equal(localStorage.getItem(storageKey), raw);
  assert.equal(byLabel("元に戻す").disabled, true);
  assert.equal(byLabel("やり直す").disabled, false);
});

test("clicking a table header selects it and the inspector renames it with undo", async () => {
  const svg = document.querySelector("#diagram");
  await pointer(
    byLabel("ordersを移動。矢印キーで移動できます。"),
    "pointerdown",
    100,
    100,
  );
  await pointer(svg, "pointerup", 101, 101);
  assert.ok(document.querySelector('[data-table="orders"].selected'));
  assert.ok(document.querySelector(".row.related"));
  assert.equal(byLabel("元に戻す").disabled, true);
  const inspector = byLabel("ordersの詳細");
  assert.match(inspector.textContent, /user_id/);
  assert.match(
    inspector.querySelector(".ddl").textContent,
    /CREATE TABLE orders/,
  );
  const name = byLabel("インスペクタで物理名を編集");
  await type(name, "purchases");
  await act(() => name.dispatchEvent(new Event("focusout", { bubbles: true })));
  assert.equal(saved().tables.find((t) => t.id === "orders").name, "purchases");
  assert.ok(byLabel("purchasesの詳細"));
  await click(byLabel("元に戻す"));
  assert.equal(saved().tables.find((t) => t.id === "orders").name, "orders");
  await click(byLabel("詳細を閉じる"));
  assert.equal(document.querySelector(".inspector"), null);
});

test("sidebar lists tables and relations and selects them", async () => {
  const items = [...document.querySelectorAll(".sidebar-item")];
  assert.deepEqual(
    items
      .filter((b) => !b.classList.contains("relation"))
      .map((b) => b.textContent),
    ["users4", "orders4", "order_items4"],
  );
  await click(items.find((b) => b.textContent.startsWith("users")));
  assert.ok(byLabel("usersの詳細"));
  await click(document.querySelector(".sidebar-item.relation"));
  assert.equal(document.querySelectorAll(".edge.selected").length, 1);
  assert.equal(document.querySelector(".inspector"), null);
  assert.ok(byText("外部キーを編集"));
  await type(byLabel("テーブルを絞り込む"), "item");
  assert.deepEqual(
    [...document.querySelectorAll(".sidebar-item:not(.relation)")].map(
      (b) => b.textContent,
    ),
    ["order_items4"],
  );
});

test("clicking a column selects only; dragging from its dot connects tables", async () => {
  await click(byLabel("usersからordersへの接続線"));
  await click(byText("外部キーを削除"));
  const before = saved().edges.length;
  await click(byLabel("users.email を接続"));
  assert.equal(document.querySelector(".connect-hint"), null);
  assert.ok(byLabel("usersの詳細"));
  assert.equal(saved().edges.length, before);
  const svg = document.querySelector("#diagram");
  const users = saved().tables.find((t) => t.id === "users");
  const orders = saved().tables.find((t) => t.id === "orders");
  const port = byLabel("users.id を接続").querySelectorAll(".port-hit")[1];
  const [vx, vy, vw, vh] = svg.getAttribute("viewBox").split(" ").map(Number);
  const at = (t, row) => [
    ((t.x + 40 - vx) * 1200) / vw,
    ((t.y + 52 + 38 * (row + 0.5) - vy) * 720) / vh,
  ];
  // Inside the same table: no self-reference.
  await pointer(port, "pointerdown", 0, 0);
  await pointer(svg, "pointermove", ...at(users, 1));
  assert.ok(document.querySelector(".link-preview"));
  assert.equal(document.querySelector(".link-preview.ready"), null);
  await pointer(svg, "pointerup", ...at(users, 1));
  assert.equal(saved().edges.length, before);
  // Onto orders.user_id (row 1): registers the foreign key.
  await pointer(port, "pointerdown", 0, 0);
  await pointer(svg, "pointermove", ...at(orders, 1));
  assert.ok(document.querySelector(".link-preview.ready"));
  await pointer(svg, "pointerup", ...at(orders, 1));
  assert.equal(saved().edges.length, before + 1);
  assert.equal(document.querySelector(".link-preview"), null);
});

test("Delete or Backspace removes the selected foreign key or table with undo", async () => {
  const edges = saved().edges.length;
  await click(document.querySelector(".sidebar-item.relation"));
  await key(document.body, "Delete");
  assert.equal(saved().edges.length, edges - 1);
  await click(byLabel("元に戻す"));
  assert.equal(saved().edges.length, edges);
  const users = [...document.querySelectorAll(".sidebar-item")].find((b) =>
    b.textContent.startsWith("users"),
  );
  await click(users);
  await key(byLabel("インスペクタで物理名を編集"), "Backspace");
  assert.equal(saved().tables.length, 3);
  await key(document.body, "Backspace");
  assert.equal(saved().tables.length, 2);
  assert.match(
    document.querySelector(".instruction").textContent,
    /usersを削除しました/,
  );
  await click(byLabel("元に戻す"));
  assert.equal(saved().tables.length, 3);
});
