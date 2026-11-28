import { recordId } from "./diagram-catalog.ts";
import type { erCatalog, DiagramEntry } from "./diagram-catalog.ts";
export type { DiagramEntry } from "./diagram-catalog.ts";
import { savedDiagramId, storageScope } from "./diagram-links.ts";

export interface OpenDiagram<T> {
  key: string;
  raw: string | null;
  doc: T;
  error?: string;
  linkId?: string;
}

export class DiagramChanged extends Error {
  constructor(readonly raw: string | null) {
    super(
      raw === null
        ? "別のタブでこの図が削除されました。"
        : "別のタブでこの図が変更されました。",
    );
  }
}

export function checkDiagram(key: string, expected: string | null) {
  const raw = localStorage.getItem(key);
  if (raw !== expected) throw new DiagramChanged(raw);
}

interface LibraryOptions<T> {
  catalog: typeof erCatalog;
  activeKey: string;
  decode: (raw: string, key: string) => T;
  emptyDocument: () => T;
  firstDocument: () => T;
  backupBeforeEdit?: (key: string, raw: string | null) => void;
  removeView?: (key: string) => void;
}

export function createDiagramLibrary<T>(options: LibraryOptions<T>) {
  const { activeKey } = options;
  const { storageKey, prefix, format, listDiagrams, isDiagramKey } =
    options.catalog;

  function openDiagram(
    key: string,
    raw = localStorage.getItem(key),
  ): OpenDiagram<T> {
    if (raw === null) throw new DiagramChanged(null);
    try {
      const record = JSON.parse(raw);
      const doc = options.decode(
        record.format === format ? raw : JSON.stringify(record.document),
        key,
      );
      return { key, raw, doc, linkId: recordId(key, record) };
    } catch {
      return {
        key,
        raw,
        doc: options.emptyDocument(),
        error:
          "保存データを読み込めませんでした。元のデータは上書きしていません。",
      };
    }
  }

  function restoreDiagram(): OpenDiagram<T> {
    try {
      let tabKey = null;
      try {
        tabKey = window.sessionStorage.getItem(activeKey);
      } catch {}
      for (const key of [tabKey, localStorage.getItem(activeKey), storageKey]) {
        if (!isDiagramKey(key)) continue;
        const raw = localStorage.getItem(key);
        if (raw !== null) return openDiagram(key, raw);
      }
      const first = listDiagrams()[0];
      if (first) return openDiagram(first.key, first.raw);
      return { key: storageKey, raw: null, doc: options.firstDocument() };
    } catch {
      return {
        key: storageKey,
        raw: null,
        doc: options.emptyDocument(),
        error:
          "このブラウザでは自動保存できません。作業はファイルに保存してください。",
      };
    }
  }

  function restoreLinkedDiagram(): OpenDiagram<T> | null {
    const query = new URLSearchParams(window.location.search);
    if (!query.has("diagram")) return restoreDiagram();
    const key = query.get("diagram");
    try {
      if (
        !isDiagramKey(key) ||
        !query.get("store") ||
        query.get("store") !== storageScope()
      )
        return null;
      const raw = localStorage.getItem(key);
      if (raw === null || savedDiagramId(key, raw) !== query.get("id"))
        return null;
      return openDiagram(key, raw);
    } catch {
      return null;
    }
  }

  function rememberDiagram(key: string) {
    // A full store may refuse this preference. The drawing is already saved.
    try {
      window.sessionStorage.setItem(activeKey, key);
    } catch {}
    try {
      localStorage.setItem(activeKey, key);
    } catch {}
  }

  function writeDiagram(
    key: string,
    doc: T,
    expected: string | null,
    action: "edit" | "delete" = "edit",
  ): OpenDiagram<T> {
    // The final slot is reused on deletion. Give its replacement a new identity.
    const linkId =
      action === "delete" || expected === null
        ? crypto.randomUUID()
        : savedDiagramId(key, expected);
    const raw = JSON.stringify({
      linkId,
      updatedAt: Date.now(),
      document: doc,
    });
    checkDiagram(key, expected);
    if (action === "edit") options.backupBeforeEdit?.(key, expected);
    try {
      localStorage.setItem(key, raw);
    } catch (error) {
      if ((error as Error).name === "QuotaExceededError")
        throw new Error(
          "ブラウザの空き容量が足りません。ファイルに保存するか、図の一覧で不要な図を削除してください。",
        );
      throw new Error(
        "ブラウザに保存できませんでした。作業はファイルに保存してください。",
      );
    }
    return { key, raw, doc, linkId };
  }

  function removeDiagram(entry: DiagramEntry) {
    checkDiagram(entry.key, entry.raw);
    localStorage.removeItem(entry.key);
    options.removeView?.(entry.key);
  }

  function deleteDiagram(entry: DiagramEntry, currentKey: string) {
    let next: OpenDiagram<T> | null = null;
    if (entry.key === currentKey) {
      const other = listDiagrams().find((item) => item.key !== entry.key);
      if (!other) {
        // Replace the last slot atomically, even when storage is full.
        next = writeDiagram(
          entry.key,
          options.emptyDocument(),
          entry.raw,
          "delete",
        );
        options.removeView?.(entry.key);
        return next;
      }
      next = openDiagram(other.key);
    }
    removeDiagram(entry);
    return next;
  }

  return {
    isDiagramKey,
    listDiagrams,
    openDiagram,
    restoreDiagram,
    restoreLinkedDiagram,
    rememberDiagram,
    writeDiagram,
    deleteDiagram,
    removeDiagram,
    newDiagramKey: () => prefix + crypto.randomUUID(),
  };
}
