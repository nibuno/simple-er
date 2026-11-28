import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { viewerHtml } from "../canvas/src/html.ts";
import { emptyDocument, sampleDocument } from "../canvas/src/model.ts";

const template = readFileSync(
  new URL("../canvas/src/viewer.html", import.meta.url),
  "utf8",
);
const render = (doc) => viewerHtml(doc, template);

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
