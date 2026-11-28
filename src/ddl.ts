import { serialBase } from "./column-attributes.ts";
import { checkSql, defaultSql } from "./ddl-expression.ts";
import { identifierPath } from "./schema-constraints.ts";
import { qualifiedTitle, tableKey } from "./model.ts";
import {
  ddlType,
  detailsComment as encodeDetails,
  supportsIdentity,
} from "./ddl-dialect.ts";
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

// SQLite folds ASCII letters in database names. No qualifier means main.
const sqliteDatabase = (table: Table) =>
  (table.schemaName ?? "main").replace(/[A-Z]/g, (ch) => ch.toLowerCase());

/** Incomplete editor drafts can lack names or foreign key targets. */
export function tableDDL(
  table: Table,
  state: Diagram,
  dialect: DdlDialect = state.ddlDialect ?? "PostgreSQL",
  forwardReferences?: string[],
) {
  const detailsComment = state.ddlAnnotations ? encodeDetails : () => "";
  const mysql = dialect === "MySQL",
    sqlite = dialect === "SQLite";
  const quote = (name: string) => identifier(name, dialect);
  const qualified = (schema: string | undefined, name: string) =>
    schema ? quote(schema) + "." + quote(name) : quote(name);
  const tableName = table.name?.trim() || table.id;
  const name = qualified(table.schemaName, tableName);
  if (
    sqlite &&
    state.tables.some(
      (t) =>
        t.id !== table.id &&
        tableKey(t.name, sqliteDatabase(t)) ===
          tableKey(tableName, sqliteDatabase(table)),
    )
  )
    throw new Error(
      `SQLite ではスキーマなしと main の ${tableName} が同じテーブルになります。`,
    );
  const tableComment = table.note || table.logicalName;
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
    const enumType = state.enums?.find((e) => e.name === original);
    if (enumType) {
      const values = enumType.values.map((v) => literal(v, dialect)).join(", ");
      type = mysql
        ? `ENUM(${values})`
        : sqlite
          ? `TEXT CHECK (${quote(c.name)} IN (${values}))`
          : identifierPath(original).map(quote).join(".");
    }
    const label = [table.schemaName, tableName, c.name]
      .filter(Boolean)
      .join(".");
    if (
      !enumType &&
      dialect !== "PostgreSQL" &&
      (/\[.*\]|\bARRAY\b/i.test(original) ||
        (mysql &&
          !/^(?:(?:tiny|small|medium|big)?int(?:eger)?|decimal|numeric|float[48]?|double(?: precision)?|real|bit|bool(?:ean)?|date(?:time)?|time(?:stamp)?|year|(?:var)?(?:char|binary)|(?:tiny|medium|long)?(?:text|blob)|json|set|geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)(?:\s*\([^)]*\))?(?: unsigned)?(?: zerofill)?$/i.test(
            type,
          )))
    )
      throw new Error(
        `${label} の型「${original}」は ${dialect} 用に変更してください。`,
      );
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
      if (!supportsIdentity(type, dialect))
        throw new Error(
          `${label} の AUTO_INCREMENT には整数型を指定してください。`,
        );
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
    const nativeDefault =
      c.defaultValue &&
      defaultSql(c.defaultValue, original, dialect, label + " の既定値", type);
    let value = nativeDefault;
    if (mysql && value)
      value = value.replace(/'(?:''|[^'])*'/g, (str) =>
        str.replaceAll("\\", "\\\\"),
      );
    const comment = c.note || c.logicalName;
    const details = detailsComment({
      defaultValue:
        nativeDefault && c.defaultValue && nativeDefault !== c.defaultValue
          ? { source: c.defaultValue, sql: nativeDefault }
          : undefined,
      enumName: enumType && (mysql || sqlite) ? enumType.name : undefined,
      type: !enumType && original !== type ? original : undefined,
      logicalName: c.logicalName || undefined,
      note: sqlite || !c.logicalName ? c.note : undefined,
      identity:
        dialect !== "PostgreSQL" && c.identity === "always"
          ? c.identity
          : undefined,
      identityOptions: dialect !== "PostgreSQL" ? c.identityOptions : undefined,
    });
    return `  ${quote(c.name).padEnd(width)} ${type}${generation}${c.notNull ? " NOT NULL" : ""}${value ? ` DEFAULT ${value}` : ""}${mysql && comment ? " COMMENT " + literal(comment, dialect) : ""}${details}`;
  });
  if (primary && !inlinePrimary && named(primary.columnIds))
    lines.push(
      `  ${constraintName(primary.name)}PRIMARY KEY (${named(primary.columnIds)})`,
    );
  for (const k of keys.filter((k) => k.kind === "unique"))
    if (named(k.columnIds))
      lines.push(`  ${constraintName(k.name)}UNIQUE (${named(k.columnIds)})`);
  for (const check of table.checks ?? []) {
    if (!check.expression.trim()) continue;
    const sql = checkSql(
      check.expression,
      columns.map((c) => c.name),
      dialect,
      tableName + " の CHECK",
    );
    const details = detailsComment({
      check:
        sql === check.expression
          ? undefined
          : { source: check.expression, sql },
    });
    lines.push(`  ${constraintName(check.name)}CHECK (${sql})${details}`);
  }
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
    if (sqlite && sqliteDatabase(parent) !== sqliteDatabase(table))
      throw new Error(
        `${tableName} から別のデータベースへの外部キーは SQLite では使えません。`,
      );
    if (
      !sqlite &&
      !parent.schemaName &&
      table.schemaName &&
      state.tables.some(
        (t) =>
          tableKey(t.name, t.schemaName) ===
          tableKey(parent.name, table.schemaName),
      )
    )
      throw new Error(
        `${qualifiedTitle(table)} の参照先 ${parent.name} にスキーマ名を付けてください。同名のテーブルがあります。`,
      );
    const target = qualified(
      sqlite ? undefined : parent.schemaName,
      parent.name?.trim() || parent.id,
    );
    const details = detailsComment({
      label: fk.label || undefined,
      cardinality: fk.cardinality,
      // SQLite omits the qualifier even when a table in main was explicitly named.
      referenceSchema:
        sqlite && !table.schemaName ? parent.schemaName : undefined,
    });
    const constraint = `${constraintName(fk.name)}FOREIGN KEY (${named(fk.columnIds)}) REFERENCES ${target} (${targets.map(quote).join(", ")})${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ""}${fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : ""}${details}`;
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
    note: sqlite || !table.logicalName ? table.note : undefined,
  });
  let options = "";
  if (mysql)
    options =
      " ENGINE=InnoDB" +
      (tableComment ? " COMMENT=" + literal(tableComment, dialect) : "");
  const statements = [
    `CREATE TABLE ${name} (\n${lines.join(",\n")}\n)${tableDetails}${options};`,
    ...indexes,
  ];
  if (dialect === "PostgreSQL") {
    if (tableComment)
      statements.push(
        `COMMENT ON TABLE ${name} IS ${literal(tableComment, dialect)};`,
      );
    for (const c of columns) {
      const comment = c.note || c.logicalName;
      if (comment)
        statements.push(
          `COMMENT ON COLUMN ${name}.${quote(c.name)} IS ${literal(comment, dialect)};`,
        );
    }
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
  const enums = state.enums ?? [];
  const preamble: string[] = [];
  if (dialect === "PostgreSQL") {
    for (const e of enums) {
      const name = identifierPath(e.name)
        .map((n) => identifier(n))
        .join(".");
      const values = e.values.map((v) => literal(v, dialect)).join(", ");
      preamble.push(`CREATE TYPE ${name} AS ENUM (${values});`);
    }
  } else if (state.ddlAnnotations) {
    const unused = enums.filter(
      (e) =>
        !state.tables.some((t) => t.columns.some((c) => c.type === e.name)),
    );
    if (unused.length)
      preamble.push("-- simple-er-enums " + JSON.stringify(unused));
  }
  return [...preamble, ...tables, ...forwardReferences].join("\n\n");
}
