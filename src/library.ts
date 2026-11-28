import { erCatalog } from "../shared/diagram-catalog.ts";
import { createDiagramLibrary } from "../shared/diagram-library.ts";
import { initial } from "./initial.ts";
import { decodeDocument, documentFromDiagram } from "./model.ts";
import type { DiagramDocument } from "./types.ts";

const { storageKey, fallbackTitle } = erCatalog;
export const untitled = "無題の図";
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
  catalog: erCatalog,
  activeKey: "er-sketch.active.v1",
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
