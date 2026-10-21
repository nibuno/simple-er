import type { Diagram, Table } from "./types.ts";

const RESERVED = new Set([
  "user",
  "order",
  "group",
  "select",
  "table",
  "from",
  "where",
  "index",
  "key",
  "primary",
  "references",
]);
/** Quote only identifiers that would not be valid as written. */
export function identifier(name: string) {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED.has(name)
    ? name
    : `"${name.replaceAll('"', '""')}"`;
}
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

/**
 * A PostgreSQL-flavoured preview of one table. It is a reading aid for the
 * editor, so incomplete drafts (unnamed columns, missing targets) are skipped
 * instead of rejected.
 */
export function tableDDL(table: Table, state: Diagram) {
  const columnName = (id: string) =>
    table.columns.find((c) => c.id === id)?.name.trim() ?? "";
  const named = (ids: string[]) => {
    const names = ids.map(columnName);
    return names.length && names.every(Boolean)
      ? names.map(identifier).join(", ")
      : "";
  };
  const name = identifier(table.name?.trim() || table.id);
  const columns = table.columns.filter((c) => c.name.trim());
  const width = Math.max(0, ...columns.map((c) => identifier(c.name).length));
  const lines = columns.map(
    (c) => `  ${identifier(c.name).padEnd(width)} ${c.type.trim() || "text"}`,
  );
  const keys = table.keys ?? [];
  const primary = keys.find((k) => k.kind === "primary");
  if (primary && named(primary.columnIds))
    lines.push(
      `  ${primary.name ? `CONSTRAINT ${identifier(primary.name)} ` : ""}PRIMARY KEY (${named(primary.columnIds)})`,
    );
  for (const k of keys.filter((k) => k.kind === "unique"))
    if (named(k.columnIds))
      lines.push(
        `  ${k.name ? `CONSTRAINT ${identifier(k.name)} ` : ""}UNIQUE (${named(k.columnIds)})`,
      );
  for (const fk of table.foreignKeys ?? []) {
    if (!fk.target || !named(fk.columnIds)) continue;
    const parent =
      fk.target.tableId === table.id
        ? table
        : state.tables.find((t) => t.id === fk.target!.tableId);
    const targets = fk.target.columnIds.map(
      (id) => parent?.columns.find((c) => c.id === id)?.name.trim() ?? "",
    );
    if (!parent || !targets.every(Boolean)) continue;
    lines.push(
      `  ${fk.name ? `CONSTRAINT ${identifier(fk.name)} ` : ""}FOREIGN KEY (${named(fk.columnIds)}) REFERENCES ${identifier(parent.name?.trim() || parent.id)} (${targets.map(identifier).join(", ")})`,
    );
  }
  const statements = [`CREATE TABLE ${name} (\n${lines.join(",\n")}\n);`];
  keys
    .filter((k) => k.kind === "index" && named(k.columnIds))
    .forEach((k, i) =>
      statements.push(
        `CREATE INDEX ${identifier(k.name || `${table.name || table.id}_idx_${i + 1}`)} ON ${name} (${named(k.columnIds)});`,
      ),
    );
  if (table.logicalName?.trim())
    statements.push(
      `COMMENT ON TABLE ${name} IS ${literal(table.logicalName.trim())};`,
    );
  for (const c of columns)
    if (c.logicalName?.trim())
      statements.push(
        `COMMENT ON COLUMN ${name}.${identifier(c.name)} IS ${literal(c.logicalName.trim())};`,
      );
  return statements.join("\n");
}
