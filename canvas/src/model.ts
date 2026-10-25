import { reduceHistory } from "../../shared/history.ts";
import type {
  CanvasDocument,
  CanvasNode,
  NodeKind,
  NodeShape,
  Point,
  History,
  HistoryAction,
} from "./types";
import {
  boxTextArea,
  minimumBoxHeight,
  minimumWidth,
  SHAPES,
  shapeLabels,
} from "./shapes";
import { NODE_ICONS } from "./Icons";
import { arrangeBoxes } from "./layout";
import { validColor } from "./colors";
import { bounds } from "./spatial";
import type { Rect } from "./spatial";
import { documentRoutes } from "./geometry";
export { bounds } from "./spatial";
import { wrapText } from "./text";
export { wrapText } from "./text";

export const STORAGE_KEY = "simple-canvas.document.v1";
export const VIEW_KEY = "simple-canvas.view.v1";
export const MAX_NODES = 150;
export const MAX_EDGES = 400;
export const MAX_TEXT = 6000;
export const uid = () => crypto.randomUUID();
export const clone = <T>(value: T): T => structuredClone(value);
export const emptyDocument = (): CanvasDocument => ({
  format: "simple-canvas",
  version: 1,
  id: uid(),
  title: "無題のキャンバス",
  nodes: [],
  edges: [],
});
export function makeNode(
  kind: NodeKind,
  point: Point,
  shape: NodeShape = "rectangle",
): CanvasNode {
  return {
    id: uid(),
    kind,
    shape: kind === "box" ? shape : "rectangle",
    x: point.x,
    y: point.y,
    w:
      kind === "group"
        ? 420
        : kind === "note"
          ? 280
          : shape === "person" || shape === "circle"
            ? 120
            : shape === "ellipse" || shape === "diamond" || shape === "cloud"
              ? 240
              : 200,
    h:
      kind === "group"
        ? 280
        : kind === "note"
          ? 50
          : shape === "diamond"
            ? 180
            : shape === "cylinder"
              ? 140
              : shape === "ellipse" ||
                  shape === "person" ||
                  shape === "cloud" ||
                  shape === "circle"
                ? 120
                : 100,
    title: kind === "group" ? "囲み" : "",
    description: "",
    body: "",
  };
}
export function sampleDocument(): CanvasDocument {
  const doc = emptyDocument();
  doc.title = "通知処理の設計";
  const data = [
    ["browser", "ブラウザ", "注文する", 80, 100],
    ["api", "API", "注文を受け付ける", 400, 100],
    ["db", "DB", "注文を保存する", 720, 100],
    ["queue", "Queue", "通知をためる", 400, 330],
    ["worker", "Worker", "メールを送る", 720, 330],
  ] as const;
  doc.nodes = data.map(([id, title, description, x, y]) => ({
    ...makeNode(
      "box",
      { x, y },
      id === "db" ? "cylinder" : id === "browser" ? "ellipse" : "rectangle",
    ),
    id,
    title,
    description,
  }));
  doc.nodes.find((n) => n.id === "api")!.body =
    "注文を保存して、通知イベントを渡す。\n\n気になる点\n保存とイベント送信の間に失敗した場合はどうするか。";
  doc.nodes.find((n) => n.id === "worker")!.body =
    "送信に失敗したら再試行する。\n\n気になる点\n同じ通知を二度送らない仕組みが必要。\n\n確認すること\n再試行回数と、失敗時の運用。";
  const decision = makeNode("note", { x: 80, y: 370 });
  decision.title = "今回の方針";
  decision.body =
    "通知は非同期にする。\nメール送信を待たずに、\n注文結果を返す。";
  decision.w = 270;
  doc.nodes.push(decision, {
    ...makeNode("note", { x: 1010, y: 260 }),
    id: "worker-note",
    attachedTo: "worker",
    h: 270,
  });
  doc.edges = [
    ["browser", "api"],
    ["api", "db"],
    ["api", "queue"],
    ["queue", "worker"],
  ].map(([from, to], i) => ({
    id: "edge-" + i,
    from,
    to,
    label: to === "queue" ? "通知イベント" : "",
    dashed: false,
  }));
  return doc;
}
export function noteContent(node: CanvasNode, doc: CanvasDocument) {
  const parent = doc.nodes.find((n) => n.id === node.attachedTo);
  return parent
    ? {
        title: parent.title
          ? parent.title + " のメモ"
          : shapeLabels[parent.shape] + "のメモ",
        body: parent.body,
      }
    : { title: node.title, body: node.body };
}
export function minimumHeight(node: CanvasNode, doc: CanvasDocument) {
  if (node.kind === "group") return 100;
  if (node.kind === "box") {
    const area = boxTextArea(node),
      textHeight =
        (node.title ? wrapText(node.title, area.w, 16).length * 24 : 0) +
        (node.description
          ? wrapText(node.description, area.w, 13).length * 21
          : 0) +
        (node.title && node.description ? 7 : 0);
    return minimumBoxHeight(node.shape, textHeight);
  }
  const text = noteContent(node, doc);
  // 50 is the smallest height a saved file accepts.
  return Math.max(
    50,
    24 +
      (text.title
        ? wrapText(text.title, node.w - 28, 13).length * 22 + 10
        : 0) +
      wrapText(text.body || "メモを書く", node.w - 28, 14).length * 24,
  );
}
// Figures and groups grow to fit their text; text and memos are exactly as
// tall as their words, so their frame never runs past them.
export function growNodes(doc: CanvasDocument) {
  doc.nodes.forEach((n) => {
    const fit = minimumHeight(n, doc);
    n.h = n.kind === "note" ? fit : Math.max(n.h, fit);
    // A circle stays round: both sides follow the larger one.
    if (n.kind === "box" && n.shape === "circle")
      n.w = n.h = Math.max(n.w, n.h);
  });
  return doc;
}
export function encode(doc: CanvasDocument) {
  return JSON.stringify(doc, null, 2);
}
export function decode(raw: string): CanvasDocument {
  if (new TextEncoder().encode(raw).length > 2_000_000)
    throw new Error("ファイルの上限は2MBです。");
  const d = JSON.parse(raw);
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (!d || d.format !== "simple-canvas" || d.version !== 1)
    fail("対応していない保存形式です。SimpleCanvasのJSONを選んでください。");
  const str = (value: unknown, max: number) =>
    typeof value === "string" && value.length <= max;
  if (!str(d.id, 120) || !d.id || !str(d.title, 200))
    fail("キャンバス名またはIDが不正です。");
  if (
    !Array.isArray(d.nodes) ||
    d.nodes.length > MAX_NODES ||
    !Array.isArray(d.edges) ||
    d.edges.length > MAX_EDGES
  )
    fail("要素数の上限を超えています。");
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (!n || !str(n.id, 120) || !n.id || ids.has(n.id))
      fail("要素のIDが不正または重複しています。");
    ids.add(n.id);
    if (
      !["box", "note", "group"].includes(n.kind) ||
      !SHAPES.includes(n.shape) ||
      (n.kind !== "box" && n.shape !== "rectangle")
    )
      fail("対応していない図形が含まれています。");
    for (const key of ["x", "y", "w", "h"])
      if (!Number.isFinite(n[key]) || Math.abs(n[key]) > 100000)
        fail("位置・サイズが不正です。");
    if (
      n.w < (n.kind === "box" ? minimumWidth(n.shape) : 160) ||
      n.h < 50 ||
      n.w > (n.kind === "group" ? 100000 : 4000) ||
      n.h > (n.kind === "group" ? 100000 : 20000)
    )
      fail("サイズが範囲外です。");
    if (
      !str(n.title, 200) ||
      !str(n.description, 500) ||
      !str(n.body, MAX_TEXT)
    )
      fail("テキストが長すぎるか、不正です。");
    if (
      n.icon !== undefined &&
      (n.kind !== "box" || !NODE_ICONS.some((icon) => icon.id === n.icon))
    )
      fail("対応していないアイコンが含まれています。");
    if (n.groupId !== undefined && !str(n.groupId, 120))
      fail("囲みの参照が不正です。");
    if (n.attachedTo !== undefined && !str(n.attachedTo, 120))
      fail("メモの参照が不正です。");
    for (const key of ["fillColor", "strokeColor"])
      if (n[key] !== undefined && !validColor(n[key]))
        fail("図形の色が不正です。");
  }
  for (const n of d.nodes) {
    if (
      n.groupId &&
      (n.kind === "group" ||
        !d.nodes.some(
          (p: CanvasNode) => p.id === n.groupId && p.kind === "group",
        ))
    )
      fail("囲みの参照先がありません。");
    if (
      n.attachedTo &&
      (n.kind !== "note" ||
        !d.nodes.some(
          (p: CanvasNode) => p.id === n.attachedTo && p.kind === "box",
        ))
    )
      fail("メモの参照先がありません。");
  }
  for (const e of d.edges) {
    if (!e || !str(e.id, 120) || !e.id || ids.has(e.id))
      fail("接続線のIDが不正または重複しています。");
    ids.add(e.id);
    if (
      ![e.from, e.to].every((id) =>
        d.nodes.some((n: CanvasNode) => n.id === id && n.kind !== "group"),
      )
    )
      fail("接続先の要素がありません。");
    if (!str(e.label, 200) || typeof e.dashed !== "boolean")
      fail("接続線の設定が不正です。");
    if (e.strokeColor !== undefined && !validColor(e.strokeColor))
      fail("接続線の色が不正です。");
  }
  return growNodes(d);
}
export function historyReducer(state: History, action: HistoryAction): History {
  return reduceHistory(state, action, 80);
}
export function expandedIds(doc: CanvasDocument, selection: string[]) {
  const ids = new Set(selection);
  doc.nodes.forEach((n) => {
    if (n.groupId && ids.has(n.groupId)) ids.add(n.id);
  });
  doc.nodes.forEach((n) => {
    if (n.attachedTo && ids.has(n.attachedTo)) ids.add(n.id);
  });
  return ids;
}
export function moveNodes(
  doc: CanvasDocument,
  ids: string[],
  dx: number,
  dy: number,
) {
  const next = clone(doc),
    expanded = expandedIds(doc, ids);
  next.nodes.forEach((n) => {
    if (expanded.has(n.id)) {
      n.x += dx;
      n.y += dy;
    }
  });
  return next;
}
export function removeSelection(doc: CanvasDocument, ids: string[]) {
  const next = clone(doc),
    removed = new Set(ids);
  next.nodes = next.nodes
    .filter((n) => !removed.has(n.id))
    .map((n) => {
      if (n.attachedTo && removed.has(n.attachedTo)) {
        Object.assign(n, noteContent(n, doc));
        delete n.attachedTo;
      }
      if (n.groupId && removed.has(n.groupId)) delete n.groupId;
      return n;
    });
  next.edges = next.edges.filter(
    (e) => !removed.has(e.id) && !removed.has(e.from) && !removed.has(e.to),
  );
  return next;
}
export function fitGroup(doc: CanvasDocument, id: string) {
  const group = doc.nodes.find((n) => n.id === id);
  const members = doc.nodes.filter((n) => n.groupId === id);
  if (group && members.length) {
    const b = bounds(members);
    Object.assign(group, {
      x: b.x - 32,
      y: b.y - 54,
      w: b.w + 64,
      h: b.h + 86,
    });
  }
  return doc;
}
export function groupSelection(doc: CanvasDocument, ids: string[]) {
  const next = clone(doc),
    expanded = expandedIds(doc, ids);
  const members = next.nodes.filter(
    (n) => expanded.has(n.id) && n.kind !== "group",
  );
  if (!members.length)
    throw new Error("囲む図形を2つ以上選択してください（Shift＋クリック）");
  if (next.nodes.length >= MAX_NODES)
    throw new Error("追加できるのは150個までです");
  const group = makeNode("group", { x: 0, y: 0 });
  members.forEach((n) => (n.groupId = group.id));
  next.nodes.push(group);
  return { doc: fitGroup(next, group.id), id: group.id };
}
export function attachNote(doc: CanvasDocument, id: string) {
  const existing = doc.nodes.find((n) => n.attachedTo === id);
  if (existing) return { doc, id: existing.id };
  const next = clone(doc),
    parent = next.nodes.find((n) => n.id === id);
  if (!parent || parent.kind !== "box")
    throw new Error("図形を選択してください");
  if (next.nodes.length >= MAX_NODES)
    throw new Error("追加できるのは150個までです");
  const note = {
    ...makeNode("note", { x: parent.x + parent.w + 72, y: parent.y }),
    attachedTo: id,
    groupId: parent.groupId,
  };
  note.h = minimumHeight(note, next);
  // Beside the figure if it is clear there, else the nearest free spot.
  placeInFreeSpace(note, next);
  next.nodes.push(note);
  return { doc: growNodes(next), id: note.id };
}
export const intersects = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
// What a new figure has to stay clear of: other elements, lines and their
// labels, with enough room around it for a line to pass.
function freeSpace(node: CanvasNode, doc: CanvasDocument) {
  const obstacles: Rect[] = doc.nodes.filter(
    (n) => n.id !== node.id && n.kind !== "group",
  );
  documentRoutes(doc).forEach((r) => {
    r.points.slice(1).forEach((p, i) => {
      const q = r.points[i];
      obstacles.push({
        x: Math.min(p.x, q.x),
        y: Math.min(p.y, q.y),
        w: Math.abs(p.x - q.x),
        h: Math.abs(p.y - q.y),
      });
    });
    if (r.labelLines.some(Boolean))
      obstacles.push({
        x: r.label.x - 110,
        y: r.label.y - 22,
        w: 220,
        h: r.labelLines.length * 18 + 22,
      });
  });
  const gap = 32;
  return {
    obstacles,
    free: (x: number, y: number) =>
      !obstacles.some((n) =>
        intersects(
          { x: x - gap, y: y - gap, w: node.w + gap * 2, h: node.h + gap * 2 },
          n,
        ),
      ),
  };
}
// The gap the ports leave between a figure and the one added beside it. The
// toolbar uses the same gap, so both ways of adding line figures up alike.
export const ADD_GAP = 96;
const snap = (value: number) => Math.round(value / 8) * 8;
// Where a figure added without a point of its own goes: to the right of the
// figure it follows, below it when the right is taken, then on along that
// row. With nothing to follow it starts at the center of the view and steps
// right, then down. A new figure stays selected, so adding several in a row
// lines them up to the right.
export function placeAdded(
  node: CanvasNode,
  doc: CanvasDocument,
  anchor?: Rect | null,
) {
  const { free } = freeSpace(node, doc),
    spots: Point[] = [];
  if (anchor) {
    spots.push({
      x: anchor.x + anchor.w + ADD_GAP,
      y: anchor.y + anchor.h / 2 - node.h / 2,
    });
    const below = {
      x: anchor.x + anchor.w / 2 - node.w / 2,
      y: anchor.y + anchor.h + ADD_GAP,
    };
    for (let col = 0; col < 24; col++)
      spots.push({ x: below.x + col * (node.w + ADD_GAP), y: below.y });
  } else {
    for (let row = 0; row < 12; row++)
      for (let col = 0; col < 12; col++)
        spots.push({
          x: node.x + col * (node.w + ADD_GAP),
          y: node.y + row * (node.h + ADD_GAP),
        });
  }
  for (const spot of spots) {
    const x = snap(spot.x),
      y = snap(spot.y);
    if (free(x, y)) {
      node.x = x;
      node.y = y;
      return node;
    }
  }
  node.x = snap(spots[0].x);
  node.y = snap(spots[0].y);
  return placeInFreeSpace(node, doc);
}
// Nudge a figure to the nearest free spot, keeping it as close as it can be
// to where it was asked to go.
export function placeInFreeSpace(node: CanvasNode, doc: CanvasDocument) {
  const start = { x: node.x, y: node.y },
    { free, obstacles } = freeSpace(node, doc);
  if (free(start.x, start.y)) return node;
  for (let ring = 1; ring <= 40; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [
        [i, -ring],
        [i, ring],
        [-ring, i],
        [ring, i],
      ]) {
        const x = start.x + dx * 32,
          y = start.y + dy * 32;
        if (free(x, y)) {
          node.x = x;
          node.y = y;
          return node;
        }
      }
    }
  }
  const area = bounds(obstacles);
  node.x = area.x;
  node.y = area.y + area.h + 40;
  return node;
}
export function selectionDocument(doc: CanvasDocument, ids: string[]) {
  const expanded = expandedIds(doc, ids);
  const next = {
    ...clone(doc),
    nodes: clone(doc.nodes.filter((n) => expanded.has(n.id))),
    edges: clone(
      doc.edges.filter((e) => expanded.has(e.from) && expanded.has(e.to)),
    ),
  };
  next.nodes.forEach((n) => {
    if (n.groupId && !expanded.has(n.groupId)) delete n.groupId;
    if (n.attachedTo && !expanded.has(n.attachedTo)) {
      Object.assign(n, noteContent(n, doc));
      delete n.attachedTo;
    }
  });
  return next;
}
export function pasteDocument(
  doc: CanvasDocument,
  fragment: CanvasDocument,
  offset: Point,
) {
  if (
    doc.nodes.length + fragment.nodes.length > MAX_NODES ||
    doc.edges.length + fragment.edges.length > MAX_EDGES
  )
    throw new Error("貼り付けると上限の150個を超えます");
  const next = clone(doc),
    map = new Map(fragment.nodes.map((n) => [n.id, uid()]));
  const nodes = fragment.nodes.map((n) => ({
    ...n,
    id: map.get(n.id)!,
    x: n.x + offset.x,
    y: n.y + offset.y,
    groupId: n.groupId ? map.get(n.groupId) : undefined,
    attachedTo: n.attachedTo ? map.get(n.attachedTo) : undefined,
  }));
  next.nodes.push(...nodes);
  next.edges.push(
    ...fragment.edges.map((e) => ({
      ...e,
      id: uid(),
      from: map.get(e.from)!,
      to: map.get(e.to)!,
    })),
  );
  return { doc: next, ids: nodes.map((n) => n.id) };
}
export function arrange(doc: CanvasDocument, selection: string[]) {
  const ids = expandedIds(doc, selection);
  const selected = doc.nodes.filter((n) => n.kind === "box" && ids.has(n.id)),
    nodes =
      selected.length >= 2
        ? selected
        : doc.nodes.filter((n) => n.kind === "box");
  if (nodes.length < 2) throw new Error("整頓するには図形が2つ以上必要です");
  const next = clone(doc),
    allowed = new Set(nodes.map((n) => n.id));
  const positions = arrangeBoxes(doc, allowed),
    moved = new Set<string>();
  for (const node of next.nodes.filter((n) => allowed.has(n.id))) {
    const point = positions.get(node.id)!;
    if (node.x !== point.x || node.y !== point.y) moved.add(node.id);
    Object.assign(node, point);
  }
  for (const note of next.nodes.filter(
    (n) => n.attachedTo && moved.has(n.attachedTo),
  )) {
    const before = doc.nodes.find((n) => n.id === note.attachedTo)!,
      after = next.nodes.find((n) => n.id === note.attachedTo)!;
    note.x += after.x - before.x;
    note.y += after.y - before.y;
    moved.add(note.id);
  }
  next.nodes
    .filter(
      (n) =>
        n.kind === "group" &&
        next.nodes.some((c) => c.groupId === n.id && moved.has(c.id)),
    )
    .forEach((n) => fitGroup(next, n.id));
  return next;
}
