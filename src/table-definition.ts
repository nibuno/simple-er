import { typeName } from "./schema-constraints.ts";
import { ddlType } from "./ddl-dialect.ts";
import { serialBase } from "./column-attributes.ts";
import { localDate } from "./export.ts";
import type {
  Column,
  DiagramDocument,
  EnumType,
  TableSchema,
} from "./types.ts";

const physicalName = (table: TableSchema) =>
  typeName(table.schemaName ? [table.schemaName, table.name] : [table.name]);
const columnName = (table: TableSchema, id: string) =>
  typeName([table.columns.find((column) => column.id === id)!.name]);

function autoNumber(column: Column) {
  if (!column.identity) return serialBase(column.type) ? "SERIAL" : "";
  const mode = column.identity === "always" ? "ALWAYS" : "BY DEFAULT";
  return `IDENTITY ${mode}${column.identityOptions ? ` (${column.identityOptions})` : ""}`;
}

// Encode punctuation that can open Markdown markup, preserving ordinary SQL identifiers.
function markdownText(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replace(
      /[<>|\\`*~\[\]#!]|(?<![\p{L}\d])_|_(?![\p{L}\d])/gu,
      (char) => `&#${char.charCodeAt(0)};`,
    )
    .replace(/\r\n|\r|\n/g, "<br>");
}

function markdownTable(headers: string[], rows: string[][]) {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [
    line(headers),
    line(headers.map(() => "---")),
    ...rows.map((cells) => line(cells.map(markdownText))),
  ].join("\n");
}

function csvCell(text: string) {
  // Spreadsheet software evaluates formulas even inside quoted CSV fields.
  if (/^\u0027*\s*[=+@-]/u.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text))
    text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// Keep ordinary names readable and preserve line breaks inside a single FK name.
function foreignNames(names: string[]) {
  const text = names.join("\n");
  return text.startsWith("[") || names.some((n) => /[\r\n]/.test(n))
    ? JSON.stringify(names)
    : text;
}

const columnAttributes = ["型", "PK", "NN", "既定値", "自動採番", "FK 参照先"];
const orderedNames = (
  physical: string,
  logical: string,
  logicalFirst: boolean,
) => (logicalFirst ? [logical, physical] : [physical, logical]);

function describeTable(
  table: TableSchema,
  tables: TableSchema[],
  logicalFirst: boolean,
  group: string | undefined,
  dialect: DiagramDocument["ddlDialect"],
) {
  const info = [
    ...orderedNames(physicalName(table), table.logicalName, logicalFirst),
    table.note ?? "",
    ...(group === undefined ? [] : [group]),
  ];
  const foreignKeys = table.foreignKeys.map((fk) => {
    const target = fk.target;
    const parent = target && tables.find((t) => t.id === target.tableId);
    const targets =
      target && parent
        ? target.columnIds.map(
            (id) => physicalName(parent) + "." + columnName(parent, id),
          )
        : fk.columnIds.map(() => "未設定");
    return {
      fk,
      targets,
      columns: fk.columnIds.map((id) => columnName(table, id)).join(", "),
    };
  });
  const constraints = table.keys.map((key) => ({
    key,
    columns: key.columnIds.map((id) => columnName(table, id)).join(", "),
  }));
  const primary = table.keys.find((key) => key.kind === "primary");
  const columns = table.columns.map((column) => {
    const refs = foreignKeys.filter(({ fk }) =>
      fk.columnIds.includes(column.id),
    );
    const isPrimary = primary?.columnIds.includes(column.id);
    // Ordinary SQLite tables allow NULL in primary keys other than the rowid alias.
    const impliedNotNull =
      isPrimary &&
      (dialect !== "SQLite" ||
        (primary?.columnIds.length === 1 &&
          (column.identity ||
            ddlType(column.type, "SQLite", true).toUpperCase() === "INTEGER")));
    const cells = [
      ...orderedNames(column.name, column.logicalName, logicalFirst),
      column.type,
      isPrimary ? "○" : "",
      column.notNull ? "○" : impliedNotNull ? "主キー" : "",
      column.defaultValue ?? "",
      autoNumber(column),
      refs
        .map(({ fk, targets }) => targets[fk.columnIds.indexOf(column.id)])
        .join("\n"),
      column.note ?? "",
    ];
    return { id: column.id, cells, refs };
  });
  return {
    info,
    group,
    columns,
    foreignKeys,
    constraints,
    checks: table.checks ?? [],
  };
}
type Definition = ReturnType<typeof describeTable>;

function markdown(
  title: string,
  day: string,
  names: string[],
  tables: Definition[],
  enums: EnumType[],
) {
  const tableHeaders = [
    ...names,
    "説明",
    ...(tables.some((t) => t.group !== undefined) ? ["グループ名"] : []),
  ];
  const sections = [
    `# ${markdownText(title)}`,
    `出力日：${day}`,
    "## テーブル一覧",
    markdownTable(
      tableHeaders,
      tables.map((table) => table.info),
    ),
  ];
  if (enums.length)
    sections.push(
      "## ENUM 型",
      markdownTable(
        ["型名", "値（順序）"],
        enums.map((e) => [
          e.name,
          e.values.every((v) => /^[\p{L}\p{N}_-]+$/u.test(v))
            ? e.values.join(", ")
            : JSON.stringify(e.values),
        ]),
      ),
    );
  for (const { info, columns, foreignKeys, constraints, checks } of tables) {
    sections.push(
      `## ${markdownText(info[0] || info[1])}`,
      markdownTable(tableHeaders, [info]),
      "### カラム",
      markdownTable(
        [...names, ...columnAttributes, "説明"],
        columns.map((column) => column.cells),
      ),
    );
    const fkDetails = foreignKeys.some(({ fk }) => fk.label || fk.cardinality);
    if (foreignKeys.length)
      sections.push(
        "### 外部キー",
        markdownTable(
          [
            "名前",
            "カラム",
            "参照先",
            "ON DELETE",
            "ON UPDATE",
            ...(fkDetails ? ["関係の補足"] : []),
          ],
          foreignKeys.map(({ fk, columns, targets }) => [
            fk.name,
            columns,
            targets.join(", "),
            fk.onDelete ?? "",
            fk.onUpdate ?? "",
            ...(fkDetails
              ? [
                  JSON.stringify({
                    label: fk.label,
                    cardinality: fk.cardinality,
                  }),
                ]
              : []),
          ]),
        ),
      );
    if (constraints.length)
      sections.push(
        "### キー・インデックス",
        markdownTable(
          ["種類", "名前", "カラム"],
          constraints.map(({ key, columns }) => [
            key.kind === "index"
              ? "インデックス"
              : key.kind === "primary"
                ? "主キー"
                : "一意制約",
            key.name,
            columns,
          ]),
        ),
      );
    if (checks.length)
      sections.push(
        "### CHECK 制約",
        markdownTable(
          ["制約名", "条件式"],
          checks.map((c) => [c.name, c.expression]),
        ),
      );
  }
  return sections.join("\n\n") + "\n";
}

function csv(
  title: string,
  day: string,
  names: string[],
  tables: Definition[],
  enums: EnumType[],
) {
  const fkDetails = tables.some((t) =>
    t.foreignKeys.some(({ fk }) => fk.label || fk.cardinality),
  );
  const hasChecks = tables.some((t) => t.checks.length);
  const records = [
    [
      "図の名前",
      "出力日",
      ...names.map((name) => "テーブル" + name),
      "テーブル説明",
      ...(tables.some((t) => t.group !== undefined) ? ["グループ名"] : []),
      ...names.map((name) => "カラム" + name),
      ...columnAttributes,
      "カラム説明",
      "外部キー名",
      "ON DELETE",
      "ON UPDATE",
      "インデックス",
      "一意制約",
      "主キー",
      "外部キーの順序",
      ...(fkDetails ? ["関係の補足"] : []),
      ...(hasChecks ? ["CHECK 制約"] : []),
      ...(enums.length ? ["ENUM 型"] : []),
    ],
  ];
  for (const { info, columns, constraints, foreignKeys, checks } of tables) {
    const extra = (first: boolean) => [
      ...(hasChecks
        ? [first && checks.length ? JSON.stringify(checks) : ""]
        : []),
      ...(enums.length
        ? [records.length === 1 ? JSON.stringify(enums) : ""]
        : []),
    ];
    if (!columns.length) {
      const row = [title, day, ...info];
      const details = extra(true);
      records.push([
        ...row,
        ...Array(records[0].length - row.length - details.length).fill(""),
        ...details,
      ]);
    }
    for (const { id, cells, refs } of columns) {
      const memberships = (kind: "index" | "unique" | "primary") =>
        constraints
          .filter(({ key }) => key.kind === kind && key.columnIds.includes(id))
          .map(({ key, columns }) =>
            `${key.name ? typeName([key.name]) : ""} (${columns})`.trim(),
          )
          .join("\n");
      records.push([
        title,
        day,
        ...info,
        ...cells,
        foreignNames(refs.map(({ fk }) => fk.name)),
        refs.map(({ fk }) => fk.onDelete ?? "").join("\n"),
        refs.map(({ fk }) => fk.onUpdate ?? "").join("\n"),
        memberships("index"),
        memberships("unique"),
        memberships("primary"),
        refs
          .map(
            (ref) =>
              `${foreignKeys.indexOf(ref) + 1}.${ref.fk.columnIds.indexOf(id) + 1}`,
          )
          .join("\n"),
        ...(fkDetails
          ? [
              refs.length
                ? JSON.stringify(
                    refs.map(({ fk }) => ({
                      label: fk.label,
                      cardinality: fk.cardinality,
                    })),
                  )
                : "",
            ]
          : []),
        ...extra(id === columns[0].id),
      ]);
    }
  }
  return (
    "\uFEFF" +
    records.map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

export function tableDefinition(
  doc: DiagramDocument,
  format: "md" | "csv",
  logicalFirst = false,
  date = new Date(),
) {
  const tables = doc.schema.tables.map((table) =>
    describeTable(
      table,
      doc.schema.tables,
      logicalFirst,
      doc.presentation.groups?.length
        ? (doc.presentation.groups.find((g) => g.tableIds.includes(table.id))
            ?.name ?? "")
        : undefined,
      doc.ddlDialect,
    ),
  );
  const render = format === "md" ? markdown : csv;
  return render(
    doc.title || "無題の図",
    localDate(date),
    orderedNames("物理名", "論理名", logicalFirst),
    tables,
    doc.schema.enums ?? [],
  );
}
