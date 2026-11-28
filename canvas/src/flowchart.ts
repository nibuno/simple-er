import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  NodeShape,
} from "./types";
import {
  MAX_EDGES,
  MAX_NODES,
  emptyDocument,
  fitGroup,
  growNodes,
  makeNode,
  uid,
} from "./model";
import { SHAPES } from "./shapes";
import { textWidth } from "./text";

// A subset of mermaid's flowchart notation, so a few lines of text become a
// diagram: the writer names the shapes and the connections, and the positions
// come from here.
type Direction = "LR" | "RL" | "TB" | "BT";
type Ref = { id: string; label: string; shape?: NodeShape; next: number };

const ID = /^[\p{L}\p{M}\p{N}_]+(?:-[\p{L}\p{M}\p{N}_]+)*/u;
// Longer openers come first: "[(" is a cylinder, "[" on its own is a box.
const BRACKETS: [string, string, NodeShape][] = [
  ["[(", ")]", "cylinder"],
  ["([", "])", "ellipse"],
  ["((", "))", "circle"],
  ["[[", "]]", "rectangle"],
  ["{{", "}}", "diamond"],
  ["[/", "/]", "document"],
  ["[", "]", "rectangle"],
  ["(", ")", "rectangle"],
  ["{", "}", "diamond"],
  [">", "]", "document"],
];
const SKIP =
  /^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/i;
const GAP = 120,
  CROSS_GAP = 48,
  // A group's frame reaches past its members, so grouped diagrams stand apart.
  GROUP_GAP = 128;

export function looksLikeFlowchart(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
  if (/^(flowchart|graph)\b/i.test(lines[0] ?? "")) return true;
  // Without a header, look for a connection directly after a node, so a
  // sentence containing an arrow still pastes as ordinary text.
  return lines.some((line) => {
    try {
      const { refs, next } = readRefs(line, 0);
      return refs.length > 0 && readLink(line, next) !== null;
    } catch {
      return /(?:-->|==>|-\.->)/.test(line);
    }
  });
}

function labelText(raw: string) {
  const lines = raw
    .trim()
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    title: (lines[0] ?? "").slice(0, 200),
    description: lines.slice(1).join("\n").slice(0, 500),
  };
}

function readRef(text: string, i: number): Ref | null {
  while (text[i] === " " || text[i] === "\t") i++;
  const id = ID.exec(text.slice(i))?.[0];
  if (!id) return null;
  i += id.length;
  let label = "",
    shape: NodeShape | undefined;
  for (const [open, close, bracketShape] of BRACKETS) {
    if (!text.startsWith(open, i)) continue;
    const start = i + open.length;
    const quoteEnd = text[start] === '"' ? text.indexOf('"', start + 1) : start;
    const end = quoteEnd < 0 ? -1 : text.indexOf(close, quoteEnd);
    if (end < 0) throw new Error(`${open} が閉じていません`);
    label = text.slice(i + open.length, end);
    shape = bracketShape;
    i = end + close.length;
    break;
  }
  const named = /^:::(\w+)/.exec(text.slice(i));
  if (named) {
    if (!SHAPES.includes(named[1] as NodeShape))
      throw new Error(`::: のあとは ${SHAPES.join(" / ")} のどれかです`);
    shape = named[1] as NodeShape;
    i += named[0].length;
  }
  if (id.length > 120) throw new Error("図形のIDは120文字までです");
  return { id, label, shape, next: i };
}

// "a & b" names two shapes at one end of a connection.
function readRefs(text: string, i: number) {
  const refs: Ref[] = [];
  for (;;) {
    const ref = readRef(text, i);
    if (!ref) {
      if (refs.length) throw new Error("& のあとに図形がありません");
      break;
    }
    refs.push(ref);
    i = ref.next;
    while (text[i] === " " || text[i] === "\t") i++;
    if (text[i] !== "&") break;
    i++;
  }
  return { refs, next: i };
}

function readLink(text: string, i: number) {
  while (text[i] === " " || text[i] === "\t") i++;
  const tail = text.slice(i);
  const spaced =
    /^(--|==|-\.)\s+(.+?)\s+(?:-->|==>|\.->)/.exec(tail) ??
    /^(<--|<==|<-\.)\s+(.+?)\s+(?:--|==|\.-)(?![-=>])/.exec(tail);
  const link =
    spaced ??
    /^(?:<?(?:-{2,}>|={2,}>|-\.+->)|<--|<==|<-\.-|-{3,}|={3,}|-\.+-)/.exec(
      tail,
    );
  if (!link) return null;
  const head = link[0];
  const startArrow = head.startsWith("<"),
    endArrow = head.endsWith(">");
  const arrowheads: CanvasEdge["arrowheads"] =
    startArrow && endArrow ? "both" : startArrow || endArrow ? "end" : "none";
  let label = spaced?.[2] ?? "";
  i += head.length;
  if (!spaced && text[i] === "|") {
    const end = text.indexOf("|", i + 1);
    if (end < 0) throw new Error("ラベルの | が閉じていません");
    label = text.slice(i + 1, end);
    i = end + 1;
  }
  return {
    label: label.trim().slice(0, 200),
    dashed: (spaced?.[1] ?? head).includes("."),
    arrowheads,
    reversed: startArrow && !endArrow,
    next: i,
  };
}

export function parseFlowchart(text: string): CanvasDocument {
  const doc = emptyDocument(),
    nodes = new Map<string, CanvasNode>();
  let groupLine = 0;
  let groupId: string | undefined;
  let direction: Direction = "LR";
  const place = (ref: Ref) => {
    const node = nodes.get(ref.id);
    if (!node) {
      if (nodes.size >= MAX_NODES)
        throw new Error(`要素は${MAX_NODES}個までです`);
      const made = {
        ...makeNode("box", { x: 0, y: 0 }, ref.shape),
        id: ref.id,
        ...labelText(ref.label || ref.id),
        groupId,
      };
      nodes.set(ref.id, made);
      doc.nodes.push(made);
      return;
    }
    if (node.kind === "group")
      throw new Error(`${ref.id} は囲みです。中の図形につないでください`);
    if (ref.label) Object.assign(node, labelText(ref.label));
    if (ref.shape && ref.shape !== node.shape) {
      const sized = makeNode("box", node, ref.shape);
      Object.assign(node, { shape: ref.shape, w: sized.w, h: sized.h });
    }
  };
  text.split("\n").forEach((raw, index) => {
    const line = raw
      .replace(/"[^"]*"|%%.*$/g, (token) =>
        token.startsWith("%%") ? "" : token,
      )
      .trim()
      .replace(/;$/, "")
      .trimEnd();
    if (!line || SKIP.test(line)) return;
    try {
      if (/^(?:flowchart|graph)\b/i.test(line)) {
        const header = /^(?:flowchart|graph)(?:\s+(LR|RL|TB|TD|BT))?$/i.exec(
          line,
        );
        if (!header)
          throw new Error("向きは LR・RL・TB・TD・BT から選んでください");
        const given = (header[1] ?? "LR").toUpperCase();
        direction = given === "TD" ? "TB" : (given as Direction);
        return;
      }
      if (/^end$/i.test(line)) {
        if (!groupId) throw new Error("subgraph がありません");
        groupId = undefined;
        return;
      }
      if (/^subgraph$/i.test(line)) throw new Error("囲みの名前がありません");
      const sub = /^subgraph\s+(.+)$/i.exec(line);
      if (sub) {
        if (groupId) throw new Error("囲みの中に囲みは置けません");
        const named = /^([^\s[\]]+)\s*\[([^\]]*)\]$/.exec(sub[1]);
        if (!named && /[[\]]/.test(sub[1]))
          throw new Error("囲みの名前を確認してください");
        const id = named ? named[1] : sub[1];
        if (id.length > 120) throw new Error("囲みのIDは120文字までです");
        if (nodes.size >= MAX_NODES)
          throw new Error(`要素は${MAX_NODES}個までです`);
        if (nodes.has(id))
          throw new Error(`${id} は図形の名前と重なっています`);
        const group = {
          ...makeNode("group", { x: 0, y: 0 }),
          id,
          ...labelText(named ? named[2] : sub[1]),
        };
        nodes.set(id, group);
        doc.nodes.push(group);
        groupId = id;
        groupLine = index + 1;
        return;
      }
      let { refs: left, next } = readRefs(line, 0);
      if (!left.length) throw new Error("図形の名前が読み取れません");
      left.forEach(place);
      for (;;) {
        const link = readLink(line, next);
        if (!link) break;
        const right = readRefs(line, link.next);
        if (!right.refs.length) throw new Error("線のつなぎ先がありません");
        right.refs.forEach(place);
        if (doc.edges.length + left.length * right.refs.length > MAX_EDGES)
          throw new Error(`線は${MAX_EDGES}本までです`);
        for (const a of left)
          for (const b of right.refs)
            doc.edges.push({
              id: uid(),
              from: link.reversed ? b.id : a.id,
              to: link.reversed ? a.id : b.id,
              label: link.label,
              dashed: link.dashed,
              arrowheads: link.arrowheads,
            });
        left = right.refs;
        next = right.next;
      }
      if (line.slice(next).trim()) throw new Error("読み取れない書き方です");
    } catch (error) {
      throw new Error(
        `${index + 1}行目: ${error instanceof Error ? error.message : "読み取れません"}`,
      );
    }
  });
  if (groupId)
    throw new Error(`${groupLine}行目: subgraph が end で閉じていません`);
  const boxes = doc.nodes.filter((n) => n.kind === "box");
  if (!boxes.length) throw new Error("図形が読み取れませんでした");
  // A group nobody was put into would only sit on top of the diagram.
  doc.nodes = doc.nodes.filter(
    (n) => n.kind !== "group" || boxes.some((m) => m.groupId === n.id),
  );
  for (const node of boxes)
    if (["rectangle", "screen", "document"].includes(node.shape))
      node.w = Math.max(
        node.w,
        Math.min(360, Math.round(textWidth(node.title, 16)) + 56),
      );
  growNodes(doc);
  arrangeFlow(boxes, doc.edges, direction);
  doc.nodes
    .filter((n) => n.kind === "group")
    .forEach((n) => fitGroup(doc, n.id));
  return doc;
}

// Longest path from the sources: a shape sits one step after everything that
// points at it. A cycle stops growing once every shape has had its turn.
function levels(boxes: CanvasNode[], edges: CanvasEdge[]) {
  const level = new Map(boxes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < boxes.length; pass++) {
    let moved = false;
    for (const edge of edges) {
      const from = level.get(edge.from),
        to = level.get(edge.to);
      if (from === undefined || to === undefined || edge.from === edge.to)
        continue;
      if (to < from + 1) {
        level.set(edge.to, from + 1);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return level;
}

// Each group has its own band across the flow. Its frame can span several
// levels without enclosing unrelated nodes in between.
function arrangeFlow(
  boxes: CanvasNode[],
  edges: CanvasEdge[],
  direction: Direction,
) {
  const level = levels(boxes, edges);
  const rows = [...new Set(level.values())].sort((a, b) => a - b);
  if (direction === "RL" || direction === "BT") rows.reverse();
  const horizontal = direction === "LR" || direction === "RL";
  const flow = horizontal ? "x" : "y",
    cross = horizontal ? "y" : "x";
  const flowSize = horizontal ? "w" : "h",
    crossSize = horizontal ? "h" : "w";
  let position = 0;
  for (const step of rows) {
    const row = boxes.filter((node) => level.get(node.id) === step);
    for (const node of row) node[flow] = position;
    position += Math.max(...row.map((node) => node[flowSize])) + GAP;
  }
  let bandStart = 0;
  for (const group of new Set(boxes.map((node) => node.groupId))) {
    const columns = new Map<number, CanvasNode[]>();
    for (const node of boxes.filter((node) => node.groupId === group)) {
      const step = level.get(node.id)!;
      if (!columns.has(step)) columns.set(step, []);
      columns.get(step)!.push(node);
    }
    let bandSize = 0;
    for (const column of columns.values()) {
      const width = column.reduce(
        (sum, node) => sum + node[crossSize] + CROSS_GAP,
        -CROSS_GAP,
      );
      bandSize = Math.max(bandSize, width);
      let offset = -width / 2;
      for (const node of column) {
        node[cross] = offset;
        offset += node[crossSize] + CROSS_GAP;
      }
    }
    for (const column of columns.values()) {
      for (const node of column) node[cross] += bandStart + bandSize / 2;
    }
    bandStart += bandSize + GROUP_GAP;
  }
}
