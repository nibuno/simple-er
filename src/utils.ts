import type { Diagram, TableGroup, Table } from "./types.ts";
import { tableWidth, height } from "./geometry.ts";
export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function overlaps(table: Table, tables: Table[]) {
  return tables.some(
    (other) =>
      other.id !== table.id &&
      table.x < other.x + tableWidth(other) + 44 &&
      table.x + tableWidth(table) + 44 > other.x &&
      table.y < other.y + height(other) + 44 &&
      table.y + height(table) + 44 > other.y,
  );
}

export function moveGroup(
  base: Diagram,
  group: TableGroup,
  dx: number,
  dy: number,
): Diagram | null {
  const ids = new Set(group.tableIds);
  const others = base.tables.filter((t) => !ids.has(t.id));
  const tables = base.tables.map((t) =>
    ids.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t,
  );
  if (
    tables.some(
      (t) =>
        ids.has(t.id) &&
        (Math.abs(t.x) > 50000 || Math.abs(t.y) > 50000 || overlaps(t, others)),
    )
  )
    return null;
  const edges = base.edges.map((e) =>
    e.manual && e.trunk !== null && ids.has(e.from.table) && ids.has(e.to.table)
      ? { ...e, trunk: e.trunk + dx }
      : e,
  );
  if (edges.some((e) => e.trunk !== null && Math.abs(e.trunk) > 50000))
    return null;
  return { ...base, tables, edges };
}
