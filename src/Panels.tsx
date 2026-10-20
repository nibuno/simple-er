import { useEffect, useState } from "react";
import type { Column, Diagram, ForeignKey, Table } from "./types.ts";
import { tableDDL } from "./ddl.ts";
import { Icon } from "./icons.tsx";
import { messageOf } from "./utils.ts";

type Names = {
  displayTable: (t: Table) => string;
  displayColumn: (c: Column) => string;
};
export function columnFlags(table: Table, columnId: string) {
  const keys = table.keys ?? [];
  return {
    pk: keys.some(
      (k) => k.kind === "primary" && k.columnIds.includes(columnId),
    ),
    fk: (table.foreignKeys ?? []).some((f) => f.columnIds.includes(columnId)),
    uq: keys.some(
      (k) =>
        k.kind === "unique" &&
        k.columnIds.length === 1 &&
        k.columnIds[0] === columnId,
    ),
  };
}
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
          <li className="sidebar-empty">カラム同士をクリックして接続</li>
        )}
      </ul>
    </aside>
  );
}

export function Inspector({
  table,
  state,
  logical,
  onRename,
  onOpenEditor,
  onClose,
  onSelectForeignKey,
  ...names
}: Names & {
  table: Table;
  state: Diagram;
  logical: boolean;
  onRename: (field: "name" | "logicalName", value: string) => void;
  onOpenEditor: () => void;
  onClose: () => void;
  onSelectForeignKey: (foreignKeyId: string) => void;
}) {
  const [values, setValues] = useState({
    name: table.name ?? table.id,
    logicalName: table.logicalName ?? "",
  });
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setValues({
      name: table.name ?? table.id,
      logicalName: table.logicalName ?? "",
    });
    setError("");
  }, [table.id, table.name, table.logicalName]);
  function apply(field: "name" | "logicalName") {
    const value = values[field];
    if (
      value ===
      (field === "name" ? (table.name ?? table.id) : (table.logicalName ?? ""))
    )
      return;
    try {
      onRename(field, value);
      setError("");
    } catch (e) {
      setError(messageOf(e));
    }
  }
  const ddl = tableDDL(table, state);
  const indexes = (table.keys ?? []).filter((k) => k.kind === "index");
  const field = (key: "name" | "logicalName", label: string) => (
    <label className="inspector-field">
      <span>{label}</span>
      <input
        className={key === "name" ? "mono" : ""}
        aria-label={`インスペクタで${label}を編集`}
        required={key === "name"}
        maxLength={80}
        autoComplete="off"
        placeholder={key === "name" ? "例: users" : "例: ユーザー"}
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        onBlur={() => apply(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            apply(key);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setValues({
              name: table.name ?? table.id,
              logicalName: table.logicalName ?? "",
            });
            setError("");
          }
        }}
      />
    </label>
  );
  return (
    <aside
      className="inspector"
      aria-label={`${names.displayTable(table)}の詳細`}
    >
      <div className="inspector-heading">
        <Icon name="table" />
        <h2 className="mono">{names.displayTable(table)}</h2>
        <span className="inspector-kind">テーブル</span>
        <span className="spacer" />
        <button
          className="icon-button"
          aria-label="詳細を閉じる"
          title="閉じる (Esc)"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="inspector-body">
        <div className="inspector-names">
          {field("name", "物理名")}
          {field("logicalName", "論理名")}
        </div>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="inspector-section">
          <h3>
            カラム <span>{table.columns.length}</span>
          </h3>
          <span className="flag-legend" aria-hidden="true">
            <span>PK</span>
            <span>FK</span>
            <span>UQ</span>
          </span>
        </div>
        <ul className="inspector-columns">
          {table.columns.map((c) => {
            const flags = columnFlags(table, c.id);
            const fks = (table.foreignKeys ?? []).filter((f) =>
              f.columnIds.includes(c.id),
            );
            return (
              <li key={c.id}>
                <div className="inspector-column">
                  <span
                    className="mono column-label"
                    title={c.logicalName || c.name}
                  >
                    {logical && c.logicalName ? c.logicalName : c.name}
                  </span>
                  <span className="mono column-kind">{c.type}</span>
                  <span className="flags">
                    <span className={`flag${flags.pk ? " pk" : ""}`}>
                      {flags.pk ? "PK" : ""}
                    </span>
                    <span className={`flag${flags.fk ? " fk" : ""}`}>
                      {flags.fk ? "FK" : ""}
                    </span>
                    <span className={`flag${flags.uq ? " uq" : ""}`}>
                      {flags.uq ? "UQ" : ""}
                    </span>
                  </span>
                </div>
                {fks.map((fk) => (
                  <button
                    key={fk.id}
                    className="inspector-reference mono"
                    onClick={() => onSelectForeignKey(fk.id)}
                    disabled={!fk.target}
                  >
                    → {foreignKeyLabel(state, table, fk, names).to}
                  </button>
                ))}
              </li>
            );
          })}
        </ul>
        {indexes.length > 0 && (
          <p className="inspector-note">
            インデックス {indexes.length}
            件・複合キーは詳細エディタで編集できます
          </p>
        )}
        <details className="inspector-ddl">
          <summary>DDL プレビュー</summary>
          <div className="ddl-tools">
            <span>PostgreSQL</span>
            <button
              className="icon-button"
              aria-label="DDLをコピー"
              title="コピー"
              onClick={() => {
                navigator.clipboard?.writeText(ddl).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  },
                  () => {},
                );
              }}
            >
              <Icon name={copied ? "check" : "copy"} />
            </button>
          </div>
          <pre className="ddl">{ddl}</pre>
        </details>
      </div>
      <div className="inspector-footer">
        <button onClick={onOpenEditor}>
          <Icon name="external" size={14} />
          詳細エディタで開く
        </button>
      </div>
    </aside>
  );
}
