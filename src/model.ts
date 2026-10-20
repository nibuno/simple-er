import type {
  Diagram,
  Table,
  RenderColumn,
  Endpoint,
  Edge,
  Candidate,
  DiagramDocument,
  TablePosition,
  RoutePresentation,
} from "./types.ts";
import { tableWidth, connectionSides } from "./geometry.ts";

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
    const columns: RenderColumn[] = t.columns.map((c, i): RenderColumn => {
      if (
        !c ||
        Array.isArray(c) ||
        !boundedText(c.name) ||
        !boundedText(c.type, 40) ||
        !keys.includes(c.key) ||
        columnNames.has(c.name.trim().toLowerCase())
      )
        fail("カラム名・型・キーが不正、または重複しています。");
      const id = c.id ?? `${t.id}:column:${i}`;
      if (!boundedText(id, 180) || columnIds.has(id))
        fail("カラムIDが不正、または重複しています。");
      columnIds.add(id);
      columnNames.add(c.name.trim().toLowerCase());
      return {
        name: c.name.trim(),
        type: c.type.trim(),
        key: c.key,
        id,
        logicalName: logicalName(c.logicalName),
      };
    });
    return {
      id: t.id,
      name: title(t).trim(),
      logicalName: logicalName(t.logicalName),
      x: t.x,
      y: t.y,
      columns,
      keys: structuredClone(t.keys),
      foreignKeys: structuredClone(t.foreignKeys),
    };
  });
  const edges = value.edges.map((e) => {
    if (!e || !boundedText(e.id, 200) || edgeIds.has(e.id))
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

    if (e.trunk != null && !coordinate(e.trunk)) fail("線の位置が不正です。");
    return {
      id: e.id,
      ...(e.foreignKeyId ? { foreignKeyId: e.foreignKeyId } : {}),
      from: { table: e.from.table, row: e.from.row, side: e.from.side },
      to: { table: e.to.table, row: e.to.row, side: e.to.side },
      trunk: e.trunk ?? null,
      manual: !!e.manual,
    };
  });
  return normalizeRelations({ ...value, tables, edges });
}

/** The only tuple-column boundary: version 1 import. Never returns tuples. */
export function migrateLegacyDiagram(input: unknown): Diagram {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray((input as { tables?: unknown }).tables)
  )
    fail("ER図のデータ形式が正しくありません。");
  const value = input as {
    tables: { columns?: unknown[] }[];
    edges?: unknown[];
  };
  return validateDiagram({
    ...value,
    tables: value.tables.map((table) => ({
      ...table,
      columns: Array.isArray(table?.columns)
        ? table.columns.map((column) => {
            if (!Array.isArray(column)) fail("旧形式のカラムが不正です。");
            return {
              name: column[0],
              type: column[1],
              key: column[2],
              id: column[3],
              logicalName: column[4],
            };
          })
        : table?.columns,
    })),
  });
}

/** Extract the only authoritative data from a validated rendering projection. */
export function documentFromDiagram(diagram: Diagram): DiagramDocument {
  const valid = validateDiagram(diagram);
  return {
    format: "er-sketch",
    version: 2,
    schema: {
      tables: valid.tables.map((t) => ({
        id: t.id,
        name: t.name,
        logicalName: t.logicalName,
        keys: structuredClone(t.keys),
        foreignKeys: structuredClone(t.foreignKeys),
        columns: t.columns.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          logicalName: c.logicalName,
        })),
      })),
    },
    presentation: {
      tables: valid.tables.map((t) => ({ tableId: t.id, x: t.x, y: t.y })),
      routes: valid.edges.map((e) => ({
        foreignKeyId: e.foreignKeyId!,
        columnId: valid.tables.find((t) => t.id === e.to.table)!.columns[
          e.to.row
        ].id,
        fromSide: e.from.side,
        toSide: e.to.side,
        trunk: e.trunk,
        manual: e.manual,
      })),
    },
    unresolvedEdges: structuredClone(valid.unresolvedEdges ?? []),
  };
}

/** Rebuild disposable rows, badges and edges; never mutates the document. */
export function projectDocument(document: DiagramDocument): Diagram {
  if (
    !document ||
    document.format !== "er-sketch" ||
    document.version !== 2 ||
    !Array.isArray(document.schema?.tables) ||
    !Array.isArray(document.presentation?.tables) ||
    !Array.isArray(document.presentation?.routes)
  )
    fail("保存データの定義または表示情報が不正です。");
  const positions = new Map<string, TablePosition>();
  for (const p of document.presentation.tables) {
    if (
      !p ||
      !validId(p.tableId) ||
      positions.has(p.tableId) ||
      !coordinate(p.x) ||
      !coordinate(p.y)
    )
      fail("テーブルの表示情報が不正または重複しています。");
    positions.set(p.tableId, p);
  }
  if (positions.size !== document.schema.tables.length)
    fail("テーブルの表示情報が一致しません。");
  const tables = document.schema.tables.map((t) => {
    const pos = t && positions.get(t.id);
    if (!pos || !Array.isArray(t.columns))
      fail("テーブルの表示情報がありません。");
    return {
      id: t.id,
      name: t.name,
      logicalName: t.logicalName,
      keys: t.keys,
      foreignKeys: t.foreignKeys,
      x: pos.x,
      y: pos.y,
      columns: t.columns.map((c) => {
        if (!c || Array.isArray(c) || !boundedText(c.id, 180))
          fail("カラムIDが不正です。");
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          logicalName: c.logicalName,
          key: "",
        };
      }),
    };
  });
  const valid = validateDiagram({
    schemaVersion: 2,
    tables,
    edges: [],
    unresolvedEdges: document.unresolvedEdges ?? [],
  });
  const routes = new Map<string, RoutePresentation>();
  for (const r of document.presentation.routes) {
    if (
      !r ||
      !boundedText(r.foreignKeyId, 180) ||
      !boundedText(r.columnId, 180) ||
      !["left", "right"].includes(r.fromSide) ||
      !["left", "right"].includes(r.toSide) ||
      (r.trunk !== null && !coordinate(r.trunk)) ||
      typeof r.manual !== "boolean"
    )
      fail("線の表示情報が不正です。");
    const key = JSON.stringify([r.foreignKeyId, r.columnId]);
    if (routes.has(key)) fail("線の表示情報が重複しています。");
    routes.set(key, r);
  }
  for (const edge of valid.edges) {
    const columnId = valid.tables.find((t) => t.id === edge.to.table)!.columns[
      edge.to.row
    ].id;
    const key = JSON.stringify([edge.foreignKeyId, columnId]);
    const r = routes.get(key);
    if (r) {
      // Automatic sides follow current table positions. Preserve the legacy trunk
      // value even on automatic routes so existing v2 files round-trip exactly.
      if (r.manual) {
        edge.from.side = r.fromSide;
        edge.to.side = r.toSide;
      }
      edge.trunk = r.trunk;
      edge.manual = r.manual;
      routes.delete(key);
    }
  }
  if (routes.size) fail("存在しない外部キーまたはカラムの経路があります。");
  return valid;
}

/** Internal saves take a canonical document directly, with no derived data. */
export function encodeDocument(document: DiagramDocument): string {
  return JSON.stringify(document, null, 2);
}

/** Compatibility entry point for callers that manipulate an editing projection. */
export function encode(diagram: Diagram): string {
  return encodeDocument(documentFromDiagram(diagram));
}

export function decodeDocument(text: string): DiagramDocument {
  if (text.length > 2_000_000) fail("ファイルが大きすぎます（上限2MB）。");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("JSONファイルとして読み取れません。");
  }
  if (data?.format !== "er-sketch" || ![1, 2].includes(data.version))
    fail("対応していない形式です。ERスケッチで保存したJSONを選んでください。");
  if (data.version === 1)
    return documentFromDiagram(migrateLegacyDiagram(data.diagram));
  return documentFromDiagram(projectDocument(data));
}

export function decode(text: string): Diagram {
  return projectDocument(decodeDocument(text));
}

function hasTargetKey(tables: Table[], fk: import("./types.ts").ForeignKey) {
  const target = fk.target;
  const parent = tables.find((t) => t.id === target?.tableId);
  return (
    !!target &&
    !!parent &&
    target.columnIds.every((id) => parent.columns.some((c) => c.id === id)) &&
    !!parent.keys?.some(
      (k) =>
        k.kind !== "index" &&
        JSON.stringify(k.columnIds) === JSON.stringify(target.columnIds),
    )
  );
}

export function referenceImpacts(diagram: Diagram, replacement: Table) {
  const tables = diagram.tables.map((t) =>
    t.id === replacement.id ? replacement : t,
  );
  return tables.flatMap((t) =>
    (t.foreignKeys ?? [])
      .filter(
        (f) =>
          f.target?.tableId === replacement.id &&
          f.columnIds.every((id) => t.columns.some((c) => c.id === id)) &&
          !hasTargetKey(tables, f),
      )
      .map((f) => ({ table: t, foreignKey: f })),
  );
}

export function editTable(diagram: Diagram, replacement: Table) {
  const previous = diagram.tables.find((t) => t.id === replacement.id);
  const tables = structuredClone(
    previous
      ? diagram.tables.map((t) => (t.id === replacement.id ? replacement : t))
      : [...diagram.tables, replacement],
  );
  const edges = diagram.edges.flatMap((edge) => {
    const copy = structuredClone(edge);
    for (const side of ["from", "to"] as const) {
      if (copy[side].table !== replacement.id || !previous) continue;
      const id = previous.columns[copy[side].row].id;
      const row = replacement.columns.findIndex((c) => c.id === id);
      if (row < 0) return [];
      copy[side].row = row;
    }
    return [copy];
  });
  // Removing a column removes its whole constraint, never part of a composite key.
  for (const t of tables) {
    const old = diagram.tables.find((old) => old.id === t.id);
    const removed = new Set(
      old?.columns
        .filter((c) => !t.columns.some((n) => n.id === c.id))
        .map((c) => c.id),
    );
    const exists = (id: string) => !removed.has(id);
    t.keys = t.keys?.filter((k) => k.columnIds.every(exists));
    t.foreignKeys = t.foreignKeys?.filter((f) => f.columnIds.every(exists));
  }
  // Preserve the relationship intent when an existing referenced key disappears.
  for (const t of tables) {
    for (const f of t.foreignKeys ?? []) {
      const old = diagram.tables
        .find((p) => p.id === t.id)
        ?.foreignKeys?.find((p) => p.id === f.id);
      if (
        old?.target &&
        JSON.stringify(old.target) === JSON.stringify(f.target) &&
        f.target?.tableId === replacement.id &&
        !hasTargetKey(tables, f)
      ) {
        delete f.target;
      }
    }
  }
  const retainedEdges = edges.filter((e) => {
    const before = diagram.tables
      .flatMap((t) => t.foreignKeys ?? [])
      .find((f) => f.id === e.foreignKeyId);
    const after = tables
      .flatMap((t) => t.foreignKeys ?? [])
      .find((f) => f.id === e.foreignKeyId);
    return JSON.stringify(before?.target) === JSON.stringify(after?.target);
  });
  return validateDiagram({ ...diagram, tables, edges: retainedEdges });
}

export function canConnect(diagram: Diagram, from: Endpoint, to: Endpoint) {
  const a = diagram.tables.find((t) => t.id === from.table);
  const b = diagram.tables.find((t) => t.id === to.table);
  return !!(
    a?.columns[from.row] &&
    b?.columns[to.row] &&
    !(from.table === to.table && from.row === to.row) &&
    a.keys?.some(
      (k) =>
        k.kind !== "index" &&
        k.columnIds.length === 1 &&
        k.columnIds[0] === a.columns[from.row].id,
    )
  );
}
// Mutates only the caller-owned draft. First endpoint is the referenced key;
// second is the referencing column. Commit validates and derives all lines.
export function makeEdge(diagram: Diagram, from: Endpoint, to: Endpoint): Edge {
  if (!canConnect(diagram, from, to)) {
    if (canConnect(diagram, to, from)) [from, to] = [to, from];
    else
      fail(
        "参照先の単一カラムの主キー・一意制約を選んでください。複合キーは編集画面で設定してください。",
      );
  }
  const parent = diagram.tables.find((t) => t.id === from.table)!;
  const child = diagram.tables.find((t) => t.id === to.table)!;
  child.foreignKeys ??= [];
  const pending = child.foreignKeys.filter(
    (f) =>
      !f.target &&
      f.columnIds.length === 1 &&
      f.columnIds[0] === child.columns[to.row].id,
  );
  if (pending.length > 1)
    fail(
      "参照先未設定の外部キーが複数あります。「要確認」から設定する外部キーを選んでください。",
    );
  const target = {
    tableId: parent.id,
    columnIds: [parent.columns[from.row].id],
  };
  const id = pending[0]?.id ?? uid();
  if (pending[0]) pending[0].target = target;
  else
    child.foreignKeys.push({
      id,
      name: "",
      columnIds: [child.columns[to.row].id],
      target,
    });
  child.columns[to.row].key = child.columns[to.row].key.includes("PK")
    ? "PK,FK"
    : "FK";
  return {
    id: `${id}:0`,
    foreignKeyId: id,
    from: { ...from, side: "right" },
    to: { ...to, side: parent.id === child.id ? "right" : "left" },
    trunk: null,
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
      const match = column.name.toLowerCase().match(/^(.+)_id$/);
      if (!match) return;
      if (
        (child.foreignKeys ?? []).filter(
          (f) =>
            !f.target &&
            f.columnIds.length === 1 &&
            f.columnIds[0] === column.id,
        ).length > 1
      ) {
        skipped.push(
          `${title(child)}.${column.name}：参照先未設定の外部キーが複数あります。「要確認」から設定してください。`,
        );
        return;
      }
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
      const label = `${title(child)}.${column.name}`;
      if (parents.length !== 1) {
        skipped.push(
          `${label}：${parents.length ? "候補が複数あります" : "対応するテーブルがありません"}`,
        );
        return;
      }
      const parent = parents[0],
        pks = (
          parent.keys?.find((k) => k.kind === "primary")?.columnIds ?? []
        ).map((id) => parent.columns.findIndex((c) => c.id === id));
      if (pks.length !== 1) {
        skipped.push(`${label}：参照先の主キーを1つに特定できません`);
        return;
      }
      const pk = pks[0];
      if (typeFamily(column.type) !== typeFamily(parent.columns[pk].type)) {
        skipped.push(`${label}：主キーと型が一致しません`);
        return;
      }
      candidates.push({
        from: { table: parent.id, row: pk },
        to: endpoint,
        label: `${label} → ${title(parent)}.${parent.columns[pk].name}`,
      });
    });
  return { candidates, skipped };
}

function prepareRelations(diagram: Diagram) {
  const { tables } = diagram;
  if (diagram.schemaVersion != null && diagram.schemaVersion !== 2)
    fail("未対応のモデル形式です。");
  // Explicit FK definitions already identify the current model, even if a caller
  // omitted its version marker. Never infer a second set from derived edges.
  const legacy =
    diagram.schemaVersion !== 2 &&
    !tables.some((t) => t.foreignKeys !== undefined);
  if (
    diagram.unresolvedEdges != null &&
    (!Array.isArray(diagram.unresolvedEdges) ||
      diagram.unresolvedEdges.length > 200)
  )
    fail("未確定の線の形式が不正です。");
  const unresolved = legacy
    ? []
    : structuredClone(diagram.unresolvedEdges ?? []);
  for (const e of unresolved) {
    if (!e || !boundedText(e.id)) fail("未確定の線のIDが不正です。");
    for (const p of [e.from, e.to])
      if (
        !p ||
        !boundedText(p.table) ||
        !Number.isInteger(p.row) ||
        p.row < 0 ||
        p.row >= 60 ||
        !["left", "right"].includes(p.side)
      )
        fail("未確定の線の端点が不正です。");
    if (e.trunk != null && !coordinate(e.trunk))
      fail("未確定の線の位置が不正です。");
  }
  for (const t of tables) {
    if (legacy && !t.keys) {
      const ids = t.columns
        .filter((c) => c.key.includes("PK"))
        .map((c) => c.id);
      t.keys = ids.length
        ? [{ id: `${t.id}:pk`, name: "", kind: "primary", columnIds: ids }]
        : [];
    }
    t.keys ??= [];
    t.foreignKeys = structuredClone(t.foreignKeys ?? []);
  }
  if (legacy) {
    for (const e of diagram.edges) {
      const directions = [
        [e.from, e.to],
        [e.to, e.from],
      ].filter(([a, b]) => {
        const parent = tables.find((t) => t.id === a.table)!;
        const child = tables.find((t) => t.id === b.table)!;
        return (
          parent.keys!.some(
            (k) =>
              k.kind === "primary" &&
              k.columnIds.length === 1 &&
              k.columnIds[0] === parent.columns[a.row].id,
          ) && child.columns[b.row].key.includes("FK")
        );
      });
      if (directions.length !== 1) {
        unresolved.push(e);
        continue;
      }
      const [a, b] = directions[0],
        child = tables.find((t) => t.id === b.table)!,
        parent = tables.find((t) => t.id === a.table)!;
      child.foreignKeys!.push({
        id: e.id,
        name: "",
        columnIds: [child.columns[b.row].id],
        target: { tableId: a.table, columnIds: [parent.columns[a.row].id] },
      });
      if (e.from !== a) [e.from, e.to] = [e.to, e.from];
      e.foreignKeyId = e.id;
    }
    for (const t of tables)
      for (const c of t.columns)
        if (
          c.key.includes("FK") &&
          !t.foreignKeys!.some((f) => f.columnIds.includes(c.id))
        )
          t.foreignKeys!.push({
            id: `${t.id}:pending:${t.columns.indexOf(c)}`,
            name: "",
            columnIds: [c.id],
          });
  }
  return { tables, unresolved };
}

function normalizeRelations(diagram: Diagram): Diagram {
  const { tables, unresolved } = prepareRelations(diagram);
  validateConstraints(tables);
  const edges = deriveEdges(tables, diagram.edges);
  recomputeKeyFlags(tables);
  return { schemaVersion: 2, tables, edges, unresolvedEdges: unresolved };
}

function validateConstraints(tables: Table[]) {
  const ids = new Set<string>();
  function identity(id: string, name: string) {
    if (
      !boundedText(id, 180) ||
      ids.has(id) ||
      typeof name !== "string" ||
      name.length > 80
    )
      fail("制約・インデックスのIDまたは名前が不正です。");
    ids.add(id);
  }
  function columns(t: Table, list: string[]) {
    if (
      !Array.isArray(list) ||
      !list.length ||
      new Set(list).size !== list.length ||
      list.some((id) => !t.columns.some((c) => c.id === id))
    )
      fail("制約に存在しないカラム、重複、空の指定があります。");
  }
  for (const t of tables) {
    if (
      !Array.isArray(t.keys) ||
      !Array.isArray(t.foreignKeys) ||
      t.keys.length + t.foreignKeys.length > 200
    )
      fail("制約の形式または件数が不正です。");
    if (t.keys.filter((k) => k.kind === "primary").length > 1)
      fail("主キーはテーブルに1つだけ設定できます。");
    for (const k of t.keys) {
      identity(k.id, k.name);
      columns(t, k.columnIds);
      if (!["primary", "unique", "index"].includes(k.kind))
        fail("キーの種類が不正です。");
    }
    for (const f of t.foreignKeys) {
      identity(f.id, f.name);
      columns(t, f.columnIds);
      if (f.label !== undefined) {
        if (typeof f.label !== "string" || f.label.length > 80)
          fail("関係ラベルは80文字以内にしてください。");
        f.label = f.label.trim();
      }
      if (f.cardinality !== undefined) {
        if (
          !f.cardinality ||
          typeof f.cardinality !== "object" ||
          Array.isArray(f.cardinality) ||
          Object.keys(f.cardinality).some(
            (k) => !["parentMinimum", "childMinimum"].includes(k),
          ) ||
          Object.values(f.cardinality).some(
            (v) => v !== undefined && v !== 0 && v !== 1,
          )
        )
          fail("関係の最小数は0・1・未指定のいずれかにしてください。");
      }
      if (!f.target) continue;
      const parent = tables.find((p) => p.id === f.target!.tableId);
      if (!parent) fail("外部キーの参照先テーブルがありません。");
      columns(parent, f.target.columnIds);
      if (
        f.columnIds.length !== f.target.columnIds.length ||
        !parent.keys!.some(
          (k) =>
            k.kind !== "index" &&
            JSON.stringify(k.columnIds) === JSON.stringify(f.target!.columnIds),
        )
      )
        fail(
          "外部キーの参照先には、同じ順序・個数の主キーまたは一意制約を指定してください。",
        );
    }
  }
}

// Drawing edges are a projection of constraints. Existing edges supply only route overrides.
function deriveEdges(tables: Table[], previousEdges: Edge[]): Edge[] {
  const edges: Edge[] = [];
  for (const t of tables) {
    for (const f of t.foreignKeys ?? []) {
      if (!f.target) continue;
      const parent = tables.find((p) => p.id === f.target!.tableId)!;
      f.columnIds.forEach((id, i) => {
        const old = previousEdges.find(
          (e) =>
            e.foreignKeyId === f.id &&
            e.to.table === t.id &&
            t.columns[e.to.row]?.id === id,
        );
        const [fromSide, toSide] = connectionSides(parent, t);
        edges.push({
          id: `${f.id}:${i}`,
          foreignKeyId: f.id,
          from: {
            table: parent.id,
            row: parent.columns.findIndex(
              (c) => c.id === f.target!.columnIds[i],
            ),
            side: old?.manual ? old.from.side : fromSide,
          },
          to: {
            table: t.id,
            row: t.columns.findIndex((c) => c.id === id),
            side: old?.manual ? old.to.side : toSide,
          },
          trunk: old?.trunk ?? null,
          manual: old?.manual ?? false,
        });
      });
    }
  }
  if (edges.length > 200) fail("接続は200本までです。");
  return edges;
}

function recomputeKeyFlags(tables: Table[]) {
  for (const t of tables) {
    for (const c of t.columns) {
      const pk = t.keys!.some(
        (k) => k.kind === "primary" && k.columnIds.includes(c.id),
      );
      const fk = t.foreignKeys!.some((f) => f.columnIds.includes(c.id));
      c.key = pk ? (fk ? "PK,FK" : "PK") : fk ? "FK" : "";
    }
  }
}

export function removeForeignKey(diagram: Diagram, id: string) {
  const next = structuredClone(diagram);
  for (const t of next.tables)
    t.foreignKeys = t.foreignKeys?.filter((f) => f.id !== id);
  return validateDiagram(next);
}
