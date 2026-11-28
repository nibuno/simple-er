import { imeKey } from "./ime-events.mjs";
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
let viewportWidth = 1200;
Object.defineProperty(dom.window.SVGSVGElement.prototype, "clientWidth", {
  get: () => viewportWidth,
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
const { encode, projectDocument, validateDiagram } =
  await import("../src/model.ts");
const { library } = await import("../src/library.ts");
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
      element instanceof dom.window.HTMLTextAreaElement
        ? dom.window.HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    ).set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(element, key, options = {}) {
  await act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    ),
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
  const current = library.restoreDiagram();
  assert.ok(current.raw);
  assert.equal(current.error, undefined);
  return projectDocument(current.doc);
}
async function mount() {
  root = createRoot(document.getElementById("root"));
  await act(() => root.render(<App />));
}
beforeEach(async () => {
  localStorage.clear();
  window.sessionStorage.clear();
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

test("undo and redo stay within the open diagram", async () => {
  const before = saved();
  await click(byText("整頓"));
  assert.notDeepEqual(saved(), before);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
  assert.equal(byLabel("やり直す").disabled, false);
  await click(byLabel("usersを移動。矢印キーで移動できます。"));
  await key(byLabel("usersを移動。矢印キーで移動できます。"), "ArrowLeft");
  assert.equal(saved().tables[0].x, before.tables[0].x - 8);
  assert.equal(byLabel("やり直す").disabled, true);
  const original = localStorage.getItem(storageKey);
  await click(byText("新しい図"));
  assert.equal(saved().tables.length, 0);
  assert.equal(byLabel("元に戻す").disabled, true);
  assert.equal(localStorage.getItem(storageKey), original);
});

test("new drawings have distinct names in the list", async () => {
  await click(byText("新しい図"));
  assert.equal(saved().title, "無題の図 2");
  await click(byText("図の一覧"));
  assert.match(
    document.querySelector(".diagram-list").textContent,
    /「元に戻す」の履歴が消えます/,
  );
  await click(byText("新しく作る"));
  assert.equal(saved().title, "無題の図 3");
});

test("the initial view fits the sample on a 768px viewport", async () => {
  await act(() => root.unmount());
  viewportWidth = 768;
  try {
    await mount();
    const [x, , w] = currentView();
    assert.ok(x <= Math.min(...initial.tables.map((t) => t.x)));
    assert.ok(w > viewportWidth);
    const fitted = currentView();
    await click(document.querySelector("#fit"));
    assert.deepEqual(currentView(), fitted);
  } finally {
    viewportWidth = 1200;
  }
});

test("the original and #37 backup keep their bytes and open independently after a reload", async () => {
  await act(() => root.unmount());
  const original = localStorage.getItem(storageKey);
  const backup = encode({ tables: [], edges: [] });
  localStorage.setItem(storageKey + ".previous", backup);
  localStorage.setItem(storageKey + ".v1-backup", "v1");
  localStorage.setItem(storageKey + ".recovery", "raw");
  await mount();
  await click(byText("図の一覧"));
  assert.deepEqual(
    library.listDiagrams().map((row) => [row.title, row.updatedAt]),
    [
      ["無題の図", null],
      ["前の図", null],
    ],
  );
  await key(document.body, "t");
  assert.equal(document.querySelector("#table-editor"), null);
  await click(byLabel("前の図を開く"));
  assert.equal(saved().tables.length, 0);
  await act(() => root.unmount());
  await mount();
  assert.equal(byLabel("図の名前").value, "前の図");
  assert.equal(byLabel("元に戻す").disabled, true);
  await click(byText("図の一覧"));
  await click(byLabel("無題の図を開く"));
  assert.ok(byLabel("usersを編集"));
  assert.equal(localStorage.getItem(storageKey), original);
  assert.equal(localStorage.getItem(storageKey + ".previous"), backup);
  assert.equal(localStorage.getItem(storageKey + ".v1-backup"), "v1");
  assert.equal(localStorage.getItem(storageKey + ".recovery"), "raw");
});

test("applying an unchanged legacy table keeps its original bytes and unknown update time", async () => {
  const raw = localStorage.getItem(storageKey);
  await click(byLabel("usersを編集"));
  await submit();
  assert.equal(byLabel("元に戻す").disabled, true);
  assert.equal(localStorage.getItem(storageKey), raw);
  assert.equal(library.listDiagrams()[0].updatedAt, null);
});

test("a damaged legacy record stays available while this tab's edits are saved separately", async () => {
  await act(() => root.unmount());
  localStorage.setItem(storageKey, "{damaged");
  await mount();
  assert.match(
    document.querySelector(".instruction").textContent,
    /読み込めません/,
  );
  assert.ok(byText("元データをファイルに保存"));
  await act(() => byLabel("図の名前").focus());
  await type(byLabel("図の名前"), "復旧作業");
  await key(byLabel("図の名前"), "Enter");
  await click(byText("別の図として保存"));
  assert.equal(localStorage.getItem(storageKey), "{damaged");
  assert.equal(saved().title, "復旧作業");
  assert.equal(library.listDiagrams().length, 2);
});

test("list actions rename, duplicate and delete the selected drawing", async () => {
  await click(byText("図の一覧"));
  await click(byLabel("無題の図の操作"));
  await click(byText("複製"));
  assert.equal(saved().title, "無題の図のコピー");
  const copy = library.restoreDiagram().key;
  await click(byLabel("usersを編集"));
  await type(byLabel("カラム2の物理名"), "nickname");
  await submit();
  await click(byText("図の一覧"));
  await click(byLabel("無題の図の操作"));
  await click(byText("名前を変更"));
  await type(document.querySelector(".row-actions input"), "元の注文");
  await submit();
  assert.equal(library.restoreDiagram().key, copy);
  await click(byLabel("元の注文を開く"));
  assert.equal(saved().tables[0].columns[1].name, "name");
  await click(byText("図の一覧"));
  await click(byLabel("元の注文の操作"));
  await click(byText("削除"));
  assert.match(
    document.querySelector(".row-actions p").textContent,
    /元の注文/,
  );
  await click(byText("キャンセル"));
  assert.equal(library.listDiagrams().length, 2);
  await click(byLabel("元の注文の操作"));
  await click(byText("削除"));
  await click(byText("削除する"));
  assert.equal(library.restoreDiagram().key, copy);
  assert.equal(saved().tables[0].columns[1].name, "nickname");
  await click(byText("図の一覧"));
  await click(byLabel("無題の図のコピーの操作"));
  await click(byText("削除"));
  assert.match(document.querySelector(".row-actions p").textContent, /空の図/);
  await click(byText("削除する"));
  assert.equal(saved().tables.length, 0);
  assert.equal(library.listDiagrams().length, 1);
});

test("quota failure keeps the active diagram and deleting another retries unsaved edits", async (t) => {
  await click(byText("新しい図"));
  const active = library.restoreDiagram();
  const proto = Object.getPrototypeOf(localStorage);
  const setItem = proto.setItem;
  t.mock.method(proto, "setItem", function (key, value) {
    if (library.isDiagramKey(key) && localStorage.getItem(storageKey) !== null)
      throw new DOMException("full", "QuotaExceededError");
    setItem.call(this, key, value);
  });
  await click(byText("新しい図"));
  assert.equal(library.restoreDiagram().key, active.key);
  assert.equal(library.listDiagrams().length, 2);
  assert.match(document.querySelector(".instruction").textContent, /空き容量/);
  await act(() => byLabel("図の名前").focus());
  await type(byLabel("図の名前"), "保存待ち");
  await key(byLabel("図の名前"), "Enter");
  await click(byText("図の一覧"));
  const other = document.querySelector(".diagram-link:not([aria-current])");
  await click(other);
  assert.ok(document.querySelector("dialog[open]"));
  assert.match(document.querySelector(".list-error").textContent, /空き容量/);
  assert.equal(byLabel("図の名前").value, "保存待ち");
  assert.equal(localStorage.getItem(active.key), active.raw);
  await click(other.closest("li").querySelector(".row-toggle"));
  await click(byText("削除"));
  await click(byText("削除する"));
  assert.equal(saved().title, "保存待ち");
  assert.equal(library.listDiagrams().length, 1);
  await act(() => root.unmount());
  await mount();
  assert.equal(byLabel("図の名前").value, "保存待ち");
});

test("another tab can delete the open diagram without losing this tab's edits", async () => {
  localStorage.removeItem(storageKey);
  // Saving before the storage event arrives must also detect the deletion.
  await act(() => byLabel("図の名前").focus());
  await type(byLabel("図の名前"), "このタブの注文");
  await key(byLabel("図の名前"), "Enter");
  assert.match(
    document.querySelector(".migration-notice").textContent,
    /削除されました/,
  );
  assert.equal(localStorage.getItem(storageKey), null);
  await click(byText("別の図として保存"));
  assert.equal(localStorage.getItem(storageKey), null);
  assert.equal(library.listDiagrams().length, 1);
  assert.equal(saved().title, "このタブの注文");
  assert.ok(byLabel("usersを編集"));
});

test("a paused drawing can be saved from the list without replacing the other tab's version", async () => {
  const remote = encode({ ...initial, title: "別のタブ" });
  localStorage.setItem(storageKey, remote);
  await act(() => byLabel("図の名前").focus());
  await type(byLabel("図の名前"), "こちらの作業");
  await key(byLabel("図の名前"), "Enter");
  await click(byText("図の一覧"));
  const dialog = document.querySelector(".diagram-list");
  assert.match(
    dialog.querySelector(".list-recovery").textContent,
    /表示中の「こちらの作業」/,
  );
  assert.equal(dialog.querySelector("[aria-current]"), null);
  await click(dialog.querySelector(".list-recovery button"));
  assert.equal(document.querySelector(".diagram-list"), null);
  assert.equal(localStorage.getItem(storageKey), remote);
  assert.equal(saved().title, "こちらの作業");
});

test("confirming deletion of the last v1 drawing needs no space for a backup", async (t) => {
  await act(() => root.unmount());
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      format: "er-sketch",
      version: 1,
      diagram: {
        tables: [{ id: "custom", x: 0, y: 0, columns: [["id", "uuid", "PK"]] }],
        edges: [],
      },
    }),
  );
  await mount();
  const proto = Object.getPrototypeOf(localStorage),
    setItem = proto.setItem;
  t.mock.method(proto, "setItem", function (key, value) {
    if (key.endsWith(".v1-backup"))
      throw new DOMException("full", "QuotaExceededError");
    setItem.call(this, key, value);
  });
  await click(byText("図の一覧"));
  await click(byLabel("無題の図の操作"));
  await click(byText("削除"));
  await click(byText("削除する"));
  assert.equal(saved().tables.length, 0);
  assert.equal(library.listDiagrams().length, 1);
});

test("a stale delete confirmation preserves an update from another tab", async () => {
  await click(byText("新しい図"));
  await click(byText("図の一覧"));
  const other = document.querySelector(".diagram-link:not([aria-current])");
  await click(other.closest("li").querySelector(".row-toggle"));
  await click(byText("削除"));
  const remote = encode({ ...initial, title: "別のタブで変更" });
  localStorage.setItem(storageKey, remote);
  await act(() =>
    window.dispatchEvent(
      new dom.window.StorageEvent("storage", {
        key: storageKey,
        newValue: remote,
      }),
    ),
  );
  await click(byText("削除する"));
  assert.match(document.querySelector(".list-error").textContent, /別のタブ/);
  assert.equal(localStorage.getItem(storageKey), remote);
  assert.equal(library.listDiagrams().length, 2);
  await click(byLabel("図の一覧を閉じる"));
  assert.equal(document.querySelector(".migration-notice"), null);
});

test("pasted DDL previews line errors and adds the readable tables in one undo step", async () => {
  const before = saved();
  await click(byText("DDL を読み込む"));
  const textarea = document.querySelector("#ddl-source");
  await type(
    textarea,
    "DROP TABLE x;\nCREATE TABLE notes(user_id uuid REFERENCES users(id));",
  );
  await click(byText("読み込む"));
  assert.match(document.querySelector(".ddl-issues").textContent, /1行目/);
  assert.deepEqual(saved(), before);
  await click(byText("読めた分を読み込む"));
  const after = saved();
  assert.equal(after.tables.length, before.tables.length + 1);
  assert.equal(after.edges.length, before.edges.length + 1);
  await key(document.body, "z", { metaKey: true });
  assert.deepEqual(saved(), before);
  await key(document.body, "z", { metaKey: true, shiftKey: true });
  assert.deepEqual(saved(), after);
});

test("Mermaid import previews issues, draws table relationships and undoes the import in one step", async () => {
  const before = saved();
  await click(byText("Mermaid を読み込む"));
  await type(
    document.querySelector("#ddl-source"),
    "erDiagram\nusers }o..o{ Notes : 閲覧\ninvalid line!",
  );
  await click(byText("読み込む"));
  assert.match(document.querySelector(".ddl-issues").textContent, /3行目/);
  assert.deepEqual(saved(), before);
  await click(byText("読めた分を読み込む"));
  const wire = byLabel("usersからNotesへの接続線");
  assert.equal(
    wire.querySelectorAll('[data-maximum="many"][data-minimum="0"]').length,
    2,
  );
  assert.equal(wire.querySelector(".relationship-label").textContent, "閲覧");
  await click(wire);
  await click(byText("リレーションを削除"));
  assert.equal(saved().edges.length, before.edges.length);
  await key(document.body, "z", { metaKey: true });
  assert.equal(saved().edges.length, before.edges.length + 1);
  await key(document.body, "z", { metaKey: true });
  assert.deepEqual(saved(), before);
});

for (const [format, extension, source] of [
  [
    "DDL",
    "sql",
    "CREATE TABLE users(id int primary key); CREATE TABLE orders(user_id int REFERENCES users);",
  ],
  ["Mermaid", "mmd", "erDiagram\nusers ||--o{ orders : places"],
])
  test(`${format} file import from an empty canvas creates its own undoable library entry`, async () => {
    await click(byText("新しい図"));
    const original = library.restoreDiagram();
    await click(
      [...document.querySelectorAll(".empty-actions button")].find(
        (b) => b.textContent === `${format} を読み込む`,
      ),
    );
    const input = document.querySelector(
      '#ddl-import-dialog input[type="file"]',
    );
    Object.defineProperty(input, "files", {
      value: [
        {
          name: `顧客.${extension}`,
          size: source.length,
          text: async () => source,
        },
      ],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(document.querySelectorAll(".ddl-destination input")[1]);
    await click(byText("読み込む"));
    const imported = library.restoreDiagram();
    assert.notEqual(original.key, imported.key);
    assert.equal(saved().title, "顧客");
    assert.equal(saved().edges.length, 1);
    assert.equal(library.listDiagrams().length, 3);
    await key(document.body, "z", { metaKey: true });
    assert.equal(saved().tables.length, 0);
    assert.equal(library.restoreDiagram().key, imported.key);
    assert.equal(localStorage.getItem(original.key), original.raw);
    await click(byLabel("やり直す"));
    assert.equal(saved().tables.length, 2);
  });

test("an empty diagram offers next steps, samples and help", async () => {
  assert.equal(document.querySelector(".empty-diagram"), null);
  await click(byText("新しい図"));
  const empty = document.querySelector(".empty-diagram");
  assert.ok(empty);
  await click(
    [...empty.querySelectorAll("button")].find(
      (b) => b.textContent === "サンプルを開く",
    ),
  );
  const sample = [...document.querySelectorAll(".sample-list button")].find(
    (b) => b.textContent.startsWith("ライブ配信"),
  );
  assert.ok(sample);
  await act(async () => {
    sample.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  assert.equal(document.querySelector("#sample-dialog"), null);
  assert.deepEqual(
    saved().tables.map((t) => t.name),
    ["Users", "LiveStreams", "Comments"],
  );
  assert.equal(document.querySelector(".empty-diagram"), null);
  assert.ok(document.body.textContent.includes("サンプルを開きました"));
  assert.equal(byLabel("元に戻す").disabled, true);
  assert.equal(library.listDiagrams().length, 3);
  assert.equal(saved().title, "ライブ配信");

  await key(document.body, "?");
  assert.ok(document.querySelector("#help-dialog"));
  assert.ok(document.body.textContent.includes("カラム端の点から"));
  // Shortcuts stay off while help is open.
  await key(document.body, "t");
  assert.equal(document.querySelector("#table-editor"), null);
  await click(byLabel("使い方を閉じる"));
  assert.equal(document.querySelector("#help-dialog"), null);
  await click(byText("使い方 ?"));
  assert.ok(document.querySelector("#help-dialog"));
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

test("add-table dialog focuses the name, Enter moves down columns and Command+Enter adds", async () => {
  await click(byText("テーブルを追加"));
  const name = document.querySelector('input[placeholder="例: users"]');
  assert.equal(document.activeElement, name);
  assert.equal(name.selectionStart, 0);
  assert.equal(name.selectionEnd, "table_1".length);
  assert.ok(byText("追加"));
  const rows = () => document.querySelectorAll(".column-edit-row").length;
  const count = rows();
  await click(byText("カラムを追加"));
  assert.equal(rows(), count + 1);
  const first = byLabel(`カラム${count}の物理名`);
  await key(first, "Enter");
  assert.equal(document.activeElement, byLabel(`カラム${count + 1}の物理名`));
  await act(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    ),
  );
  assert.equal(rows(), count + 1);
  await key(byLabel(`カラム${count + 1}の論理名`), "Enter");
  assert.equal(rows(), count + 2);
  assert.equal(document.activeElement, byLabel(`カラム${count + 2}の物理名`));
  assert.ok(document.querySelector("dialog[open]"));
  await act(() =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
      }),
    ),
  );
  assert.equal(document.querySelector("dialog[open]"), null);
  const added = saved().tables.find((t) => t.name === "table_1");
  assert.equal(added.columns.length, count + 2);
});

test("editing a table keeps the apply button label", async () => {
  await click(byLabel("usersを編集"));
  assert.ok(byText("変更を反映"));
});

test("invalid imports preserve the diagram and importing a file twice creates independent drawings", async () => {
  const before = localStorage.getItem(storageKey);
  async function upload(text) {
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        { name: "受注管理.json", size: text.length, text: async () => text },
      ],
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await upload("{broken");
  assert.equal(localStorage.getItem(storageKey), before);
  assert.match(
    document.querySelector(".instruction").textContent,
    /読み込めませんでした/,
  );
  const data = encode(validateDiagram({ tables: [], edges: [] }));
  await upload(data);
  assert.equal(saved().tables.length, 0);
  assert.equal(saved().title, "受注管理");
  const first = library.restoreDiagram().key;
  await upload(data);
  assert.notEqual(library.restoreDiagram().key, first);
  assert.equal(library.listDiagrams().length, 3);
  assert.equal(localStorage.getItem(storageKey), before);
  assert.equal(byLabel("元に戻す").disabled, true);
});

test("file menu copies and saves the same DDL and Mermaid text and disables exports on an empty diagram", async (t) => {
  let copied, blob, filename;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        copied = text;
      },
    },
  });
  t.after(() => {
    delete navigator.clipboard;
  });
  t.mock.method(URL, "createObjectURL", (value) => {
    blob = value;
    return "blob:test";
  });
  t.mock.method(dom.window.HTMLAnchorElement.prototype, "click", function () {
    filename = this.download;
  });
  await act(() => byLabel("図の名前").focus());
  await type(byLabel("図の名前"), "  注文/管理  ");
  await key(byLabel("図の名前"), "Enter");
  assert.equal(byLabel("図の名前").value, "注文/管理");
  await click(byText("ファイルに保存"));
  assert.equal(filename, "注文_管理.json");
  assert.equal(JSON.parse(await blob.text()).title, "注文/管理");
  await click(byText("SVG で保存"));
  assert.equal(filename, "注文_管理.svg");
  await click(byText("全テーブルの DDL をコピー"));
  assert.equal(copied.match(/CREATE TABLE /g).length, initial.tables.length);
  assert.match(
    document.querySelector(".instruction").textContent,
    /コピーしました/,
  );
  await click(byText("全テーブルの DDL を保存"));
  assert.equal(await blob.text(), copied);
  assert.equal(filename, "注文_管理.sql");
  await click(byText("Mermaid をコピー"));
  assert.match(copied, /^erDiagram\n/);
  await click(byText("Mermaid を保存"));
  assert.equal(await blob.text(), copied);
  assert.equal(filename, "注文_管理.mmd");
  await click(byText("定義書を保存（Markdown）"));
  assert.equal(filename, "注文_管理.md");
  assert.match(await blob.text(), /^# 注文\/管理\n/);
  await click(byText("定義書を保存（CSV）"));
  assert.equal(filename, "注文_管理.csv");
  assert.match(await blob.text(), /注文\/管理,\d{4}-\d{2}-\d{2},users,/);
  await click(byText("新しい図"));
  for (const label of [
    "SVG で保存",
    "PNG で保存",
    "全テーブルの DDL をコピー",
    "全テーブルの DDL を保存",
    "Mermaid をコピー",
    "Mermaid を保存",
    "定義書を保存（Markdown）",
    "定義書を保存（CSV）",
  ])
    assert.equal(byText(label).disabled, true);
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
test("adding tables keeps the zoom and only pans enough to show each one", async () => {
  await click(byText("新しい図"));
  await click(byLabel("拡大率 100%。100%に戻す"));
  await click(byLabel("拡大"));
  await click(byLabel("拡大"));
  const zoom = document.querySelector("#zoom-label").textContent;
  assert.notEqual(zoom, "100%");
  for (let i = 0; i < 5; i++) {
    const before = currentView();
    await click(byText("テーブルを追加"));
    await submit();
    assert.equal(document.querySelector("#zoom-label").textContent, zoom);
    const [x, y, w, h] = currentView();
    assert.deepEqual([w, h], [before[2], before[3]]);
    const table = saved().tables.at(-1);
    assert.ok(table.x >= x && table.y >= y, `table ${i + 1} is in view`);
    assert.ok(table.x < x + w && table.y < y + h, `table ${i + 1} is in view`);
  }
});
test("fit to view never zooms in past 100%", async () => {
  await click(byText("新しい図"));
  await click(byText("テーブルを追加"));
  await submit();
  await click(document.querySelector("#fit"));
  assert.equal(document.querySelector("#zoom-label").textContent, "100%");
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
  await key(byLabel("図上で物理名を編集"), "Enter");
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
  await key(byLabel("図上で論理名を編集"), "Enter");
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
  await key(byLabel("図上で物理名を編集"), "Enter");
  assert.match(
    document.querySelector('.inline-name [role="alert"]').textContent,
    /重複/,
  );
  assert.deepEqual(saved(), before);
  await key(byLabel("図上で物理名を編集"), "Escape");
});

test("add columns on the selected table one at a time and undo from the next empty row", async () => {
  const before = saved();
  assert.equal(document.querySelector(".inline-add-column"), null);
  await click(byLabel("users.id を接続"));
  await click(byLabel("usersにカラムを追加"));
  const input = () => byLabel("追加するカラムの物理名");
  assert.equal(document.activeElement, input());
  await key(input(), "Enter");
  await type(input(), " ID ");
  await key(input(), "Enter");
  assert.match(
    document.querySelector('.inline-name [role="alert"]').textContent,
    /重複/,
  );
  assert.deepEqual(saved(), before);

  await type(input(), " nickname ");
  await key(input(), "Enter");
  const first = saved();
  const { id, ...column } = first.tables[0].columns.at(-1);
  assert.ok(id);
  assert.deepEqual(column, {
    name: "nickname",
    type: "text",
    key: "",
    logicalName: "",
  });
  assert.deepEqual(first.tables[0].keys, before.tables[0].keys);
  assert.deepEqual(first.edges, before.edges);
  assert.equal(document.activeElement, input());
  assert.equal(input().value, "");
  await type(input(), "timezone");
  await key(input(), "Enter");
  const second = saved();
  assert.equal(
    second.tables[0].columns.length,
    before.tables[0].columns.length + 2,
  );
  await key(input(), "z", { metaKey: true });
  assert.deepEqual(saved(), first);
  await key(input(), "z", { metaKey: true, shiftKey: true });
  assert.deepEqual(saved(), second);
  await type(input(), "draft");
  await type(input(), "");
  await key(input(), "z", { metaKey: true });
  assert.deepEqual(saved(), second);
  await type(input(), "unfinished");
  await key(input(), "Escape");
  assert.equal(document.querySelector(".inline-name"), null);
  assert.deepEqual(saved(), second);
  await key(document.body, "z", { metaKey: true });
  await key(document.body, "z", { metaKey: true });
  assert.deepEqual(saved(), before);
});

test("Enter after a logical rename starts a new column, ignoring IME confirmation in either field", async () => {
  await click(byLabel("users.id を接続"));
  await click(byLabel("usersにカラムを追加"));
  await type(document.activeElement, "COLUMN_1");
  await key(document.activeElement, "Enter");
  await key(document.activeElement, "Escape");
  await click(document.querySelector('input[value="logical"]'));
  await key(byLabel("users.name を接続"), "F2");
  const rename = byLabel("図上で論理名を編集");
  await type(rename, "名前");
  await key(rename, "Enter", { isComposing: true });
  assert.equal(document.activeElement, rename);
  assert.equal(saved().tables[0].columns[1].logicalName, "");
  await key(rename, "Enter");
  const input = byLabel("追加するカラムの論理名");
  assert.equal(document.activeElement, input);
  const before = saved();
  assert.equal(before.tables[0].columns[1].logicalName, "名前");
  await type(input, "連絡先");
  await key(input, "Enter", { isComposing: true });
  await key(input, "Enter", { keyCode: 229 });
  assert.equal(document.activeElement, input);
  assert.deepEqual(saved(), before);
  await key(input, "Enter");
  const added = saved().tables[0].columns.at(-1);
  assert.equal(added.name, "column_2");
  assert.equal(added.logicalName, "連絡先");
  await click(byLabel("orders.id を接続"));
  assert.equal(document.querySelector(".inline-name"), null);
  assert.ok(byLabel("ordersにカラムを追加"));
  await click(byLabel("users.連絡先 を接続"));
  assert.equal(document.querySelector(".inline-name"), null);
});

test("adding the sixtieth column from the canvas ends entry and disables the add button", async () => {
  await act(() => root.unmount());
  const diagram = saved();
  const { columns } = diagram.tables[0];
  while (columns.length < 59) {
    const name = `col_${columns.length}`;
    columns.push({ id: name, name, type: "text", key: "", logicalName: "" });
  }
  localStorage.setItem(storageKey, encode(diagram));
  await mount();
  await key(byLabel("users.id を接続"), "F2");
  await key(byLabel("図上で物理名を編集"), "Enter");
  const input = byLabel("追加するカラムの物理名");
  const [, y, , h] = currentView();
  assert.ok(y + h > diagram.tables[0].y + 52 + 59 * 38);
  await type(input, "last_column");
  await key(input, "Enter");
  assert.equal(document.querySelector(".inline-name"), null);
  assert.equal(saved().tables[0].columns.length, 60);
  assert.equal(byLabel("usersにカラムを追加").disabled, true);
  await key(document.body, "z", { metaKey: true });
  assert.deepEqual(saved(), diagram);
  assert.equal(byLabel("usersにカラムを追加").disabled, false);
});

test("a column that would grow into a neighboring table stays an editable draft", async () => {
  await act(() => root.unmount());
  const diagram = saved();
  diagram.tables[1].x = diagram.tables[0].x;
  diagram.tables[1].y = diagram.tables[0].y + 265;
  localStorage.setItem(storageKey, encode(diagram));
  await mount();
  const before = saved();
  await click(byLabel("users.id を接続"));
  await click(byLabel("usersにカラムを追加"));
  const input = byLabel("追加するカラムの物理名");
  await type(input, "nickname");
  await key(input, "Enter");
  assert.match(
    document.querySelector('.inline-name [role="alert"]').textContent,
    /移動/,
  );
  assert.equal(document.activeElement, input);
  assert.deepEqual(saved(), before);
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
  const oldRaw = localStorage.getItem(storageKey);
  const proto = Object.getPrototypeOf(localStorage),
    original = proto.setItem;
  proto.setItem = function (key, value) {
    if (key.endsWith(".v1-backup")) throw new Error("quota");
    return original.call(this, key, value);
  };
  try {
    await mount();
    assert.ok(byLabel("customを編集"));
    assert.equal(library.listDiagrams().length, 1);
    assert.equal(localStorage.getItem(storageKey + ".v1-backup"), null);
    await act(() => byLabel("図の名前").focus());
    await type(byLabel("図の名前"), "編集中");
    await key(byLabel("図の名前"), "Enter");
    assert.match(document.querySelector(".instruction").textContent, /退避先/);
    assert.equal(localStorage.getItem(storageKey), oldRaw);
    proto.setItem = original;
    await click(byText("図の一覧"));
    assert.equal(localStorage.getItem(storageKey + ".v1-backup"), oldRaw);
    assert.equal(saved().title, "編集中");
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
  const raw = localStorage.getItem(storageKey),
    before = saved();
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
  assert.deepEqual(saved(), before);
  assert.equal(byLabel("やり直す").disabled, false);
  const afterUndo = localStorage.getItem(storageKey);
  await pointer(header(), "pointerdown", 100, 100);
  await pointer(svg, "pointermove", 130, 130);
  await pointer(svg, "pointercancel", 130, 130);
  assert.equal(localStorage.getItem(storageKey), afterUndo);
  assert.equal(byLabel("元に戻す").disabled, true);
  assert.equal(byLabel("やり直す").disabled, false);
});

test("clicking a table header selects it without editing history", async () => {
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
  assert.equal(document.querySelector(".inspector"), null);
  assert.equal(byLabel("元に戻す").disabled, true);
  await key(document.body, "Escape");
  assert.equal(document.querySelector("[data-table].selected"), null);
});

test("table editor offers a collapsible DDL preview", async () => {
  await click(byLabel("ordersを編集"));
  const ddl = document.querySelector("#table-editor .ddl-section");
  assert.equal(ddl.open, false);
  assert.match(ddl.querySelector(".ddl").textContent, /CREATE TABLE orders/);
});

test("sidebar lists tables and relations and selects them", async () => {
  assert.equal(document.querySelector(".sidebar"), null);
  await click(byLabel("テーブル一覧"));
  assert.equal(localStorage.getItem("er-sketch.sidebar"), "open");
  const items = [...document.querySelectorAll(".sidebar-item")];
  assert.deepEqual(
    items
      .filter((b) => !b.classList.contains("relation"))
      .map((b) => b.textContent),
    ["users4", "orders4", "order_items4"],
  );
  await click(items.find((b) => b.textContent.startsWith("users")));
  assert.ok(document.querySelector('[data-table="users"].selected'));
  await click(document.querySelector(".sidebar-item.relation"));
  assert.equal(document.querySelectorAll(".edge.selected").length, 1);
  assert.equal(document.querySelector("[data-table].selected"), null);
  assert.ok(byText("外部キーを編集"));
  await type(byLabel("図の中を検索"), "item");
  assert.deepEqual(
    [...document.querySelectorAll(".sidebar-item:not(.relation)")].map(
      (b) => b.textContent,
    ),
    ["order_items4"],
  );
});

test("diagram search matches both names of tables and columns and reveals the result", async () => {
  await act(() => root.unmount());
  const diagram = structuredClone(initial);
  const table = diagram.tables.find((t) => t.id === "order_items");
  table.logicalName = "注文明細";
  table.note = "購入時の明細";
  table.columns[2].note = "注文時点の単価";
  table.columns[2].logicalName = "商品番号";
  table.x = 10000;
  localStorage.setItem(storageKey, encode(diagram));
  await mount();
  await click(document.querySelector("#zoom-label"));
  await key(document.body, "f", { metaKey: true });
  const input = byLabel("図の中を検索");
  assert.equal(document.activeElement, input);
  for (const query of [
    "ORDER_IT",
    "注文明細",
    "購入時",
    "単価",
    table.columns[2].name,
    "商品番号",
  ]) {
    await type(input, query);
    assert.equal(document.querySelectorAll(".sidebar-item").length, 1);
    assert.match(
      document.querySelector(".sidebar-item").textContent,
      /order_items/,
    );
  }
  assert.equal(document.querySelector(".search-match").textContent, "商品番号");
  await key(input, "Enter");
  assert.ok(document.querySelector('[data-table="order_items"].selected'));
  assert.equal(
    document.querySelector("[data-search-match] .column-name").textContent,
    table.columns[2].name,
  );
  const [x, , width] = currentView();
  assert.ok(x <= table.x && table.x + 230 <= x + width);
  await type(input, "該当なし");
  assert.equal(
    document.querySelector(".sidebar-empty").textContent,
    "一致するテーブルはありません",
  );
});

test("related view keeps both ends editable and saves and exports the whole diagram", async (t) => {
  const tables = () =>
    [...document.querySelectorAll("g.table")].map((el) =>
      el.getAttribute("data-table"),
    );
  const before = saved();
  const view = currentView();
  await click(byLabel("users.email を接続"));
  await click(byText("関連だけ表示"));
  assert.deepEqual(tables(), ["users", "orders"]);
  assert.equal(document.querySelectorAll("g.edge").length, 1);
  await click(byLabel("orders.user_id を接続"));
  await key(byLabel("ordersを移動。矢印キーで移動できます。"), "ArrowDown");
  assert.deepEqual(tables(), ["users", "orders"]);
  assert.equal(saved().tables[1].y, before.tables[1].y + 8);
  assert.deepEqual(saved().tables[2], before.tables[2]);
  assert.equal(saved().edges.length, 2);
  let blob;
  t.mock.method(URL, "createObjectURL", (value) => {
    blob = value;
    return "blob:test";
  });
  t.mock.method(dom.window.HTMLAnchorElement.prototype, "click", () => {});
  await click(byText("ファイルに保存"));
  assert.equal(JSON.parse(await blob.text()).schema.tables.length, 3);
  await click(byText("SVG で保存"));
  assert.match(await blob.text(), /order_items/);
  await click(byText("定義書を保存（Markdown）"));
  assert.match(await blob.text(), /\n## order_items\n/);
  await click(byText("定義書を保存（CSV）"));
  assert.match(await blob.text(), /,order_items,[^\r\n]*,product_name,/);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved().tables, before.tables);
  assert.deepEqual(tables(), ["users", "orders"]);
  await click(byText("関連表示を解除"));
  assert.equal(tables().length, 3);
  assert.deepEqual(currentView(), view);
  await click(byLabel("orders.user_id を接続"));
  await click(byText("関連だけ表示"));
  assert.equal(tables().length, 3); // both incoming and outgoing tables
  await click(byText("関連表示を解除"));
  await click(byLabel("users.email を接続"));
  await click(byText("関連だけ表示"));
  await key(document.body, "f", { ctrlKey: true });
  await type(byLabel("図の中を検索"), "order_items");
  await click(document.querySelector(".sidebar-item"));
  assert.deepEqual(tables(), ["orders", "order_items"]);
  assert.ok(document.querySelector('[data-table="order_items"].selected'));
});

test("clicking a column selects only; dragging from its dot connects tables", async () => {
  await click(byLabel("usersからordersへの接続線"));
  await click(byText("外部キーを削除"));
  const before = saved().edges.length;
  await click(byLabel("users.email を接続"));
  assert.equal(document.querySelector(".connect-hint"), null);
  assert.ok(document.querySelector('[data-table="users"].selected'));
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
  await click(byLabel("テーブル一覧"));
  await click(document.querySelector(".sidebar-item.relation"));
  await key(document.body, "Delete");
  assert.equal(saved().edges.length, edges - 1);
  await click(byLabel("元に戻す"));
  assert.equal(saved().edges.length, edges);
  const users = [...document.querySelectorAll(".sidebar-item")].find((b) =>
    b.textContent.startsWith("users"),
  );
  await click(users);
  await key(byLabel("図の中を検索"), "Backspace");
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

for (const engine of ["Chrome", "Safari"]) {
  test(`${engine} composition keeps ER fields focused and Escape restores the saved diagram name`, async () => {
    const title = byLabel("図の名前"),
      original = title.value;
    await act(() => title.focus());
    await type(title, "注文の流れ");
    await imeKey(title, "Enter", engine);
    await imeKey(title, "Escape", engine);
    assert.equal(document.activeElement, title);
    assert.equal(title.value, "注文の流れ");
    await key(title, "Escape");
    assert.equal(title.value, original);
    assert.equal(byLabel("元に戻す").disabled, true);

    await click(byText("DDL を読み込む"));
    const ddl = document.querySelector("#ddl-source");
    await act(() => ddl.focus());
    await type(ddl, "CREATE TABLE 受注(id int);");
    await imeKey(ddl, "Escape", engine);
    await imeKey(ddl, "Enter", engine);
    assert.equal(document.activeElement, ddl);
    assert.match(ddl.value, /受注/);
    await click(byText("キャンセル"));

    await click(byLabel("usersを編集"));
    const column = byLabel("カラム1の論理名");
    await act(() => column.focus());
    await type(column, "識別子");
    await imeKey(column, "Enter", engine, { metaKey: true });
    assert.equal(document.activeElement, column);
    assert.equal(saved().tables[0].columns[0].logicalName, "");
  });
}

test("Tab renames successive columns, and blur saves the final draft only once", async () => {
  const originalLast = saved().tables[0].columns.at(-1).name;
  await key(byLabel("usersを移動。矢印キーで移動できます。"), "Enter");
  const name = () => byLabel("図上で物理名を編集");
  await type(name(), "members");
  await key(name(), "Tab");
  assert.equal(saved().tables[0].name, "members");
  assert.equal(document.activeElement.value, "id");
  await type(name(), "member_id");
  await key(name(), "Tab");
  assert.equal(document.activeElement.value, "name");
  await type(name(), "display_name");
  const grid = document.querySelector('rect[fill="url(#grid)"]');
  await pointer(grid, "pointerdown", 10, 10);
  assert.equal(document.querySelector(".inline-name"), null);
  assert.deepEqual(
    saved()
      .tables[0].columns.slice(0, 2)
      .map((c) => c.name),
    ["member_id", "display_name"],
  );

  await click(byLabel("members.member_id を接続"));
  await click(byLabel("membersにカラムを追加"));
  const add = () => byLabel("追加するカラムの物理名");
  await type(add(), "memo_text");
  await key(add(), "Tab");
  assert.equal(document.activeElement, add());
  assert.equal(add().value, "");
  await type(add(), "   ");
  await act(() => add().blur());
  assert.equal(document.querySelector(".inline-name"), null);
  assert.equal(
    saved().tables[0].columns.filter((c) => c.name === "memo_text").length,
    1,
  );
  await click(byLabel("元に戻す"));
  assert.equal(saved().tables[0].columns.at(-1).name, originalLast);
});

test("an invalid name stays editable when leaving through Tab or the grid", async () => {
  await key(byLabel("users.id を接続"), "F2");
  const input = byLabel("図上で物理名を編集");
  await type(input, "email");
  await key(input, "Tab");
  const grid = document.querySelector('rect[fill="url(#grid)"]');
  await pointer(grid, "pointerdown", 10, 10);
  await click(grid);
  assert.equal(document.activeElement, input);
  assert.equal(input.value, "email");
  assert.equal(input.getAttribute("aria-invalid"), "true");
  await key(input, "Escape");
  assert.equal(saved().tables[0].columns[0].name, "id");
});

test("column details and referential actions can be edited, cleared and undone", async () => {
  async function choose(select, value) {
    await act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await click(byLabel("ordersを編集"));
  await type(byLabel("テーブルの説明"), "注文の明細は別表に記録します。");
  await click(byLabel("totalのNOT NULL"));
  await click(byLabel("totalの詳細"));
  await type(byLabel("totalの既定値"), "0");
  await type(byLabel("totalの説明"), "税込の合計");
  await click(byLabel("idの詳細"));
  await choose(byLabel("カラム1の型"), "integer");
  await choose(byLabel("idの自動採番"), "serial");
  assert.equal(byLabel("カラム1の型").value, "serial");
  await click(byLabel("user_idの参照先 users.idを編集"));
  await choose(
    document.querySelector('select[aria-label="親の削除時"]'),
    "CASCADE",
  );
  await choose(
    document.querySelector('select[aria-label="親の更新時"]'),
    "RESTRICT",
  );
  await click(byText("完了"));
  await submit();
  const order = saved().tables[1];
  assert.equal(order.note, "注文の明細は別表に記録します。");
  assert.equal(order.columns[0].type, "serial");
  assert.equal(order.columns[2].note, "税込の合計");
  assert.equal(order.columns[2].notNull, true);
  assert.equal(order.columns[2].defaultValue, "0");
  assert.equal(order.foreignKeys[0].onUpdate, "RESTRICT");
  assert.deepEqual(
    [...document.querySelectorAll(".column-marks")].map((n) => n.textContent),
    ["AI", "NN · DF"],
  );
  await click(byLabel("usersからordersへの接続線"));
  assert.match(
    document.querySelector("#edge-label").textContent,
    /削除時 CASCADE更新時 RESTRICT/,
  );
  await click(byText("外部キーを編集"));
  await choose(document.querySelector('select[aria-label="親の削除時"]'), "");
  await click(byText("完了"));
  await click(byLabel("idの詳細"));
  await choose(byLabel("idの自動採番"), "always");
  await submit();
  assert.equal(saved().tables[1].columns[0].type, "integer");
  assert.equal(saved().tables[1].columns[0].identity, "always");
  assert.equal(saved().tables[1].foreignKeys[0].onDelete, undefined);
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved().tables[1], order);
});

test("Shift selection and Command+G group tables, search and filtered drag use full membership", async () => {
  for (const id of ["orders", "order_items"]) {
    const heading = document.querySelector(`[data-table="${id}"] .table-title`);
    await act(() =>
      heading.dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true }),
      ),
    );
  }
  assert.equal(document.querySelectorAll(".table.selected").length, 2);
  await key(document.body, "g", { metaKey: true });
  assert.equal(
    document.querySelectorAll("#group-dialog input:checked").length,
    2,
  );
  await type(document.querySelector("#group-dialog .field input"), "受注");
  await submit();
  assert.deepEqual(saved().groups[0].tableIds, ["orders", "order_items"]);
  await key(document.body, "f", { metaKey: true });
  await type(byLabel("図の中を検索"), "受注");
  assert.equal(document.querySelectorAll(".sidebar-item").length, 2);
  await click(byLabel("users.email を接続"));
  await click(byText("関連だけ表示"));
  assert.equal(document.querySelectorAll(".table").length, 2);
  const before = saved(),
    svg = document.querySelector("#diagram");
  await pointer(byLabel("受注の囲みを編集"), "pointerdown", 100, 100);
  await pointer(svg, "pointermove", 120, 115);
  await pointer(svg, "pointerup", 120, 115);
  const after = saved();
  assert.deepEqual(after.tables[0], before.tables[0]);
  assert.ok(after.tables[1].x > before.tables[1].x);
  assert.equal(
    after.tables[1].x - before.tables[1].x,
    after.tables[2].x - before.tables[2].x,
  );
  await click(byLabel("元に戻す"));
  assert.deepEqual(saved(), before);
  await key(byLabel("受注の囲みを編集"), "Enter");
  await click(byText("囲みを解除"));
  assert.equal(saved().groups, undefined);
  assert.equal(saved().tables.length, 3);
});
