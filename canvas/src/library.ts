import {
  decode,
  emptyDocument,
  growNodes,
  sampleDocument,
  STORAGE_KEY,
  uid,
  VIEW_KEY,
} from "./model";
import type { CanvasDocument } from "./types";

const ACTIVE_KEY = "simple-canvas.active.v1";
const PREFIX = STORAGE_KEY + ".";
// The old document and #37's .previous backup are already individual slots.
// Read them in place, even when storage is too full to copy either one.
export function isDiagramKey(key: string | null): key is string {
  return key !== null && (key === STORAGE_KEY || key.startsWith(PREFIX));
}
export const newDiagramKey = () => PREFIX + uid();
export const viewKeyFor = (key: string) =>
  VIEW_KEY + key.slice(STORAGE_KEY.length);

export interface DiagramEntry {
  key: string;
  raw: string;
  title: string;
  updatedAt: number | null;
}
export interface OpenDiagram {
  key: string;
  raw: string | null;
  doc: CanvasDocument;
  error?: string;
}

export function listDiagrams(): DiagramEntry[] {
  const entries: DiagramEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!isDiagramKey(key)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    let title = "読み込めない図",
      updatedAt = null;
    try {
      const record = JSON.parse(raw);
      const doc = record.format === "simple-canvas" ? record : record.document;
      if (typeof doc.title === "string")
        title = doc.title || "無題のキャンバス";
      if (
        !record.format &&
        typeof record.updatedAt === "number" &&
        Number.isFinite(new Date(record.updatedAt).getTime())
      )
        updatedAt = record.updatedAt;
    } catch {
      /* Keep damaged entries available for recovery. */
    }
    entries.push({ key, raw, title, updatedAt });
  }
  return entries.sort(
    (a, b) =>
      (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.key.localeCompare(b.key),
  );
}

export function openDiagram(
  key: string,
  raw = localStorage.getItem(key),
): OpenDiagram {
  if (raw === null) throw new DiagramChanged(null);
  try {
    const record = JSON.parse(raw);
    const doc = decode(
      record.format === "simple-canvas" ? raw : JSON.stringify(record.document),
    );
    return { key, raw, doc };
  } catch {
    return {
      key,
      raw,
      doc: emptyDocument(),
      error:
        "保存データを読み込めませんでした。元のデータは上書きしていません。",
    };
  }
}

export function restoreDiagram(): OpenDiagram {
  try {
    let tabKey = null;
    try {
      tabKey = window.sessionStorage.getItem(ACTIVE_KEY);
    } catch {}
    for (const key of [tabKey, localStorage.getItem(ACTIVE_KEY), STORAGE_KEY]) {
      if (!isDiagramKey(key)) continue;
      const raw = localStorage.getItem(key);
      if (raw !== null) return openDiagram(key, raw);
    }
    const first = listDiagrams()[0];
    if (first) return openDiagram(first.key, first.raw);
    return { key: STORAGE_KEY, raw: null, doc: growNodes(sampleDocument()) };
  } catch {
    return {
      key: STORAGE_KEY,
      raw: null,
      doc: emptyDocument(),
      error:
        "このブラウザでは自動保存できません。作業はファイルに保存してください。",
    };
  }
}

export function rememberDiagram(key: string) {
  // A full store may refuse this preference. The drawing is already saved.
  try {
    window.sessionStorage.setItem(ACTIVE_KEY, key);
  } catch {}
  try {
    localStorage.setItem(ACTIVE_KEY, key);
  } catch {}
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
export function writeDiagram(
  key: string,
  doc: CanvasDocument,
  expected: string | null,
): OpenDiagram {
  const raw = JSON.stringify({ updatedAt: Date.now(), document: doc });
  checkDiagram(key, expected);
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
  return { key, raw, doc };
}
export function removeDiagram(entry: DiagramEntry) {
  checkDiagram(entry.key, entry.raw);
  localStorage.removeItem(entry.key);
  localStorage.removeItem(viewKeyFor(entry.key));
}
