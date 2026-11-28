import type { Diagram, Table } from "./types.ts";

// PostgreSQL 19 pg_get_keywords() categories R and T, plus the previously quoted index and key.
const RESERVED = new Set(
  `all analyse analyze and any array as asc asymmetric authorization binary both case
   cast check collate collation column concurrently constraint create cross
   current_catalog current_date current_role current_schema current_time
   current_timestamp current_user default deferrable desc distinct do else end except
   false fetch for foreign freeze from full grant group having ilike in index
   initially inner intersect into is isnull join key lateral leading left like limit
   localtime localtimestamp natural not notnull null offset on only or order outer
   overlaps placing primary references returning right select session_user similar
   some symmetric system_user table tablesample then to trailing true union unique
   user using variadic verbose when where window with`.split(/\s+/),
);
/** Quote only identifiers that would not be valid as written. */
export function identifier(name: string) {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED.has(name)
    ? name
    : `"${name.replaceAll('"', '""')}"`;
}
const tableIdentifier = (table: Table) =>
  [table.schemaName, table.name?.trim() || table.id]
    .filter((part): part is string => !!part)
    .map(identifier)
    .join(".");
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;

/**
 * A PostgreSQL-flavoured preview of one table. It is a reading aid for the
 * editor, so incomplete drafts (unnamed columns, missing targets) are skipped
 * instead of rejected.
 */
export function tableDDL(
  table: Table,
  state: Diagram,
  forwardReferences?: string[],
) {
  const columnName = (id: string) =>
    table.columns.find((c) => c.id === id)?.name.trim() ?? "";
  const named = (ids: string[]) => {
    const names = ids.map(columnName);
    return names.length && names.every(Boolean)
      ? names.map(identifier).join(", ")
      : "";
  };
  const name = tableIdentifier(table);
  const columns = table.columns.filter((c) => c.name.trim());
  const width = Math.max(0, ...columns.map((c) => identifier(c.name).length));
  const lines = columns.map((c) => {
    const identity = c.identity
      ? ` GENERATED ${c.identity === "always" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY${c.identityOptions ? ` (${c.identityOptions})` : ""}`
      : "";
    return `  ${identifier(c.name).padEnd(width)} ${c.type.trim() || "text"}${identity}${c.notNull ? " NOT NULL" : ""}${c.defaultValue ? ` DEFAULT ${c.defaultValue}` : ""}`;
  });
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
    const constraint = `${fk.name ? `CONSTRAINT ${identifier(fk.name)} ` : ""}FOREIGN KEY (${named(fk.columnIds)}) REFERENCES ${tableIdentifier(parent)} (${targets.map(identifier).join(", ")})${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ""}${fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : ""}`;
    if (
      forwardReferences &&
      state.tables.indexOf(parent) > state.tables.indexOf(table)
    )
      forwardReferences.push(`ALTER TABLE ${name} ADD ${constraint};`);
    else lines.push(`  ${constraint}`);
  }
  const statements = [`CREATE TABLE ${name} (\n${lines.join(",\n")}\n);`];
  keys
    .filter((k) => k.kind === "index" && named(k.columnIds))
    .forEach((k, i) =>
      statements.push(
        `CREATE INDEX ${identifier(k.name || `${table.name || table.id}_idx_${i + 1}`)} ON ${name} (${named(k.columnIds)});`,
      ),
    );
  if (table.note)
    statements.push(`COMMENT ON TABLE ${name} IS ${literal(table.note)};`);
  for (const c of columns)
    if (c.note)
      statements.push(
        `COMMENT ON COLUMN ${name}.${identifier(c.name)} IS ${literal(c.note)};`,
      );
  return statements.join("\n");
}

/** Install references to later tables after CREATE TABLE, including cycles. */
export function diagramDDL(state: Diagram) {
  const forwardReferences: string[] = [];
  const tables = state.tables.map((table) =>
    tableDDL(table, state, forwardReferences),
  );
  return [...tables, ...forwardReferences].join("\n\n");
}
