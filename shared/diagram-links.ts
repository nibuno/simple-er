import { canvasCatalog, erCatalog, recordId } from "./diagram-catalog.ts";

export interface DiagramLink {
  store: string;
  key: string;
  id: string;
}
export const scopeKey = "simple-er-canvas.links.v1";
export function storageScope(create = false): string | null {
  let scope = localStorage.getItem(scopeKey);
  if (!scope && create) {
    scope = crypto.randomUUID();
    localStorage.setItem(scopeKey, scope);
  }
  return scope;
}

export function isDiagramLink(value: unknown): value is DiagramLink {
  if (!value || typeof value !== "object") return false;
  const link = value as Partial<DiagramLink>;
  return (
    [link.store, link.key, link.id].every(
      (s) => typeof s === "string" && s.length > 0 && s.length <= 512,
    ) && erCatalog.isDiagramKey(link.key ?? null)
  );
}

export function savedDiagramId(key: string, raw: string) {
  try {
    return recordId(key, JSON.parse(raw));
  } catch {
    // Explicit recovery can replace an unreadable save.
  }
  return key;
}

export function linkedUrl(app: "canvas" | "er", link: DiagramLink) {
  const query = new URLSearchParams({
    diagram: link.key,
    id: link.id,
    store: link.store,
  });
  return (app === "er" ? "../" : "./canvas/") + "?" + query;
}

export function clearLinkedUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("diagram")) return;
  for (const key of ["diagram", "id", "store"]) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url);
}

export interface LinkEntry {
  key: string;
  id: string;
  title: string;
}
export function readLinkEntries(
  catalog: typeof erCatalog,
  target?: DiagramLink,
): LinkEntry[] {
  return catalog
    .listDiagrams((doc) => {
      if (catalog === erCatalog) return [1, 2, 3].includes(doc.version);
      return (
        doc.version === 1 &&
        !!target &&
        Array.isArray(doc.nodes) &&
        doc.nodes.some(
          (node) =>
            node?.kind === "box" &&
            node.erLink?.key === target.key &&
            node.erLink.id === target.id &&
            node.erLink.store === target.store,
        )
      );
    })
    .map(({ key, linkId, title }) => ({ key, id: linkId, title }));
}
