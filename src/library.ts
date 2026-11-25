import { createDiagramLibrary } from "../shared/diagram-library.ts";
import { initial } from "./initial.ts";
import { decodeDocument, documentFromDiagram } from "./model.ts";
import type { DiagramDocument } from "./types.ts";

const storageKey = "er-sketch.local.v1";
export const untitled = "無題の図";
const fallbackTitle = (key: string) =>
  key === storageKey + ".previous" ? "前の図" : untitled;
// Keep the canonical field order used by history and no-op save comparisons.
export function namedDocument(doc: DiagramDocument, fallback?: string) {
  const { format, version, title, ...contents } = doc;
  return {
    format,
    version,
    title: title || fallback?.trim() || untitled,
    ...contents,
  };
}

export const emptyDocument = () =>
  documentFromDiagram({ title: untitled, tables: [], edges: [] });

export const library = createDiagramLibrary({
  storageKey,
  // Keep the .v1-backup and .recovery keys outside the library.
  prefix: "er-sketch.diagram.",
  activeKey: "er-sketch.active.v1",
  format: "er-sketch",
  fallbackTitle,
  decode(raw, key) {
    return namedDocument(decodeDocument(raw), fallbackTitle(key));
  },
  emptyDocument,
  firstDocument: () => documentFromDiagram({ ...initial, title: untitled }),
  backupBeforeEdit(key, raw) {
    // Only an edit to the original v1 slot needs a backup. Opening or listing
    // it works even if there isn't space for a second copy.
    if (
      key !== storageKey ||
      raw === null ||
      localStorage.getItem(key + ".v1-backup") !== null
    )
      return;
    let record;
    try {
      record = JSON.parse(raw);
    } catch {
      return;
    }
    if (record?.version !== 1) return;
    try {
      localStorage.setItem(key + ".v1-backup", raw);
    } catch {
      throw new Error(
        "旧データの退避先に保存できません。ファイルに保存するか、図の一覧で不要な図を削除してください。",
      );
    }
  },
});
