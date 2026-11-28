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
import { normalizeColor } from "./colors";
import { SHAPES } from "./shapes";
import { textWidth } from "./text";

// A subset of mermaid's flowchart notation, so a few lines of text become a
// diagram: the writer names the shapes and the connections, and the positions
// come from here.
type Direction = "LR" | "RL" | "TB" | "BT";
type Ref = {
  id: string;
  label: string;
  shape?: NodeShape;
  className?: string;
  next: number;
};

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
// The importer also accepts alternate spellings. Use one spelling per shape.
const SHAPE_MARKS: Record<NodeShape, [string, string]> = {
  rectangle: ["[", "]"],
  ellipse: ["([", "])"],
  circle: ["((", "))"],
  diamond: ["{", "}"],
  cylinder: ["[(", ")]"],
  document: ["[/", "/]"],
  person: ["[", "]:::person"],
  cloud: ["[", "]:::cloud"],
  screen: ["[", "]:::screen"],
};

function escapeLabel(value: string) {
  return value.replace(
    /["#%&<>[\]|\\\r\n\x60]/g,
    (c) => "#" + c.charCodeAt(0) + ";",
  );
}

function decodeLabel(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  // Decode once so an exported literal "&amp;" stays literal on re-import.
  return value.replace(
    /&(amp|lt|gt|quot|apos);|&?#(\d{1,7}|x[0-9a-fA-F]{1,6}|quot);/g,
    (entity, name, code) => {
      if (name) return named[name];
      if (code === "quot") return '"';
      const point = code.startsWith("x")
        ? parseInt(code.slice(1), 16)
        : Number(code);
      return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    },
  );
}

export function toFlowchart(doc: CanvasDocument) {
  const boxes = doc.nodes.filter((n) => n.kind === "box");
  // Canvas IDs may contain punctuation or Mermaid keywords such as "end".
  const ids = new Map(boxes.map((n, i) => [n.id, "n" + (i + 1)]));
  const lines = ["flowchart LR"];
  function label(n: CanvasNode) {
    const title = escapeLabel(n.title);
    const description = n.description
      .split("\n")
      .map(escapeLabel)
      .join("<br/>");
    // Mermaid requires some content inside the brackets, even for a blank box.
    return (
      '"' +
      ((description ? title + "<br/>" + description : title) || "<br/>") +
      '"'
    );
  }
  function box(n: CanvasNode) {
    const [open, close] = SHAPE_MARKS[n.shape];
    return ids.get(n.id) + open + label(n) + close;
  }
  for (const n of boxes) if (!n.groupId) lines.push("  " + box(n));
  const groups = doc.nodes.filter((n) => n.kind === "group");
  groups.forEach((group, i) => {
    const members = boxes.filter((n) => n.groupId === group.id);
    if (
      !members.length &&
      !doc.edges.some((e) => e.from === group.id || e.to === group.id)
    )
      return;
    ids.set(group.id, "g" + (i + 1));
    lines.push("  subgraph g" + (i + 1) + " [" + label(group) + "]");
    for (const n of members) lines.push("    " + box(n));
    lines.push("  end");
  });
  for (const edge of doc.edges) {
    const from = ids.get(edge.from),
      to = ids.get(edge.to);
    if (!from || !to) continue;
    const arrows = edge.dashed
      ? { end: "-.->", both: "<-.->", none: "-.-" }
      : { end: "-->", both: "<-->", none: "---" };
    const arrow = arrows[edge.arrowheads ?? "end"];
    const text = edge.label ? '|"' + escapeLabel(edge.label) + '"|' : "";
    lines.push("  " + from + " " + arrow + text + " " + to);
  }
  return lines.join("\n") + "\n";
}
const GAP = 120,
  CROSS_GAP = 48;

export function looksLikeFlowchart(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line && !line.startsWith("%%") && !/^```(?:mermaid)?$/i.test(line),
    );
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
  const trimmed = raw.trim();
  const quoted = trimmed.startsWith('"') && trimmed.endsWith('"');
  const parts = (quoted ? trimmed.slice(1, -1) : trimmed)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\\n/g, "\n")
    .split("\n");
  const lines = (
    quoted ? parts : parts.map((line) => line.trim()).filter(Boolean)
  ).map(decodeLabel);
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
  const named = /^:::([\w-]+)/.exec(text.slice(i));
  if (named) {
    if (SHAPES.includes(named[1] as NodeShape)) shape = named[1] as NodeShape;
    i += named[0].length;
  }
  if (id.length > 120) throw new Error("図形のIDは120文字までです");
  return { id, label, shape, className: named?.[1], next: i };
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
    label: decodeLabel(label.trim().replace(/^"([\s\S]*)"$/, "$1")).slice(
      0,
      200,
    ),
    dashed: (spaced?.[1] ?? head).includes("."),
    arrowheads,
    reversed: startArrow && !endArrow,
    next: i,
  };
}

// Read a whole connection chain before applying it. A malformed line must not
// introduce a stray box or consume the remaining connection allowance.
function readChain(line: string) {
  let { refs: left, next } = readRefs(line, 0);
  if (!left.length) throw new Error("図形の名前が読み取れません");
  const refs = [...left],
    edges: CanvasEdge[] = [];
  for (;;) {
    const link = readLink(line, next);
    if (!link) break;
    const right = readRefs(line, link.next);
    if (!right.refs.length) throw new Error("線のつなぎ先がありません");
    if (edges.length + left.length * right.refs.length > MAX_EDGES)
      throw new Error(`線は${MAX_EDGES}本までです`);
    refs.push(...right.refs);
    for (const a of left)
      for (const b of right.refs)
        edges.push({
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
  return { refs, edges };
}

type Paint = Pick<CanvasNode, "fillColor" | "strokeColor">;
function readPaint(properties: string, warn: (message: string) => void) {
  const paint: Paint = {};
  const skipped: string[] = [];
  for (const declaration of properties.split(",")) {
    const [key, value] = declaration.trim().split(/\s*:\s*/);
    const color =
      value === "transparent" || value === "none"
        ? "transparent"
        : normalizeColor(value ?? "");
    if (key === "fill" && color) paint.fillColor = color;
    else if (key === "stroke" && color) paint.strokeColor = color;
    else skipped.push(key);
  }
  if (skipped.length)
    warn("反映できない色・書式があります（" + skipped.join("、") + "）");
  return paint;
}

export function readFlowchart(text: string) {
  const doc = emptyDocument();
  const nodes = new Map<string, CanvasNode>();
  const groups: { id: string; line: number }[] = [];
  const groupRoot = new Map<string, string>();
  const directions = new Map<string, Direction>();
  const classes = new Map<string, Paint>();
  const assignments: { id: string; name: string; line: number }[] = [];
  const styles: { id: string; paint: Paint; line: number }[] = [];
  const issues: { line: number; message: string }[] = [];
  let direction: Direction = "LR";
  function report(line: number, message: string) {
    issues.push({ line, message });
  }
  function checkSize(size: number) {
    if (size > MAX_NODES) throw new Error(`要素は${MAX_NODES}個までです`);
  }
  text.split("\n").forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw
      .replace(/"[^"]*"|%%.*$/g, (token) =>
        token.startsWith("%%") ? "" : token,
      )
      .trim()
      .replace(/;$/, "")
      .trimEnd();
    if (!line || /^```(?:mermaid)?$/i.test(line)) return;
    const groupId = groups[0]?.id;
    try {
      if (/^(?:flowchart|graph|direction)\b/i.test(line)) {
        const header =
          /^(flowchart|graph|direction)(?:\s+(LR|RL|TB|TD|BT))?$/i.exec(line);
        if (!header || (!header[2] && header[1].toLowerCase() === "direction"))
          throw new Error("向きは LR・RL・TB・TD・BT から選んでください");
        const value = (header[2] ?? "LR").toUpperCase();
        const dir = value === "TD" ? "TB" : (value as Direction);
        if (groupId) directions.set(groupId, dir);
        else direction = dir;
        return;
      }
      if (/^end$/i.test(line)) {
        if (!groups.pop()) throw new Error("subgraph がありません");
        return;
      }
      if (/^subgraph\b/i.test(line)) {
        const title = line.slice(8).trim();
        const named = /^([^\s[\]]+)\s*\[(.*)\]$/.exec(title);
        if (!title || (!named && /[[\]]/.test(title)))
          throw new Error("囲みの名前を確認してください");
        const id = named?.[1] ?? title;
        if (id.length > 120 || groupRoot.has(id))
          throw new Error("囲みのIDが長すぎるか、重複しています");
        // A bare reference before this declaration may already be an endpoint.
        const existing = nodes.get(id);
        if (!groupId) checkSize(nodes.size + (existing ? 0 : 1));
        groupRoot.set(id, groupId ?? id);
        if (groupId) {
          report(
            lineNumber,
            "入れ子の囲みは「" + nodes.get(groupId)!.title + "」にまとめました",
          );
          nodes.delete(id);
        } else {
          nodes.set(id, {
            ...makeNode("group", { x: 0, y: 0 }),
            id,
            ...labelText(named?.[2] ?? title),
          });
        }
        groups.push({ id, line: lineNumber });
        return;
      }
      const paint = /^(classDef|style)\s+(\S+)\s+(.+)$/i.exec(line);
      if (paint) {
        const parsed = readPaint(paint[3], (message) =>
          report(lineNumber, message),
        );
        for (const id of paint[2].split(",")) {
          if (paint[1].toLowerCase() === "classdef") classes.set(id, parsed);
          else styles.push({ id, paint: parsed, line: lineNumber });
        }
        return;
      }
      const assign = /^class\s+(\S+)\s+(\S+)$/i.exec(line);
      if (assign) {
        for (const id of assign[1].split(","))
          assignments.push({ id, name: assign[2], line: lineNumber });
        return;
      }
      const parsed = readChain(line);
      const added = new Set(
        parsed.refs
          .map((r) => r.id)
          .filter((id) => !nodes.has(id) && !groupRoot.has(id)),
      );
      checkSize(nodes.size + added.size);
      if (doc.edges.length + parsed.edges.length > MAX_EDGES)
        throw new Error(`線は${MAX_EDGES}本までです`);
      for (const ref of parsed.refs) {
        if (ref.className)
          assignments.push({
            id: ref.id,
            name: ref.className,
            line: lineNumber,
          });
        if (groupRoot.has(ref.id)) continue;
        let node = nodes.get(ref.id);
        if (!node) {
          node = {
            ...makeNode("box", { x: 0, y: 0 }, ref.shape),
            id: ref.id,
            ...labelText(ref.label || ref.id),
          };
          nodes.set(ref.id, node);
        } else {
          if (ref.label) Object.assign(node, labelText(ref.label));
          if (ref.shape && ref.shape !== node.shape) {
            const { w, h } = makeNode("box", node, ref.shape);
            Object.assign(node, { shape: ref.shape, w, h });
          }
        }
        if (groupId) node.groupId = groupId;
      }
      doc.edges.push(...parsed.edges);
    } catch (error) {
      report(
        lineNumber,
        error instanceof Error ? error.message : "読み取れません",
      );
    }
  });
  for (const group of groups)
    report(group.line, "subgraph が end で閉じていません");
  const resolve = (id: string) => groupRoot.get(id) ?? id;
  for (const edge of doc.edges) {
    edge.from = resolve(edge.from);
    edge.to = resolve(edge.to);
  }
  for (const node of nodes.values())
    Object.assign(node, classes.get("default"));
  for (const { id, name, line } of assignments) {
    const node = nodes.get(resolve(id));
    if (!node) report(line, "色を付ける図形がありません（" + id + "）");
    else if (classes.has(name)) Object.assign(node, classes.get(name));
    else if (!SHAPES.includes(name as NodeShape))
      report(line, "クラスの定義がありません（" + name + "）");
  }
  for (const { id, paint, line } of styles) {
    const node = nodes.get(resolve(id));
    if (node) Object.assign(node, paint);
    else report(line, "色を付ける図形がありません（" + id + "）");
  }
  const used = new Set([...nodes.values()].map((n) => n.groupId));
  for (const edge of doc.edges) {
    used.add(edge.from);
    used.add(edge.to);
  }
  doc.nodes = [...nodes.values()].filter(
    (n) => n.kind !== "group" || used.has(n.id),
  );
  for (const node of doc.nodes)
    if (
      node.kind === "box" &&
      ["rectangle", "screen", "document"].includes(node.shape)
    )
      node.w = Math.max(
        node.w,
        Math.min(360, Math.round(textWidth(node.title, 16)) + 56),
      );
  growNodes(doc);
  // Lay out the members first. Each frame then occupies one position in the
  // outer graph, including when an external edge refers directly to its ID.
  const frames = doc.nodes.filter((n) => n.kind === "group");
  for (const frame of frames) {
    const members = doc.nodes.filter((n) => n.groupId === frame.id);
    arrangeFlow(members, doc.edges, directions.get(frame.id) ?? direction);
    fitGroup(doc, frame.id);
    for (const member of members) {
      member.x -= frame.x;
      member.y -= frame.y;
    }
  }
  const outer = (id: string) => nodes.get(id)?.groupId ?? id;
  arrangeFlow(
    doc.nodes.filter((n) => !n.groupId),
    doc.edges.map((e) => ({ ...e, from: outer(e.from), to: outer(e.to) })),
    direction,
  );
  for (const node of doc.nodes)
    if (node.groupId) {
      const frame = nodes.get(node.groupId)!;
      node.x += frame.x;
      node.y += frame.y;
    }
  issues.sort((a, b) => a.line - b.line);
  return { doc, warnings: issues.map((i) => `${i.line}行目: ${i.message}`) };
}

export function parseFlowchart(text: string) {
  const { doc, warnings } = readFlowchart(text);
  if (warnings.length) throw new Error(warnings[0]);
  if (!doc.nodes.length) throw new Error("図形が読み取れませんでした");
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

// Place the boxes in one frame, or the frames and ungrouped boxes in the outer graph.
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
    const width = row.reduce(
      (sum, node) => sum + node[crossSize] + CROSS_GAP,
      -CROSS_GAP,
    );
    let offset = -width / 2;
    for (const node of row) {
      node[flow] = position;
      node[cross] = offset;
      offset += node[crossSize] + CROSS_GAP;
    }
    position += Math.max(...row.map((node) => node[flowSize])) + GAP;
  }
}
