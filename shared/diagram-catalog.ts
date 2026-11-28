export interface DiagramEntry {
  key: string;
  raw: string;
  title: string;
  updatedAt: number | null;
}

// Older records have no separate identity. Their original slot stays valid
// through ordinary edits, but deletion or re-creation gets a new UUID.
export function recordId(
  key: string,
  record: { format?: unknown; linkId?: unknown } | null,
) {
  return typeof record?.linkId === "string" && !record.format
    ? record.linkId
    : key;
}
interface DocumentSummary {
  version: number;
  nodes?: unknown;
}

const erKey = "er-sketch.local.v1";
const canvasKey = "simple-canvas.document.v1";

export const erCatalog = createCatalog(
  erKey,
  "er-sketch.diagram.",
  "er-sketch",
  (key) => (key === erKey + ".previous" ? "前の図" : "無題の図"),
);
export const canvasCatalog = createCatalog(
  canvasKey,
  canvasKey + ".",
  "simple-canvas",
  () => "無題の図",
);

function createCatalog(
  storageKey: string,
  prefix: string,
  format: string,
  fallbackTitle: (key: string) => string,
) {
  // Both the original save and #37's backup are already individual slots.
  function isDiagramKey(key: string | null): key is string {
    return (
      key !== null &&
      (key === storageKey ||
        key === storageKey + ".previous" ||
        key.startsWith(prefix))
    );
  }

  function listDiagrams(include?: (doc: DocumentSummary) => boolean) {
    const entries: (DiagramEntry & { linkId: string })[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!isDiagramKey(key)) continue;
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      let title = "読み込めない図",
        updatedAt = null,
        linkId = key;
      try {
        const record = JSON.parse(raw);
        const legacy = record.format === format;
        const doc = legacy ? record : record.document;
        if (include && (doc?.format !== format || !include(doc))) continue;
        linkId = recordId(key, record);
        if (doc?.format === format)
          title =
            (typeof doc.title === "string" && doc.title.trim()) ||
            fallbackTitle(key);
        if (
          !legacy &&
          typeof record.updatedAt === "number" &&
          Number.isFinite(new Date(record.updatedAt).getTime())
        )
          updatedAt = record.updatedAt;
      } catch {
        // Keep damaged entries available in the recovery list.
        if (include) continue;
      }
      entries.push({ key, raw, title, updatedAt, linkId });
    }
    return entries.sort(
      (a, b) =>
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.key.localeCompare(b.key),
    );
  }

  return {
    storageKey,
    prefix,
    format,
    fallbackTitle,
    isDiagramKey,
    listDiagrams,
  };
}
