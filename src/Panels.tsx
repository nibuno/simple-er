import { useState, type RefObject } from "react";
import { isImeKey } from "../shared/ime.ts";
import type { Column, Diagram, ForeignKey, Table } from "./types.ts";
import { Icon } from "./icons.tsx";
import { qualifiedTitle } from "./model.ts";

function noteMatch(note: string | undefined, query: string) {
  if (!note) return "";
  const index = note.toLowerCase().indexOf(query);
  if (index < 0) return "";
  const start = Math.max(0, index - 8);
  const end = Math.min(note.length, index + query.length + 16);
  return (
    (start ? "…" : "") + note.slice(start, end) + (end < note.length ? "…" : "")
  );
}

type Names = {
  displayTable: (t: Table) => string;
  displayColumn: (c: Column) => string;
};
function foreignKeyLabel(
  state: Diagram,
  child: Table,
  fk: ForeignKey,
  { displayTable, displayColumn }: Names,
) {
  const parent = state.tables.find((t) => t.id === fk.target?.tableId);
  const from = fk.columnIds
    .map((id) => child.columns.find((c) => c.id === id))
    .map((c) => (c ? displayColumn(c) : "?"))
    .join(", ");
  if (!parent || !fk.target)
    return { from: `${displayTable(child)}.${from}`, to: "未設定" };
  const to = fk.target.columnIds
    .map((id) => parent.columns.find((c) => c.id === id))
    .map((c) => (c ? displayColumn(c) : "?"))
    .join(", ");
  return {
    from: `${displayTable(child)}.${from}`,
    to: `${displayTable(parent)}.${to}`,
  };
}

export function Sidebar({
  state,
  visible,
  searchRef,
  selectedTable,
  selectedRelation,
  onSelectTable,
  onSelectEdge,
  onAdd,
  ...names
}: Names & {
  state: Diagram;
  visible: Diagram;
  searchRef: RefObject<HTMLInputElement | null>;
  selectedTable: string | null;
  selectedRelation?: string;
  onSelectTable: (id: string, matchedColumns?: string[]) => void;
  onSelectEdge: (edgeId: string) => void;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const matches = (value?: string) => !!value?.toLowerCase().includes(query);
  type Result = { table: Table; detail: string; columnIds?: string[] };
  const tables = (query ? state : visible).tables.flatMap<Result>((table) => {
    if (!query) return [{ table, detail: "", columnIds: undefined }];
    const columns = table.columns.flatMap((c) => {
      const label =
        [c.name, c.logicalName].find(matches) ||
        (matches(c.note) && names.displayColumn(c));
      return label ? [{ id: c.id, label }] : [];
    });
    const tableMatch =
      [
        qualifiedTitle(table),
        names.displayTable(table),
        table.logicalName,
        table.id,
        table.schemaName,
        state.groups?.find((g) => g.tableIds.includes(table.id))?.name,
      ].find(matches) || noteMatch(table.note, query);
    if (!tableMatch && !columns.length) return [];
    const detail = [
      tableMatch !== names.displayTable(table) && tableMatch,
      ...columns.map((c) => c.label),
    ]
      .filter(Boolean)
      .join("、");
    return [{ table, detail, columnIds: columns.map((c) => c.id) }];
  });
  const relations = (query ? [] : visible.tables).flatMap((child) =>
    (child.foreignKeys ?? []).flatMap((fk) => {
      const edge = visible.edges.find((e) => e.foreignKeyId === fk.id);
      return edge
        ? [{ id: fk.id, edge, ...foreignKeyLabel(state, child, fk, names) }]
        : [];
    }),
  );
  for (const edge of visible.edges.filter((e) => !query && e.entityRelation)) {
    const tableName = (id: string) =>
      names.displayTable(state.tables.find((t) => t.id === id)!);
    relations.push({
      id: edge.id,
      edge,
      from: tableName(edge.from.table),
      to: tableName(edge.to.table),
    });
  }
  return (
    <aside className="sidebar" aria-label="テーブルとリレーションの一覧">
      <label className="sidebar-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          ref={searchRef}
          aria-label="図の中を検索"
          placeholder="テーブル・カラム・囲みを検索"
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              query &&
              tables[0] &&
              !isImeKey(e.nativeEvent)
            ) {
              e.preventDefault();
              onSelectTable(tables[0].table.id, tables[0].columnIds);
            }
          }}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      <div className="sidebar-section">
        <h2>
          テーブル <span>{tables.length}</span>
        </h2>
        <button
          className="icon-button"
          aria-label="一覧からテーブルを追加"
          title="テーブルを追加 (T)"
          onClick={onAdd}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <ul className="sidebar-list">
        {tables.map(({ table: t, detail, columnIds }) => (
          <li key={t.id}>
            <button
              className="sidebar-item"
              aria-current={selectedTable === t.id || undefined}
              title={detail || undefined}
              onClick={() => onSelectTable(t.id, columnIds)}
            >
              <Icon name="table" size={14} />
              <span className="sidebar-name">
                {names.displayTable(t)}
                {detail && <small className="search-match">{detail}</small>}
              </span>
              <span className="sidebar-count">{t.columns.length}</span>
            </button>
          </li>
        ))}
        {!tables.length && (
          <li className="sidebar-empty">
            {state.tables.length
              ? "一致するテーブルはありません"
              : "テーブルはまだありません"}
          </li>
        )}
      </ul>
      {!query && (
        <>
          <div className="sidebar-section">
            <h2>
              リレーション <span>{relations.length}</span>
            </h2>
          </div>
          <ul className="sidebar-list">
            {relations.map((r) => (
              <li key={r.id}>
                <button
                  className="sidebar-item relation"
                  aria-current={selectedRelation === r.id || undefined}
                  onClick={() => onSelectEdge(r.edge.id)}
                >
                  <span className="sidebar-name">{r.from}</span>
                  <span className="arrow" aria-label="から">
                    →
                  </span>
                  <span className="sidebar-name">{r.to}</span>
                </button>
              </li>
            ))}
            {!relations.length && (
              <li className="sidebar-empty">カラム端の点をドラッグして接続</li>
            )}
          </ul>
        </>
      )}
    </aside>
  );
}
