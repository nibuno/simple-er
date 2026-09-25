import type {
  Diagram,
  Table,
  Column,
  Endpoint,
  Edge,
  Candidate,
} from "./types.ts";
import { tableWidth } from "./geometry.ts";

export const uid = () => crypto.randomUUID();
export const title = (table: Table) => table.name ?? table.id;
function fail(message: string): never {
  throw new Error(message);
}
const boundedText = (value: unknown, max = 80): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const coordinate = (value: unknown) =>
  Number.isFinite(value) && Math.abs(value as number) <= 50000;
const validId = (value: unknown) =>
  boundedText(value) && /^[A-Za-z0-9_-]+$/.test(value);
const logicalName = (value: unknown) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 80)
    fail("論理名は80文字以内にしてください。");
  return value.trim();
};
const keys = ["", "PK", "FK", "PK,FK"];

// Column IDs remain stable when names or ordering change. Row indexes are only
// the renderer's coordinates and are remapped when a table is edited.
export function validateDiagram(input: unknown): Diagram {
  const value = input as Diagram;
  if (!value || !Array.isArray(value.tables) || !Array.isArray(value.edges))
    fail("ER図のデータ形式が正しくありません。");
  if (value.tables.length > 40 || value.edges.length > 200)
    fail("読み込める上限は40テーブル・200接続です。");
  const tableIds = new Set(),
    names = new Set(),
    edgeIds = new Set();
  const tables = value.tables.map((t) => {
    if (
      !t ||
      !validId(t.id) ||
      tableIds.has(t.id) ||
      !boundedText(title(t)) ||
      names.has(title(t).trim().toLowerCase()) ||
      !coordinate(t.x) ||
      !coordinate(t.y)
    )
      fail("テーブル名・ID・位置が不正、または重複しています。");
    if (!Array.isArray(t.columns) || !t.columns.length || t.columns.length > 60)
      fail("カラム数は1〜60個にしてください。");
    tableIds.add(t.id);
    names.add(title(t).trim().toLowerCase());
    const columnIds = new Set(),
      columnNames = new Set();
    const columns: Column[] = t.columns.map((c, i): Column => {
      if (
        !Array.isArray(c) ||
        !boundedText(c[0]) ||
        !boundedText(c[1], 40) ||
        !keys.includes(c[2]) ||
        columnNames.has(c[0].trim().toLowerCase())
      )
        fail("カラム名・型・キーが不正、または重複しています。");
      const id = c[3] ?? `${t.id}:column:${i}`;
      if (!boundedText(id, 180) || columnIds.has(id))
        fail("カラムIDが不正、または重複しています。");
      columnIds.add(id);
      columnNames.add(c[0].trim().toLowerCase());
      return [c[0].trim(), c[1].trim(), c[2], id, logicalName(c[4])];
    });
    return {
      id: t.id,
      name: title(t).trim(),
      logicalName: logicalName(t.logicalName),
      x: t.x,
      y: t.y,
      columns,
    };
  });
  const edges = value.edges.map((e) => {
    if (!e || !boundedText(e.id) || edgeIds.has(e.id))
      fail("接続IDが不正です。");
    edgeIds.add(e.id);
    for (const p of [e.from, e.to]) {
      const t = tables.find((t) => t.id === p?.table);
      if (
        !t ||
        !Number.isInteger(p.row) ||
        p.row < 0 ||
        p.row >= t.columns.length ||
        !["left", "right"].includes(p.side)
      )
        fail("存在しないカラムへの接続があります。");
    }
    if (e.from.table === e.to.table)
      fail("自己参照の接続はまだ対応していません。");
    if (e.trunk != null && !coordinate(e.trunk)) fail("線の位置が不正です。");
    return {
      id: e.id,
      from: { table: e.from.table, row: e.from.row, side: e.from.side },
      to: { table: e.to.table, row: e.to.row, side: e.to.side },
      trunk: e.trunk ?? null,
      manual: !!e.manual,
    };
  });
  return { tables, edges };
}

export function encode(diagram: Diagram) {
  return JSON.stringify(
    { format: "er-sketch", version: 1, diagram: validateDiagram(diagram) },
    null,
    2,
  );
}
export function decode(text: string) {
  if (text.length > 2_000_000) fail("ファイルが大きすぎます（上限2MB）。");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("JSONファイルとして読み取れません。");
  }
  if (data?.format !== "er-sketch" || data.version !== 1)
    fail("対応していない形式です。ERスケッチで保存したJSONを選んでください。");
  return validateDiagram(data.diagram);
}

export function editTable(diagram: Diagram, replacement: Table) {
  const previous = diagram.tables.find((t) => t.id === replacement.id);
  const tables = previous
    ? diagram.tables.map((t) => (t.id === replacement.id ? replacement : t))
    : [...diagram.tables, replacement];
  const edges = diagram.edges.flatMap((edge) => {
    const copy = structuredClone(edge);
    for (const side of ["from", "to"] as const) {
      if (copy[side].table !== replacement.id || !previous) continue;
      const id = previous.columns[copy[side].row][3];
      const row = replacement.columns.findIndex((c) => c[3] === id);
      if (row < 0) return [];
      copy[side].row = row;
    }
    return [copy];
  });
  return validateDiagram({ tables, edges });
}

export function canConnect(diagram: Diagram, from: Endpoint, to: Endpoint) {
  const a = diagram.tables.find((t) => t.id === from.table)?.columns[from.row];
  const b = diagram.tables.find((t) => t.id === to.table)?.columns[to.row];
  return !!(
    a &&
    b &&
    from.table !== to.table &&
    ((a[2].includes("PK") && b[2].includes("FK")) ||
      (a[2].includes("FK") && b[2].includes("PK")))
  );
}
export function makeEdge(diagram: Diagram, from: Endpoint, to: Endpoint): Edge {
  if (!canConnect(diagram, from, to))
    fail("主キー（PK）と外部キー（FK）の組み合わせを選んでください。");
  const a = diagram.tables.find((t) => t.id === from.table)!,
    b = diagram.tables.find((t) => t.id === to.table)!,
    right = a.x <= b.x;
  return {
    id: uid(),
    from: { ...from, side: right ? "right" : "left" },
    to: { ...to, side: right ? "left" : "right" },
    trunk: (a.x + tableWidth(a) / 2 + b.x + tableWidth(b) / 2) / 2,
    manual: false,
  };
}
const typeFamily = (type: string) =>
  (
    ({
      int: "integer",
      int4: "integer",
      bool: "boolean",
      int8: "bigint",
    }) as Record<string, string>
  )[type.toLowerCase()] ?? type.toLowerCase();
const singular = (name: string) =>
  name.endsWith("ies")
    ? name.slice(0, -3) + "y"
    : name.endsWith("s") && !name.endsWith("ss")
      ? name.slice(0, -1)
      : name;

export function inferConnections(diagram: Diagram) {
  const candidates: Candidate[] = [],
    skipped: string[] = [];
  for (const child of diagram.tables)
    child.columns.forEach((column, row) => {
      const match = column[0].toLowerCase().match(/^(.+)_id$/);
      if (!match) return;
      const endpoint = { table: child.id, row };
      if (
        diagram.edges.some((e) =>
          [e.from, e.to].some((p) => p.table === child.id && p.row === row),
        )
      )
        return;
      const parents = diagram.tables.filter(
        (t) =>
          t.id !== child.id &&
          [title(t).toLowerCase(), singular(title(t).toLowerCase())].includes(
            match[1],
          ),
      );
      const label = `${title(child)}.${column[0]}`;
      if (parents.length !== 1) {
        skipped.push(
          `${label}：${parents.length ? "候補が複数あります" : "対応するテーブルがありません"}`,
        );
        return;
      }
      const parent = parents[0],
        pks = parent.columns
          .map((c, i) => (c[2].includes("PK") ? i : -1))
          .filter((i) => i >= 0);
      if (pks.length !== 1) {
        skipped.push(`${label}：参照先の主キーを1つに特定できません`);
        return;
      }
      const pk = pks[0];
      if (typeFamily(column[1]) !== typeFamily(parent.columns[pk][1])) {
        skipped.push(`${label}：主キーと型が一致しません`);
        return;
      }
      candidates.push({
        from: { table: parent.id, row: pk },
        to: endpoint,
        label: `${label} → ${title(parent)}.${parent.columns[pk][0]}`,
      });
    });
  return { candidates, skipped };
}
