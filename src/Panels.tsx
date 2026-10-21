import { useState } from "react";
import type { Column, Diagram, ForeignKey, Table } from "./types.ts";
import { Icon } from "./icons.tsx";

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
  selectedTable,
  selectedForeignKey,
  onSelectTable,
  onSelectEdge,
  onAdd,
  ...names
}: Names & {
  state: Diagram;
  selectedTable: string | null;
  selectedForeignKey?: string;
  onSelectTable: (id: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const tables = state.tables.filter(
    (t) =>
      !query ||
      [t.name, t.logicalName, t.id].some((s) =>
        s?.toLowerCase().includes(query),
      ),
  );
  const relations = state.tables.flatMap((child) =>
    (child.foreignKeys ?? []).flatMap((fk) => {
      const edge = state.edges.find((e) => e.foreignKeyId === fk.id);
      return edge
        ? [{ fk, edge, ...foreignKeyLabel(state, child, fk, names) }]
        : [];
    }),
  );
  return (
    <aside className="sidebar" aria-label="テーブルとリレーションの一覧">
      <label className="sidebar-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          aria-label="テーブルを絞り込む"
          placeholder="テーブルを絞り込む"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </label>
      <div className="sidebar-section">
        <h2>
          テーブル <span>{state.tables.length}</span>
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
        {tables.map((t) => (
          <li key={t.id}>
            <button
              className="sidebar-item"
              aria-current={selectedTable === t.id || undefined}
              onClick={() => onSelectTable(t.id)}
            >
              <Icon name="table" size={14} />
              <span className="sidebar-name">{names.displayTable(t)}</span>
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
      <div className="sidebar-section">
        <h2>
          リレーション <span>{relations.length}</span>
        </h2>
      </div>
      <ul className="sidebar-list">
        {relations.map((r) => (
          <li key={r.fk.id}>
            <button
              className="sidebar-item relation"
              aria-current={selectedForeignKey === r.fk.id || undefined}
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
    </aside>
  );
}
