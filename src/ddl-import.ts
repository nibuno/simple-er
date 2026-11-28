import {
  inlineEnumName,
  readEnumValues,
  registerEnum,
  typeName,
} from "./schema-constraints.ts";
import { ddlType, readDetails } from "./ddl-dialect.ts";
import { serialBase, serialType } from "./column-attributes.ts";
import { expression, SqlError, statements, Tokens } from "./ddl-tokens.ts";
import { layoutImportedTables } from "./import-layout.ts";
import {
  MAX_COLUMNS,
  MAX_TABLES,
  MAX_CONNECTIONS,
  qualifiedTitle,
  tableKey,
  uid,
} from "./model.ts";
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
  | Constraint
  | { kind: "comment"; column?: string; text: string }
  | {
      kind: "identity";
      column: string;
      identity: "always" | "byDefault";
      options?: string;
    }
  | { kind: "default"; column: string; value: string }
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
  const { label, cardinality, referenceSchema } = readDetails(
    tokens.items[tokens.index - 1]?.details,
  );
  return {
    kind: "foreign",
    columns,
    name,
    parent:
      parent.length === 1 && referenceSchema
        ? [referenceSchema, ...parent]
        : parent,
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
  const saved = readDetails(tokens.items[tokens.index - 1].details).check;
  const last = body.at(-1)!;
  const raw = sql.slice(body[0].offset, last.offset + last.raw.length);
  return {
    kind: "check",
    columns: [],
    name,
    expression:
      saved?.sql === raw ? saved.source : expression(body, sql, "PostgreSQL"),
  };
}

function indexMethod(tokens: Tokens) {
  if (tokens.eat("USING") && !tokens.eat("BTREE"))
    tokens.fail("このインデックスの方式は読み込めません。");
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
    if (tokens.keyword !== "(" && tokens.keyword !== "USING") {
      const indexName = tokens.name();
      name ||= indexName;
    }
  }
  indexMethod(tokens);
  const columns = tokens.names();
  indexMethod(tokens);
  return { kind, name, columns };
}

function readIdentity(tokens: Tokens, sql: string) {
  const always = tokens.eat("ALWAYS");
  if (!always) {
    tokens.need("BY");
    tokens.need("DEFAULT");
  }
  tokens.need("AS");
  tokens.need("IDENTITY");
  let options: string | undefined;
  if (tokens.eat("(")) {
    options =
      expression(
        tokens.until((word) => word === ")"),
        sql,
      ) || undefined;
    tokens.need(")");
  }
  const identity = always ? ("always" as const) : ("byDefault" as const);
  return { identity, ...(options && { identityOptions: options }) };
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
        Object.assign(column, readIdentity(tokens, sql));
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
  if (details.defaultValue && details.defaultValue.sql === column.defaultValue)
    column.defaultValue = details.defaultValue.source;
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
  let ignoredCount = 0;
  let database: string | undefined;
  const qualified = (path: Name) =>
    database && path.length === 1 ? [database, ...path] : path;
  const sequences = new Map<string, Name>();
  function attempt(line: number, action: () => void, context?: string) {
    try {
      action();
    } catch (error) {
      if (!(error instanceof SqlError)) throw error;
      issues.push({
        line: error.line || line,
        message: context ? context + "：" + error.message : error.message,
      });
    }
  }
  function readTable(t: Tokens, line: number) {
    if (t.eat("IF")) {
      t.need("NOT");
      t.need("EXISTS");
    }
    const path = qualified(t.qualifiedName());
    const name = path.at(-1)!;
    if (/^sqlite_(?:sequence|stat[1-4])$/i.test(name)) {
      ignoredCount++;
      return;
    }
    if (path.length > 2)
      t.fail("テーブル名はスキーマと名前で指定してください。");
    const key = tableKey(name, path.at(-2));
    const existing = next.tables.find(
      (t) => tableKey(t.name, t.schemaName) === key,
    );
    if (existing) {
      if (base.tables.some((t) => t.id === existing.id))
        skipped.add(existing.id);
      throw new SqlError(
        line,
        `${qualifiedTitle(existing)} はすでにあります。`,
      );
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
    attempt(
      line,
      () => {
        // Dump settings, permissions and client commands do not describe the diagram.
        const head = statement
          .slice(0, 6)
          .map((token) => token.raw.toUpperCase())
          .join(" ");
        if (
          t.keyword.startsWith("/*!") ||
          (t.keyword === "COPY" &&
            statement.at(-1)?.raw.toUpperCase() === "STDIN") ||
          t.keyword.startsWith("\\") ||
          /^(?:INSERT INTO|SET|GRANT|REVOKE|PRAGMA|BEGIN|COMMIT|LOCK TABLES|UNLOCK TABLES|CREATE (?:SCHEMA|DATABASE|EXTENSION|SEQUENCE)|DROP TABLE IF EXISTS|SELECT (?:PG_CATALOG \. )?(?:SET_CONFIG|SETVAL))(?: |$)/.test(
            head,
          ) ||
          /^COMMENT ON (?!TABLE |COLUMN )/.test(head) ||
          (/^ALTER (?:SCHEMA|TYPE|SEQUENCE) /.test(head) &&
            statement.some((token) => token.raw.toUpperCase() === "OWNER"))
        ) {
          ignoredCount++;
          return;
        }
        if (t.eat("USE")) {
          const name = t.name();
          t.end();
          database = name;
          return;
        }
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
            if (!t.eat("INDEX"))
              t.fail(`CREATE ${t.keyword} は読み込めません。`);
            if (t.eat("IF")) {
              t.need("NOT");
              t.need("EXISTS");
            }
            const index = t.qualifiedName();
            const name = index.at(-1)!;
            indexMethod(t);
            t.need("ON");
            t.eat("ONLY");
            const table = t.qualifiedName();
            indexMethod(t);
            const columns = t.names();
            indexMethod(t);
            t.end();
            changes.push({
              kind: unique ? "unique" : "index",
              name,
              table:
                index.length === 2 && table.length === 1
                  ? [index[0], ...table]
                  : qualified(table),
              columns,
              line,
            });
          }
        } else if (t.eat("ALTER")) {
          if (t.eat("SEQUENCE")) {
            const sequence = t.qualifiedName();
            t.need("OWNED");
            t.need("BY");
            const owner = t.qualifiedName();
            t.end();
            sequences.set(JSON.stringify(sequence), owner);
            ignoredCount++;
            return;
          }
          t.need("TABLE");
          t.eat("ONLY");
          const table = qualified(t.qualifiedName());
          if (t.eat("OWNER")) {
            t.need("TO");
            t.name();
            t.end();
            ignoredCount++;
            return;
          }
          if (t.eat("ALTER")) {
            t.eat("COLUMN");
            const column = t.name();
            if (t.eat("SET")) {
              t.need("DEFAULT");
              const value = expression(t.items.slice(t.index), sql);
              if (!value) t.fail("既定値がありません。");
              changes.push({ kind: "default", column, value, table, line });
            } else {
              t.need("ADD");
              t.need("GENERATED");
              const { identity, identityOptions } = readIdentity(t, sql);
              t.end();
              changes.push({
                kind: "identity",
                column,
                identity,
                options: identityOptions,
                table,
                line,
              });
            }
            return;
          }
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
          changes.push({
            kind: "comment",
            table: qualified(table),
            column,
            text,
            line,
          });
        } else
          t.fail(
            `「${t.current.raw.slice(0, 40)}」で始まる文には対応していません。`,
          );
      },
      statement[1]?.raw.toUpperCase() === "TABLE" &&
        statement[0].raw.toUpperCase() === "CREATE"
        ? undefined
        : statement
            .slice(0, 2)
            .map((token) => token.raw.slice(0, 40))
            .join(" "),
    );
  }
  function findTable(path: Name, line: number, schema?: string) {
    const name = path.at(-1)!;
    const candidates = next.tables.filter((t) => same(t.name, name));
    const expected = path.length === 2 ? path[0] : schema;
    const local = candidates.find((t) =>
      same(t.schemaName ?? "", expected ?? ""),
    );
    let table = path.length <= 2 ? local : undefined;
    if (!table && path.length === 1) {
      if (schema) table = candidates.find((t) => !t.schemaName);
      else if (candidates.length === 1) table = candidates[0];
      else if (candidates.length > 1)
        throw new SqlError(
          line,
          `${name} が複数あります。スキーマ名を付けてください。`,
        );
    }
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
          `${qualifiedTitle(table)} にカラム ${name} がありません。`,
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
      if (skipped.has(table.id))
        throw new SqlError(
          op.line,
          `既存の ${qualifiedTitle(table)} への変更は省きました。`,
        );
      if (op.kind === "comment") {
        if (!op.column) table.note = op.text;
        else {
          const [id] = columnIds(table, [op.column], op.line);
          table.columns.find((c) => c.id === id)!.note = op.text;
        }
      } else if (op.kind === "identity" || op.kind === "default") {
        const [id] = columnIds(table, [op.column], op.line);
        const column = table.columns.find((c) => c.id === id)!;
        if (op.kind === "identity") {
          column.identity = op.identity;
          column.identityOptions = op.options;
        } else {
          const match = /^nextval\('((?:''|[^'])+)'::regclass\)$/i.exec(
            op.value,
          );
          if (match) {
            const seq = new Tokens(
              [...statements(match[1].replaceAll("''", "'"))][0] ?? [],
            );
            const owner = sequences.get(JSON.stringify(seq.qualifiedName()));
            const serial = serialType(column.type);
            if (
              !serial ||
              !owner ||
              JSON.stringify(owner) !== JSON.stringify([...op.table, op.column])
            )
              throw new SqlError(
                op.line,
                `${table.name}.${column.name} の共有シーケンスは読み込めません。`,
              );
            column.type = serial;
          } else column.defaultValue = op.value;
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
              `${qualifiedTitle(parent)} の主キーまたは一意制約を参照してください。`,
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
              `${qualifiedTitle(table)} の主キーが重複しています。`,
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
    ignoredCount,
    issues: issues.sort((a, b) => a.line - b.line),
  };
}
