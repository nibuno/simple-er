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
const { isDiagramKey, listDiagrams, restoreDiagram, viewKeyFor } =
  await import("../canvas/src/library.ts");
const {
  encode,
  growNodes,
  sampleDocument,
  STORAGE_KEY,
  VIEW_KEY,
  emptyDocument,
  makeNode,
} = await import("../canvas/src/model.ts");
let root;
const saved = () => {
  const current = restoreDiagram();
  assert.notEqual(current.raw, null);
  assert.equal(current.error, undefined);
  return current.doc;
};
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
async function choose(select, value) {
  await act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
// The toolbar asks where the figure goes; jsdom has no pointer resting on
// the canvas, so every addition is answered with a click.
async function placeAt(x = 400, y = 300) {
  const stage = label("設計キャンバス");
  await pointer(stage, "pointerdown", x, y);
  await pointer(stage, "click", x, y);
}
async function addFigure(name, x, y) {
  await click(label(name));
  await placeAt(x, y);
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
  window.sessionStorage.clear();
  localStorage.setItem(STORAGE_KEY, encode(growNodes(sampleDocument())));
  await mount();
});
afterEach(async () => {
  await act(() => root.unmount());
});

test("inline Japanese edits persist; Escape keeps edits and undo takes them back", async () => {
  const before = saved();
  await addFigure("箱を追加");
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
test("a figure added without text stays, survives reload, and undo removes it", async () => {
  const before = saved(),
    added = () =>
      saved().nodes.find((n) => !before.nodes.some((old) => old.id === n.id));
  await addFigure("箱を追加");
  assert.equal(label("名前を直接編集").value, "");
  assert.equal(label("説明を直接編集").value, "");
  assert.ok(label("説明を直接編集").classList.contains("empty-description"));
  assert.ok(added(), "the figure is on the canvas while its name is open");
  await submit();
  assert.equal(document.querySelector("form"), null);
  assert.ok(added(), "an empty name keeps the figure");
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before);

  await addFigure("箱を追加");
  await key(label("名前を直接編集"), "Escape");
  assert.ok(added(), "Escape keeps the figure too");
  await act(() => root.unmount());
  await mount();
  assert.ok(added(), "and it is still there after a reload");
});
test("the name and the explanation behave as one text: Enter down, arrows across, Backspace joins", async () => {
  await dblclick(label("Workerを選択"));
  const name = label("名前を直接編集"),
    explanation = label("説明を直接編集");
  assert.equal(name.getAttribute("placeholder"), null);
  assert.equal(explanation.getAttribute("placeholder"), null);
  name.focus();
  name.setSelectionRange(name.value.length, name.value.length);
  await key(name, "Enter");
  assert.equal(document.activeElement, explanation);
  assert.equal(explanation.selectionStart, 0);
  await key(explanation, "ArrowUp");
  assert.equal(document.activeElement, name);
  assert.equal(name.selectionStart, name.value.length);
  await key(name, "ArrowDown");
  assert.equal(document.activeElement, explanation);
  await key(explanation, "ArrowLeft");
  assert.equal(document.activeElement, name);

  name.setSelectionRange(name.value.length, name.value.length);
  await key(name, "ArrowRight");
  assert.equal(document.activeElement, explanation);
  await type(name, "Worker");
  await type(explanation, "上段\n下段");
  explanation.setSelectionRange(4, 4);
  await key(explanation, "ArrowUp");
  assert.equal(document.activeElement, explanation);
  explanation.setSelectionRange(0, 0);
  await key(explanation, "Backspace", { isComposing: true });
  assert.equal(explanation.value, "上段\n下段");
  await type(explanation, "通知を送る\n再試行もする");
  explanation.focus();
  explanation.setSelectionRange(0, 0);
  await key(explanation, "Backspace");
  assert.equal(document.activeElement, name);
  assert.equal(name.value, "Worker通知を送る");
  assert.equal(name.selectionStart, "Worker".length);
  assert.equal(explanation.value, "再試行もする");
  await submit();
  const node = saved().nodes.find((n) => n.id === "worker");
  assert.equal(node.title, "Worker通知を送る");
  assert.equal(node.description, "再試行もする");
});
test("Backspace preserves text when the joined name would exceed its limit", async () => {
  await addFigure("箱を追加");
  const name = label("名前を直接編集"),
    description = label("説明を直接編集");
  await type(name, "名".repeat(199));
  await type(description, "補足");
  description.setSelectionRange(0, 0);
  await key(description, "Backspace");
  assert.equal(name.value, "名".repeat(199));
  assert.equal(description.value, "補足");
});
test("empty text notes never reach autosave or undo, whether submitted, dismissed, cancelled or reloaded", async () => {
  const before = saved();
  await addFigure("テキストを追加");
  assert.equal(label("テキストを直接編集").value, "");
  assert.deepEqual(saved(), before);
  await submit();
  assert.equal(document.querySelector("form"), null);
  assert.deepEqual(saved(), before);
  assert.ok(label("元に戻す").disabled);

  await addFigure("テキストを追加");
  await click(label("Workerを選択"));
  assert.equal(document.querySelector("form"), null);
  assert.deepEqual(saved(), before);

  await addFigure("テキストを追加");
  await key(label("テキストを直接編集"), "Escape");
  assert.deepEqual(saved(), before, "Escape on empty text adds nothing");

  await addFigure("テキストを追加");
  await type(label("テキストを直接編集"), "　 ");
  await submit();
  assert.deepEqual(saved(), before);

  await addFigure("テキストを追加");
  await act(() =>
    window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
  );
  assert.deepEqual(saved(), before);
  await act(() => root.unmount());
  await mount();
  assert.deepEqual(saved(), before);
  assert.ok(label("元に戻す").disabled);
});
// A figure goes where the pointer says: under the cursor when it rests on
// the canvas, otherwise on the next click. Positions keep the 8px grid.
const snap = (value) => Math.round(value / 8) * 8;
const currentView = () => JSON.parse(localStorage.getItem(VIEW_KEY));
test("the toolbar asks where to put the figure, and Esc gives up", async () => {
  const before = saved(),
    view = currentView();
  await click(label("箱を追加"));
  assert.equal(document.querySelector("form"), null, "nothing placed yet");
  assert.deepEqual(saved(), before);
  assert.ok(label("設計キャンバス").className.includes("tool-place"));
  await placeAt(520, 360);
  await type(label("名前を直接編集"), "監視");
  await submit();
  const added = saved().nodes.find((n) => n.title === "監視");
  assert.equal(added.x, snap((520 - view.x) / view.zoom - added.w / 2));
  assert.equal(added.y, snap((360 - view.y) / view.zoom - added.h / 2));
  assert.ok(!label("設計キャンバス").className.includes("tool-place"));

  const placed = saved();
  await click(label("箱を追加"));
  await key(label("設計キャンバス"), "Escape");
  assert.ok(!label("設計キャンバス").className.includes("tool-place"));
  await placeAt(520, 360);
  assert.equal(document.querySelector("form"), null);
  assert.deepEqual(saved(), placed);
});
test("with the pointer over the canvas the figure appears under it at once", async () => {
  const view = currentView();
  await pointer(label("設計キャンバス"), "pointermove", 640, 420);
  await key(label("設計キャンバス"), "b");
  await type(label("名前を直接編集"), "通知ログ");
  await submit();
  const added = saved().nodes.find((n) => n.title === "通知ログ");
  assert.equal(added.x, snap((640 - view.x) / view.zoom - added.w / 2));
  assert.equal(added.y, snap((420 - view.y) / view.zoom - added.h / 2));
});
test("the empty canvas points to the rail until text placement begins", async () => {
  await click(button("新しいキャンバス"));
  assert.equal(document.querySelector(".empty-canvas"), null);
  assert.equal(
    document.querySelector(".rail-anchor .rail-hint").textContent,
    "← ここから図形を置きます",
  );
  const action = label("テキストを追加");
  await pointer(action, "pointermove", 600, 350);
  await click(action);
  assert.equal(document.querySelector(".rail-hint"), null);
  assert.equal(label("テキストを追加").getAttribute("aria-pressed"), "true");
  assert.equal(document.querySelector(".canvas-node"), null);
  const view = JSON.parse(
    localStorage.getItem(viewKeyFor(restoreDiagram().key)),
  );
  await placeAt(800, 500);
  await type(label("テキストを直接編集"), "構成図の補足");
  await submit();
  const [note] = saved().nodes;
  assert.equal(note.kind, "note");
  assert.equal(document.querySelector(".rail-hint"), null);
  assert.equal(note.x, snap((800 - view.x) / view.zoom - note.w / 2));
  assert.equal(note.y, snap((500 - view.y) / view.zoom - note.h / 2));
});
test("a description alone creates a figure without a generated name, and creation is one undo step", async () => {
  const before = saved();
  await addFigure("箱を追加");
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
    ["circle", "円"],
    ["diamond", "ひし形"],
    ["cylinder", "円柱"],
    ["person", "人"],
    ["cloud", "クラウド"],
    ["screen", "画面"],
    ["document", "書類"],
  ]) {
    // Shapes beyond the rail's four sit behind "その他の図形".
    if (!document.querySelector(`[aria-label="${name}を追加"]`))
      await click(label("その他の図形"));
    await addFigure(name + "を追加");
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
  assert.equal(
    saved().edges.find((e) => e.from === "worker" && e.to === "db").label,
    "入力中の接続名",
  );
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
test("the edge toolbar changes arrowheads independently of dashes and new connections", async () => {
  const firstWire = () => document.querySelector(".edge-visible");
  const ends = (path) =>
    ["marker-start", "marker-end"].map((attr) => path.hasAttribute(attr));
  await click(document.querySelector(".edge-control"));
  assert.equal(label("矢印の種類").value, "end");
  assert.deepEqual(ends(firstWire()), [false, true]);
  await click(label("破線"));
  await choose(label("矢印の種類"), "both");
  assert.deepEqual(ends(firstWire()), [true, true]);
  assert.equal(label("向きを反転").disabled, true);
  await choose(label("矢印の種類"), "none");
  assert.deepEqual(ends(firstWire()), [false, false]);
  assert.equal(firstWire().getAttribute("stroke-dasharray"), "7 5");
  await act(() => root.unmount());
  await mount();
  await click(document.querySelector(".edge-control"));
  assert.equal(label("矢印の種類").value, "none");
  await click(label("接続"));
  await click(label("Workerを選択"));
  await click(label("DBを選択"));
  assert.deepEqual(ends(document.querySelectorAll(".edge-visible")[4]), [
    false,
    true,
  ]);
  assert.equal(label("向きを反転").disabled, false);
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
test("assigning a status from an attached memo updates its owner, list and drawing through undo and reload", async () => {
  const attached = () =>
    document.querySelector('[data-node-id="worker-note"] .node-face');
  const marker = () =>
    document.querySelector('[data-node-id="worker"] .memo-indicator');
  await click(attached());
  await panel("メモを開く");
  await choose(label("メモの状態"), "decided");
  assert.equal(marker().textContent, "決定");
  assert.match(attached().textContent, /Worker のメモ · 決定/);
  assert.ok(document.querySelector(".attachment-wire"));
  await click(label("元に戻す"));
  assert.equal(marker().textContent, "メモ");
  await click(label("やり直す"));
  await act(() => root.unmount());
  await mount();
  assert.equal(marker().textContent, "決定");
  await click(button("メモの一覧"));
  const filter = label("メモを状態で絞り込む");
  const owners = () =>
    [...document.querySelectorAll(".memo-row strong")].map(
      (el) => el.textContent,
    );
  assert.deepEqual(owners(), ["API", "Worker"]);
  await choose(filter, "decided");
  assert.deepEqual(owners(), ["Worker"]);
  await choose(filter, "");
  assert.deepEqual(owners(), ["API"]);
  await choose(filter, "concern");
  assert.match(
    document.querySelector(".memo-list").textContent,
    /この状態のメモはありません/,
  );
});
test("choosing an off-screen memo centers and selects its figure without editing it or switching drawings", async () => {
  await act(() => root.unmount());
  const doc = growNodes(sampleDocument());
  const api = doc.nodes.find((n) => n.id === "api");
  api.x = -3000;
  localStorage.setItem(STORAGE_KEY, encode(doc));
  localStorage.setItem(VIEW_KEY, JSON.stringify({ x: 0, y: 0, zoom: 0.8 }));
  await mount();
  await click(label("箱を追加"));
  await click(button("メモの一覧"));
  const row = document.querySelector(".memo-row");
  assert.equal(row.querySelector(".memo-body").textContent, api.body);
  await click(row);
  assert.equal(label("箱を追加").getAttribute("aria-pressed"), "false");
  assert.ok(label("設計キャンバス").classList.contains("tool-select"));
  assert.equal(label("APIを選択").getAttribute("aria-pressed"), "true");
  assert.equal(row.getAttribute("aria-current"), "true");
  const view = JSON.parse(localStorage.getItem(VIEW_KEY));
  assert.equal(view.zoom, 0.8);
  assert.equal(view.x + (api.x + api.w / 2) * view.zoom, 600);
  assert.equal(view.y + (api.y + api.h / 2) * view.zoom, 350);
  await key(row, "Delete");
  assert.deepEqual(saved(), doc);
  await key(label("メニュー"), "Enter");
  assert.equal(document.querySelector(".canvas-node.editing"), null);
  await click(button("図の一覧"));
  assert.ok(document.querySelector(".diagram-list[open]"));
  assert.equal(document.querySelector(".memo-list"), null);
});
test("invalid files keep the current work, and importing the same file twice makes independent drawings", async () => {
  const before = saved();
  async function load(text) {
    const input = document.querySelector('input[type="file"]');
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
      .textContent.includes("今の図はそのまま"),
  );
  const imported = sampleDocument();
  imported.title = "別の設計";
  await load(encode(imported));
  assert.equal(saved().title, "別の設計");
  assert.equal(label("元に戻す").disabled, true);
  const firstKey = restoreDiagram().key;
  await load(encode(imported));
  assert.notEqual(restoreDiagram().key, firstKey);
  assert.equal(listDiagrams().length, 3);
  await click(button("図の一覧"));
  await click(label(before.title + "を開く"));
  assert.deepEqual(saved(), before);
});
test("the old document and its previous version remain separate, even with the same document ID", async () => {
  await act(() => root.unmount());
  const mine = growNodes(sampleDocument());
  mine.title = "自分の図";
  const previous = { ...mine, title: "前の案" };
  localStorage.setItem(STORAGE_KEY, encode(mine));
  localStorage.setItem(STORAGE_KEY + ".previous", encode(previous));
  await mount();
  assert.deepEqual(saved(), mine);
  assert.equal(listDiagrams().length, 2);
  assert.ok(listDiagrams().every((entry) => entry.updatedAt === null));
  await click(button("サンプルを開く"));
  await click(button("図の一覧"));
  await click(button("新しく作る"));
  assert.equal(listDiagrams().length, 4);
  await click(button("図の一覧"));
  await click(label("前の案を開く"));
  await act(() => root.unmount());
  await mount();
  assert.deepEqual(saved(), previous);
  assert.equal(localStorage.getItem(STORAGE_KEY), encode(mine));
  assert.equal(
    localStorage.getItem(STORAGE_KEY + ".previous"),
    encode(previous),
  );
  assert.equal(listDiagrams().length, 4);
});
test("the list creates, copies, renames and deletes drawings, including the last one", async () => {
  const original = saved();
  const options = async (title) => click(label(title + "の操作"));
  const list = async () => click(button("図の一覧"));
  await list();
  await options(original.title);
  await click(button("複製"));
  const copy = saved();
  assert.notEqual(copy.id, original.id);
  assert.deepEqual(copy.nodes, original.nodes);
  assert.deepEqual(copy.edges, original.edges);
  assert.equal(copy.title, original.title + "のコピー");
  await list();
  await options(original.title);
  await click(button("名前を変更"));
  await type(document.querySelector(".row-actions input"), "注文処理");
  await click(button("変更する"));
  assert.equal(saved().title, copy.title);
  const renamed = listDiagrams().find((entry) => entry.title === "注文処理");
  assert.ok(renamed.updatedAt);
  await click(label("注文処理を開く"));
  assert.equal(saved().id, original.id);
  assert.equal(
    listDiagrams().find((entry) => entry.title === "注文処理").raw,
    renamed.raw,
  );
  await list();
  await options("注文処理");
  await click(button("削除"));
  await click(button("キャンセル"));
  assert.equal(listDiagrams().length, 2);
  await options("注文処理");
  await click(button("削除"));
  await click(button("削除する"));
  assert.deepEqual(saved(), copy);
  await list();
  await options(copy.title);
  await click(button("削除"));
  await click(button("削除する"));
  assert.equal(saved().nodes.length, 0);
  assert.equal(label("元に戻す").disabled, true);
  await act(() => root.unmount());
  await mount();
  assert.deepEqual(
    listDiagrams().map((row) => row.title),
    ["無題のキャンバス"],
  );
});
test("quota errors keep saved drawings and pending edits until another drawing is removed", async () => {
  const original = saved();
  await click(button("新しいキャンバス"));
  const active = restoreDiagram();
  const proto = Object.getPrototypeOf(localStorage),
    setItem = proto.setItem;
  proto.setItem = function (key, raw) {
    if (isDiagramKey(key) && localStorage.getItem(STORAGE_KEY) !== null)
      throw new dom.window.DOMException("full", "QuotaExceededError");
    return setItem.call(this, key, raw);
  };
  try {
    await click(button("サンプルを開く"));
    assert.equal(listDiagrams().length, 2);
    assert.equal(restoreDiagram().key, active.key);
    await type(label("キャンバス名"), "保存待ちの図");
    await blur(label("キャンバス名"));
    assert.equal(localStorage.getItem(active.key), active.raw);
    assert.equal(
      document.querySelector(".save-long").textContent,
      "自動保存できません",
    );
    assert.equal(
      document.querySelector(".save-short").textContent,
      "保存できません",
    );
    assert.ok(
      document.querySelector('[role="alert"]').textContent.includes("空き容量"),
    );
    await click(button("図の一覧"));
    await click(label(original.title + "を開く"));
    assert.ok(document.querySelector(".diagram-list[open]"));
    assert.equal(label("キャンバス名").value, "保存待ちの図");
    await click(label(original.title + "の操作"));
    await click(button("削除"));
    await click(button("削除する"));
    assert.equal(document.querySelector(".save-status"), null);
    assert.equal(saved().title, "保存待ちの図");
    assert.equal(listDiagrams().length, 1);
  } finally {
    proto.setItem = setItem;
  }
});
test("corrupt stored data is not overwritten by mounting or editing", async () => {
  await act(() => root.unmount());
  localStorage.setItem(STORAGE_KEY, "broken-original");
  await mount();
  assert.ok(
    document
      .querySelector('[role="alert"]')
      .textContent.includes("上書きしていません"),
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
  assert.equal(document.querySelector(".save-status"), null);
});

for (const resume of [true, false]) {
  test(
    "the paused list keeps the local title and can " +
      (resume ? "resume saving" : "save a separate drawing"),
    async () => {
      const original = saved();
      const remote = encode({ ...original, title: "別のタブ" });
      localStorage.setItem(STORAGE_KEY, remote);
      await act(() =>
        window.dispatchEvent(
          new StorageEvent("storage", { key: STORAGE_KEY, newValue: remote }),
        ),
      );
      await type(label("キャンバス名"), "こちらの作業");
      await blur(label("キャンバス名"));
      await click(button("図の一覧"));
      const dialog = document.querySelector(".diagram-list");
      assert.match(
        dialog.querySelector(".list-recovery").textContent,
        /表示中の「こちらの作業」/,
      );
      assert.equal(dialog.querySelector("[aria-current]"), null);
      const action = resume ? "この画面の内容で保存を再開" : "別の図として保存";
      await click(
        [...dialog.querySelectorAll("button")].find(
          (b) => b.textContent === action,
        ),
      );
      assert.equal(document.querySelector(".save-status"), null);
      assert.equal(saved().title, "こちらの作業");
      if (resume) {
        assert.match(
          dialog.querySelector("[aria-current]").textContent,
          /こちらの作業/,
        );
        assert.equal(listDiagrams().length, 1);
      } else {
        assert.equal(localStorage.getItem(STORAGE_KEY), remote);
        assert.notEqual(saved().id, original.id);
      }
    },
  );
}

test("a change to a different drawing refreshes the list and prevents a stale deletion", async () => {
  const original = saved();
  await click(button("新しいキャンバス"));
  await click(button("図の一覧"));
  await click(label(original.title + "の操作"));
  await click(button("削除"));
  const remote = encode({ ...original, title: "別のタブの案" });
  localStorage.setItem(STORAGE_KEY, remote);
  await act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: STORAGE_KEY, newValue: remote }),
    ),
  );
  await click(button("削除する"));
  assert.equal(localStorage.getItem(STORAGE_KEY), remote);
  assert.ok(
    document.querySelector(".list-error").textContent.includes("別のタブ"),
  );
  assert.ok(label("別のタブの案を開く"));
  assert.equal(document.querySelector(".save-status"), null);
});

test("edits in a tab with a remotely deleted drawing never recreate it on unload", async () => {
  await click(button("新しいキャンバス"));
  const { key } = restoreDiagram();
  localStorage.removeItem(key);
  await act(() =>
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: null })),
  );
  await type(label("キャンバス名"), "手元に残す案");
  const unloading = new Event("beforeunload", { cancelable: true });
  await act(() => window.dispatchEvent(unloading));
  assert.ok(unloading.defaultPrevented);
  assert.equal(localStorage.getItem(key), null);
  assert.equal(label("キャンバス名").value, "手元に残す案");
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
test("dropping a line on empty space adds a connected figure as one undo step, empty name or not", async () => {
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
  await key(label("名前を直接編集"), "Escape");
  assert.equal(saved().nodes.length, before.nodes.length + 1);
  assert.equal(saved().edges.length, before.edges.length + 1);
  await click(label("元に戻す"));
  assert.deepEqual(saved(), before, "the figure and its line go back together");
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
test("saving leaves no mark, but a stopped autosave does, short on narrow screens", async () => {
  await click(label("Workerを選択"));
  await panel("メモを開く");
  await type(label("メモ"), "保存状態の確認");
  assert.equal(document.querySelector(".save-status"), null);
  await blur(label("メモ"));
  assert.equal(document.querySelector(".save-status"), null);
  const other = sampleDocument();
  other.title = "別画面で更新";
  await act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: encode(other),
      }),
    ),
  );
  assert.equal(
    document.querySelector(".save-long").textContent,
    "自動保存を停止中",
  );
  assert.equal(document.querySelector(".save-short").textContent, "保存停止中");
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
  assert.ok(bar(), "finishing the text brings the bar back");
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
});
test("a visible memo link follows the dragged note and is removed with its owner", async () => {
  const stage = label("設計キャンバス"),
    path = () => document.querySelector(".attachment-wire")?.getAttribute("d"),
    before = path();
  assert.ok(before);
  await pointer(label("Worker のメモを選択"), "pointerdown", 700, 400);
  await pointer(stage, "pointermove", 920, 460);
  const dragging = path();
  assert.ok(dragging);
  assert.notEqual(dragging, before);
  await pointer(stage, "pointerup", 920, 460);
  assert.equal(path(), dragging);
  await click(label("元に戻す"));
  assert.equal(path(), before);

  await click(label("Workerを選択"));
  await click(label("削除"));
  assert.ok(label("Worker のメモを選択"));
  assert.equal(path(), undefined);
});
test("clicking a port adds a connected figure on that side, clear of others", async () => {
  const stage = label("設計キャンバス"),
    worker = saved().nodes.find((n) => n.id === "worker");
  const port = document.querySelector(
    '[data-node-id="worker"] .connection-port.bottom',
  );
  assert.equal(port.dataset.tip, "下に追加（ドラッグで接続）");
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
test("a box takes an icon from the selection bar, shown beside its name", async () => {
  await click(label("Queueを選択"));
  await panel("アイコン");
  await click(label("キュー"));
  assert.equal(saved().nodes.find((n) => n.id === "queue").icon, "queue");
  assert.ok(
    document.querySelector('[data-node-id="queue"] .node-title .node-icon'),
  );
  await click(label("アイコンなし"));
  assert.equal(saved().nodes.find((n) => n.id === "queue").icon, undefined);
});
test("the selection bar names its buttons and shows the current color", async () => {
  await click(label("Queueを選択"));
  assert.equal(label("アイコン").dataset.tip, "アイコン");
  assert.equal(label("色").textContent, "色");
  await panel("色");
  await click(label("塗り：赤"));
  const swatch = label("色").querySelector(".bar-swatch");
  assert.equal(
    swatch.style.getPropertyValue("--swatch-fill"),
    saved().nodes.find((n) => n.id === "queue").fillColor,
  );
});
test("a circle stays round when resized from a side or a corner", async () => {
  await click(label("その他の図形"));
  await addFigure("円を追加");
  await type(label("名前を直接編集"), "注文確定");
  await key(label("名前を直接編集"), "Enter", { metaKey: true });
  const id = saved().nodes.find((n) => n.title === "注文確定").id,
    circle = () => saved().nodes.find((n) => n.id === id),
    stage = label("設計キャンバス");
  assert.equal(circle().w, circle().h);
  await click(label("注文確定を選択"));
  for (const [dir, dx, dy] of [
    ["e", 64, 0],
    ["se", 16, 48],
    ["n", 0, -40],
  ]) {
    const handle = document.querySelector(
      `[data-node-id="${id}"] .resize-handle.${dir}`,
    );
    await pointer(handle, "pointerdown", 300, 300);
    await pointer(stage, "pointermove", 300 + dx, 300 + dy);
    await pointer(stage, "pointerup", 300 + dx, 300 + dy);
    assert.equal(circle().w, circle().h, dir);
  }
  assert.ok(circle().w > 120);
});

async function paste(text, target = label("設計キャンバス")) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (format) => (format === "text/plain" ? text : "") },
  });
  await act(() => target.dispatchEvent(event));
  return event.defaultPrevented;
}

test("画像コピーが使えないときはメニューとショートカットからPNG保存を案内する", async () => {
  await key(label("キャンバス名"), "C", { metaKey: true, shiftKey: true });
  assert.equal(document.querySelector('[role="alert"]'), null);
  await key(window, "C", { metaKey: true, shiftKey: true });
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /PNGで保存/,
  );
  await click(label("通知を閉じる"));
  await click(button("画像をコピー ⌘⇧C"));
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /PNGで保存/,
  );
});

test("Mermaidでコピーした図は選択にかかわらず図全体を貼り付けられる", async (t) => {
  let text;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (source) => {
        text = source;
      },
    },
  });
  t.after(() => delete navigator.clipboard);
  await click(label("Queueを選択"));
  await click(button("Mermaidでコピー"));
  const before = saved();
  await paste(text);
  assert.equal(
    saved().nodes.length - before.nodes.length,
    before.nodes.filter((n) => n.kind === "box").length,
  );
  assert.equal(saved().edges.length, 2 * before.edges.length);
});

test("長いMermaidを貼り付けても、自由なテキストだけは6000文字の上限を守る", async () => {
  const before = saved();
  await paste(
    "flowchart LR\n" +
      Array.from(
        { length: 35 },
        (_, i) => "n" + i + '["' + "あ".repeat(190) + '"]',
      ).join("\n"),
  );
  assert.equal(saved().nodes.length, before.nodes.length + 35);
  await paste("あ".repeat(6001));
  assert.match(
    document.querySelector('[role="alert"]').textContent,
    /6000文字/,
  );
});

test("pasting a flowchart appends one undoable edit to the open diagram", async () => {
  const before = saved();
  // Reuse an ID from the open diagram. Both new edges must point to the pasted nodes.
  const source = before.nodes.find((n) => n.kind === "box").id;
  const text = `graph TD\nsubgraph 注文\n${source}[受付] -->|保存| db[(注文DB)] & cache\nend`;
  await paste(text);
  const after = saved();
  assert.equal(after.id, before.id);
  assert.deepEqual(after.nodes.slice(0, before.nodes.length), before.nodes);
  assert.deepEqual(after.edges.slice(0, before.edges.length), before.edges);
  const added = after.nodes.slice(before.nodes.length),
    edges = after.edges.slice(before.edges.length);
  assert.equal(added.length, 4);
  assert.equal(edges.length, 2);
  const group = added.find((n) => n.kind === "group");
  const boxes = added.filter((n) => n.kind === "box");
  assert.ok(boxes.every((n) => n.groupId === group.id));
  assert.deepEqual(
    edges.map((e) => e.to),
    boxes.slice(1).map((n) => n.id),
  );
  assert.ok(edges.every((e) => e.from === boxes[0].id && e.label === "保存"));
  await key(window, "z", { metaKey: true });
  assert.deepEqual(saved(), before);
  await key(window, "z", { metaKey: true, shiftKey: true });
  assert.deepEqual(saved(), after);
});

test("an invalid flowchart reports its line and leaves the saved diagram and history intact", async () => {
  const before = saved();
  await paste("flowchart LR\na --> b\nb -->");
  assert.match(document.querySelector('[role="alert"]').textContent, /3行目/);
  assert.deepEqual(saved(), before);
  assert.ok(label("元に戻す").disabled);
});

test("canvas JSON and plain text keep their paste behavior, and inputs handle paste natively", async () => {
  const before = saved();
  const fragment = emptyDocument();
  fragment.nodes.push(makeNode("box", { x: 0, y: 0 }));
  fragment.nodes[0].title = "a --> b";
  await paste(encode(fragment));
  assert.equal(saved().nodes.length, before.nodes.length + 1);
  assert.equal(saved().nodes.at(-1).title, "a --> b");
  await paste("次の注文を確認する");
  assert.equal(saved().nodes.at(-1).body, "次の注文を確認する");
  const current = saved();
  assert.equal(await paste("a --> b", label("キャンバス名")), false);
  assert.deepEqual(saved(), current);
});

test("an import that exceeds the open diagram's edge limit adds nothing", async () => {
  const before = saved();
  const remaining = 400 - before.edges.length;
  const text = "flowchart LR\n" + "a --> b\n".repeat(remaining + 1);
  await paste(text);
  assert.match(document.querySelector('[role="alert"]').textContent, /400本/);
  assert.deepEqual(saved(), before);
  assert.ok(label("元に戻す").disabled);
});
