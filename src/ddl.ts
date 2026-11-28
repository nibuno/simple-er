import { serialBase } from "./column-attributes.ts";
import { ddlType, detailsComment } from "./ddl-dialect.ts";
import type { DdlDialect, Diagram, Table } from "./types.ts";

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
/** Keep familiar PostgreSQL spelling, and quote all MySQL/SQLite identifiers. */
export function identifier(name: string, dialect: DdlDialect = "PostgreSQL") {
  if (
    dialect === "PostgreSQL" &&
    /^[a-z_][a-z0-9_]*$/.test(name) &&
    !RESERVED.has(name)
  )
    return name;
  const quote = dialect === "MySQL" ? "`" : '"';
  return quote + name.replaceAll(quote, quote + quote) + quote;
}
const literal = (text: string, dialect: DdlDialect) =>
  "'" +
  (dialect === "MySQL" ? text.replaceAll("\\", "\\\\") : text).replaceAll(
    "'",
    "''",
  ) +
  "'";

/** Incomplete editor drafts can lack names or foreign key targets. */
export function tableDDL(
  table: Table,
  state: Diagram,
  dialect: DdlDialect = state.ddlDialect ?? "PostgreSQL",
  forwardReferences?: string[],
) {
  const mysql = dialect === "MySQL",
    sqlite = dialect === "SQLite";
  const quote = (name: string) => identifier(name, dialect);
  const qualified = (schema: string | undefined, name: string) =>
    schema ? quote(schema) + "." + quote(name) : quote(name);
  const tableName = table.name?.trim() || table.id;
  const name = qualified(table.schemaName, tableName);
  const constraintName = (name?: string) =>
    name ? `CONSTRAINT ${quote(name)} ` : "";
  const named = (ids: string[]) => {
    const names = ids.map((id) =>
      table.columns.find((c) => c.id === id)?.name.trim(),
    );
    return names.length && names.every((n): n is string => !!n)
      ? names.map(quote).join(", ")
      : "";
  };
  const keys = table.keys ?? [];
  const primary = keys.find((k) => k.kind === "primary");
  const columns = table.columns.filter((c) => c.name.trim());
  const width = Math.max(0, ...columns.map((c) => quote(c.name).length));
  let inlinePrimary = false;
  let mysqlIncrement = false;
  const lines = columns.map((c) => {
    const original = c.type.trim() || "text";
    const serial = serialBase(original);
    const indexed =
      keys.some((k) => k.columnIds.includes(c.id)) ||
      table.foreignKeys?.some((k) => k.columnIds.includes(c.id)) ||
      false;
    let type = ddlType(original, dialect, indexed);
    let generation = "";
    if (sqlite && (serial || c.identity)) {
      if (primary?.columnIds.length !== 1 || primary.columnIds[0] !== c.id)
        throw new Error(
          `${tableName}.${c.name} を SQLite で自動採番するには、単独の主キーにしてください。`,
        );
      type = "INTEGER";
      inlinePrimary = true;
      generation =
        " " + constraintName(primary.name) + "PRIMARY KEY AUTOINCREMENT";
    } else if (mysql && (serial || c.identity)) {
      if (mysqlIncrement || !keys.some((k) => k.columnIds[0] === c.id))
        throw new Error(
          `${tableName} の AUTO_INCREMENT はキーの先頭カラム1つに指定してください。`,
        );
      mysqlIncrement = true;
      generation = " AUTO_INCREMENT";
    } else if (c.identity) {
      if (type === "numeric(20)" && type !== original)
        throw new Error(
          `${tableName}.${c.name} の符号なし BIGINT は PostgreSQL の IDENTITY の範囲を超えます。`,
        );
      generation = ` GENERATED ${c.identity === "always" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY${c.identityOptions ? ` (${c.identityOptions})` : ""}`;
    }
    let value = c.defaultValue;
    if (mysql && value)
      value = value.replace(/'(?:''|[^'])*'/g, (str) =>
        str.replaceAll("\\", "\\\\"),
      );
    const details = detailsComment({
      type: original !== type ? original : undefined,
      logicalName: c.logicalName || undefined,
      note: sqlite ? c.note : undefined,
      identity:
        dialect !== "PostgreSQL" && c.identity === "always"
          ? c.identity
          : undefined,
      identityOptions: dialect !== "PostgreSQL" ? c.identityOptions : undefined,
    });
    return `  ${quote(c.name).padEnd(width)} ${type}${generation}${c.notNull ? " NOT NULL" : ""}${value ? ` DEFAULT ${value}` : ""}${mysql && c.note ? " COMMENT " + literal(c.note, dialect) : ""}${details}`;
  });
  if (primary && !inlinePrimary && named(primary.columnIds))
    lines.push(
      `  ${constraintName(primary.name)}PRIMARY KEY (${named(primary.columnIds)})`,
    );
  for (const k of keys.filter((k) => k.kind === "unique"))
    if (named(k.columnIds))
      lines.push(`  ${constraintName(k.name)}UNIQUE (${named(k.columnIds)})`);
  const indexes: string[] = [];
  keys
    .filter((k) => k.kind === "index" && named(k.columnIds))
    .forEach((k, i) => {
      const index = k.name || `${tableName}_idx_${i + 1}`;
      if (mysql) lines.push(`  INDEX ${quote(index)} (${named(k.columnIds)})`);
      else
        indexes.push(
          `CREATE INDEX ${qualified(sqlite ? table.schemaName : undefined, index)} ON ${sqlite ? quote(tableName) : name} (${named(k.columnIds)});`,
        );
    });
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
    if (
      mysql &&
      (fk.onDelete === "SET DEFAULT" || fk.onUpdate === "SET DEFAULT")
    )
      throw new Error(
        `${tableName} の外部キーにある SET DEFAULT は MySQL では使えません。`,
      );
    if (
      sqlite &&
      (parent.schemaName ?? "main") !== (table.schemaName ?? "main")
    )
      throw new Error(
        `${tableName} から別のデータベースへの外部キーは SQLite では使えません。`,
      );
    const target = qualified(
      sqlite ? undefined : parent.schemaName,
      parent.name?.trim() || parent.id,
    );
    const constraint = `${constraintName(fk.name)}FOREIGN KEY (${named(fk.columnIds)}) REFERENCES ${target} (${targets.map(quote).join(", ")})${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ""}${fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : ""}${detailsComment({ label: fk.label || undefined, cardinality: fk.cardinality })}`;
    if (
      !sqlite &&
      forwardReferences &&
      state.tables.indexOf(parent) > state.tables.indexOf(table)
    )
      forwardReferences.push(`ALTER TABLE ${name} ADD ${constraint};`);
    else lines.push(`  ${constraint}`);
  }
  const tableDetails = detailsComment({
    logicalName: table.logicalName || undefined,
    note: sqlite ? table.note : undefined,
  });
  let options = "";
  if (mysql)
    options =
      " ENGINE=InnoDB" +
      (table.note ? " COMMENT=" + literal(table.note, dialect) : "");
  const statements = [
    `CREATE TABLE ${name} (\n${lines.join(",\n")}\n)${tableDetails}${options};`,
    ...indexes,
  ];
  if (dialect === "PostgreSQL") {
    if (table.note)
      statements.push(
        `COMMENT ON TABLE ${name} IS ${literal(table.note, dialect)};`,
      );
    for (const c of columns)
      if (c.note)
        statements.push(
          `COMMENT ON COLUMN ${name}.${quote(c.name)} IS ${literal(c.note, dialect)};`,
        );
  }
  return statements.join("\n");
}

export function diagramDDL(
  state: Diagram,
  dialect: DdlDialect = state.ddlDialect ?? "PostgreSQL",
) {
  const forwardReferences: string[] = [];
  const tables = state.tables.map((table) =>
    tableDDL(table, state, dialect, forwardReferences),
  );
  return [...tables, ...forwardReferences].join("\n\n");
}
