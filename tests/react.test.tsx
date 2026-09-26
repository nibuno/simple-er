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
    document.querySelector('input[placeholder="ユーザー"]'),
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
  assert.equal(saved().tables[0].columns[1][0], "id");
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
  assert.equal(saved().tables[0].columns[1][1], "varchar(32)");
  await click(byLabel("usersを編集"));
  await type(byLabel("カラム2の物理名"), "changed");
  await click(byText("キャンセル"));
  assert.equal(saved().tables[0].columns[1][0], "name");
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

test("React can delete and manually reconnect a relation", async () => {
  await click(byLabel("usersからordersへの接続線"));
  await click(byText("接続を削除"));
  assert.equal(saved().edges.length, 1);
  await click(byLabel("users.id を接続"));
  await click(byLabel("orders.user_id を接続"));
  assert.equal(saved().edges.length, 2);
  await click(byLabel("元に戻す"));
  assert.equal(saved().edges.length, 1);
});

test("automatic connection candidates apply and can be undone", async () => {
  await click(byLabel("usersからordersへの接続線"));
  await click(byText("接続を削除"));
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
  await type(document.querySelector('input[placeholder="users"]'), "orders");
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
