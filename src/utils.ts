import type { Table } from "./types.ts";
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
