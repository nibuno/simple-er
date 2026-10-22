import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: "http://localhost:5175" },
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
  "StorageEvent",
  "localStorage",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "FormData",
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
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
  get: () => 1200,
});
Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
  get: () => 700,
});
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
dom.window.HTMLElement.prototype.setPointerCapture = function () {};
dom.window.HTMLElement.prototype.hasPointerCapture = function () {
  return false;
};
const React = await import("react"),
  { act } = React;
const { createRoot } = await import("react-dom/client");
const { App } = await import("../canvas/src/App.tsx");
const {
  encode,
  decode,
  growNodes,
  sampleDocument,
  STORAGE_KEY,
  VIEW_KEY,
  emptyDocument,
  makeNode,
} = await import("../canvas/src/model.ts");
let root;
const saved = () => decode(localStorage.getItem(STORAGE_KEY));
function label(text) {
  const el = [...document.querySelectorAll("[aria-label]")].find(
    (el) => el.getAttribute("aria-label") === text,
  );
  assert.ok(el, text);
  return el;
}
function button(text) {
  const el = [...document.querySelectorAll("button")].find(
    (el) => el.textContent.trim() === text,
  );
  assert.ok(el, text);
  return el;
}
async function click(el) {
  await act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
async function type(el, value) {
  await act(() => {
    el.focus();
    Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    ).set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function blur(el) {
  await act(() => el.blur());
}
async function key(el, key, options = {}) {
  await act(() =>
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    ),
  );
}
// Opens a panel of the selection bar unless it is already open.
async function panel(name) {
  const toggle = label(name);
  if (toggle.getAttribute("aria-expanded") !== "true") await click(toggle);
}
async function dblclick(el) {
  await act(() =>
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 })),
  );
}
async function pointer(el, event, x, y) {
  await act(() => {
    const e = new MouseEvent(event, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperty(e, "pointerId", { value: 1 });
    el.dispatchEvent(e);
  });
}
async function submit() {
  await act(() =>
    document
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function mount() {
  root = createRoot(document.getElementById("root"));
  await act(() => root.render(<App />));
}
beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, encode(growNodes(sampleDocument())));
  await mount();
});
afterEach(async () => {
  await act(() => root.unmount());
});

test("inline Japanese edits persist; Escape keeps edits and undo takes them back", async () => {
  const before = saved();
  await click(label("箱を追加"));
  await type(label("名前を直接編集"), "監視");
  await type(label("説明を直接編集"), "失敗した通知に気づく");
  await act(() =>
    document
      .querySelector("form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  assert.ok(
    saved().nodes.some(
      (n) => n.title === "監視" && n.description === "失敗した通知に気づく",
    ),
  );
  await dblclick(label("監視を選択"));
  await type(label("名前を直接編集"), "監視サービス");
  await key(label("名前を直接編集"), "Escape");
  assert.equal(document.querySelector(".shape-text-editor"), null);
  assert.ok(saved().nodes.some((n) => n.title === "監視サービス"));
  await click(label("元に戻す"));
  assert.ok(saved().nodes.some((n) => n.title === "監視"));
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
  await click(label("やり直す"));
  assert.ok(saved().nodes.some((n) => n.title === "監視"));
});
test("empty additions never reach autosave or undo, whether submitted, dismissed, cancelled or reloaded", async () => {
  const before = saved();
  await click(label("箱を追加"));
  assert.equal(label("名前を直接編集").value, "");
  assert.equal(label("説明を直接編集").value, "");
  assert.deepEqual(saved(), before);
  await submit();
  assert.equal(document.querySelector("form"), null);
  assert.deepEqual(saved(), before);
  assert.ok(label("元に戻す").disabled);

  await click(label("箱を追加"));
  await click(label("Workerを選択"));
  assert.equal(document.querySelector("form"), null);
  assert.deepEqual(saved(), before);

  await click(label("箱を追加"));
  await key(label("名前を直接編集"), "Escape");
  assert.deepEqual(saved(), before, "Escape on an empty figure adds nothing");

  await click(label("箱を追加"));
  await type(label("名前を直接編集"), "　 ");
  await type(label("説明を直接編集"), "\n ");
  await submit();
  assert.deepEqual(saved(), before);

  await click(label("箱を追加"));
  await act(() =>
    window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  );
  assert.deepEqual(saved(), before);
  await act(() => root.unmount());
  await mount();
  assert.deepEqual(saved(), before);
  assert.ok(label("元に戻す").disabled);
});
test("a description alone creates a figure without a generated name, and creation is one undo step", async () => {
  const before = saved();
  await click(label("箱を追加"));
  await type(label("説明を直接編集"), "通知の送信を待つ");
  await click(label("Workerを選択"));
  const added = saved().nodes.find(
    (n) => !before.nodes.some((old) => old.id === n.id),
  );
  assert.equal(added.title, "");
  assert.equal(added.description, "通知の送信を待つ");
  const face = document.querySelector(
    `[data-node-id="${added.id}"] .node-face`,
  );
  assert.equal(face.textContent, "通知の送信を待つ");
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
  await click(label("やり直す"));
  assert.deepEqual(
    saved().nodes.find((n) => n.id === added.id),
    added,
  );
});
test("new shapes can be created, converted, connected and reloaded", async () => {
  for (const [shape, name] of [
    ["ellipse", "楕円"],
    ["diamond", "ひし形"],
    ["cylinder", "円柱"],
  ]) {
    await click(label(name + "を追加"));
    await type(label("名前を直接編集"), name + "の図形");
    await key(label("名前を直接編集"), "Enter", { metaKey: true });
    assert.equal(
      saved().nodes.find((n) => n.title === name + "の図形").shape,
      shape,
    );
  }
  await click(label("接続"));
  await click(label("楕円の図形を選択"));
  await click(label("ひし形の図形を選択"));
  const connection = saved().edges.at(-1);
  assert.equal(
    saved().nodes.find((n) => n.id === connection.from).shape,
    "ellipse",
  );
  assert.equal(
    saved().nodes.find((n) => n.id === connection.to).shape,
    "diamond",
  );
  await click(label("円柱の図形を選択"));
  await panel("図形");
  assert.equal(label("円柱").getAttribute("aria-checked"), "true");
  await click(label("ひし形"));
  assert.equal(label("ひし形").getAttribute("aria-checked"), "true");
  assert.equal(
    saved().nodes.find((n) => n.title === "円柱の図形").shape,
    "diamond",
  );
  await act(() => root.unmount());
  await mount();
  assert.ok(label("楕円の図形を選択"));
  assert.equal(
    document.querySelectorAll('[data-node-shape="diamond"]').length,
    2,
  );
  assert.equal(saved().edges.at(-1).id, connection.id);
});
test("color selection, custom input, undo, reset and reload preserve figure colors", async () => {
  await click(label("Workerを選択"));
  await panel("色");
  await click(label("塗り：青"));
  await click(label("線：赤"));
  assert.equal(
    saved().nodes.find((n) => n.id === "worker").fillColor,
    "#a5d8ff",
  );
  assert.equal(
    saved().nodes.find((n) => n.id === "worker").strokeColor,
    "#e03131",
  );
  assert.equal(
    document
      .querySelector('[data-node-id="worker"]')
      .style.getPropertyValue("--node-fill"),
    "#a5d8ff",
  );
  await click(label("塗りの色を選ぶ"));
  const beforeCustom = saved();
  await type(label("塗りの色コード"), "bad!");
  await click(label("塗りに適用"));
  assert.deepEqual(saved(), beforeCustom);
  assert.equal(label("塗りの色コード").getAttribute("aria-invalid"), "true");
  await type(label("塗りの色コード"), "#123abc");
  await click(label("塗りに適用"));
  const colored = saved();
  assert.equal(
    colored.nodes.find((n) => n.id === "worker").fillColor,
    "#123abc",
  );
  await click(label("元に戻す"));
  assert.deepEqual(saved(), beforeCustom);
  await click(label("やり直す"));
  assert.deepEqual(saved(), colored);
  await act(() => root.unmount());
  await mount();
  await click(label("Workerを選択"));
  await panel("色");
  assert.equal(label("線：赤").getAttribute("aria-pressed"), "true");
  await click(label("塗りを標準に戻す"));
  assert.equal(
    document.querySelector('[aria-label="塗りを標準に戻す"]'),
    null,
    "the reset appears only for a custom color",
  );
  assert.equal(
    saved().nodes.find((n) => n.id === "worker").fillColor,
    undefined,
  );
  assert.equal(
    saved().nodes.find((n) => n.id === "worker").strokeColor,
    "#e03131",
  );
  await click(label("元に戻す"));
  assert.deepEqual(saved(), colored);
});
test("a color change applies to selected figures and connectors as one undo step", async () => {
  const before = saved(),
    edge = before.edges[0];
  await click(label("Workerを選択"));
  const from = before.nodes.find((n) => n.id === edge.from).title,
    to = before.nodes.find((n) => n.id === edge.to).title;
  await act(() =>
    label(from + "から" + to + "への接続線").dispatchEvent(
      new MouseEvent("click", { bubbles: true, shiftKey: true }),
    ),
  );
  await panel("色");
  await click(label("線：青"));
  const afterStroke = saved();
  assert.equal(
    afterStroke.nodes.find((n) => n.id === "worker").strokeColor,
    "#1971c2",
  );
  assert.equal(afterStroke.edges[0].strokeColor, "#1971c2");
  assert.equal(
    document
      .querySelector('.edge-control[style*="--edge-stroke"]')
      .style.getPropertyValue("--edge-stroke"),
    "#1971c2",
  );
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
  await click(label("やり直す"));
  assert.deepEqual(saved(), afterStroke);
  await panel("色");
  await click(label("塗り：黄"));
  assert.equal(
    saved().nodes.find((n) => n.id === "worker").fillColor,
    "#ffec99",
  );
  assert.deepEqual(saved().edges, afterStroke.edges);
  await click(label("元に戻す"));
  assert.deepEqual(saved(), afterStroke);
});
test("a click on a figure's text selects it; clicking it again edits that field and commits both fields as one undo step", async () => {
  const before = saved(),
    stage = label("設計キャンバス");
  const text = () => label("Workerを選択").querySelector(".node-description");
  await pointer(text(), "pointerdown", 300, 200);
  await pointer(stage, "pointerup", 300, 200);
  assert.equal(document.querySelector(".shape-text-editor"), null);
  assert.equal(label("Workerを選択").getAttribute("aria-pressed"), "true");
  await pointer(text(), "pointerdown", 300, 200);
  await pointer(stage, "pointerup", 300, 200);
  assert.equal(document.activeElement, label("説明を直接編集"));
  assert.ok(document.querySelector('[data-node-id="worker"] .shape-outline'));
  await type(label("説明を直接編集"), "送信を再試行する");
  await type(label("名前を直接編集"), "通知処理");
  await key(label("名前を直接編集"), "Enter");
  assert.equal(document.activeElement, label("説明を直接編集"));
  assert.deepEqual(saved(), before);
  await click(label("DBを選択"));
  const worker = saved().nodes.find((n) => n.id === "worker");
  assert.equal(worker.title, "通知処理");
  assert.equal(worker.description, "送信を再試行する");
  assert.equal(worker.x, before.nodes.find((n) => n.id === "worker").x);
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
});
test("IME confirmation stays in the figure editor; Escape then keeps its text and undo restores the size", async () => {
  const before = saved();
  await click(label("Workerを選択"));
  await key(label("設計キャンバス"), "Enter");
  const title = label("名前を直接編集");
  await act(() =>
    title.dispatchEvent(
      new dom.window.CompositionEvent("compositionstart", { bubbles: true }),
    ),
  );
  await type(title, "通知処理");
  await key(title, "Enter", { metaKey: true });
  await key(title, "Escape");
  assert.equal(document.activeElement, title);
  assert.ok(document.querySelector(".shape-text-editor"));
  await act(() =>
    title.dispatchEvent(
      new dom.window.CompositionEvent("compositionend", { bubbles: true }),
    ),
  );
  await key(title, "Enter");
  assert.equal(document.activeElement, label("説明を直接編集"));
  await type(label("説明を直接編集"), "確認する項目\n".repeat(35));
  assert.ok(
    parseFloat(document.querySelector('[data-node-id="worker"]').style.height) >
      before.nodes.find((n) => n.id === "worker").h,
  );
  assert.deepEqual(saved(), before);
  await key(label("説明を直接編集"), "Escape");
  assert.equal(document.querySelector(".shape-text-editor"), null);
  assert.equal(saved().nodes.find((n) => n.id === "worker").title, "通知処理");
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
  assert.equal(
    parseFloat(document.querySelector('[data-node-id="worker"]').style.height),
    before.nodes.find((n) => n.id === "worker").h,
  );
});
test("dragging text moves its figure without opening an editor or losing its text", async () => {
  const before = saved(),
    stage = label("設計キャンバス");
  const text = label("Workerを選択").querySelector(".node-title");
  await pointer(text, "pointerdown", 300, 200);
  await pointer(stage, "pointermove", 332, 224);
  await pointer(stage, "pointerup", 332, 224);
  assert.equal(document.querySelector(".shape-text-editor"), null);
  const worker = saved().nodes.find((n) => n.id === "worker");
  assert.notEqual(worker.x, before.nodes.find((n) => n.id === "worker").x);
  assert.equal(worker.title, "Worker");
  assert.equal(worker.description, "メールを送る");
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
});
test("double-clicking a figure's text edits that field", async () => {
  await dblclick(label("DBを選択").querySelector(".node-description"));
  assert.equal(document.activeElement, label("説明を直接編集"));
  assert.equal(label("説明を直接編集").value, "注文を保存する");
  await key(label("説明を直接編集"), "Escape");
  await dblclick(label("Workerを選択"));
  assert.equal(document.activeElement, label("名前を直接編集"));
});
test("clicking another figure's text commits the current input and selects that figure", async () => {
  const stage = label("設計キャンバス");
  await dblclick(label("Workerを選択").querySelector(".node-title"));
  await type(label("名前を直接編集"), "通知処理");
  const next = () => label("DBを選択").querySelector(".node-description");
  await pointer(next(), "pointerdown", 400, 200);
  await pointer(stage, "pointerup", 400, 200);
  assert.equal(saved().nodes.find((n) => n.id === "worker").title, "通知処理");
  assert.equal(document.querySelector(".shape-text-editor"), null);
  assert.equal(label("DBを選択").getAttribute("aria-pressed"), "true");
  await pointer(next(), "pointerdown", 400, 200);
  await pointer(stage, "pointerup", 400, 200);
  assert.equal(document.activeElement, label("説明を直接編集"));
  assert.equal(label("説明を直接編集").value, "注文を保存する");
  await key(label("説明を直接編集"), "Escape");
  assert.equal(saved().nodes.find((n) => n.id === "worker").title, "通知処理");
});
test("figure editing keeps the current view at reduced and enlarged scales, including manual adjustments", async () => {
  const before = saved();
  const open = () =>
    dblclick(label("Workerを選択").querySelector(".node-title"));
  for (const view of [
    { x: 20, y: 460, zoom: 0.4 },
    { x: -1480, y: -200, zoom: 2.4 },
  ]) {
    await act(() => root.unmount());
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    await mount();
    await open();
    assert.deepEqual(JSON.parse(localStorage.getItem(VIEW_KEY)), view);
    await key(label("名前を直接編集"), "Escape");
    assert.deepEqual(JSON.parse(localStorage.getItem(VIEW_KEY)), view);
    assert.equal(document.querySelector(".inspector"), null);
    await open();
    await key(label("名前を直接編集"), "Enter", { metaKey: true });
    assert.deepEqual(JSON.parse(localStorage.getItem(VIEW_KEY)), view);
  }
  await open();
  const view = JSON.parse(localStorage.getItem(VIEW_KEY));
  await act(() =>
    label("設計キャンバス").dispatchEvent(
      new dom.window.WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: 50,
        clientX: 300,
        clientY: 200,
      }),
    ),
  );
  const adjusted = JSON.parse(localStorage.getItem(VIEW_KEY));
  assert.notEqual(adjusted.zoom, view.zoom);
  await key(label("名前を直接編集"), "Escape");
  assert.deepEqual(JSON.parse(localStorage.getItem(VIEW_KEY)), adjusted);
  assert.deepEqual(saved(), before);
});
test("dragging immediately after memo input keeps the text and undoes only the move", async () => {
  await click(label("Workerを選択"));
  const before = saved().nodes.find((n) => n.id === "worker");
  await panel("メモを開く");
  await type(label("メモ"), "ドラッグ直前に入力したメモ");
  const stage = label("設計キャンバス");
  await pointer(label("Workerを選択"), "pointerdown", 300, 200);
  await pointer(stage, "pointermove", 332, 224);
  await pointer(stage, "pointerup", 332, 224);
  const moved = saved().nodes.find((n) => n.id === "worker");
  assert.equal(moved.body, "ドラッグ直前に入力したメモ");
  assert.notEqual(moved.x, before.x);
  await click(label("元に戻す"));
  const undone = saved().nodes.find((n) => n.id === "worker");
  assert.equal(undone.body, "ドラッグ直前に入力したメモ");
  assert.equal(undone.x, before.x);
});
test("starting another connection commits the active line label before changing selection", async () => {
  await click(label("接続"));
  await click(label("Workerを選択"));
  await click(label("DBを選択"));
  await panel("ラベル");
  await type(label("線のラベル"), "入力中の接続名");
  await pointer(label("ブラウザから接続"), "pointerdown", 100, 200);
  document.elementFromPoint = () => label("ブラウザを選択");
  await pointer(label("設計キャンバス"), "pointerup", 100, 200);
  assert.equal(saved().edges.at(-1).label, "入力中の接続名");
  delete document.elementFromPoint;
});
test("selecting two elements creates one connection and editing its label survives reload", async () => {
  await click(label("接続"));
  await click(label("Workerを選択"));
  await click(label("DBを選択"));
  assert.equal(saved().edges.length, 5);
  await panel("ラベル");
  await type(label("線のラベル"), "結果を保存");
  await blur(label("線のラベル"));
  assert.equal(saved().edges.at(-1).label, "結果を保存");
  await act(() => root.unmount());
  await mount();
  assert.ok(document.body.textContent.includes("結果を保存"));
  assert.equal(saved().edges.length, 5);
});
test("a box memo and its canvas note remain in sync through edits and undo", async () => {
  await click(label("Workerを選択"));
  await panel("メモを開く");
  await type(label("メモ"), "失敗時は3回再試行する。");
  await blur(label("メモ"));
  assert.ok(label("Worker のメモを選択").textContent.includes("失敗時は3回"));
  await click(label("元に戻す"));
  assert.ok(
    label("Worker のメモを選択").textContent.includes("送信に失敗したら"),
  );
  await click(label("やり直す"));
  assert.ok(label("Worker のメモを選択").textContent.includes("失敗時は3回"));
});
test("invalid JSON import keeps the current work; valid replacement can be undone", async () => {
  const before = saved(),
    input = document.querySelector('input[type="file"]');
  async function load(text) {
    Object.defineProperty(input, "files", {
      value: [{ size: text.length, text: async () => text }],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  await load('{"format":"simple-canvas","version":99}');
  assert.deepEqual(saved(), before);
  assert.ok(
    document
      .querySelector('[role="alert"]')
      .textContent.includes("現在の内容は保持"),
  );
  const imported = sampleDocument();
  imported.title = "別の設計";
  await load(encode(imported));
  assert.equal(saved().title, "別の設計");
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
});
test("corrupt stored data is not overwritten by mounting or editing", async () => {
  await act(() => root.unmount());
  localStorage.setItem(STORAGE_KEY, "broken-original");
  await mount();
  assert.ok(
    document.querySelector('[role="alert"]').textContent.includes("上書きせず"),
  );
  await type(label("キャンバス名"), "新しく検討");
  await blur(label("キャンバス名"));
  assert.equal(localStorage.getItem(STORAGE_KEY), "broken-original");
});
test("another tab's write pauses autosave until the user explicitly resolves it", async () => {
  const original = localStorage.getItem(STORAGE_KEY),
    other = sampleDocument();
  other.title = "別画面で更新";
  localStorage.setItem(STORAGE_KEY, encode(other));
  await act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: encode(other),
      }),
    ),
  );
  await type(label("キャンバス名"), "こちらの作業");
  await blur(label("キャンバス名"));
  assert.equal(localStorage.getItem(STORAGE_KEY), encode(other));
  assert.ok(document.body.textContent.includes("自動保存を停止中"));
  await click(button("最新の内容を開く"));
  assert.equal(saved().title, "別画面で更新");
  assert.ok(document.body.textContent.includes("このブラウザに保存済み"));
});

test("reload flushes the active editor rather than losing its unblurred text", async () => {
  await click(label("Workerを選択"));
  await panel("メモを開く");
  await type(label("メモ"), "再読み込み直前の入力");
  await act(() =>
    window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  );
  assert.equal(
    saved().nodes.find((n) => n.id === "worker").body,
    "再読み込み直前の入力",
  );
});
test("tidy works just after connecting, updates the visible wires, and undoes as one operation", async () => {
  await click(label("接続"));
  await click(label("DBを選択"));
  await click(label("Workerを選択"));
  const before = saved(),
    paths = [...document.querySelectorAll(".edge-visible")].map((el) =>
      el.getAttribute("d"),
    );
  await click(label("整頓"));
  const next = saved(),
    nodes = new Map(next.nodes.map((n) => [n.id, n])),
    center = (id) => nodes.get(id).y + nodes.get(id).h / 2;
  assert.ok(Math.abs(center("browser") - center("api")) < 0.01);
  assert.ok(Math.abs(center("api") - center("db")) < 0.01);
  assert.ok(Math.abs(center("worker") - center("queue")) < 0.01);
  for (const n of next.nodes) {
    const old = before.nodes.find((old) => old.id === n.id);
    assert.equal(n.x, old.x);
    assert.ok(Math.abs(n.y - old.y) <= 20);
  }
  assert.notDeepEqual(
    [...document.querySelectorAll(".edge-visible")].map((el) =>
      el.getAttribute("d"),
    ),
    paths,
  );
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
  await click(label("やり直す"));
  assert.deepEqual(saved(), next);
});
test("tidy preserves a vertical flow, the current view, and the prior document on undo", async () => {
  await act(() => root.unmount());
  const doc = emptyDocument();
  doc.nodes = ["a", "b", "c"].map((id, i) => ({
    ...makeNode("box", { x: 400 + [0, 24, -8][i], y: 60 + i * 280 }),
    id,
    title: id,
  }));
  doc.edges = [
    ["a", "b"],
    ["b", "c"],
  ].map(([from, to], i) => ({
    id: "edge-" + i,
    from,
    to,
    label: "",
    dashed: false,
  }));
  const view = { documentId: doc.id, x: -230, y: 80, zoom: 1.2 };
  localStorage.setItem(STORAGE_KEY, encode(doc));
  localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  await mount();
  const camera = localStorage.getItem(VIEW_KEY),
    before = saved();
  await click(label("整頓"));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  const next = saved(),
    centers = next.nodes.map((n) => n.x + n.w / 2);
  assert.ok(centers.every((value) => Math.abs(value - centers[0]) < 0.01));
  assert.deepEqual(
    next.nodes.map((n) => n.y),
    before.nodes.map((n) => n.y),
  );
  assert.equal(localStorage.getItem(VIEW_KEY), camera);
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
  await click(label("やり直す"));
  assert.deepEqual(saved(), next);
  await act(() => root.unmount());
  await mount();
  assert.deepEqual(saved(), next);
});
test("a stored view that hides the drawing at 5% is replaced by fitting it; a usable one is kept", async () => {
  await act(() => root.unmount());
  localStorage.setItem(VIEW_KEY, JSON.stringify({ x: 0, y: 0, zoom: 0.05 }));
  await mount();
  assert.ok(JSON.parse(localStorage.getItem(VIEW_KEY)).zoom > 0.5);
  await act(() => root.unmount());
  const usable = { x: 10, y: 20, zoom: 0.8 };
  localStorage.setItem(VIEW_KEY, JSON.stringify(usable));
  await mount();
  assert.deepEqual(JSON.parse(localStorage.getItem(VIEW_KEY)), usable);
});
test("a figure being added does not reroute existing lines until it is confirmed", async () => {
  await act(() => root.unmount());
  localStorage.setItem(VIEW_KEY, JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  await mount();
  const paths = () =>
    [...document.querySelectorAll(".edge-control path")].map((p) =>
      p.getAttribute("d"),
    );
  const before = paths();
  await act(() =>
    label("設計キャンバス").dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: 460, clientY: 230 }),
    ),
  );
  assert.ok(document.querySelector(".canvas-node.editing"));
  assert.deepEqual(paths(), before);
});
test("dropping a line on empty space adds a connected figure as one undo step, or nothing if left empty", async () => {
  const before = saved(),
    stage = label("設計キャンバス");
  const drop = async () => {
    await pointer(label("Workerから接続"), "pointerdown", 300, 200);
    document.elementFromPoint = () => stage;
    await pointer(stage, "pointermove", 600, 500);
    await pointer(stage, "pointerup", 600, 500);
    delete document.elementFromPoint;
  };
  await drop();
  assert.ok(label("名前を直接編集"));
  assert.deepEqual(saved(), before);
  await key(label("名前を直接編集"), "Escape");
  assert.deepEqual(saved(), before);
  await drop();
  await type(label("名前を直接編集"), "通知ログ");
  await key(label("名前を直接編集"), "Enter", { metaKey: true });
  const added = saved().nodes.find((n) => n.title === "通知ログ");
  assert.equal(added.shape, "rectangle");
  assert.deepEqual(
    saved()
      .edges.filter((e) => e.to === added.id)
      .map((e) => e.from),
    ["worker"],
  );
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);
});
test("resizing from the top-left corner keeps the opposite corner in place", async () => {
  await click(label("Workerを選択"));
  const before = saved().nodes.find((n) => n.id === "worker"),
    stage = label("設計キャンバス"),
    handle = document.querySelector(
      '[data-node-id="worker"] .resize-handle.nw',
    );
  await pointer(handle, "pointerdown", 300, 200);
  await pointer(stage, "pointermove", 260, 160);
  await pointer(stage, "pointerup", 260, 160);
  const after = saved().nodes.find((n) => n.id === "worker");
  assert.ok(after.w > before.w && after.h > before.h);
  assert.equal(after.x + after.w, before.x + before.w);
  assert.equal(after.y + after.h, before.y + before.h);
});
test("moving a figure near another's edge aligns it and shows a guide until the drop", async () => {
  await act(() => root.unmount());
  localStorage.setItem(VIEW_KEY, JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  await mount();
  const stage = label("設計キャンバス"),
    worker = saved().nodes.find((n) => n.id === "worker"),
    db = saved().nodes.find((n) => n.id === "db");
  await pointer(label("Workerを選択"), "pointerdown", 300, 200);
  // 3px off DB's left edge; the 8px grid alone would leave it there.
  await pointer(stage, "pointermove", 300 + db.x - worker.x + 3, 120);
  assert.ok(document.querySelector(".snap-guides line"));
  await pointer(stage, "pointerup", 300 + db.x - worker.x + 3, 120);
  assert.equal(document.querySelector(".snap-guides"), null);
  assert.equal(saved().nodes.find((n) => n.id === "worker").x, db.x);
});
test("the canvas records whether the last input was a pointer or the keyboard", async () => {
  const stage = label("設計キャンバス");
  await pointer(label("Workerを選択"), "pointerdown", 300, 200);
  await pointer(stage, "pointerup", 300, 200);
  assert.equal(stage.dataset.input, "pointer");
  await key(stage, "Tab");
  assert.equal(stage.dataset.input, "keyboard");
  await key(stage, "Shift");
  assert.equal(stage.dataset.input, "keyboard");
});
test("the save state has a short form for narrow screens", async () => {
  await click(label("Workerを選択"));
  await panel("メモを開く");
  await type(label("メモ"), "保存状態の確認");
  await blur(label("メモ"));
  assert.equal(
    document.querySelector(".save-long").textContent,
    "このブラウザに保存済み",
  );
  assert.equal(document.querySelector(".save-short").textContent, "保存済み");
  await type(label("メモ"), "編集中の文章");
  assert.equal(document.querySelector(".save-short").textContent, "編集中");
});
test("a figure with a memo shows a labeled marker that previews its first line", async () => {
  const marker = document.querySelector(
    '[data-node-id="worker"] .memo-indicator',
  );
  assert.equal(marker.textContent, "メモ");
  assert.equal(marker.title, "メモ：送信に失敗したら再試行する。");
  assert.equal(
    document.querySelector('[data-node-id="queue"] .memo-indicator'),
    null,
  );
});
test("ports are left off the sides where a line already meets the figure", async () => {
  const sides = (id) =>
    [...document.querySelectorAll(`[data-node-id="${id}"] .connection-port`)]
      .map((port) => port.className.replace("connection-port ", ""))
      .sort();
  // Queue → Worker arrives at Worker's left side.
  assert.deepEqual(sides("worker"), ["bottom", "right", "top"]);
  // API → Queue arrives at the top, Queue → Worker leaves from the right.
  assert.deepEqual(sides("queue"), ["bottom", "left"]);
  assert.ok(label("Workerから接続").classList.contains("right"));
  assert.ok(
    label("Queueから接続").classList.contains("bottom") ||
      label("Queueから接続").classList.contains("left"),
  );
});
test("the selection bar appears over a selection and steps aside while editing or moving", async () => {
  const bar = () => document.querySelector('[aria-label="選択した要素の操作"]');
  assert.equal(bar(), null);
  await click(label("Workerを選択"));
  assert.ok(bar());
  await panel("色");
  assert.ok(label("塗り：赤"));
  await key(label("塗り：赤"), "Escape");
  assert.equal(document.querySelector(".bar-panel"), null);
  await key(label("設計キャンバス"), "Enter");
  assert.equal(bar(), null);
  await key(label("名前を直接編集"), "Escape");
  const stage = label("設計キャンバス");
  await pointer(label("Workerを選択"), "pointerdown", 300, 200);
  await pointer(stage, "pointermove", 340, 230);
  assert.equal(bar(), null);
  await pointer(stage, "pointerup", 340, 230);
  assert.ok(bar());
  await click(label("元に戻す"));
});
test("double-clicking empty space writes text in place, and existing text keeps its heading", async () => {
  const before = saved(),
    stage = label("設計キャンバス"),
    view = localStorage.getItem(VIEW_KEY);
  await act(() =>
    stage.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: 900, clientY: 600 }),
    ),
  );
  const field = label("テキストを直接編集");
  assert.equal(document.activeElement, field);
  assert.equal(document.querySelector(".inline-editor label"), null);
  assert.equal(localStorage.getItem(VIEW_KEY), view, "the view stays put");
  await type(field, "非同期にする理由");
  await key(field, "Enter", { metaKey: true });
  const added = saved().nodes.find((n) => n.body === "非同期にする理由");
  assert.equal(added.kind, "note");
  assert.equal(added.title, "");

  const policy = before.nodes.find((n) => n.title === "今回の方針");
  await dblclick(label("今回の方針を選択"));
  assert.ok(document.querySelector(".inline-editor .note-title"));
  await type(label("テキストを直接編集"), "通知は非同期にする。");
  await key(label("テキストを直接編集"), "Enter", { metaKey: true });
  const edited = saved().nodes.find((n) => n.id === policy.id);
  assert.equal(edited.title, "今回の方針");
  assert.equal(edited.body, "通知は非同期にする。");

  await dblclick(label("Worker のメモを選択"));
  await type(label("メモを直接編集"), "再試行は3回まで");
  await key(label("メモを直接編集"), "Enter", { metaKey: true });
  assert.equal(
    saved().nodes.find((n) => n.id === "worker").body,
    "再試行は3回まで",
  );
});
test("a double-click that reaches the canvas through pointer capture edits the memo under the pointer", async () => {
  const stage = label("設計キャンバス"),
    memo = label("Worker のメモを選択"),
    before = saved().nodes.length;
  document.elementFromPoint = () => memo.querySelector(".note-body");
  await act(() =>
    stage.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, clientX: 900, clientY: 300 }),
    ),
  );
  delete document.elementFromPoint;
  assert.equal(document.activeElement, label("メモを直接編集"));
  await key(label("メモを直接編集"), "Escape");
  assert.equal(saved().nodes.length, before, "no new text is added");
});
test("pointing at a memo lights up its figure, and the other way round", async () => {
  const memo = label("Worker のメモを選択"),
    worker = label("Workerを選択");
  const lit = (id) =>
    document
      .querySelector(`[data-node-id="${id}"]`)
      .classList.contains("linked");
  await act(() =>
    memo.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })),
  );
  assert.ok(lit("worker"));
  await act(() =>
    memo.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })),
  );
  assert.ok(!lit("worker"));
  await act(() =>
    worker.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })),
  );
  assert.ok(lit("worker-note"));
  assert.equal(document.querySelector(".attachment-wire"), null);
});
test("clicking a port adds a connected figure on that side, clear of others", async () => {
  const stage = label("設計キャンバス"),
    worker = saved().nodes.find((n) => n.id === "worker");
  const port = document.querySelector(
    '[data-node-id="worker"] .connection-port.bottom',
  );
  assert.equal(port.dataset.tip, "クリックで下に追加 · ドラッグで接続");
  document.elementFromPoint = () => stage;
  await pointer(port, "pointerdown", 300, 200);
  await pointer(stage, "pointerup", 300, 200);
  delete document.elementFromPoint;
  await type(label("名前を直接編集"), "通知ログ");
  await key(label("名前を直接編集"), "Enter", { metaKey: true });
  const doc = saved(),
    added = doc.nodes.find((n) => n.title === "通知ログ");
  assert.ok(added.y >= worker.y + worker.h + 32, "placed below Worker");
  assert.ok(doc.edges.some((e) => e.from === "worker" && e.to === added.id));
  for (const n of doc.nodes)
    if (n.id !== added.id && n.kind !== "group")
      assert.ok(
        added.x >= n.x + n.w ||
          n.x >= added.x + added.w ||
          added.y >= n.y + n.h ||
          n.y >= added.y + added.h,
        "does not overlap " + (n.title || n.id),
      );
});
test("pointing at a figure readies only the port on the nearest side", async () => {
  const worker = label("Workerを選択");
  await act(() =>
    worker.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })),
  );
  assert.equal(
    document.querySelectorAll('[data-node-id="worker"] .connection-port.near')
      .length,
    1,
  );
});
test("double-clicking a line opens its label for writing", async () => {
  const line = document.querySelector(".edge-control");
  await act(() =>
    line.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
  );
  assert.equal(document.activeElement, label("線のラベル"));
  await type(label("線のラベル"), "注文ID");
  await key(label("線のラベル"), "Escape");
  assert.ok(saved().edges.some((e) => e.label === "注文ID"));
  await click(line);
  assert.equal(document.querySelector(".bar-panel"), null);
});
test("typing does not bring back the canvas focus ring; only Tab does", async () => {
  const stage = label("設計キャンバス");
  await pointer(label("Workerを選択"), "pointerdown", 300, 200);
  await pointer(stage, "pointerup", 300, 200);
  await key(stage, "Enter");
  await key(label("名前を直接編集"), "a");
  await key(label("名前を直接編集"), "Enter", { metaKey: true });
  assert.equal(stage.dataset.input, "pointer");
  await key(stage, "Tab");
  assert.equal(stage.dataset.input, "keyboard");
});
