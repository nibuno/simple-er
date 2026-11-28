import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { unzipSync } from "fflate";
import { markdownArchive } from "../canvas/src/markdown.ts";
import { decode, encode } from "../canvas/src/model.ts";
import { toSvg } from "../canvas/src/export.ts";
import { viewerHtml } from "../canvas/src/html.ts";
import { emptyDocument, sampleDocument } from "../canvas/src/model.ts";

const template = readFileSync(
  new URL("../canvas/src/viewer.html", import.meta.url),
  "utf8",
);
const render = (doc) => viewerHtml(doc, template);

test("ER リンクは編集用 JSON で復元し、閲覧用 HTML・SVG・Markdown には出さない", async () => {
  const plain = sampleDocument(),
    linked = structuredClone(plain);
  const link = {
    key: "er-sketch.local.v1",
    id: "original",
    store: "local-store",
  };
  linked.nodes[0].erLink = link;
  assert.deepEqual(decode(encode(linked)).nodes[0].erLink, link);
  assert.equal(render(linked), render(plain));
  assert.equal(toSvg(linked), toSvg(plain));
  const unpack = async (doc) =>
    unzipSync(new Uint8Array(await markdownArchive(doc).arrayBuffer()));
  assert.deepEqual(await unpack(linked), await unpack(plain));
  linked.nodes[0].erLink = { ...link, key: "simple-canvas.active.v1" };
  assert.throws(() => decode(encode(linked)), /リンク/);
});

test("閲覧用HTMLに図と状態付きメモを一覧順で埋め込み、入力した文字をそのまま表示する", () => {
  const doc = sampleDocument();
  doc.title = "通知 <設計> & {{memos}}";
  const api = doc.nodes.find((node) => node.id === "api");
  const worker = doc.nodes.find((node) => node.id === "worker");
  api.title = "";
  api.body = "受付 <注文>\n{{diagram}} & 詳細";
  worker.memoStatus = "decided";
  worker.body += "\n最終行";
  doc.nodes = [worker, ...doc.nodes.filter((node) => node !== worker)];
  const page = new JSDOM(render(doc)).window.document;
  assert.equal(page.title, doc.title);
  assert.equal(page.querySelector("h1").textContent, doc.title);
  assert.equal(page.querySelectorAll("svg marker").length, doc.edges.length);
  assert.deepEqual(
    [...page.querySelectorAll("li strong")].map((el) => el.textContent),
    ["Worker", "箱"],
  );
  assert.deepEqual(
    [...page.querySelectorAll("[data-status]")].map((el) => el.textContent),
    ["決定", "未設定"],
  );
  assert.deepEqual(
    [...page.querySelectorAll(".memo-body")].map((el) => el.textContent),
    [worker.body, api.body],
  );
  assert.equal(page.querySelectorAll("script").length, 1);
  assert.equal(
    page.querySelectorAll("[src],link,[contenteditable],input,textarea").length,
    0,
  );
  assert.equal(page.querySelectorAll('svg [data-memo="0"]').length, 2);
  assert.match(
    new JSDOM(render(emptyDocument())).window.document.querySelector("aside")
      .textContent,
    /この図にはメモがありません/,
  );
});

test("閲覧用HTMLで図形・点線メモ・一覧を選ぶと双方が連動し、表示範囲を変更できる", () => {
  const { window } = new JSDOM(render(sampleDocument()), {
    runScripts: "dangerously",
    beforeParse(window) {
      window.ResizeObserver = class {
        observe() {}
      };
      Object.defineProperty(window.HTMLElement.prototype, "clientWidth", {
        get: () => 800,
      });
      Object.defineProperty(window.HTMLElement.prototype, "clientHeight", {
        get: () => 600,
      });
      window.SVGElement.prototype.getBBox = () => ({
        x: 720,
        y: 330,
        width: 200,
        height: 100,
      });
      window.HTMLElement.prototype.scrollIntoView = function () {
        this.dataset.scrolled = "true";
      };
    },
  });
  const page = window.document;
  const svg = page.querySelector("svg");
  const view = () => svg.getAttribute("viewBox").split(" ").map(Number);
  const fitted = view();
  const row = page.querySelector('button[data-memo="1"]');
  row.click();
  assert.equal(
    page.querySelectorAll('svg [data-memo="1"][aria-current]').length,
    2,
  );
  assert.equal(view()[0] + view()[2] / 2, 820);
  page.querySelector("#enlarge").click();
  assert.ok(view()[2] < fitted[2]);
  const zoomed = view();
  page
    .querySelector("#stage")
    .dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }));
  assert.ok(view()[0] > zoomed[0]);
  page.querySelector("#fit").click();
  assert.deepEqual(view(), fitted);
  svg
    .querySelector('[data-memo="0"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(page.querySelector("button[aria-current]").dataset.memo, "0");
  assert.equal(row.hasAttribute("aria-current"), false);
  svg
    .querySelector('[data-memo="1"]:not([data-owner])')
    .dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  assert.equal(row.dataset.scrolled, "true");
  assert.equal(row.getAttribute("aria-current"), "true");
  window.close();
});

test("画像と閲覧用HTMLの図では名前・説明・線・テキスト・メモを禁則に従って折り返す", async () => {
  const { makeNode, growNodes, attachNote } =
    await import("../canvas/src/model.ts");
  const { toSvg } = await import("../canvas/src/export.ts");
  const doc = emptyDocument();
  const sentence =
    "入力する。（確認してから「次へ」を押す）、保存・終了。".repeat(3);
  const box = {
    ...makeNode("box", { x: 0, y: 0 }),
    title: sentence,
    description: sentence,
    body: sentence,
  };
  const text = { ...makeNode("note", { x: 240, y: 0 }), body: sentence };
  doc.nodes.push(box, text);
  doc.edges.push({
    id: "edge",
    from: box.id,
    to: text.id,
    label: sentence,
    dashed: false,
  });
  const withMemo = attachNote(growNodes(doc), box.id).doc;
  const svg = new JSDOM(toSvg(withMemo), { contentType: "image/svg+xml" })
    .window.document;
  const viewer = new JSDOM(render(withMemo)).window.document;
  const lines = (root) =>
    [...root.querySelectorAll("svg text")].map((el) => el.textContent);
  const imageLines = lines(svg);
  assert.deepEqual(lines(viewer), imageLines);
  for (const line of imageLines) {
    assert.doesNotMatch(line, /^[。、・）」]|[（「]$/);
  }
  // The title also appears in the attached memo's heading.
  assert.equal(imageLines.join("").split(sentence).length - 1, 6);
  assert.equal(viewer.querySelector(".memo-body").textContent, sentence);
});
