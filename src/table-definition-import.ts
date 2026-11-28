import { statements, Tokens } from "./ddl-tokens.ts";
import { tidyDiagram } from "./layout.ts";
import { documentFromDiagram, uid } from "./model.ts";
import { registerEnum } from "./schema-constraints.ts";
import type {
  CheckConstraint,
  Diagram,
  EnumType,
  ForeignKey,
  KeyDefinition,
  Table,
} from "./types.ts";

type Row = Record<string, string>;
type KeyRow = { name: string; kind: KeyDefinition["kind"]; columns: string[] };
type Reference = {
  name: string;
  columns: string[];
  targets: string[][];
} & Pick<ForeignKey, "onDelete" | "onUpdate" | "label" | "cardinality">;
type Entry = {
  info: Row;
  columns: Row[];
  keys: KeyRow[];
  references: Reference[];
  checks: CheckConstraint[];
};

function entry(info: Row): Entry {
  return { info, columns: [], keys: [], references: [], checks: [] };
}
function invalid(): never {
  throw new Error("定義書の形式を確認してください。");
}
function tokens(text: string) {
  const parts = [...statements(text)];
  if (parts.length > 1) invalid();
  return new Tokens(parts[0] ?? []);
}
function paths(text: string) {
  const t = tokens(text);
  const result = [t.qualifiedName()];
  while (t.eat(",")) result.push(t.qualifiedName());
  t.end();
  return result;
}
const columnList = (s: string) =>
  paths(s).map((p) => (p.length === 1 ? p[0] : invalid()));
function reference(
  row: Row,
  columns: string[],
  targets: string[][],
  detail?: Partial<ForeignKey>,
): Reference {
  return {
    name: row["名前"],
    columns,
    targets,
    ...(row["ON DELETE"] && {
      onDelete: row["ON DELETE"] as ForeignKey["onDelete"],
    }),
    ...(row["ON UPDATE"] && {
      onUpdate: row["ON UPDATE"] as ForeignKey["onUpdate"],
    }),
    ...(detail?.label && { label: detail.label }),
    ...(detail?.cardinality && { cardinality: detail.cardinality }),
  };
}
function rows(cells: string[][]) {
  const [header, ...body] = cells;
  return body.map((values) => {
    if (values.length !== header.length) invalid();
    return Object.fromEntries(header.map((key, i) => [key, values[i]]));
  });
}
const decodeCell = (s: string) =>
  s
    .replaceAll("<br>", "\n")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replaceAll("&amp;", "&");

function markdown(source: string) {
  const lines = source.split(/\r?\n/);
  const tables: Entry[] = [],
    enums: EnumType[] = [];
  let current: Entry | undefined;
  let overview = true;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("| ")) continue;
    const cells: string[][] = [];
    for (; i < lines.length && lines[i].startsWith("| "); i++)
      cells.push(lines[i].slice(2, -2).split(" | ").map(decodeCell));
    i--;
    const [header, separator, ...values] = cells;
    if (!separator?.every((s) => s === "---")) invalid();
    const records = rows([header, ...values]);
    if (header.includes("値（順序）")) {
      for (const r of records)
        registerEnum(enums, {
          name: r["型名"],
          values: r["値（順序）"].startsWith("[")
            ? JSON.parse(r["値（順序）"])
            : r["値（順序）"].split(",").map((v) => v.trim()),
        });
    } else if (header.includes("物理名") && !header.includes("型")) {
      if (overview) {
        overview = false;
        continue;
      }
      if (records.length !== 1) invalid();
      current = entry(records[0]);
      tables.push(current);
    } else if (!current) invalid();
    else if (header.includes("型")) current.columns.push(...records);
    else if (header.includes("条件式"))
      current.checks.push(
        ...records.map((r) => ({ name: r["制約名"], expression: r["条件式"] })),
      );
    else if (header.includes("種類")) {
      const kinds = new Map<string, KeyDefinition["kind"]>([
        ["主キー", "primary"],
        ["一意制約", "unique"],
        ["インデックス", "index"],
      ]);
      for (const r of records)
        current.keys.push({
          kind: kinds.get(r["種類"]) ?? invalid(),
          name: r["名前"],
          columns: columnList(r["カラム"]),
        });
    } else if (header.includes("参照先"))
      for (const r of records)
        current.references.push(
          reference(
            r,
            columnList(r["カラム"]),
            paths(r["参照先"]),
            r["関係の補足"] && JSON.parse(r["関係の補足"]),
          ),
        );
  }
  return { tables, enums, title: decodeCell(lines[0].slice(2)) };
}

// A field may contain commas, escaped quotes and line breaks (including CRLF).
function csvRows(text: string) {
  const records: string[][] = [];
  const field = /(?:"((?:""|[^"])*)"|([^",\r\n]*))(,|\r\n|\n|$)/y;
  let row: string[] = [];
  while (field.lastIndex < text.length) {
    const match = field.exec(text);
    if (!match) invalid();
    const cell =
      match[1] === undefined ? match[2] : match[1].replaceAll('""', '"');
    row.push(/^'+\s*[=+@-]/.test(cell) ? cell.slice(1) : cell);
    if (match[3] !== ",") {
      records.push(row);
      row = [];
    }
  }
  if (row.length) {
    row.push("");
    records.push(row);
  }
  return rows(records);
}

function csv(source: string) {
  const tables = new Map<string, Entry>(),
    enums: EnumType[] = [];
  let title = "";
  for (const r of csvRows(source)) {
    const name = r["テーブル物理名"],
      col = r["カラム物理名"];
    if (!name || col === undefined) invalid();
    title ||= r["図の名前"];
    const t =
      tables.get(name) ??
      entry({
        物理名: name,
        論理名: r["テーブル論理名"],
        説明: r["テーブル説明"],
        グループ名: r["グループ名"],
      });
    tables.set(name, t);
    if (r["ENUM 型"])
      for (const e of JSON.parse(r["ENUM 型"])) registerEnum(enums, e);
    if (r["CHECK 制約"]) t.checks.push(...JSON.parse(r["CHECK 制約"]));
    if (!col) continue;
    t.columns.push({
      ...r,
      物理名: col,
      論理名: r["カラム論理名"],
      説明: r["カラム説明"],
    });
    for (const [kind, heading] of [
      ["index", "インデックス"],
      ["unique", "一意制約"],
      ["primary", "主キー"],
    ] as const) {
      const list = tokens(r[heading] ?? "");
      while (list.current) {
        const name = list.keyword === "(" ? "" : list.name();
        const columns = list.names();
        if (columns[0] === col) t.keys.push({ kind, name, columns });
      }
    }
    if (!r["FK 参照先"]) continue;
    if (!r["外部キーの順序"])
      throw new Error(
        "この CSV に外部キーの順序がありません。元の図から定義書を保存し直してください。",
      );
    const mappings = r["外部キーの順序"].split("\n");
    const details = r["関係の補足"] ? JSON.parse(r["関係の補足"]) : [];
    const names = r["外部キー名"].startsWith("[")
      ? JSON.parse(r["外部キー名"])
      : r["外部キー名"].split("\n");
    const targets = tokens(r["FK 参照先"]);
    for (const [i, order] of mappings.entries()) {
      if (!/^[1-9]\d{0,2}\.[1-9]\d?$/.test(order)) invalid();
      const [group, position] = order.split(".").map(Number);
      const fk = (t.references[group - 1] ??= reference(
        {
          名前: names[i] ?? "",
          "ON DELETE": r["ON DELETE"].split("\n")[i],
          "ON UPDATE": r["ON UPDATE"].split("\n")[i],
        },
        [],
        [],
        details[i],
      ));
      if (fk.columns[position - 1] !== undefined) invalid();
      fk.columns[position - 1] = col;
      fk.targets[position - 1] = targets.qualifiedName();
    }
    targets.end();
  }
  return { tables: [...tables.values()], enums, title };
}

export function importTableDefinition(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  const {
    title,
    tables: entries,
    enums,
  } = source.startsWith("# ") ? markdown(source) : csv(source);
  if (!entries.length) throw new Error("定義書にテーブルがありません。");
  const diagram: Diagram = { title, enums, tables: [], edges: [] };
  const groups = new Map<string, string[]>();
  const ids = (t: Table, names: string[]) =>
    names.map((n) => t.columns.find((c) => c.name === n)?.id ?? invalid());
  for (const record of entries) {
    const info = record.info;
    const tableNames = paths(info["物理名"]);
    const [path] = tableNames;
    if (tableNames.length !== 1 || path.length > 2) invalid();
    const t: Table = {
      id: uid(),
      name: path.at(-1)!,
      schemaName: path.at(-2),
      logicalName: info["論理名"],
      note: info["説明"],
      x: 0,
      y: 0,
      keys: [],
      foreignKeys: [],
      checks: record.checks,
      columns: record.columns.map((r) => {
        const generation = r["自動採番"];
        const mode = /^IDENTITY (ALWAYS|BY DEFAULT)(?: \(([\s\S]*)\))?$/.exec(
          generation,
        );
        if (generation && generation !== "SERIAL" && !mode) invalid();
        return {
          id: uid(),
          name: r["物理名"],
          logicalName: r["論理名"],
          type: r["型"],
          key: "",
          note: r["説明"],
          defaultValue: r["既定値"] || undefined,
          notNull: r["NN"] === "○",
          identity: mode
            ? mode[1] === "ALWAYS"
              ? "always"
              : "byDefault"
            : undefined,
          identityOptions: mode?.[2],
        };
      }),
    };
    diagram.tables.push(t);
    const keys = record.keys;
    if (!keys.some((k) => k.kind === "primary")) {
      const columns = record.columns
        .filter((r) => r["PK"] === "○")
        .map((r) => r["物理名"]);
      if (columns.length) keys.push({ name: "", kind: "primary", columns });
    }
    t.keys = keys.map((k) => ({
      id: uid(),
      kind: k.kind,
      name: k.name,
      columnIds: ids(t, k.columns),
    }));
    if (info["グループ名"]) {
      const group = groups.get(info["グループ名"]) ?? [];
      group.push(t.id);
      groups.set(info["グループ名"], group);
    }
  }
  for (const [i, record] of entries.entries()) {
    const t = diagram.tables[i];
    for (const ref of record.references) {
      if (!ref) invalid();
      const { columns, targets, ...fk } = ref;
      if (
        Array.from(targets).some((p) => !p) ||
        Array.from(columns).some((c) => !c)
      )
        invalid();
      const columnIds = ids(t, columns);
      if (targets.every((p) => p.length === 1 && p[0] === "未設定")) {
        t.foreignKeys.push({ ...fk, id: uid(), columnIds });
        continue;
      }
      const path = targets[0].slice(0, -1);
      const target = diagram.tables.find(
        (p) => p.name === path.at(-1) && p.schemaName === path.at(-2),
      );
      if (
        !target ||
        targets.some(
          (p) => JSON.stringify(p.slice(0, -1)) !== JSON.stringify(path),
        )
      )
        invalid();
      t.foreignKeys.push({
        ...fk,
        id: uid(),
        columnIds,
        target: {
          tableId: target.id,
          columnIds: ids(
            target,
            targets.map((p) => p.at(-1)!),
          ),
        },
      });
    }
  }
  diagram.groups = [...groups].map(([name, tableIds]) => ({
    id: uid(),
    name,
    tableIds,
  }));
  return documentFromDiagram(tidyDiagram(diagram));
}
