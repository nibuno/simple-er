import { useEffect, useState } from "react";
import { canvasCatalog, erCatalog } from "./diagram-catalog.ts";
import {
  readLinkEntries,
  scopeKey,
  storageScope,
  type LinkEntry,
} from "./diagram-links.ts";

// Refresh only for the other editor's saves, including restores from the back/forward cache.
export function useDiagramLinks(catalog: typeof erCatalog, key = "", id = "") {
  function read() {
    try {
      const store = storageScope();
      const entries =
        catalog === canvasCatalog && !store
          ? []
          : readLinkEntries(catalog, store ? { store, key, id } : undefined);
      return { store, entries };
    } catch {
      return { store: null, entries: [] };
    }
  }
  const [catalogState, setCatalogState] = useState<{
    store: string | null;
    entries: LinkEntry[];
  }>({ store: null, entries: [] });
  useEffect(() => {
    const refresh = () => setCatalogState(read());
    const changed = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === scopeKey ||
        catalog.isDiagramKey(event.key)
      )
        refresh();
    };
    refresh();
    window.addEventListener("storage", changed);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("pageshow", refresh);
    };
  }, [catalog, key, id]);
  return { ...catalogState, refresh: () => setCatalogState(read()) };
}

export function MissingDiagram({ app }: { app: string }) {
  return (
    <main className="missing-diagram">
      <h1>図が見つかりません</h1>
      <p>リンクを作ったブラウザと保存先を確認してください。</p>
      <a href={window.location.pathname}>{app} を開く</a>
    </main>
  );
}
