import type { Diagram, Table } from "./types.ts";
import { tableWidth, height, port } from "./geometry.ts";

// Keep the current reading order while aligning rows and columns.
export function tidyDiagram(diagram: Diagram, aspect = 1.5) {
  const next = structuredClone(diagram),
    tables = next.tables;
  if (!tables.length) return next;
  const gap = 96,
    n = tables.length;
  const avgW = tables.reduce((sum, t) => sum + tableWidth(t), 0) / n;
  const avgH = tables.reduce((sum, t) => sum + height(t), 0) / n;
  const columns = Math.max(
    1,
    Math.min(
      n,
      Math.round(
        Math.sqrt(
          ((n * (avgH + gap)) / (avgW + gap)) *
            Math.max(0.5, Math.min(2, aspect)),
        ),
      ),
    ),
  );
  const ordered = [...tables].sort(
    (a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
  );
  const rows: Table[][] = [];
  for (let i = 0; i < n; i += columns)
    rows.push(
      ordered
        .slice(i, i + columns)
        .sort((a, b) => a.x - b.x || a.id.localeCompare(b.id)),
    );
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(...rows.map((row) => (row[c] ? tableWidth(row[c]) : 0))),
  );
  let y = 80;
  for (const row of rows) {
    let x = 80;
    row.forEach((table, c) => {
      table.x = x;
      table.y = y;
      x += widths[c] + gap;
    });
    y += Math.max(...row.map(height)) + gap;
  }
  const original = new Map(diagram.tables.map((t) => [t.id, t]));
  const placed = new Map(tables.map((t) => [t.id, t]));
  for (const edge of next.edges) {
    const a = placed.get(edge.from.table)!,
      b = placed.get(edge.to.table)!;
    if (edge.manual && edge.trunk != null) {
      edge.trunk +=
        (a.x - original.get(a.id)!.x + b.x - original.get(b.id)!.x) / 2;
    } else {
      edge.trunk =
        (port(a, edge.from.row, edge.from.side).x +
          port(b, edge.to.row, edge.to.side).x) /
        2;
    }
  }
  return next;
}
