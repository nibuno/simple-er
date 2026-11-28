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

export function previousVariantName(group: DiagramEntry[]) {
  const names = new Set(group.map((entry) => entry.title));
  let title = "以前の元の図";
  for (let i = 2; names.has(title); i++) title = "以前の元の図 " + i;
  return title;
}

export function chooseVariant(
  primary: DiagramEntry,
  selected: DiagramEntry,
  reason = "",
) {
  const current = groupVariants(listDiagrams()).find((group) =>
    group.some((e) => e.key === selected.key),
  );
  if (!current || current[0].key !== primary.key)
    throw new Error("元の図が変わりました。図の一覧から開き直してください。");
  const chosen = readVariant(selected);
  const previous = readVariant(primary);
  if (selected.key === primary.key) return previous;
  const renamed: { key: string; before: string; after: string }[] = [];
  const rename = (entry: DiagramEntry, doc: CanvasDocument, title: string) => {
    const saved = writeDiagram(
      entry.key,
      decode(encode({ ...doc, title })),
      entry.raw,
    );
    renamed.push({ key: entry.key, before: entry.raw, after: saved.raw! });
    return saved;
  };
  try {
    rename(primary, previous.doc, previousVariantName(current));
    const decisions = [
      {
        at: new Date().toISOString(),
        variant: chosen.doc.title,
        reason: reason.trim(),
      },
      ...(previous.doc.decisions ?? []),
    ];
    const result = rename(
      selected,
      { ...chosen.doc, decisions },
      previous.doc.title,
    );
    localStorage.setItem(choicePrefix + familyKey(selected.key), selected.key);
    return result;
  } catch (error) {
    // Restore only our writes if a later slot or the preference could not be saved.
    for (const entry of renamed.reverse()) {
      if (localStorage.getItem(entry.key) === entry.after)
        localStorage.setItem(entry.key, entry.before);
    }
    if (error instanceof Error && error.name !== "QuotaExceededError")
      throw error;
    throw new Error(
      "元の図を変更できませんでした。ブラウザの空き容量を確認してください。",
    );
  }
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
