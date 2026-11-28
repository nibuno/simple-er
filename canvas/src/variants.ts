import {
  checkDiagram,
  listDiagrams,
  openDiagram,
  writeDiagram,
  type DiagramEntry,
} from "./library";
import { decode, encode, uid } from "./model";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "./types";

const marker = ".variant.";
const choicePrefix = "simple-canvas.chosen.v1:";
const familyKey = (key: string) => key.split(marker)[0];
export const isChoiceKey = (key: string | null) =>
  !!key?.startsWith(choicePrefix);

// Membership lives in the save slot's key, so autosave, rename and file export
// need no extra fields. A normal duplicate gets an unrelated slot as before.
export function groupVariants(entries: DiagramEntry[]) {
  const families = new Map<string, DiagramEntry[]>();
  for (const entry of entries) {
    const family = familyKey(entry.key);
    if (!families.has(family)) families.set(family, []);
    families.get(family)!.push(entry);
  }
  return [...families].map(([family, members]) => {
    if (members.length === 1) return members;
    const choice = localStorage.getItem(choicePrefix + family);
    // If the chosen drawing was deleted, use the original or oldest surviving
    // variant. Editing another member does not change the group's primary.
    const primary =
      members.find((e) => e.key === choice) ??
      members.find((e) => e.key === family) ??
      members.reduce((a, b) => (a.key < b.key ? a : b));
    return [primary, ...members.filter((e) => e !== primary)];
  });
}

function readVariant(entry: DiagramEntry) {
  checkDiagram(entry.key, entry.raw);
  const source = openDiagram(entry.key, entry.raw);
  if (source.error) throw new Error(source.error);
  return source;
}

export function createVariant(entry: DiagramEntry, title: string) {
  const { doc } = readVariant(entry);
  const key = familyKey(entry.key) + marker + Date.now() + "." + uid();
  const copy = decode(encode({ ...doc, id: uid(), title }));
  return writeDiagram(key, copy, null);
}

export function chooseVariant(primary: DiagramEntry, selected: DiagramEntry) {
  const current = groupVariants(listDiagrams()).find((group) =>
    group.some((e) => e.key === selected.key),
  );
  if (!current || current[0].key !== primary.key)
    throw new Error("元の図が変わりました。図の一覧から開き直してください。");
  const chosen = readVariant(selected);
  checkDiagram(primary.key, primary.raw);
  try {
    localStorage.setItem(choicePrefix + familyKey(selected.key), selected.key);
  } catch {
    throw new Error(
      "元の図を変更できませんでした。ブラウザの空き容量を確認してください。",
    );
  }
  return chosen;
}

export function clearVariantChoice(key: string) {
  // Deletion has already succeeded. A stale preference is ignored on read.
  try {
    const preference = choicePrefix + familyKey(key);
    if (localStorage.getItem(preference) === key)
      localStorage.removeItem(preference);
  } catch {}
}

export type Difference = "added" | "removed" | "changed";
function compareItems<T extends CanvasNode | CanvasEdge>(
  before: T[],
  after: T[],
) {
  const left = new Map(before.map((item) => [item.id, item]));
  const right = new Map(after.map((item) => [item.id, item]));
  const changes = new Map<string, Difference>();
  for (const item of before) {
    const other = right.get(item.id);
    if (!other) changes.set(item.id, "removed");
    else if (!equalItem(item, other)) changes.set(item.id, "changed");
  }
  for (const item of after)
    if (!left.has(item.id)) changes.set(item.id, "added");
  return changes;
}

function equalItem(a: CanvasNode | CanvasEdge, b: CanvasNode | CanvasEdge) {
  const fields = (item: CanvasNode | CanvasEdge): Record<string, unknown> =>
    "from" in item
      ? { ...item, arrowheads: item.arrowheads ?? "end" }
      : {
          ...item,
          // Compare the link by value across independently decoded documents.
          erLink:
            item.erLink &&
            JSON.stringify([
              item.erLink.store,
              item.erLink.key,
              item.erLink.id,
            ]),
        };
  const left = fields(a),
    right = fields(b);
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Object.hasOwn(right, key) && left[key] === right[key],
    )
  );
}

export function compareDiagrams(left: CanvasDocument, right: CanvasDocument) {
  return {
    nodes: compareItems(left.nodes, right.nodes),
    edges: compareItems(left.edges, right.edges),
  };
}
