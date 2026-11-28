import { height, tableWidth } from "./geometry.ts";
import { overlaps } from "./utils.ts";
import { tidyDiagram } from "./layout.ts";
import { validateDiagram } from "./model.ts";
import type { Diagram, Table } from "./types.ts";

export function layoutImportedTables(
  next: Diagram,
  added: Table[],
  base: Diagram,
) {
  const valid = validateDiagram(next);
  if (added.length) {
    const ids = new Set(added.map((t) => t.id));
    const layout = tidyDiagram({
      tables: valid.tables
        .filter((t) => ids.has(t.id))
        .map((t) => ({
          ...t,
          foreignKeys: t.foreignKeys.filter(
            (f) => f.target && ids.has(f.target.tableId),
          ),
        })),
      edges: valid.edges.filter(
        (e) => ids.has(e.from.table) && ids.has(e.to.table),
      ),
    });
    // Prefer the space to the right. At the document coordinate limit, try
    // unoccupied rows and columns between the existing tables instead.
    const offsets = (values: number[]) => [
      0,
      ...values.map((v) => v + 64),
      -50000,
    ];
    const xs = offsets(base.tables.map((t) => t.x + tableWidth(t))).sort(
      (a, b) => b - a,
    );
    const ys = offsets(base.tables.map((t) => t.y + height(t)));
    const position = ys
      .flatMap((y) => xs.map((x) => ({ x, y })))
      .find(({ x, y }) =>
        layout.tables.every((t) => {
          const placed = { ...t, x: x + t.x, y: y + t.y };
          return (
            Math.abs(placed.x) <= 50000 &&
            Math.abs(placed.y) <= 50000 &&
            !overlaps(placed, base.tables)
          );
        }),
      );
    if (!position)
      throw new Error(
        "テーブルを並べる空間がありません。新しい図に読み込んでください。",
      );
    for (const placed of layout.tables) {
      const table = valid.tables.find((t) => t.id === placed.id)!;
      table.x = placed.x + position.x;
      table.y = placed.y + position.y;
    }
  }
  return validateDiagram(valid);
}
