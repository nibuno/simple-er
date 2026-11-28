import type { Column, TableSchema } from "./types.ts";
/** PostgreSQL serial types already include their own sequence default. */
const serialTypes = new Map([
  ["smallserial", "smallint"],
  ["serial2", "smallint"],
  ["serial", "integer"],
  ["serial4", "integer"],
  ["bigserial", "bigint"],
  ["serial8", "bigint"],
]);

export const serialBase = (type: string) =>
  serialTypes.get(type.trim().toLowerCase());
export function serialType(type: string) {
  switch (type.trim().toLowerCase()) {
    case "smallint":
    case "int2":
      return "smallserial";
    case "int":
    case "int4":
    case "integer":
      return "serial";
    case "bigint":
    case "int8":
      return "bigserial";
  }
}

export function columnMarks(column: Column, table?: TableSchema) {
  return [
    table?.keys?.some(
      (k) => k.kind === "unique" && k.columnIds.includes(column.id),
    ) && "UK",
    column.notNull && "NN",
    column.defaultValue && "DF",
    (column.identity || serialBase(column.type)) && "AI",
  ]
    .filter(Boolean)
    .join(" · ");
}
