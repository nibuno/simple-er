import type { Diagram } from "./types.ts";

export interface TableReveal {
  id: string;
  n: number;
  nearest?: boolean;
  matchedColumns?: string[];
}

// This projection is for display and routing. Edits always use the full diagram.
export function relatedDiagram(
  diagram: Diagram,
  anchor: string | null,
): Diagram {
  if (!anchor || !diagram.tables.some((table) => table.id === anchor))
    return diagram;
  const ids = new Set([anchor]);
  for (const { from, to } of diagram.edges) {
    if (from.table === anchor) ids.add(to.table);
    if (to.table === anchor) ids.add(from.table);
  }
  return {
    ...diagram,
    tables: diagram.tables.filter((table) => ids.has(table.id)),
    edges: diagram.edges.filter(
      ({ from, to }) => ids.has(from.table) && ids.has(to.table),
    ),
  };
}
