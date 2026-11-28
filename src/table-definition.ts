import { serialBase } from "./column-attributes.ts";
import { localDate } from "./export.ts";
import type { Column, DiagramDocument, TableSchema } from "./types.ts";

const physicalName = (table: TableSchema) =>
  [table.schemaName, table.name].filter(Boolean).join(".");
const columnName = (table: TableSchema, id: string) =>
  table.columns.find((column) => column.id === id)!.name;

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
  if (/^\s*[=+@-]/u.test(text) && !/^[+-]?\d+(\.\d+)?$/.test(text))
    text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
  const constraints = table.keys
    .filter((key) => key.kind !== "primary")
    .map((key) => ({
      key,
      columns: key.columnIds.map((id) => columnName(table, id)).join(", "),
    }));
  const primary = table.keys.find((key) => key.kind === "primary");
  const columns = table.columns.map((column) => {
    const refs = foreignKeys.filter(({ fk }) =>
      fk.columnIds.includes(column.id),
    );
    const cells = [
      ...orderedNames(column.name, column.logicalName, logicalFirst),
      column.type,
      primary?.columnIds.includes(column.id) ? "○" : "",
      column.notNull ? "○" : "",
      column.defaultValue ?? "",
      autoNumber(column),
      refs
        .map(({ fk, targets }) => targets[fk.columnIds.indexOf(column.id)])
        .join("\n"),
      column.note ?? "",
    ];
    return { id: column.id, cells, refs };
  });
  return { info, group, columns, foreignKeys, constraints };
}
type Definition = ReturnType<typeof describeTable>;

function markdown(
  title: string,
  day: string,
  names: string[],
  tables: Definition[],
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
  for (const { info, columns, foreignKeys, constraints } of tables) {
    sections.push(
      `## ${markdownText(info[0] || info[1])}`,
      markdownTable(tableHeaders, [info]),
      "### カラム",
      markdownTable(
        [...names, ...columnAttributes, "説明"],
        columns.map((column) => column.cells),
      ),
    );
    if (foreignKeys.length)
      sections.push(
        "### 外部キー",
        markdownTable(
          ["名前", "カラム", "参照先", "ON DELETE", "ON UPDATE"],
          foreignKeys.map(({ fk, columns, targets }) => [
            fk.name,
            columns,
            targets.join(", "),
            fk.onDelete ?? "",
            fk.onUpdate ?? "",
          ]),
        ),
      );
    if (constraints.length)
      sections.push(
        "### インデックス・一意制約",
        markdownTable(
          ["種類", "名前", "カラム"],
          constraints.map(({ key, columns }) => [
            key.kind === "index" ? "インデックス" : "一意制約",
            key.name,
            columns,
          ]),
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
) {
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
    ],
  ];
  for (const { info, group, columns, constraints } of tables) {
    if (!columns.length && group !== undefined) {
      const row = [title, day, ...info];
      records.push([...row, ...Array(records[0].length - row.length).fill("")]);
    }
    for (const { id, cells, refs } of columns) {
      const memberships = (kind: "index" | "unique") =>
        constraints
          .filter(({ key }) => key.kind === kind && key.columnIds.includes(id))
          .map(({ key, columns }) => `${key.name} (${columns})`.trim())
          .join("\n");
      records.push([
        title,
        day,
        ...info,
        ...cells,
        refs.map(({ fk }) => fk.name).join("\n"),
        refs.map(({ fk }) => fk.onDelete ?? "").join("\n"),
        refs.map(({ fk }) => fk.onUpdate ?? "").join("\n"),
        memberships("index"),
        memberships("unique"),
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
    ),
  );
  const render = format === "md" ? markdown : csv;
  return render(
    doc.title || "無題の図",
    localDate(date),
    orderedNames("物理名", "論理名", logicalFirst),
    tables,
  );
}
