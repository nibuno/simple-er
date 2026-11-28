import {
  inlineEnumName,
  readEnumValues,
  registerEnum,
  typeName,
} from "./schema-constraints.ts";
import { ddlType, readDetails } from "./ddl-dialect.ts";
import { serialBase } from "./column-attributes.ts";
import { expression, SqlError, statements, Tokens } from "./ddl-tokens.ts";
import { layoutImportedTables } from "./import-layout.ts";
import { MAX_COLUMNS, MAX_TABLES, MAX_CONNECTIONS, uid } from "./model.ts";
import { ddlDialects, referenceActions } from "./types.ts";
import type {
  Diagram,
  EnumType,
  ForeignKey,
  KeyDefinition,
  Table,
} from "./types.ts";

type Name = string[];
type Constraint = { name: string; columns: string[] } & (
  | { kind: "check"; expression: string }
  | { kind: KeyDefinition["kind"] }
  | ({ kind: "foreign"; parent: Name; targets?: string[] } & Pick<
      ForeignKey,
      "onDelete" | "onUpdate" | "label" | "cardinality"
    >)
);
type Change = { table: Name; line: number } & (
  Constraint | { kind: "comment"; column?: string; text: string }
);
export interface DdlIssue {
  line: number;
  message: string;
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const modifiers = new Set(
  "NOT NULL DEFAULT PRIMARY UNIQUE REFERENCES CONSTRAINT COMMENT AUTO_INCREMENT AUTOINCREMENT CHECK GENERATED COLLATE CHARACTER ON".split(
    " ",
  ),
);
const constraints = new Set(
  "CONSTRAINT PRIMARY UNIQUE FOREIGN INDEX KEY CHECK".split(" "),
);

function reference(
  tokens: Tokens,
  columns: string[],
  name: string,
): Constraint {
  const parent = tokens.qualifiedName();
  const targets = tokens.keyword === "(" ? tokens.names() : undefined;
  const actions: Pick<ForeignKey, "onDelete" | "onUpdate"> = {};
  while (tokens.eat("ON")) {
    const deleting = tokens.eat("DELETE");
    if (!deleting) tokens.need("UPDATE");
    const action = referenceActions.find((action) =>
      action
        .split(" ")
        .every(
          (word, i) =>
            tokens.items[tokens.index + i]?.raw.toUpperCase() === word,
        ),
    );
    if (!action) tokens.fail("参照動作を読み取れません。");
    tokens.index += action.split(" ").length;
    actions[deleting ? "onDelete" : "onUpdate"] = action;
  }
  const { label, cardinality } = readDetails(
    tokens.items[tokens.index - 1]?.details,
  );
  return {
    kind: "foreign",
    columns,
    name,
    parent,
    targets,
    ...actions,
    label,
    cardinality,
  };
}

function checkConstraint(
  tokens: Tokens,
  name: string,
  sql: string,
): Constraint {
  tokens.need("(");
  const body = tokens.until((word) => word === ")");
  if (!body.length) tokens.fail("CHECK の条件式がありません。");
  tokens.need(")");
  return {
    kind: "check",
    columns: [],
    name,
    expression: expression(body, sql, "PostgreSQL"),
  };
}

function tableConstraint(tokens: Tokens, sql: string): Constraint {
  let name = tokens.eat("CONSTRAINT") ? tokens.name() : "";
  if (tokens.eat("CHECK")) return checkConstraint(tokens, name, sql);
  if (tokens.eat("FOREIGN")) {
    tokens.need("KEY");
    if (tokens.keyword !== "(") {
      const indexName = tokens.name();
      name ||= indexName;
    }
    const columns = tokens.names();
    tokens.need("REFERENCES");
    return reference(tokens, columns, name);
  }
  let kind: KeyDefinition["kind"];
  if (tokens.eat("PRIMARY")) {
    tokens.need("KEY");
    kind = "primary";
  } else {
    if (tokens.eat("UNIQUE")) {
      kind = "unique";
      if (!tokens.eat("KEY")) tokens.eat("INDEX");
    } else {
      if (!tokens.eat("INDEX")) tokens.need("KEY");
      kind = "index";
    }
    if (tokens.keyword !== "(") {
      const indexName = tokens.name();
      name ||= indexName;
    }
  }
  return { kind, name, columns: tokens.names() };
}

function parseColumn(tokens: Tokens, sql: string, issues: DdlIssue[]) {
  const name = tokens.name();
  // CHARACTER VARYING is a type. CHARACTER SET after the type is a modifier.
  const first = tokens.keyword;
  if (!first || (modifiers.has(first) && first !== "CHARACTER"))
    tokens.fail(`${name} の型を読み取れません。`);
  const start = tokens.index;
  let enumValues: string[] | undefined;
  if (tokens.eat("ENUM") && tokens.keyword === "(") {
    enumValues = readEnumValues(tokens);
  } else {
    tokens.index = start;
    tokens.name();
    tokens.until((word) => modifiers.has(word));
  }
  const type = enumValues
    ? "ENUM"
    : expression(tokens.items.slice(start, tokens.index), sql);
  if (type.length > 40) tokens.fail("型は40文字以内で指定してください。");
  const details = readDetails(tokens.items.at(-1)?.details);
  const column: Table["columns"][number] = {
    id: uid(),
    name,
    type,
    key: "",
    logicalName: "",
  };
  const keys: Constraint[] = [];
  try {
    while (tokens.current) {
      const keyName = tokens.eat("CONSTRAINT") ? tokens.name() : "";
      if (tokens.eat("PRIMARY")) {
        tokens.need("KEY");
        keys.push({ kind: "primary", name: keyName, columns: [name] });
      } else if (tokens.eat("UNIQUE")) {
        tokens.eat("KEY");
        keys.push({ kind: "unique", name: keyName, columns: [name] });
      } else if (tokens.eat("REFERENCES"))
        keys.push(reference(tokens, [name], keyName));
      else if (tokens.eat("NOT")) {
        tokens.need("NULL");
        column.notNull = true;
      } else if (tokens.eat("DEFAULT")) {
        const first = tokens.index;
        const value = expression(
          tokens.until(
            (word) =>
              modifiers.has(word) &&
              !(word === "NULL" && tokens.index === first),
          ),
          sql,
        );
        if (!value) tokens.fail("既定値がありません。");
        column.defaultValue = value;
      } else if (tokens.eat("GENERATED")) {
        const always = tokens.eat("ALWAYS");
        if (!always) {
          tokens.need("BY");
          tokens.need("DEFAULT");
        }
        tokens.need("AS");
        tokens.need("IDENTITY");
        column.identity = always ? "always" : "byDefault";
        if (tokens.eat("(")) {
          column.identityOptions =
            expression(
              tokens.until((word) => word === ")"),
              sql,
            ) || undefined;
          tokens.need(")");
        }
      } else if (tokens.eat("AUTO_INCREMENT") || tokens.eat("AUTOINCREMENT")) {
        column.identity = "byDefault";
      } else if (tokens.eat("CHECK")) {
        const start = tokens.index;
        const check = checkConstraint(tokens, keyName, sql);
        // A tagged SQLite TEXT/IN declaration denotes an ENUM. Keep a changed condition as a CHECK.
        if (details.enumName && type.toUpperCase() === "TEXT" && !enumValues) {
          const body = new Tokens(
            tokens.items.slice(start + 1, tokens.index - 1),
          );
          try {
            if (body.name() === name && body.eat("IN")) {
              const values = readEnumValues(body);
              body.end();
              enumValues = values;
              continue;
            }
          } catch (error) {
            if (!(error instanceof SqlError)) throw error;
          }
        }
        keys.push(check);
      } else if (tokens.eat("COMMENT")) column.note = tokens.string();
      else if (tokens.eat("CHARACTER")) {
        tokens.need("SET");
        tokens.name();
      } else if (tokens.eat("COLLATE")) tokens.name();
      else if (tokens.eat("ON")) {
        tokens.need("UPDATE");
        tokens.need("CURRENT_TIMESTAMP");
        if (tokens.eat("(")) {
          if (/^\d+$/.test(tokens.keyword)) tokens.index++;
          tokens.need(")");
        }
      } else if (!tokens.eat("NULL")) tokens.end();
    }
  } catch (error) {
    if (!(error instanceof SqlError)) throw error;
    issues.push({ line: error.line, message: `${name}：${error.message}` });
  }
  // If the native type has since been edited, keep the SQL declaration.
  if (
    details.type &&
    ddlDialects.some(
      (dialect) =>
        ddlType(details.type!, dialect, true).toLowerCase() ===
        type.toLowerCase(),
    )
  ) {
    column.type = details.type;
    if (serialBase(column.type)) delete column.identity;
  }
  if (column.identity) {
    if (details.identity) column.identity = details.identity;
    if (details.identityOptions)
      column.identityOptions = details.identityOptions;
  }
  if (details.note !== undefined) column.note = details.note;
  if (details.logicalName) column.logicalName = details.logicalName;
  return { column, keys, enumValues, enumName: details.enumName };
}

function parseOptions(tokens: Tokens, table: Table) {
  if (tokens.keyword === "STRICT" || tokens.keyword === "WITHOUT") {
    do {
      if (!tokens.eat("STRICT")) {
        tokens.need("WITHOUT");
        tokens.need("ROWID");
      }
    } while (tokens.eat(","));
    return tokens.end();
  }
  while (tokens.current) {
    if (tokens.eat("COMMENT")) {
      tokens.eat("=");
      table.note = tokens.string();
    } else {
      tokens.eat("DEFAULT");
      if (tokens.eat("CHARACTER")) tokens.need("SET");
      else if (
        ![
          "CHARSET",
          "ENGINE",
          "COLLATE",
          "AUTO_INCREMENT",
          "ROW_FORMAT",
        ].includes(tokens.keyword)
      )
        tokens.end();
      else tokens.index++;
      tokens.eat("=");
      if (!tokens.current) tokens.fail("テーブルオプションの値がありません。");
      tokens.index++;
    }
    tokens.eat(",");
  }
}

export function importDDL(
  sql: string,
  base: Diagram = { tables: [], edges: [] },
) {
  const next = structuredClone(base);
  const enums = (next.enums ??= []);
  const supplemental = /^-- simple-er-enums (.+)$/.exec(
    sql.trimStart().split("\n", 1)[0],
  );
  if (supplemental) {
    const values: EnumType[] = JSON.parse(supplemental[1]);
    if (!Array.isArray(values))
      throw new Error("ENUM の補足コメントが不正です。");
    for (const e of values) registerEnum(enums, e);
  }
  const issues: DdlIssue[] = [];
  const changes: Change[] = [];
  const added: Table[] = [];
  const skipped = new Set<string>();
  function attempt(line: number, action: () => void) {
    try {
      action();
    } catch (error) {
      if (!(error instanceof SqlError)) throw error;
      issues.push({ line: error.line || line, message: error.message });
    }
  }
  function readTable(t: Tokens, line: number) {
    if (t.eat("IF")) {
      t.need("NOT");
      t.need("EXISTS");
    }
    const path = t.qualifiedName();
    const name = path.at(-1)!;
    if (path.length > 2)
      t.fail("テーブル名はスキーマと名前で指定してください。");
    if (next.tables.some((table) => same(table.name, name))) {
      if (base.tables.some((table) => same(table.name, name)))
        skipped.add(name.toLowerCase());
      throw new SqlError(line, `${name} はすでにあります。`);
    }
    if (next.tables.length >= MAX_TABLES)
      t.fail(`テーブルは${MAX_TABLES}個までです。`);
    const table: Table = {
      id: uid(),
      name,
      ...(path.length === 2 && { schemaName: path[0] }),
      logicalName: "",
      x: 0,
      y: 0,
      columns: [],
      keys: [],
      foreignKeys: [],
    };
    const local: Change[] = [];
    t.need("(");
    while (t.keyword !== ")") {
      const part = new Tokens(t.until((word) => word === "," || word === ")"));
      if (!part.current) t.fail("カラムまたは制約が必要です。");
      const at = part.line;
      attempt(at, () => {
        let keys: Constraint[];
        if (constraints.has(part.keyword)) {
          keys = [tableConstraint(part, sql)];
          part.end();
        } else {
          const {
            column,
            keys: inline,
            enumValues,
            enumName,
          } = parseColumn(part, sql, issues);
          if (table.columns.length >= MAX_COLUMNS)
            part.fail("カラムは60個までです。");
          if (table.columns.some((c) => same(c.name, column.name)))
            part.fail(`${column.name} が重複しています。`);
          if (enumValues) {
            column.type = enumName ?? inlineEnumName(name, column.name, enums);
            registerEnum(enums, { name: column.type, values: enumValues });
          }
          table.columns.push(column);
          keys = inline;
        }
        local.push(...keys.map((key) => ({ ...key, table: path, line: at })));
      });
      if (!t.eat(",")) break;
    }
    t.need(")");
    const { note, logicalName } = readDetails(t.items[t.index - 1].details);
    if (logicalName) table.logicalName = logicalName;
    if (note !== undefined) table.note = note;
    if (!table.columns.length)
      t.fail(`${name} に読み込めるカラムがありません。`);
    attempt(t.line, () => parseOptions(t, table));
    next.tables.push(table);
    added.push(table);
    changes.push(...local);
  }
  for (const statement of statements(sql)) {
    const t = new Tokens(statement);
    const line = t.line;
    attempt(line, () => {
      if (t.eat("CREATE")) {
        if (!t.eat("TEMPORARY")) t.eat("TEMP");
        if (t.eat("TABLE")) {
          readTable(t, line);
        } else if (t.eat("TYPE")) {
          const name = typeName(t.qualifiedName());
          t.need("AS");
          t.need("ENUM");
          const values = readEnumValues(t);
          t.end();
          registerEnum(enums, { name, values });
        } else {
          const unique = t.eat("UNIQUE");
          t.need("INDEX");
          const index = t.qualifiedName();
          const name = index.at(-1)!;
          t.need("ON");
          const table = t.qualifiedName(),
            columns = t.names();
          t.end();
          changes.push({
            kind: unique ? "unique" : "index",
            name,
            table:
              index.length === 2 && table.length === 1
                ? [index[0], ...table]
                : table,
            columns,
            line,
          });
        }
      } else if (t.eat("ALTER")) {
        t.need("TABLE");
        t.eat("ONLY");
        const table = t.qualifiedName();
        do {
          t.need("ADD");
          const part = new Tokens(t.until((word) => word === ","));
          const at = part.line;
          attempt(at, () => {
            const key = tableConstraint(part, sql);
            part.end();
            changes.push({ ...key, table, line: at });
          });
        } while (t.eat(","));
        t.end();
      } else if (t.eat("COMMENT")) {
        t.need("ON");
        const hasColumn = t.eat("COLUMN");
        if (!hasColumn) t.need("TABLE");
        const table = t.qualifiedName();
        const column = hasColumn ? table.pop() : undefined;
        if (!table.length) t.fail("コメントの対象テーブルがありません。");
        t.need("IS");
        const text = t.eat("NULL") ? "" : t.string();
        t.end();
        changes.push({ kind: "comment", table, column, text, line });
      } else
        t.fail(
          `「${t.current.raw.slice(0, 40)}」で始まる文には対応していません。`,
        );
    });
  }
  function findTable(path: Name, line: number, schema?: string) {
    const name = path.at(-1)!;
    const table = next.tables.find(
      (t) =>
        same(t.name, name) &&
        (path.length === 1
          ? !schema || !t.schemaName || same(t.schemaName, schema)
          : path.length === 2 && same(t.schemaName ?? "", path[0])),
    );
    if (!table)
      throw new SqlError(line, `テーブル ${path.join(".")} が見つかりません。`);
    return table;
  }
  function columnIds(table: Table, names: string[], line: number) {
    const ids = names.map((name) => {
      const column = table.columns.find((c) => same(c.name, name));
      if (!column)
        throw new SqlError(
          line,
          `${table.name} にカラム ${name} がありません。`,
        );
      return column.id;
    });
    if (new Set(ids).size !== ids.length)
      throw new SqlError(line, "制約のカラムが重複しています。");
    return ids;
  }
  let connections = base.edges.length;
  for (const table of added) {
    for (const column of table.columns) {
      if (!enums.length) continue;
      try {
        const t = new Tokens([...statements(column.type)][0] ?? []);
        const parts = t.qualifiedName();
        t.end();
        const qualified =
          table.schemaName && parts.length === 1
            ? typeName([table.schemaName, ...parts])
            : undefined;
        const found =
          enums.find((e) => e.name === qualified) ??
          enums.find((e) => e.name === typeName(parts));
        if (found) column.type = found.name;
      } catch (error) {
        if (!(error instanceof SqlError)) throw error;
      }
    }
  }
  let applied = added.length + enums.length - (base.enums?.length ?? 0);
  // Resolve every candidate key before foreign keys, including forward references and cycles.
  for (const op of [
    ...changes.filter((c) => c.kind !== "foreign"),
    ...changes.filter((c) => c.kind === "foreign"),
  ]) {
    attempt(op.line, () => {
      const table = findTable(op.table, op.line);
      // A duplicate CREATE from a full dump must not attach its later comments,
      // indexes or ALTER statements to a table already in the user's drawing.
      if (skipped.has(table.name.toLowerCase()))
        throw new SqlError(
          op.line,
          `既存の ${table.name} への変更は省きました。`,
        );
      if (op.kind === "comment") {
        if (!op.column) table.note = op.text;
        else {
          const [id] = columnIds(table, [op.column], op.line);
          table.columns.find((c) => c.id === id)!.note = op.text;
        }
      } else {
        const ids = columnIds(table, op.columns, op.line);
        if (
          table.keys.length +
            table.foreignKeys.length +
            (table.checks?.length ?? 0) >=
          200
        )
          throw new SqlError(op.line, "制約は200件までです。");
        if (op.kind === "check") {
          (table.checks ??= []).push({
            name: op.name,
            expression: op.expression,
          });
        } else if (op.kind === "foreign") {
          const parent = findTable(op.parent, op.line, table.schemaName);
          const targets = op.targets
            ? columnIds(parent, op.targets, op.line)
            : parent.keys.find((k) => k.kind === "primary")?.columnIds;
          if (
            !targets ||
            targets.length !== ids.length ||
            !parent.keys.some(
              (k) =>
                k.kind !== "index" &&
                k.columnIds.length === targets.length &&
                k.columnIds.every((id, i) => id === targets[i]),
            )
          )
            throw new SqlError(
              op.line,
              `${parent.name} の主キーまたは一意制約を参照してください。`,
            );
          if (connections + ids.length > MAX_CONNECTIONS)
            throw new SqlError(op.line, `接続は${MAX_CONNECTIONS}本までです。`);
          table.foreignKeys.push({
            id: uid(),
            name: op.name,
            columnIds: ids,
            ...(op.label && { label: op.label }),
            ...(op.cardinality && { cardinality: op.cardinality }),
            ...(op.onDelete && { onDelete: op.onDelete }),
            ...(op.onUpdate && { onUpdate: op.onUpdate }),
            target: { tableId: parent.id, columnIds: targets },
          });
          connections += ids.length;
        } else {
          if (
            op.kind === "primary" &&
            table.keys.some((k) => k.kind === "primary")
          )
            throw new SqlError(
              op.line,
              `${table.name} の主キーが重複しています。`,
            );
          table.keys.push({
            id: uid(),
            kind: op.kind,
            name: op.name,
            columnIds: ids,
          });
        }
      }
      applied++;
    });
  }
  return {
    diagram: layoutImportedTables(next, added, base),
    tableCount: added.length,
    applied,
    issues: issues.sort((a, b) => a.line - b.line),
  };
}
